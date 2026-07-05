/**
 * Affine 2D transform as the SVG 6-tuple [a, b, c, d, e, f], i.e. the matrix
 *
 *   | a  c  e |
 *   | b  d  f |
 *   | 0  0  1 |
 *
 * CONVENTION (fixed, do not change): column vectors, points transform as p' = M * p:
 *
 *   x' = a*x + c*y + e
 *   y' = b*x + d*y + f
 *
 * `multiply(A, B)` returns A*B, which applies B FIRST, then A:  (A*B)*p = A*(B*p).
 * Equivalently `compose(m1, m2, ...)` reads left-to-right as "outermost first":
 * compose(translate, rotate) rotates the point, then translates it — identical to
 * the SVG nesting <g transform="translate"><g transform="rotate">.
 */

import type { Vec2 } from './vec2'

export type Mat = [a: number, b: number, c: number, d: number, e: number, f: number]

export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0]

export function identity(): Mat {
  return [1, 0, 0, 1, 0, 0]
}

export function isIdentity(m: Mat, epsilon = 1e-12): boolean {
  return (
    Math.abs(m[0] - 1) <= epsilon &&
    Math.abs(m[1]) <= epsilon &&
    Math.abs(m[2]) <= epsilon &&
    Math.abs(m[3] - 1) <= epsilon &&
    Math.abs(m[4]) <= epsilon &&
    Math.abs(m[5]) <= epsilon
  )
}

/** A*B — applies B first, then A: (A*B)*p = A*(B*p). */
export function multiply(m1: Mat, m2: Mat): Mat {
  const [a1, b1, c1, d1, e1, f1] = m1
  const [a2, b2, c2, d2, e2, f2] = m2
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ]
}

/**
 * compose(m1, m2, ..., mn) = m1 * m2 * ... * mn.
 * Applied to a point, mn acts first and m1 acts last (outermost first, like SVG nesting).
 */
export function compose(...mats: Mat[]): Mat {
  let out = identity()
  for (const m of mats) out = multiply(out, m)
  return out
}

export function translate(tx: number, ty: number): Mat {
  return [1, 0, 0, 1, tx, ty]
}

export function scaleMat(sx: number, sy = sx): Mat {
  return [sx, 0, 0, sy, 0, 0]
}

/** Rotation by `radians` (CCW in a y-up frame; CW on screen where y grows down), optionally about a center point. */
export function rotateMat(radians: number, center?: Vec2): Mat {
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  const rot: Mat = [cos, sin, -sin, cos, 0, 0]
  if (!center) return rot
  return compose(translate(center.x, center.y), rot, translate(-center.x, -center.y))
}

export function applyToPoint(m: Mat, p: Vec2): Vec2 {
  return {
    x: m[0] * p.x + m[2] * p.y + m[4],
    y: m[1] * p.x + m[3] * p.y + m[5],
  }
}

/** Transforms a direction vector: rotation/scale/skew only, no translation. */
export function applyToVector(m: Mat, v: Vec2): Vec2 {
  return {
    x: m[0] * v.x + m[2] * v.y,
    y: m[1] * v.x + m[3] * v.y,
  }
}

export function determinant(m: Mat): number {
  return m[0] * m[3] - m[1] * m[2]
}

/** Inverse such that multiply(invert(m), m) ≈ identity. Throws on a singular matrix. */
export function invert(m: Mat): Mat {
  const [a, b, c, d, e, f] = m
  const det = a * d - b * c
  if (det === 0 || !Number.isFinite(det)) {
    throw new Error('matrix.invert: singular matrix')
  }
  const ia = d / det
  const ib = -b / det
  const ic = -c / det
  const id = a / det
  return [ia, ib, ic, id, -(ia * e + ic * f), -(ib * e + id * f)]
}

export interface DecomposedMat {
  /** Translation (e, f). */
  tx: number
  ty: number
  /** Rotation in radians, atan2 of the first column. */
  rotation: number
  scaleX: number
  /** Signed: negative when the matrix contains a reflection. */
  scaleY: number
  /** Shear factor k (x' = x + k*y before rotation), NOT an angle. */
  skew: number
}

/**
 * QR-style decomposition: M = T(tx,ty) * R(rotation) * Shear(skew) * S(scaleX, scaleY).
 * Round-trips through `recompose` (up to float precision) for any non-singular matrix.
 * Degenerate (singular) matrices decompose with zero scale and are not round-trippable.
 */
export function decompose(m: Mat): DecomposedMat {
  const [a, b, c, d, e, f] = m
  const scaleX = Math.hypot(a, b)
  if (scaleX === 0) {
    return { tx: e, ty: f, rotation: 0, scaleX: 0, scaleY: Math.hypot(c, d), skew: 0 }
  }
  const an = a / scaleX
  const bn = b / scaleX
  // Project column 2 onto normalized column 1 to extract shear, then the remainder is scaleY.
  const shearRaw = an * c + bn * d
  const c2 = c - an * shearRaw
  const d2 = d - bn * shearRaw
  const scaleY = an * d2 - bn * c2 // signed length along the perpendicular of column 1
  const skew = scaleY !== 0 ? shearRaw / scaleY : 0
  return { tx: e, ty: f, rotation: Math.atan2(b, a), scaleX, scaleY, skew }
}

export function recompose(dec: DecomposedMat): Mat {
  const shear: Mat = [1, 0, dec.skew, 1, 0, 0]
  return compose(
    translate(dec.tx, dec.ty),
    rotateMat(dec.rotation),
    shear,
    scaleMat(dec.scaleX, dec.scaleY),
  )
}

export function matEquals(m1: Mat, m2: Mat, epsilon = 1e-9): boolean {
  for (let i = 0; i < 6; i++) {
    if (Math.abs(m1[i]! - m2[i]!) > epsilon) return false
  }
  return true
}

/** SVG attribute string: `matrix(a,b,c,d,e,f)`. */
export function toSvgTransform(m: Mat): string {
  return `matrix(${m.join(',')})`
}
