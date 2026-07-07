import { describe, expect, it } from 'vitest'
import {
  alignRing,
  degenerateRing,
  interpolateStyle,
  lerpRing,
  pairRings,
  resampleRing,
} from './blend'
import { defaultStyle } from './nodes'
import type { Ring } from '../geometry/boolean'

const square: Ring = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
]

describe('resampleRing', () => {
  it('produces exactly k points uniform by arc length', () => {
    const out = resampleRing(square, 8)
    expect(out).toHaveLength(8)
    expect(out[0]).toEqual({ x: 0, y: 0 })
    expect(out[2]).toEqual({ x: 10, y: 0 }) // 2/8 of the 40-perimeter = corner
  })
})

describe('alignRing', () => {
  it('reverses rings with opposite winding', () => {
    const a = resampleRing(square, 16)
    const reversed = resampleRing([...square].reverse(), 16)
    const aligned = alignRing(a, reversed)
    // After alignment, corresponding vertices should be close to a's.
    const cost = a.reduce((sum, p, i) => sum + Math.hypot(p.x - aligned[i]!.x, p.y - aligned[i]!.y), 0)
    const rawCost = a.reduce(
      (sum, p, i) => sum + Math.hypot(p.x - reversed[i]!.x, p.y - reversed[i]!.y),
      0,
    )
    expect(cost).toBeLessThan(rawCost)
  })
})

describe('pairRings', () => {
  it('pairs extras with a degenerate ring at the partner centroid', () => {
    const big: Ring = square
    const small: Ring = square.map((p) => ({ x: p.x + 30, y: p.y }))
    const pairs = pairRings([[big], [small]], [[big]])
    expect(pairs).toHaveLength(2)
    // The unmatched b-side ring is a collapsed point.
    const degenerate = pairs[1]!.b
    expect(new Set(degenerate.map((p) => `${p.x},${p.y}`)).size).toBe(1)
  })

  it('lerpRing midpoint sits halfway', () => {
    const a = resampleRing(square, 8)
    const b = resampleRing(square.map((p) => ({ x: p.x + 100, y: p.y })), 8)
    const mid = lerpRing(a, alignRing(a, b), 0.5)
    expect(mid[0]!.x).toBeCloseTo(a[0]!.x + 50)
  })

  it('degenerateRing collapses to one point', () => {
    const ring = degenerateRing({ x: 5, y: 5 }, 12)
    expect(ring).toHaveLength(12)
    expect(ring.every((p) => p.x === 5 && p.y === 5)).toBe(true)
  })
})

describe('interpolateStyle', () => {
  it('lerps solid fill colors and stroke width', () => {
    const a = defaultStyle()
    a.fill = { type: 'solid', color: { r: 0, g: 0, b: 0, a: 1 } }
    a.strokeWidth = 2
    const b = defaultStyle()
    b.fill = { type: 'solid', color: { r: 100, g: 200, b: 50, a: 1 } }
    b.strokeWidth = 10
    const mid = interpolateStyle(a, b, 0.5)
    expect(mid.fill).toEqual({ type: 'solid', color: { r: 50, g: 100, b: 25, a: 1 } })
    expect(mid.strokeWidth).toBe(6)
  })

  it('null paints switch at the halfway point', () => {
    const a = defaultStyle()
    a.fill = null
    const b = defaultStyle()
    expect(interpolateStyle(a, b, 0.25).fill).toBeNull()
    expect(interpolateStyle(a, b, 0.75).fill).not.toBeNull()
  })
})
