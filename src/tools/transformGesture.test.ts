import { describe, expect, it } from 'vitest'
import {
  handleDocPosition,
  reflectDocTransform,
  rotateDocTransform,
  scaleDocTransform,
  shearDocTransform,
} from './behaviors/TransformHandleBehavior'
import { applyToPoint, decompose, invert, multiply } from '../geometry/matrix'
import type { BBox } from '../geometry/bbox'

const box: BBox = { minX: 0, minY: 0, maxX: 100, maxY: 100 }
const none = { shift: false, alt: false }

describe('scaleDocTransform', () => {
  it('corner drag scales both axes about the OPPOSITE corner', () => {
    // Drag BR (index 4) from (100,100) to (200,150): anchor is TL (0,0).
    const D = scaleDocTransform(box, 4, { x: 200, y: 150 }, none)
    expect(applyToPoint(D, { x: 0, y: 0 })).toEqual({ x: 0, y: 0 }) // anchor fixed
    expect(applyToPoint(D, { x: 100, y: 100 })).toEqual({ x: 200, y: 150 })
    const dec = decompose(D)
    expect(dec.scaleX).toBeCloseTo(2)
    expect(dec.scaleY).toBeCloseTo(1.5)
  })

  it('edge handles scale ONE axis only', () => {
    // Drag MR (index 3) from (100,50) to (150,999): y must be untouched.
    const D = scaleDocTransform(box, 3, { x: 150, y: 999 }, none)
    const p = applyToPoint(D, { x: 100, y: 80 })
    expect(p.x).toBeCloseTo(150)
    expect(p.y).toBeCloseTo(80)
  })

  it('Shift constrains a corner to uniform scale via diagonal projection', () => {
    const D = scaleDocTransform(box, 4, { x: 200, y: 100 }, { shift: true, alt: false })
    const dec = decompose(D)
    expect(dec.scaleX).toBeCloseTo(dec.scaleY)
    expect(dec.scaleX).toBeCloseTo(1.5) // projection of (200,100) onto the diagonal
  })

  it('Alt scales about the bbox CENTER', () => {
    const D = scaleDocTransform(box, 4, { x: 150, y: 150 }, { shift: false, alt: true })
    const center = applyToPoint(D, { x: 50, y: 50 })
    expect(center.x).toBeCloseTo(50) // center fixed
    expect(center.y).toBeCloseTo(50)
    expect(applyToPoint(D, { x: 100, y: 100 }).x).toBeCloseTo(150)
  })

  it('dragging past the anchor flips (negative scale)', () => {
    const D = scaleDocTransform(box, 4, { x: -100, y: 100 }, none)
    expect(decompose(D).scaleX * decompose(D).scaleY).toBeLessThan(0)
    expect(applyToPoint(D, { x: 100, y: 0 }).x).toBeCloseTo(-100)
  })

  it('degenerate axes (zero-size bbox) leave that axis at 1', () => {
    const flat: BBox = { minX: 0, minY: 50, maxX: 100, maxY: 50 } // zero height
    const D = scaleDocTransform(flat, 4, { x: 200, y: 80 }, none)
    const p = applyToPoint(D, { x: 50, y: 50 })
    expect(p.y).toBeCloseTo(50) // no y blow-up
  })

  it('handleDocPosition matches the overlay handle table', () => {
    expect(handleDocPosition(box, 0)).toEqual({ x: 0, y: 0 })
    expect(handleDocPosition(box, 3)).toEqual({ x: 100, y: 50 })
    expect(handleDocPosition(box, 5)).toEqual({ x: 50, y: 100 })
  })
})

describe('rotateDocTransform', () => {
  it('rotates about the bbox center by the swept angle', () => {
    // Start at MR direction, drag to BM direction: +90° in screen coords.
    const D = rotateDocTransform(box, { x: 150, y: 50 }, { x: 50, y: 150 }, false)
    const p = applyToPoint(D, { x: 100, y: 50 })
    expect(p.x).toBeCloseTo(50)
    expect(p.y).toBeCloseTo(100)
    // Center is fixed.
    const c = applyToPoint(D, { x: 50, y: 50 })
    expect(c.x).toBeCloseTo(50)
    expect(c.y).toBeCloseTo(50)
  })

  it('Shift snaps to 45° steps', () => {
    // Sweep of ~50°: snaps to 45°.
    const D = rotateDocTransform(
      box,
      { x: 150, y: 50 },
      { x: 50 + 100 * Math.cos(0.873), y: 50 + 100 * Math.sin(0.873) },
      true,
    )
    expect(decompose(D).rotation).toBeCloseTo(Math.PI / 4)
  })

  it('a rotation then its inverse is the identity (reversible)', () => {
    const D = rotateDocTransform(box, { x: 150, y: 50 }, { x: 90, y: 130 }, false)
    const round = multiply(invert(D), D)
    expect(round[0]).toBeCloseTo(1)
    expect(round[4]).toBeCloseTo(0)
    expect(round[5]).toBeCloseTo(0)
  })
})

describe('reflectDocTransform', () => {
  it('reflects across a horizontal axis (point to the right of center)', () => {
    // Axis angle 0 (pointer due right of center 50,50) → mirror across the
    // horizontal line y=50: x is unchanged, y flips about 50.
    const D = reflectDocTransform(box, { x: 150, y: 50 }, false)
    expect(applyToPoint(D, { x: 30, y: 20 })).toMatchObject({ x: 30 })
    const p = applyToPoint(D, { x: 30, y: 20 })
    expect(p.x).toBeCloseTo(30)
    expect(p.y).toBeCloseTo(80) // 20 reflected about y=50
    // Points ON the axis are fixed.
    const c = applyToPoint(D, { x: 10, y: 50 })
    expect(c.x).toBeCloseTo(10)
    expect(c.y).toBeCloseTo(50)
  })

  it('reflects across a vertical axis (point above center)', () => {
    // Axis angle 90° (pointer straight up) → mirror across the vertical line
    // x=50: y unchanged, x flips about 50.
    const D = reflectDocTransform(box, { x: 50, y: 150 }, false)
    const p = applyToPoint(D, { x: 20, y: 30 })
    expect(p.x).toBeCloseTo(80)
    expect(p.y).toBeCloseTo(30)
  })

  it('is a reflection (negative determinant) and an involution', () => {
    const D = reflectDocTransform(box, { x: 130, y: 90 }, false)
    const dec = decompose(D)
    expect(dec.scaleX * dec.scaleY).toBeLessThan(0) // orientation reversed
    // Applying it twice returns to the original.
    const twice = multiply(D, D)
    expect(applyToPoint(twice, { x: 33, y: 77 }).x).toBeCloseTo(33)
    expect(applyToPoint(twice, { x: 33, y: 77 }).y).toBeCloseTo(77)
  })

  it('Shift snaps the axis to 45° steps', () => {
    // Pointer at ~50° from center snaps the mirror axis to 45°.
    const D = reflectDocTransform(
      box,
      { x: 50 + 100 * Math.cos(0.873), y: 50 + 100 * Math.sin(0.873) },
      true,
    )
    // Reflection across a 45° axis swaps dx/dy about the center.
    const p = applyToPoint(D, { x: 70, y: 50 }) // (+20, 0) from center
    expect(p.x).toBeCloseTo(50)
    expect(p.y).toBeCloseTo(70) // becomes (0, +20)
  })
})

describe('shearDocTransform', () => {
  it('horizontal drag shears along X about the center (center fixed)', () => {
    // Drag +50 in x; halfH = 50 → k = 1. A point one half-height BELOW center
    // (y=100) shifts +50 in x; the center row (y=50) is unchanged.
    const D = shearDocTransform(box, { x: 50, y: 50 }, { x: 100, y: 50 }, { shift: false })
    const c = applyToPoint(D, { x: 50, y: 50 })
    expect(c.x).toBeCloseTo(50)
    expect(c.y).toBeCloseTo(50)
    const below = applyToPoint(D, { x: 50, y: 100 })
    expect(below.x).toBeCloseTo(100) // +50 (k=1 · Δy=50)
    expect(below.y).toBeCloseTo(100)
  })

  it('Shift shears along Y instead', () => {
    // halfW = 50; drag +50 in y → k = 1. A point one half-width RIGHT of
    // center (x=100) shifts +50 in y.
    const D = shearDocTransform(box, { x: 50, y: 50 }, { x: 50, y: 100 }, { shift: true })
    const right = applyToPoint(D, { x: 100, y: 50 })
    expect(right.x).toBeCloseTo(100)
    expect(right.y).toBeCloseTo(100)
  })

  it('produces a nonzero skew and preserves area (determinant 1)', () => {
    const D = shearDocTransform(box, { x: 50, y: 50 }, { x: 90, y: 50 }, { shift: false })
    const dec = decompose(D)
    expect(Math.abs(dec.skew)).toBeGreaterThan(0)
    // Pure shear preserves area.
    expect(D[0] * D[3] - D[1] * D[2]).toBeCloseTo(1)
  })
})
