/**
 * 2D vector math. Plain `{x, y}` objects, pure free functions.
 * These are the only point/vector primitives used across the model and geometry layers.
 */

export interface Vec2 {
  x: number
  y: number
}

export function vec2(x: number, y: number): Vec2 {
  return { x, y }
}

export const ZERO: Vec2 = Object.freeze({ x: 0, y: 0 })

export function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y }
}

export function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y }
}

export function scale(v: Vec2, s: number): Vec2 {
  return { x: v.x * s, y: v.y * s }
}

export function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y
}

/** z-component of the 3D cross product; sign gives winding/turn direction. */
export function cross(a: Vec2, b: Vec2): number {
  return a.x * b.y - a.y * b.x
}

export function length(v: Vec2): number {
  return Math.hypot(v.x, v.y)
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/** Returns ZERO for a zero-length input rather than NaN. */
export function normalize(v: Vec2): Vec2 {
  const len = Math.hypot(v.x, v.y)
  if (len === 0) return { x: 0, y: 0 }
  return { x: v.x / len, y: v.y / len }
}

export function lerp(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}

/** Angle of the vector in radians, in (-PI, PI], measured from +x axis. */
export function angle(v: Vec2): number {
  return Math.atan2(v.y, v.x)
}

/** Rotate `v` by `radians` around the origin (or around `center` if given). */
export function rotate(v: Vec2, radians: number, center?: Vec2): Vec2 {
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  const cx = center?.x ?? 0
  const cy = center?.y ?? 0
  const dx = v.x - cx
  const dy = v.y - cy
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos }
}

export function negate(v: Vec2): Vec2 {
  return { x: -v.x, y: -v.y }
}

/** Component-wise min/max, useful for bbox accumulation. */
export function min(a: Vec2, b: Vec2): Vec2 {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) }
}

export function max(a: Vec2, b: Vec2): Vec2 {
  return { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y) }
}

export function equals(a: Vec2, b: Vec2, epsilon = 1e-9): boolean {
  return Math.abs(a.x - b.x) <= epsilon && Math.abs(a.y - b.y) <= epsilon
}

export function clone(v: Vec2): Vec2 {
  return { x: v.x, y: v.y }
}
