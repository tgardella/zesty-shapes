import { describe, expect, it } from 'vitest'
import { createAnchor, createSubPath } from './pathOps'
import { defaultStyle } from './nodes'
import {
  hasWidthProfile,
  nearestOffsetOnPath,
  pointAtOffset,
  samplePath,
  sortedProfile,
  widthAt,
} from './widthProfile'
import { outlineStroke } from './strokeOutline'
import { pointInRegions, regionsArea } from '../geometry/boolean'

/** Straight horizontal line 0..100 (easy arc-length assertions). */
function line(): ReturnType<typeof createSubPath> {
  return createSubPath([createAnchor({ x: 0, y: 0 }), createAnchor({ x: 100, y: 0 })], false)
}

describe('widthAt', () => {
  const profile = [
    { offset: 0.2, width: 2 },
    { offset: 0.8, width: 10 },
  ]

  it('interpolates linearly between stops', () => {
    expect(widthAt(profile, 0.5, 1)).toBeCloseTo(6)
    expect(widthAt(profile, 0.2, 1)).toBe(2)
    expect(widthAt(profile, 0.8, 1)).toBe(10)
  })

  it('clamps beyond the ends and falls back when empty', () => {
    expect(widthAt(profile, 0, 1)).toBe(2)
    expect(widthAt(profile, 1, 1)).toBe(10)
    expect(widthAt([], 0.5, 7)).toBe(7)
  })

  it('handles unsorted input (sortedProfile is canonical)', () => {
    const unsorted = [profile[1]!, profile[0]!]
    expect(widthAt(unsorted, 0.5, 1)).toBeCloseTo(6)
    expect(sortedProfile(unsorted)[0]!.offset).toBe(0.2)
  })
})

describe('samplePath / pointAtOffset / nearestOffsetOnPath', () => {
  it('parameterizes a straight line by arc length', () => {
    const sampled = samplePath([line()])!
    expect(sampled).not.toBeNull()
    expect(sampled.totalLength).toBeCloseTo(100)
    const mid = pointAtOffset(sampled, 0.5)
    expect(mid.point.x).toBeCloseTo(50)
    expect(mid.point.y).toBeCloseTo(0)
    expect(Math.abs(mid.tangent.x)).toBeCloseTo(1)
    // Normal is perpendicular to the tangent.
    expect(Math.abs(mid.normal.y)).toBeCloseTo(1)
  })

  it('nearest offset projects onto the path', () => {
    const sampled = samplePath([line()])!
    const near = nearestOffsetOnPath(sampled, { x: 30, y: 12 })
    expect(near.u).toBeCloseTo(0.3, 2)
    expect(near.distance).toBeCloseTo(12)
    expect(near.point.x).toBeCloseTo(30, 1)
  })

  it('spans multiple subpaths on one 0-1 axis', () => {
    const a = line() // length 100
    const b = createSubPath(
      [createAnchor({ x: 0, y: 50 }), createAnchor({ x: 300, y: 50 })],
      false,
    ) // length 300
    const sampled = samplePath([a, b])!
    expect(sampled.totalLength).toBeCloseTo(400)
    expect(sampled.runs).toHaveLength(2)
    // u=0.5 lands 100 units into subpath b (concatenated arc length).
    const p = pointAtOffset(sampled, 0.5)
    expect(p.point.y).toBeCloseTo(50)
    expect(p.point.x).toBeCloseTo(100, 0)
  })

  it('returns null for degenerate geometry', () => {
    expect(samplePath([createSubPath([createAnchor({ x: 5, y: 5 })], false)])).toBeNull()
  })
})

describe('outlineStroke (the real filled outline)', () => {
  it('tapered stroke: wide where the profile is wide, thin at the thin end', () => {
    const style = defaultStyle()
    style.widthProfile = [
      { offset: 0, width: 2 },
      { offset: 1, width: 20 },
    ]
    const outline = outlineStroke([line()], style)!
    expect(outline).not.toBeNull()
    expect(pointInRegions(outline, { x: 99, y: 8 })).toBe(true) // wide end (±10)
    expect(pointInRegions(outline, { x: 1, y: 0.5 })).toBe(true) // thin end (±1)
    expect(pointInRegions(outline, { x: 1, y: 5 })).toBe(false) // beyond the taper
    // Area ≈ trapezoid: 100 long, widths 2..20 -> ~1100 (+ round caps).
    const area = regionsArea(outline)
    expect(area).toBeGreaterThan(1000)
    expect(area).toBeLessThan(1500)
  })

  it('outlines a UNIFORM stroke too (the offset primitive)', () => {
    const style = defaultStyle()
    style.strokeWidth = 10
    const outline = outlineStroke([line()], style)!
    expect(regionsArea(outline)).toBeGreaterThan(990) // 100x10 + round caps
    expect(pointInRegions(outline, { x: 50, y: 4.9 })).toBe(true)
    expect(pointInRegions(outline, { x: 50, y: 5.5 })).toBe(false)
  })

  it('closed subpaths produce an annulus (the hole survives)', () => {
    const square = createSubPath(
      [
        createAnchor({ x: 0, y: 0 }),
        createAnchor({ x: 100, y: 0 }),
        createAnchor({ x: 100, y: 100 }),
        createAnchor({ x: 0, y: 100 }),
      ],
      true,
    )
    const style = defaultStyle()
    style.strokeWidth = 8
    const outline = outlineStroke([square], style)!
    expect(pointInRegions(outline, { x: 50, y: 2 })).toBe(true) // edge band
    expect(pointInRegions(outline, { x: 50, y: 50 })).toBe(false) // the hole
  })

  it('is null without a stroke', () => {
    const noStroke = defaultStyle()
    noStroke.stroke = null
    noStroke.widthProfile = [{ offset: 0.5, width: 5 }]
    expect(outlineStroke([line()], noStroke)).toBeNull()
    expect(hasWidthProfile(noStroke)).toBe(false)
  })
})
