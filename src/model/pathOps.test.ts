import { describe, expect, it } from 'vitest'
import {
  autoSmoothSubPath,
  createAnchor,
  createSubPath,
  fitPointsToSubPath,
  insertAnchorOnSegment,
  mirrorOppositeHandle,
  nearestOnSubPaths,
  rdpSimplify,
  reverseSubPath,
  splitSubPathAtAnchorIndex,
  splitSubPathAtSegment,
  subPathSegments,
} from './pathOps'
import { pointAt } from '../geometry/bezier'
import type { SubPath } from './types'

function square(closed = true): SubPath {
  return createSubPath(
    [
      createAnchor({ x: 0, y: 0 }),
      createAnchor({ x: 100, y: 0 }),
      createAnchor({ x: 100, y: 100 }),
      createAnchor({ x: 0, y: 100 }),
    ],
    closed,
  )
}

function curvyLine(): SubPath {
  return createSubPath(
    [
      createAnchor({ x: 0, y: 0 }, { handleOut: { x: 30, y: -40 }, type: 'smooth' }),
      createAnchor({ x: 100, y: 0 }, { handleIn: { x: 70, y: -40 }, type: 'smooth' }),
    ],
    false,
  )
}

describe('subPathSegments', () => {
  it('includes the closing segment only for closed subpaths', () => {
    expect(subPathSegments(square(true))).toHaveLength(4)
    expect(subPathSegments(square(false))).toHaveLength(3)
    const closing = subPathSegments(square(true))[3]!
    expect(closing.startIndex).toBe(3)
    expect(closing.endIndex).toBe(0)
  })
})

describe('insertAnchorOnSegment', () => {
  it('preserves the exact curve shape on a curved segment', () => {
    const sp = curvyLine()
    const before = subPathSegments(sp)[0]!.cubic
    const midBefore = pointAt(before, 0.5)
    const quarterBefore = pointAt(before, 0.25)

    const anchor = insertAnchorOnSegment(sp, 0, 0.5)
    expect(sp.anchors).toHaveLength(3)
    expect(sp.anchors[1]!.id).toBe(anchor.id)
    expect(anchor.point.x).toBeCloseTo(midBefore.x)
    expect(anchor.point.y).toBeCloseTo(midBefore.y)
    // The left half at t=0.5 is the original at t=0.25.
    const left = subPathSegments(sp)[0]!.cubic
    const q = pointAt(left, 0.5)
    expect(q.x).toBeCloseTo(quarterBefore.x)
    expect(q.y).toBeCloseTo(quarterBefore.y)
  })

  it('keeps straight segments straight (no handles invented)', () => {
    const sp = square(false)
    const anchor = insertAnchorOnSegment(sp, 0, 0.5)
    expect(anchor.point).toEqual({ x: 50, y: 0 })
    expect(anchor.handleIn).toBeNull()
    expect(anchor.handleOut).toBeNull()
    expect(sp.anchors[0]!.handleOut).toBeNull()
  })
})

describe('splitSubPathAtAnchorIndex', () => {
  it('opens a closed subpath at the anchor (same point count + duplicate)', () => {
    const sp = square(true)
    const pieces = splitSubPathAtAnchorIndex(sp, 2)
    expect(pieces).toHaveLength(1)
    const open = pieces[0]!
    expect(open.closed).toBe(false)
    expect(open.anchors).toHaveLength(5) // 4 + duplicated cut anchor
    expect(open.anchors[0]!.point).toEqual({ x: 100, y: 100 })
    expect(open.anchors[4]!.point).toEqual({ x: 100, y: 100 })
  })

  it('cuts an open subpath into two; endpoints are no-ops', () => {
    const sp = square(false)
    const pieces = splitSubPathAtAnchorIndex(sp, 1)
    expect(pieces).toHaveLength(2)
    expect(pieces[0]!.anchors.map((a) => a.point.x)).toEqual([0, 100])
    expect(pieces[1]!.anchors.map((a) => a.point.x)).toEqual([100, 100, 0])
    expect(splitSubPathAtAnchorIndex(square(false), 0)).toHaveLength(1)
    expect(splitSubPathAtAnchorIndex(square(false), 3)).toHaveLength(1)
  })

  it('splitSubPathAtSegment cuts mid-segment preserving geometry', () => {
    const sp = curvyLine()
    const original = subPathSegments(sp)[0]!.cubic
    const target = pointAt(original, 0.5)
    const pieces = splitSubPathAtSegment(sp, 0, 0.5)
    expect(pieces).toHaveLength(2)
    const endOfFirst = pieces[0]!.anchors.at(-1)!.point
    const startOfSecond = pieces[1]!.anchors[0]!.point
    expect(endOfFirst.x).toBeCloseTo(target.x)
    expect(startOfSecond.x).toBeCloseTo(target.x)
  })
})

describe('reverse + nearest + smoothing', () => {
  it('reverseSubPath swaps direction and handle sides', () => {
    const sp = curvyLine()
    reverseSubPath(sp)
    expect(sp.anchors[0]!.point).toEqual({ x: 100, y: 0 })
    expect(sp.anchors[0]!.handleOut).toEqual({ x: 70, y: -40 })
    expect(sp.anchors[1]!.handleIn).toEqual({ x: 30, y: -40 })
  })

  it('nearestOnSubPaths finds the closest segment point', () => {
    const near = nearestOnSubPaths([square(true)], { x: 50, y: -10 })
    expect(near).not.toBeNull()
    expect(near!.segIndex).toBe(0)
    expect(near!.point.x).toBeCloseTo(50)
    expect(near!.point.y).toBeCloseTo(0)
    expect(near!.distance).toBeCloseTo(10)
  })

  it('autoSmoothSubPath gives interior smooth anchors chord-parallel handles', () => {
    const sp = createSubPath(
      [
        createAnchor({ x: 0, y: 0 }, { type: 'smooth' }),
        createAnchor({ x: 50, y: 50 }, { type: 'smooth' }),
        createAnchor({ x: 100, y: 0 }, { type: 'smooth' }),
      ],
      false,
    )
    autoSmoothSubPath(sp)
    const mid = sp.anchors[1]!
    expect(mid.handleIn).not.toBeNull()
    expect(mid.handleOut).not.toBeNull()
    // Chord (0,0)->(100,0) is horizontal: handles must be horizontal too.
    expect(mid.handleIn!.y).toBeCloseTo(50)
    expect(mid.handleOut!.y).toBeCloseTo(50)
    // Corner anchors stay untouched.
    const sp2 = createSubPath(
      [createAnchor({ x: 0, y: 0 }), createAnchor({ x: 50, y: 50 }), createAnchor({ x: 100, y: 0 })],
      false,
    )
    autoSmoothSubPath(sp2)
    expect(sp2.anchors[1]!.handleIn).toBeNull()
  })

  it('mirrorOppositeHandle: symmetric mirrors exactly, smooth keeps length', () => {
    const symmetric = createAnchor(
      { x: 0, y: 0 },
      { handleIn: { x: -10, y: 0 }, handleOut: { x: 10, y: 0 }, type: 'symmetric' },
    )
    symmetric.handleOut = { x: 20, y: 10 }
    mirrorOppositeHandle(symmetric, 'out')
    expect(symmetric.handleIn).toEqual({ x: -20, y: -10 })

    const smooth = createAnchor(
      { x: 0, y: 0 },
      { handleIn: { x: -5, y: 0 }, handleOut: { x: 10, y: 0 }, type: 'smooth' },
    )
    smooth.handleOut = { x: 0, y: 20 } // straight up
    mirrorOppositeHandle(smooth, 'out')
    expect(smooth.handleIn!.x).toBeCloseTo(0)
    expect(smooth.handleIn!.y).toBeCloseTo(-5) // direction flipped, LENGTH kept
  })
})

describe('pencil fitting', () => {
  it('rdpSimplify keeps corners and drops collinear noise', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 10, y: 0.05 },
      { x: 20, y: -0.04 },
      { x: 50, y: 0 }, // corner
      { x: 50.02, y: 20 },
      { x: 50, y: 40 },
    ]
    const out = rdpSimplify(points, 0.5)
    expect(out.length).toBeLessThan(points.length)
    expect(out[0]).toEqual({ x: 0, y: 0 })
    expect(out.at(-1)).toEqual({ x: 50, y: 40 })
    expect(out.some((p) => p.x === 50 && p.y === 0)).toBe(true)
  })

  it('fitPointsToSubPath produces a smooth open subpath through the points', () => {
    const raw = Array.from({ length: 40 }, (_, i) => ({
      x: i * 5,
      y: Math.sin(i / 6) * 30,
    }))
    const sp = fitPointsToSubPath(raw, 1)
    expect(sp).not.toBeNull()
    expect(sp!.closed).toBe(false)
    expect(sp!.anchors.length).toBeGreaterThan(2)
    expect(sp!.anchors.length).toBeLessThan(raw.length)
    // Interior anchors carry handles (smooth fit, not a polyline).
    const interior = sp!.anchors.slice(1, -1)
    expect(interior.every((a) => a.handleIn && a.handleOut)).toBe(true)
  })

  it('degenerate input returns null', () => {
    expect(fitPointsToSubPath([{ x: 0, y: 0 }], 1)).toBeNull()
  })
})
