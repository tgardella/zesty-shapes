/**
 * Cubic bezier math. Thin wrapper around bezier-js — its types must not leak
 * out of this file; everything is expressed in our own CubicSegment / Vec2 terms.
 */

import { Bezier } from 'bezier-js'
import type { Vec2 } from './vec2'
import { distance, lerp } from './vec2'

/** A single cubic segment with ABSOLUTE control points (local space). */
export interface CubicSegment {
  p0: Vec2
  p1: Vec2
  p2: Vec2
  p3: Vec2
}

export interface NearestPoint {
  /** Curve parameter of the closest point, 0-1. */
  t: number
  point: Vec2
  distance: number
}

/** Axis-aligned extents; kept local to avoid a value-cycle with bbox.ts. */
export interface CubicExtents {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

function toBezier(seg: CubicSegment): Bezier {
  return new Bezier([seg.p0, seg.p1, seg.p2, seg.p3])
}

/** Promote a straight line to an equivalent cubic (control points at the thirds). */
export function lineToCubic(a: Vec2, b: Vec2): CubicSegment {
  return { p0: a, p1: lerp(a, b, 1 / 3), p2: lerp(a, b, 2 / 3), p3: b }
}

export function pointAt(seg: CubicSegment, t: number): Vec2 {
  if (t <= 0) return { ...seg.p0 }
  if (t >= 1) return { ...seg.p3 }
  const p = toBezier(seg).get(t)
  return { x: p.x, y: p.y }
}

/** De Casteljau split at t; both halves keep exact geometric continuity. */
export function splitAt(seg: CubicSegment, t: number): [CubicSegment, CubicSegment] {
  const { left, right } = toBezier(seg).split(t)
  const l = left.points
  const r = right.points
  return [
    { p0: v(l[0]), p1: v(l[1]), p2: v(l[2]), p3: v(l[3]) },
    { p0: v(r[0]), p1: v(r[1]), p2: v(r[2]), p3: v(r[3]) },
  ]
}

function v(p: { x: number; y: number } | undefined): Vec2 {
  if (!p) throw new Error('bezier: malformed split result')
  return { x: p.x, y: p.y }
}

/** TIGHT bounding box via derivative roots (not the control hull). */
export function bboxOf(seg: CubicSegment): CubicExtents {
  const b = toBezier(seg).bbox()
  return { minX: b.x.min, minY: b.y.min, maxX: b.x.max, maxY: b.y.max }
}

export function lengthOf(seg: CubicSegment): number {
  return toBezier(seg).length()
}

/** Closest point on the curve to `p` (bezier-js projection + local refinement). */
export function nearestT(seg: CubicSegment, p: Vec2): NearestPoint {
  const proj = toBezier(seg).project(p)
  const point = { x: proj.x, y: proj.y }
  return { t: proj.t, point, distance: proj.d ?? distance(point, p) }
}

/**
 * Flatten to a polyline of `steps` chords (steps+1 points, including both ends).
 * Used by fill hit-testing and marquee intersection.
 */
export function flatten(seg: CubicSegment, steps = 24): Vec2[] {
  const out: Vec2[] = [{ ...seg.p0 }]
  for (let i = 1; i < steps; i++) {
    out.push(pointAt(seg, i / steps))
  }
  out.push({ ...seg.p3 })
  return out
}
