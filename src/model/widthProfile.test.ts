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
  widthChunks,
} from './widthProfile'

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

describe('widthChunks (the rendered approximation)', () => {
  it('emits chunks whose widths follow the profile', () => {
    const style = defaultStyle()
    style.widthProfile = [
      { offset: 0, width: 2 },
      { offset: 1, width: 20 },
    ]
    const chunks = widthChunks([line()], style)!
    expect(chunks.length).toBeGreaterThan(4)
    // Monotonically increasing widths along a linear ramp.
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i]!.width).toBeGreaterThan(chunks[i - 1]!.width)
    }
    expect(chunks[0]!.width).toBeGreaterThanOrEqual(2)
    expect(chunks[chunks.length - 1]!.width).toBeLessThanOrEqual(20)
  })

  it('is null without a stroke or without a profile', () => {
    const noProfile = defaultStyle()
    expect(widthChunks([line()], noProfile)).toBeNull()
    const noStroke = defaultStyle()
    noStroke.stroke = null
    noStroke.widthProfile = [{ offset: 0.5, width: 5 }]
    expect(widthChunks([line()], noStroke)).toBeNull()
    expect(hasWidthProfile(noStroke)).toBe(false)
  })
})
