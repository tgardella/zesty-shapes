import { describe, expect, it } from 'vitest'
import {
  difference,
  intersection,
  pointInRegions,
  regionsArea,
  ringArea,
  union,
  xor,
  type Regions,
} from './boolean'

const square = (x: number, y: number, size: number): Regions => [
  [
    [
      { x, y },
      { x: x + size, y },
      { x: x + size, y: y + size },
      { x, y: y + size },
    ],
  ],
]

describe('boolean wrapper', () => {
  const a = square(0, 0, 10) // area 100
  const b = square(5, 5, 10) // overlaps 25

  it('union merges overlapping squares', () => {
    const u = union(a, b)
    expect(u).toHaveLength(1)
    expect(regionsArea(u)).toBeCloseTo(175)
    expect(pointInRegions(u, { x: 12, y: 12 })).toBe(true)
    expect(pointInRegions(u, { x: 12, y: 2 })).toBe(false) // notch corner
  })

  it('difference subtracts', () => {
    const d = difference(a, b)
    expect(regionsArea(d)).toBeCloseTo(75)
    expect(pointInRegions(d, { x: 7, y: 7 })).toBe(false)
    expect(pointInRegions(d, { x: 2, y: 2 })).toBe(true)
  })

  it('intersection keeps the shared area', () => {
    const i = intersection(a, b)
    expect(regionsArea(i)).toBeCloseTo(25)
    expect(pointInRegions(i, { x: 7, y: 7 })).toBe(true)
  })

  it('xor keeps the non-shared areas (two pieces)', () => {
    const x = xor(a, b)
    expect(regionsArea(x)).toBeCloseTo(150)
    expect(pointInRegions(x, { x: 7, y: 7 })).toBe(false)
    expect(pointInRegions(x, { x: 2, y: 2 })).toBe(true)
    expect(pointInRegions(x, { x: 13, y: 13 })).toBe(true)
  })

  it('holes come back as extra rings (donut difference)', () => {
    const d = difference(square(0, 0, 30), square(10, 10, 10))
    expect(d).toHaveLength(1)
    expect(d[0]!.length).toBe(2) // exterior + hole
    expect(regionsArea(d)).toBeCloseTo(800)
    expect(pointInRegions(d, { x: 15, y: 15 })).toBe(false) // the hole
  })

  it('empty inputs are safe', () => {
    expect(union([], [])).toEqual([])
    expect(difference([], a)).toEqual([])
    expect(intersection(a, [])).toEqual([])
    expect(regionsArea(difference(a, a))).toBeCloseTo(0)
  })

  it('ringArea is signed by winding', () => {
    const cw = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ]
    expect(Math.abs(ringArea(cw))).toBeCloseTo(100)
    expect(ringArea(cw)).toBeCloseTo(-ringArea([...cw].reverse()))
  })
})
