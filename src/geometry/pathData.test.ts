import { describe, expect, it } from 'vitest'
import { nanoid } from 'nanoid'
import type { Anchor, SubPath } from '../model/types'
import { parsePathData, segmentsOfSubPath, subpathsToPathData } from './pathData'

function anchor(
  x: number,
  y: number,
  handleIn: { x: number; y: number } | null = null,
  handleOut: { x: number; y: number } | null = null,
  type: Anchor['type'] = 'corner',
): Anchor {
  return { id: nanoid(), point: { x, y }, handleIn, handleOut, type }
}

function subpath(anchors: Anchor[], closed = false): SubPath {
  return { id: nanoid(), closed, anchors }
}

/** Geometric equality: ids are freshly allocated by the parser by design. */
function expectSubPathsEqual(actual: SubPath[], expected: SubPath[]): void {
  expect(actual.length).toBe(expected.length)
  for (let i = 0; i < expected.length; i++) {
    const a = actual[i]!
    const e = expected[i]!
    expect(a.closed).toBe(e.closed)
    expect(a.anchors.length).toBe(e.anchors.length)
    for (let j = 0; j < e.anchors.length; j++) {
      const aa = a.anchors[j]!
      const ea = e.anchors[j]!
      expect(aa.point.x).toBeCloseTo(ea.point.x, 4)
      expect(aa.point.y).toBeCloseTo(ea.point.y, 4)
      for (const side of ['handleIn', 'handleOut'] as const) {
        const ah = aa[side]
        const eh = ea[side]
        if (eh === null) {
          expect(ah).toBeNull()
        } else {
          expect(ah).not.toBeNull()
          expect(ah!.x).toBeCloseTo(eh.x, 4)
          expect(ah!.y).toBeCloseTo(eh.y, 4)
        }
      }
    }
  }
}

describe('pathData round-trip (subpaths -> d -> subpaths)', () => {
  it('round-trips an open polyline', () => {
    const sp = [subpath([anchor(0, 0), anchor(10, 0), anchor(10.5, 20.25)])]
    const d = subpathsToPathData(sp)
    expect(d).toBe('M 0 0 L 10 0 L 10.5 20.25')
    expectSubPathsEqual(parsePathData(d), sp)
  })

  it('round-trips a closed polygon', () => {
    const sp = [subpath([anchor(0, 0), anchor(100, 0), anchor(50, 80)], true)]
    const d = subpathsToPathData(sp)
    expect(d.endsWith('Z')).toBe(true)
    expectSubPathsEqual(parsePathData(d), sp)
  })

  it('round-trips open cubics with mixed handles', () => {
    const sp = [
      subpath([
        anchor(0, 0, null, { x: 10, y: -20 }),
        anchor(50, 0, { x: 40, y: -20 }, { x: 60, y: 20 }),
        anchor(100, 0, { x: 90, y: 20 }, null),
      ]),
    ]
    const d = subpathsToPathData(sp)
    expectSubPathsEqual(parsePathData(d), sp)
  })

  it('round-trips a closed path with a curved closing segment', () => {
    const sp = [
      subpath(
        [
          anchor(0, 0, { x: -10, y: 10 }, { x: 10, y: -10 }),
          anchor(100, 0, { x: 90, y: -10 }, { x: 110, y: 10 }),
          anchor(50, 60, { x: 70, y: 60 }, { x: 30, y: 60 }),
        ],
        true,
      ),
    ]
    const d = subpathsToPathData(sp)
    expectSubPathsEqual(parsePathData(d), sp)
  })

  it('round-trips multiple subpaths (compound path with a hole)', () => {
    const sp = [
      subpath([anchor(0, 0), anchor(100, 0), anchor(100, 100), anchor(0, 100)], true),
      subpath([anchor(25, 25), anchor(75, 25), anchor(75, 75), anchor(25, 75)], true),
    ]
    expectSubPathsEqual(parsePathData(subpathsToPathData(sp)), sp)
  })

  it('round-trips one-sided handles (line into curve)', () => {
    const sp = [
      subpath([anchor(0, 0), anchor(50, 50, null, { x: 75, y: 50 }), anchor(100, 0, { x: 100, y: 25 }, null)]),
    ]
    expectSubPathsEqual(parsePathData(subpathsToPathData(sp)), sp)
  })

  it('double round-trip is stable (d -> subpaths -> d)', () => {
    const d = 'M 0 0 C 10 -20 40 -20 50 0 C 60 20 90 20 100 0 L 100 50 Z M 10 10 L 20 10'
    const once = parsePathData(d)
    expect(subpathsToPathData(once)).toBe(d)
  })
})

describe('pathData tolerant parsing', () => {
  it('parses relative commands and comma separators', () => {
    const sp = parsePathData('m 10,10 l 20,0 l 0,20 z')
    expectSubPathsEqual(sp, [subpath([anchor(10, 10), anchor(30, 10), anchor(30, 30)], true)])
  })

  it('parses H/V shorthands', () => {
    const sp = parsePathData('M 0 0 H 50 V 25 h -10 v -5')
    expectSubPathsEqual(sp, [
      subpath([anchor(0, 0), anchor(50, 0), anchor(50, 25), anchor(40, 25), anchor(40, 20)]),
    ])
  })

  it('parses S (smooth cubic) with reflected control', () => {
    const sp = parsePathData('M 0 0 C 10 -20 40 -20 50 0 S 90 20 100 0')
    const anchors = sp[0]!.anchors
    // Reflection of (40,-20) about (50,0) is (60,20).
    expect(anchors[1]!.handleOut).toEqual({ x: 60, y: 20 })
    expect(anchors[2]!.handleIn).toEqual({ x: 90, y: 20 })
  })

  it('converts quadratics (Q/T) to exact cubics', () => {
    const sp = parsePathData('M 0 0 Q 50 100 100 0')
    const segs = segmentsOfSubPath(sp[0]!)
    expect(segs).toHaveLength(1)
    const seg = segs[0]!
    if (seg.kind !== 'cubic') throw new Error('expected cubic')
    // Midpoint of the quadratic is (50, 50); the elevated cubic must agree.
    const mid = {
      x: 0.125 * seg.cubic.p0.x + 0.375 * seg.cubic.p1.x + 0.375 * seg.cubic.p2.x + 0.125 * seg.cubic.p3.x,
      y: 0.125 * seg.cubic.p0.y + 0.375 * seg.cubic.p1.y + 0.375 * seg.cubic.p2.y + 0.125 * seg.cubic.p3.y,
    }
    expect(mid.x).toBeCloseTo(50)
    expect(mid.y).toBeCloseTo(50)
  })

  it('parses implicit repeated commands (M with extra pairs = implicit L)', () => {
    const sp = parsePathData('M 0 0 10 0 10 10')
    expectSubPathsEqual(sp, [subpath([anchor(0, 0), anchor(10, 0), anchor(10, 10)])])
  })

  it('approximates arcs with cubics that stay on the circle', () => {
    // Quarter of a radius-50 circle centered at (0,0): (50,0) -> (0,50), sweep=1.
    const sp = parsePathData('M 50 0 A 50 50 0 0 1 0 50')
    const anchors = sp[0]!.anchors
    expect(anchors[0]!.point).toEqual({ x: 50, y: 0 })
    const last = anchors[anchors.length - 1]!
    expect(last.point.x).toBeCloseTo(0, 6)
    expect(last.point.y).toBeCloseTo(50, 6)
    // Every anchor must sit on the circle.
    for (const a of anchors) {
      expect(Math.hypot(a.point.x, a.point.y)).toBeCloseTo(50, 3)
    }
  })

  it('parses smashed arc flags ("A 5 5 0 011 ...")', () => {
    const sp = parsePathData('M 0 0 A 5 5 0 01 10 0')
    expect(sp[0]!.anchors[sp[0]!.anchors.length - 1]!.point.x).toBeCloseTo(10)
  })

  it('throws on garbage', () => {
    expect(() => parsePathData('M 0 0 % 3')).toThrow()
  })
})
