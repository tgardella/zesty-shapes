/**
 * Hit-testing glue for tools.
 *
 * - Click selection uses the browser's DOM hit-test: NodeView stamps
 *   data-node-id on every scene element; we resolve the event target and
 *   climb to the TOP-LEVEL ancestor (direct child of root).
 * - Marquee selection is geometric: node subpaths are mapped local -> world
 *   through worldTransform (NEVER ancestor-agnostic math) and intersected
 *   with the doc-space rect.
 */

import type { BBox } from '../geometry/bbox'
import { bboxesIntersect, localBBoxOfNode, transformBBox } from '../geometry/bbox'
import { rectIntersectsSubPaths } from '../geometry/hittest'
import { transformSubPaths } from '../geometry/pathData'
import type { Document, NodeId, SceneNode } from '../model/types'
import { toSubPaths } from '../model/nodes'
import { worldTransform } from '../store/worldTransform'

/** Resolve a pointer-event target to the top-level (child-of-root) node id. */
export function topNodeIdFromTarget(doc: Document, target: EventTarget | null): NodeId | null {
  if (!(target instanceof Element)) return null
  const el = target.closest('[data-node-id]')
  if (!el) return null
  const rawId = el.getAttribute('data-node-id')
  const hit: SceneNode | undefined = rawId ? doc.nodes[rawId] : undefined
  if (!hit) return null
  let node: SceneNode = hit
  while (node.parent !== null && node.parent !== doc.root) {
    const parent: SceneNode | undefined = doc.nodes[node.parent]
    if (!parent) return null
    node = parent
  }
  if (node.parent !== doc.root) return null
  if (node.locked || node.hidden) return null
  return node.id
}

/** Top-level ids whose subtree geometry intersects the doc-space rect. */
export function nodesInDocRect(doc: Document, rect: BBox): NodeId[] {
  const root = doc.nodes[doc.root]
  if (!root || root.type !== 'group') return []
  return root.children.filter((id) => {
    const node = doc.nodes[id]
    if (!node || node.locked || node.hidden) return false
    return subtreeIntersectsRect(doc, id, rect)
  })
}

function subtreeIntersectsRect(doc: Document, id: NodeId, rect: BBox): boolean {
  const node = doc.nodes[id]
  if (!node || node.hidden) return false
  if (node.type === 'group') {
    return node.children.some((childId) => subtreeIntersectsRect(doc, childId, rect))
  }
  if (node.type === 'text') return false // reserved kind, no measurable geometry yet
  const world = worldTransform(doc.nodes, id)
  const local = localBBoxOfNode(node, doc.nodes)
  if (local && !bboxesIntersect(transformBBox(world, local), rect)) return false
  return rectIntersectsSubPaths(rect, transformSubPaths(world, toSubPaths(node)), node.style.fillRule)
}
