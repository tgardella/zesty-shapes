/**
 * Gradient geometry: the mapping between a gradient's on-canvas annotator
 * (axis endpoints / center+radius in the node's LOCAL space) and the paint's
 * unit-space `transform` (emitted as gradientTransform with
 * gradientUnits="userSpaceOnUse").
 *
 * Unit-space convention (model/types.ts): linear runs (0,0) -> (1,0); radial
 * is the circle of radius 0.5 centered at (0.5,0.5). `transform` maps that
 * unit space into node-LOCAL coordinates.
 */

import type { Mat } from '../geometry/matrix'
import { applyToPoint } from '../geometry/matrix'
import type { Vec2 } from '../geometry/vec2'
import type { BBox } from '../geometry/bbox'
import { localBBoxOfNode } from '../geometry/bbox'
import type { GradientPaint, NodeId, RGBA, SceneNode } from './types'

/**
 * Transform placing a LINEAR axis from `a` to `b` (local space). The unit
 * y-axis maps to the axis normal at equal length, so unit space stays
 * conformal — stop math and future spread features never skew.
 */
export function linearAxisTransform(a: Vec2, b: Vec2): Mat {
  const dx = b.x - a.x
  const dy = b.y - a.y
  return [dx, dy, -dy, dx, a.x, a.y]
}

/** Transform placing a RADIAL gradient as the circle centered `c`, radius `r` (local space). */
export function radialCircleTransform(c: Vec2, r: number): Mat {
  const s = 2 * r
  return [s, 0, 0, s, c.x - r, c.y - r]
}

/** Linear annotator endpoints in LOCAL space: unit (0,0) and (1,0) through the transform. */
export function linearAxisOf(paint: GradientPaint): { a: Vec2; b: Vec2 } {
  return {
    a: applyToPoint(paint.transform, { x: 0, y: 0 }),
    b: applyToPoint(paint.transform, { x: 1, y: 0 }),
  }
}

/** Radial annotator in LOCAL space: center (0.5,0.5) and the (1,0.5) edge point. */
export function radialAxisOf(paint: GradientPaint): { center: Vec2; edge: Vec2 } {
  return {
    center: applyToPoint(paint.transform, { x: 0.5, y: 0.5 }),
    edge: applyToPoint(paint.transform, { x: 1, y: 0.5 }),
  }
}

/**
 * Default placement for a node: the gradient spans the node's local bbox
 * (left -> right for linear; inscribed for radial). Falls back to a unit
 * square when the node has no bbox yet (zero-size draft).
 */
export function defaultGradientTransform(
  node: SceneNode,
  nodes: Record<NodeId, SceneNode>,
  type: GradientPaint['gradientType'],
): Mat {
  const local: BBox = localBBoxOfNode(node, nodes) ?? { minX: 0, minY: 0, maxX: 100, maxY: 100 }
  const w = Math.max(local.maxX - local.minX, 1e-6)
  const h = Math.max(local.maxY - local.minY, 1e-6)
  if (type === 'linear') {
    return linearAxisTransform(
      { x: local.minX, y: (local.minY + local.maxY) / 2 },
      { x: local.maxX, y: (local.minY + local.maxY) / 2 },
    )
  }
  // Radial: ellipse filling the bbox (unit circle scaled non-uniformly).
  return [w, 0, 0, h, local.minX, local.minY]
}

/**
 * Refit any gradient paints on `node` to its (current) local bbox — used when
 * a NEW shape finishes drawing with a gradient current style, since the
 * cloned transform was sized for a different object.
 */
export function fitGradientsToNode(node: SceneNode, nodes: Record<NodeId, SceneNode>): void {
  for (const slot of ['fill', 'stroke'] as const) {
    const paint = node.style[slot]
    if (paint && paint.type === 'gradient') {
      paint.transform = defaultGradientTransform(node, nodes, paint.gradientType)
    }
  }
}

/** A fresh 2-stop gradient fading out of `from` (keeps the object's hue readable). */
export function defaultGradientFrom(
  from: RGBA,
  type: GradientPaint['gradientType'],
  transform: Mat,
): GradientPaint {
  return {
    type: 'gradient',
    gradientType: type,
    stops: [
      { offset: 0, color: { ...from, a: from.a > 0 ? from.a : 1 } },
      { offset: 1, color: { ...from, a: 0 } },
    ],
    transform: [...transform] as Mat,
  }
}
