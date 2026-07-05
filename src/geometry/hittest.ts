/**
 * Pure hit-testing primitives. All inputs are in the SAME coordinate space —
 * callers convert screen -> doc -> world -> local through worldTransform and
 * its inverse BEFORE calling, and convert screen-px tolerances by dividing by
 * zoom. Nothing here knows about the viewport.
 */

import type { SubPath, FillRule } from '../model/types'
import type { Vec2 } from './vec2'
import { distance, sub, dot } from './vec2'
import type { BBox } from './bbox'
import { bboxOfSubPaths, bboxContainsPoint, bboxesIntersect } from './bbox'
import { flatten, nearestT } from './bezier'
import { segmentsOfSubPath } from './pathData'

/** Chords per cubic when flattening for winding/intersection tests. */
const FLATTEN_STEPS = 24

/**
 * Flatten a subpath to a polyline. Closed subpaths repeat the start point at
 * the end so consecutive pairs cover every edge.
 */
export function flattenSubPath(subpath: SubPath, steps = FLATTEN_STEPS): Vec2[] {
  const segs = segmentsOfSubPath(subpath)
  if (segs.length === 0) return subpath.anchors.map((a) => ({ ...a.point }))
  const out: Vec2[] = []
  for (const seg of segs) {
    const pts = seg.kind === 'line' ? [seg.a, seg.b] : flatten(seg.cubic, steps)
    // Skip each segment's first point after the first segment (shared vertex).
    for (let i = out.length === 0 ? 0 : 1; i < pts.length; i++) out.push(pts[i]!)
  }
  return out
}

/**
 * Point-in-fill test honoring the fill rule. Open subpaths are treated as
 * implicitly closed for filling, matching SVG fill semantics.
 */
export function pointInSubPaths(point: Vec2, subpaths: SubPath[], fillRule: FillRule = 'nonzero'): boolean {
  let winding = 0
  let crossings = 0
  for (const sp of subpaths) {
    const poly = flattenSubPath(sp)
    if (poly.length < 3) continue
    const closed = closeRing(poly)
    for (let i = 0; i < closed.length - 1; i++) {
      const a = closed[i]!
      const b = closed[i + 1]!
      if (a.y <= point.y) {
        if (b.y > point.y && isLeft(a, b, point) > 0) {
          winding++
          crossings++
        }
      } else if (b.y <= point.y && isLeft(a, b, point) < 0) {
        winding--
        crossings++
      }
    }
  }
  return fillRule === 'nonzero' ? winding !== 0 : crossings % 2 === 1
}

function closeRing(poly: Vec2[]): Vec2[] {
  const first = poly[0]!
  const last = poly[poly.length - 1]!
  if (first.x === last.x && first.y === last.y) return poly
  return [...poly, first]
}

/** > 0 if p is left of the directed line a->b. */
function isLeft(a: Vec2, b: Vec2, p: Vec2): number {
  return (b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y)
}

/** Exact distance from a point to the path outline (bezier projection for curves). */
export function distanceToSubPaths(point: Vec2, subpaths: SubPath[]): number {
  let best = Infinity
  for (const sp of subpaths) {
    for (const seg of segmentsOfSubPath(sp)) {
      const d =
        seg.kind === 'line'
          ? distanceToSegment(point, seg.a, seg.b)
          : nearestT(seg.cubic, point).distance
      if (d < best) best = d
    }
    // A single-anchor subpath still has a hittable point.
    if (sp.anchors.length === 1) {
      const d = distance(point, sp.anchors[0]!.point)
      if (d < best) best = d
    }
  }
  return best
}

export function distanceToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const ab = sub(b, a)
  const lenSq = ab.x * ab.x + ab.y * ab.y
  if (lenSq === 0) return distance(p, a)
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / lenSq))
  return distance(p, { x: a.x + ab.x * t, y: a.y + ab.y * t })
}

/**
 * Stroke hit: within strokeWidth/2 + tolerance of the outline.
 * `tolerance` is in the SAME space as the geometry (screen px / zoom).
 */
export function hitTestStroke(
  point: Vec2,
  subpaths: SubPath[],
  strokeWidth: number,
  tolerance: number,
): boolean {
  return distanceToSubPaths(point, subpaths) <= strokeWidth / 2 + tolerance
}

/** Anchor grabbing: `tolerance` is screen px already divided by zoom by the caller. */
export function pointNearPoint(a: Vec2, b: Vec2, tolerance: number): boolean {
  return distance(a, b) <= tolerance
}

/**
 * Marquee test: does the rect touch the path? True when any outline point
 * falls inside the rect, any flattened edge crosses a rect edge, or the rect
 * sits entirely inside the filled path.
 */
export function rectIntersectsSubPaths(
  rect: BBox,
  subpaths: SubPath[],
  fillRule: FillRule = 'nonzero',
): boolean {
  const pathBounds = bboxOfSubPaths(subpaths)
  if (!pathBounds || !bboxesIntersect(rect, pathBounds)) return false

  const rectCorners: Vec2[] = [
    { x: rect.minX, y: rect.minY },
    { x: rect.maxX, y: rect.minY },
    { x: rect.maxX, y: rect.maxY },
    { x: rect.minX, y: rect.maxY },
  ]

  for (const sp of subpaths) {
    const poly = flattenSubPath(sp)
    for (const p of poly) {
      if (bboxContainsPoint(rect, p)) return true
    }
    for (let i = 0; i < poly.length - 1; i++) {
      for (let j = 0; j < 4; j++) {
        if (segmentsIntersect(poly[i]!, poly[i + 1]!, rectCorners[j]!, rectCorners[(j + 1) % 4]!)) {
          return true
        }
      }
    }
  }
  // Rect entirely inside the filled region (no outline touched).
  return pointInSubPaths({ x: (rect.minX + rect.maxX) / 2, y: (rect.minY + rect.maxY) / 2 }, subpaths, fillRule)
}

function segmentsIntersect(a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2): boolean {
  const d1 = isLeft(b1, b2, a1)
  const d2 = isLeft(b1, b2, a2)
  const d3 = isLeft(a1, a2, b1)
  const d4 = isLeft(a1, a2, b2)
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true
  }
  // Collinear touching counts as intersecting.
  if (d1 === 0 && onSegment(b1, b2, a1)) return true
  if (d2 === 0 && onSegment(b1, b2, a2)) return true
  if (d3 === 0 && onSegment(a1, a2, b1)) return true
  if (d4 === 0 && onSegment(a1, a2, b2)) return true
  return false
}

function onSegment(a: Vec2, b: Vec2, p: Vec2): boolean {
  return (
    Math.min(a.x, b.x) <= p.x &&
    p.x <= Math.max(a.x, b.x) &&
    Math.min(a.y, b.y) <= p.y &&
    p.y <= Math.max(a.y, b.y)
  )
}
