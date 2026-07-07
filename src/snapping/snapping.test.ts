import { describe, expect, it } from 'vitest'
import { createDefaultSnapEngine } from './engine'
import { angleSnapper, gridSnapper } from './snappers'
import type { SnapQuery, SnapSettings } from './types'

const noGrid: SnapSettings = { snapToGrid: false, gridSize: 10 }
const grid10: SnapSettings = { snapToGrid: true, gridSize: 10 }
const free: SnapQuery = { zoom: 1, anchor: null, constrainAngle: false }

describe('gridSnapper', () => {
  it('LOCKS every point to the nearest grid intersection', () => {
    const r = gridSnapper.snap({ x: 12.4, y: 99 }, free, grid10)
    expect(r).not.toBeNull()
    expect(r!.point).toEqual({ x: 10, y: 100 })
    // Even far from a line: 26 -> 30, 44 -> 40 (Illustrator lock semantics).
    const far = gridSnapper.snap({ x: 26, y: 44 }, free, grid10)
    expect(far!.point).toEqual({ x: 30, y: 40 })
  })

  it('does nothing when snap-to-grid is off', () => {
    expect(gridSnapper.snap({ x: 10.01, y: 10.01 }, free, noGrid)).toBeNull()
  })
})

describe('angleSnapper (Shift-constrain)', () => {
  const anchor = { x: 0, y: 0 }

  it('projects onto the nearest 45° ray from the anchor', () => {
    const q: SnapQuery = { zoom: 1, anchor, constrainAngle: true }
    const horizontal = angleSnapper.snap({ x: 10, y: 1 }, q, noGrid)!
    expect(horizontal.point.x).toBeCloseTo(10)
    expect(horizontal.point.y).toBeCloseTo(0)

    const diagonal = angleSnapper.snap({ x: 8, y: 9 }, q, noGrid)!
    expect(diagonal.point.x).toBeCloseTo(8.5)
    expect(diagonal.point.y).toBeCloseTo(8.5)
    expect(diagonal.guides).toHaveLength(1)
  })

  it('is inert without constrain or without an anchor', () => {
    expect(angleSnapper.snap({ x: 5, y: 3 }, { zoom: 1, anchor, constrainAngle: false }, noGrid)).toBeNull()
    expect(angleSnapper.snap({ x: 5, y: 3 }, { zoom: 1, anchor: null, constrainAngle: true }, noGrid)).toBeNull()
  })
})

describe('SnapEngine', () => {
  it('threads the point through providers; angle constraint wins over grid', () => {
    const engine = createDefaultSnapEngine()
    const q: SnapQuery = { zoom: 1, anchor: { x: 0, y: 0 }, constrainAngle: true }
    // Grid pulls (12.4, 1) toward (10, 0); angle then projects onto 0° exactly.
    const r = engine.snap({ x: 12.4, y: 1 }, q, grid10)
    expect(r.point.y).toBeCloseTo(0)
    expect(r.guides.length).toBeGreaterThan(0)
  })

  it('passes points through untouched when nothing applies', () => {
    const engine = createDefaultSnapEngine()
    const r = engine.snap({ x: 3.3, y: 4.4 }, free, noGrid)
    expect(r.point).toEqual({ x: 3.3, y: 4.4 })
    expect(r.guides).toEqual([])
  })
})
