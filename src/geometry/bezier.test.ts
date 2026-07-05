import { describe, expect, it } from 'vitest'
import { bboxOf, lengthOf, lineToCubic, nearestT, pointAt, splitAt, type CubicSegment } from './bezier'

const arch: CubicSegment = {
  p0: { x: 0, y: 0 },
  p1: { x: 0, y: -100 },
  p2: { x: 100, y: -100 },
  p3: { x: 100, y: 0 },
}

describe('bezier wrapper', () => {
  it('pointAt hits both endpoints exactly', () => {
    expect(pointAt(arch, 0)).toEqual(arch.p0)
    expect(pointAt(arch, 1)).toEqual(arch.p3)
    const mid = pointAt(arch, 0.5)
    expect(mid.x).toBeCloseTo(50)
    expect(mid.y).toBeCloseTo(-75)
  })

  it('splitAt keeps geometric continuity', () => {
    const [left, right] = splitAt(arch, 0.3)
    expect(left.p0).toEqual(arch.p0)
    expect(right.p3).toEqual(arch.p3)
    expect(left.p3.x).toBeCloseTo(right.p0.x)
    expect(left.p3.y).toBeCloseTo(right.p0.y)
    const onOriginal = pointAt(arch, 0.3)
    expect(left.p3.x).toBeCloseTo(onOriginal.x)
    expect(left.p3.y).toBeCloseTo(onOriginal.y)
  })

  it('bbox is TIGHT (curve extrema, not control hull)', () => {
    const b = bboxOf(arch)
    expect(b.minX).toBeCloseTo(0)
    expect(b.maxX).toBeCloseTo(100)
    expect(b.maxY).toBeCloseTo(0)
    // Control hull reaches -100; the curve only reaches -75.
    expect(b.minY).toBeCloseTo(-75)
  })

  it('length of a degenerate straight cubic equals point distance', () => {
    const line = lineToCubic({ x: 0, y: 0 }, { x: 30, y: 40 })
    expect(lengthOf(line)).toBeCloseTo(50, 3)
  })

  it('nearestT projects onto the curve', () => {
    const n = nearestT(arch, { x: 50, y: -200 })
    expect(n.t).toBeCloseTo(0.5, 2)
    expect(n.point.x).toBeCloseTo(50, 1)
    expect(n.point.y).toBeCloseTo(-75, 1)
    expect(n.distance).toBeCloseTo(125, 0)
  })
})
