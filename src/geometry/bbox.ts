/**
 * Axis-aligned bounding boxes: node-local, world (transform-applied), union.
 * Path bboxes are TIGHT (bezier extrema via derivative roots, not control hulls).
 */

import type { Mat } from './matrix'
import { applyToPoint } from './matrix'
import type { Vec2 } from './vec2'
import type { SceneNode, SubPath, NodeId } from '../model/types'
import { bboxOf as cubicBBox } from './bezier'
import { segmentsOfSubPath } from './pathData'
import { toSubPaths } from '../model/nodes'

export interface BBox {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export function bbox(minX: number, minY: number, maxX: number, maxY: number): BBox {
  return { minX, minY, maxX, maxY }
}

export function bboxWidth(b: BBox): number {
  return b.maxX - b.minX
}

export function bboxHeight(b: BBox): number {
  return b.maxY - b.minY
}

export function bboxCenter(b: BBox): Vec2 {
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 }
}

export function bboxFromPoints(points: Vec2[]): BBox | null {
  if (points.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of points) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  return { minX, minY, maxX, maxY }
}

export function unionBBox(a: BBox | null, b: BBox | null): BBox | null {
  if (!a) return b
  if (!b) return a
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  }
}

export function bboxContainsPoint(b: BBox, p: Vec2): boolean {
  return p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY
}

export function bboxesIntersect(a: BBox, b: BBox): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY
}

/**
 * AABB of the transformed box (transforms the 4 corners). For rotated content
 * this is the bbox OF the bbox — conservative, which is what selection
 * bounds and marquee prefiltering want.
 */
export function transformBBox(m: Mat, b: BBox): BBox {
  const corners = [
    applyToPoint(m, { x: b.minX, y: b.minY }),
    applyToPoint(m, { x: b.maxX, y: b.minY }),
    applyToPoint(m, { x: b.maxX, y: b.maxY }),
    applyToPoint(m, { x: b.minX, y: b.maxY }),
  ]
  return bboxFromPoints(corners)!
}

/** Tight bbox of subpath geometry (curve extrema, not control points). */
export function bboxOfSubPaths(subpaths: SubPath[]): BBox | null {
  let out: BBox | null = null
  for (const sp of subpaths) {
    if (sp.anchors.length === 1) {
      out = unionBBox(out, bboxFromPoints([sp.anchors[0]!.point]))
      continue
    }
    for (const seg of segmentsOfSubPath(sp)) {
      if (seg.kind === 'line') {
        out = unionBBox(out, bboxFromPoints([seg.a, seg.b]))
      } else {
        out = unionBBox(out, cubicBBox(seg.cubic))
      }
    }
  }
  return out
}

/**
 * Node-local bbox (before the node's own transform).
 * Groups union their children's bboxes mapped through each child's transform.
 * TextNode returns null: text bboxes need font measurement (later phase).
 */
export function localBBoxOfNode(
  node: SceneNode,
  nodes: Record<NodeId, SceneNode>,
): BBox | null {
  if (node.type === 'group') {
    let out: BBox | null = null
    for (const childId of node.children) {
      const child = nodes[childId]
      if (!child) continue
      const childLocal = localBBoxOfNode(child, nodes)
      if (childLocal) out = unionBBox(out, transformBBox(child.transform, childLocal))
    }
    return out
  }
  if (node.type === 'text') return null
  return bboxOfSubPaths(toSubPaths(node))
}

/**
 * World bbox: local bbox mapped through the node's EFFECTIVE (world) transform —
 * the product of all ancestor transforms times its own (see getWorldTransform).
 */
export function worldBBoxOfNode(
  nodes: Record<NodeId, SceneNode>,
  id: NodeId,
  worldTransform: Mat,
): BBox | null {
  const node = nodes[id]
  if (!node) return null
  const local = localBBoxOfNode(node, nodes)
  return local ? transformBBox(worldTransform, local) : null
}
