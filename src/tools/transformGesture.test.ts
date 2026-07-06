import { describe, expect, it } from 'vitest'
import {
  handleDocPosition,
  rotateDocTransform,
  scaleDocTransform,
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
