/**
 * Hit-testing glue for tools.
 *
 * - Click selection uses the browser's DOM hit-test: NodeView stamps
 *   data-node-id on every scene element; we resolve the event target and
 *   climb to the top-level ancestor WITHIN THE CURRENT SCOPE (the edit scope
 *   entered by double-clicking a group; the document root by default).
 * - Marquee selection is geometric: node subpaths are mapped local -> world
 *   through worldTransform (NEVER ancestor-agnostic math) and intersected
 *   with the doc-space rect ('intersect'), or their world bboxes must fit
 *   entirely inside it ('contain').
 */

import type { BBox } from '../geometry/bbox'
import { bboxesIntersect, localBBoxOfNode, transformBBox } from '../geometry/bbox'
import {
  distanceToSubPaths,
  pointInSubPaths,
  rectIntersectsSubPaths,
} from '../geometry/hittest'
import { transformSubPaths } from '../geometry/pathData'
import type { Vec2 } from '../geometry/vec2'
import type { Document, NodeId, SceneNode } from '../model/types'
import { toSubPaths } from '../model/nodes'
import { worldTransform } from '../store/worldTransform'

export type MarqueeMode = 'intersect' | 'contain'

/**
 * Lock/hide INHERIT to children: a node is selectable only if neither it nor
 * any ancestor is locked or hidden.
 */
export function isSelectableDeep(nodes: Record<NodeId, SceneNode>, id: NodeId): boolean {
  let cur: SceneNode | undefined = nodes[id]
  while (cur) {
    if (cur.locked || cur.hidden) return false
    cur = cur.parent === null ? undefined : nodes[cur.parent]
  }
  return true
}

/**
 * Climb from any node to its top-level ancestor under `scopeId` (pure —
 * shared by DOM and geometric hit paths). When the node is NOT inside the
 * scope subtree, falls back to its child-of-root ancestor so out-of-scope
 * clicks still resolve (the Selection tool exits the scope in that case).
 * Returns null for the root/scope itself or unknown ids.
 */
export function resolveTopLevel(doc: Document, leafId: NodeId, scopeId: NodeId): NodeId | null {
  const leaf = doc.nodes[leafId]
  if (!leaf || leafId === doc.root || leafId === scopeId) return null
  // Walk up, remembering the child-of-scope and child-of-root candidates.
  let node: SceneNode = leaf
  let childOfScope: NodeId | null = null
  let childOfRoot: NodeId | null = null
  while (node.parent !== null) {
    if (node.parent === scopeId) childOfScope = node.id
    if (node.parent === doc.root) childOfRoot = node.id
    const parent: SceneNode | undefined = doc.nodes[node.parent]
    if (!parent) return null
    node = parent
  }
  return childOfScope ?? childOfRoot
}

/**
 * Resolve a pointer-event target to the LEAF node it painted (no scope
 * climbing) — Direct Selection and the deep path tools edit the actual
 * object at any nesting depth.
 */
export function leafNodeIdFromTarget(doc: Document, target: EventTarget | null): NodeId | null {
  if (!(target instanceof Element)) return null
  const el = target.closest('[data-node-id]')
  if (!el) return null
  const id = el.getAttribute('data-node-id')
  if (!id || !doc.nodes[id] || id === doc.root) return null
  return isSelectableDeep(doc.nodes, id) ? id : null
}

/** Resolve a pointer-event target to a selectable top-level node id. */
export function topNodeIdFromTarget(
  doc: Document,
  target: EventTarget | null,
  scopeId: NodeId = doc.root,
): NodeId | null {
  if (!(target instanceof Element)) return null
  const el = target.closest('[data-node-id]')
  if (!el) return null
  const rawId = el.getAttribute('data-node-id')
  if (!rawId) return null
  const topId = resolveTopLevel(doc, rawId, scopeId)
  if (!topId) return null
  if (!isSelectableDeep(doc.nodes, topId)) return null
  return topId
}

/**
 * GEOMETRIC point hit-test: the topmost selectable leaf whose geometry is
 * within `tolerance` (doc units) of the point — fills count when the point
 * is inside, outlines within the tolerance band, text by its layout bbox.
 * Backstop for the DOM hit-test: DOM hits only painted pixels, so clicking
 * the edge of an unfilled shape or between the glyphs of a text block
 * misses; this doesn't.
 */
export function leafNodeAtPoint(doc: Document, point: Vec2, tolerance: number): NodeId | null {
  const visit = (id: NodeId): NodeId | null => {
    const node = doc.nodes[id]
    if (!node || node.locked || node.hidden) return null
    if (node.type === 'group') {
      // Topmost first: children paint in array order, so scan back-to-front.
      for (let i = node.children.length - 1; i >= 0; i--) {
        const hit = visit(node.children[i]!)
        if (hit) return hit
      }
      return null
    }
    const world = worldTransform(doc.nodes, id)
    if (node.type === 'text') {
      const local = localBBoxOfNode(node, doc.nodes)
      if (!local) return null
      const b = transformBBox(world, local)
      const inX = point.x >= b.minX - tolerance && point.x <= b.maxX + tolerance
      const inY = point.y >= b.minY - tolerance && point.y <= b.maxY + tolerance
      return inX && inY ? id : null
    }
    const subpaths = transformSubPaths(world, toSubPaths(node))
    if (node.style.fill && pointInSubPaths(point, subpaths, node.style.fillRule)) return id
    const band = tolerance + (node.style.stroke ? node.style.strokeWidth / 2 : 0)
    return distanceToSubPaths(point, subpaths) <= band ? id : null
  }
  return visit(doc.root)
}

/**
 * Children of `scopeId` matched by the doc-space marquee rect.
 * 'intersect': any geometry touches the rect. 'contain': the node's world
 * bbox lies entirely inside the rect.
 */
export function nodesInDocRect(
  doc: Document,
  rect: BBox,
  opts: { scopeId?: NodeId; mode?: MarqueeMode } = {},
): NodeId[] {
  const scopeId = opts.scopeId ?? doc.root
  const mode = opts.mode ?? 'intersect'
  const scope = doc.nodes[scopeId]
  if (!scope || scope.type !== 'group') return []
  return scope.children.filter((id) => {
    if (!isSelectableDeep(doc.nodes, id)) return false
    if (mode === 'contain') return subtreeContainedInRect(doc, id, rect)
    return subtreeIntersectsRect(doc, id, rect)
  })
}

function subtreeIntersectsRect(doc: Document, id: NodeId, rect: BBox): boolean {
  const node = doc.nodes[id]
  if (!node || node.hidden) return false
  if (node.type === 'group') {
    return node.children.some((childId) => subtreeIntersectsRect(doc, childId, rect))
  }
  const world = worldTransform(doc.nodes, id)
  const local = localBBoxOfNode(node, doc.nodes)
  if (local && !bboxesIntersect(transformBBox(world, local), rect)) return false
  // Text has no outline geometry to intersect; its (layout) bbox decides.
  if (node.type === 'text') return local !== null
  return rectIntersectsSubPaths(rect, transformSubPaths(world, toSubPaths(node)), node.style.fillRule)
}

function subtreeContainedInRect(doc: Document, id: NodeId, rect: BBox): boolean {
  const node = doc.nodes[id]
  if (!node || node.hidden) return false
  const local = localBBoxOfNode(node, doc.nodes)
  if (!local) return false
  const world = transformBBox(worldTransform(doc.nodes, id), local)
  return (
    world.minX >= rect.minX &&
    world.maxX <= rect.maxX &&
    world.minY >= rect.minY &&
    world.maxY <= rect.maxY
  )
}
