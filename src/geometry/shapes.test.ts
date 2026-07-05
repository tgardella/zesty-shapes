import { describe, expect, it } from 'vitest'
import { ellipseToPath, lineToPath, polygonToPath, rectToPath, starToPath } from './shapes'
import { bboxOfSubPaths } from './bbox'
import { pointInSubPaths } from './hittest'

describe('shapes -> subpaths', () => {
  it('rectToPath produces a closed 4-corner subpath with exact bbox', () => {
    const sp = rectToPath(10, 20, 100, 50)
    expect(sp).toHaveLength(1)
    expect(sp[0]!.closed).toBe(true)
    expect(sp[0]!.anchors).toHaveLength(4)
    expect(bboxOfSubPaths(sp)).toEqual({ minX: 10, minY: 20, maxX: 110, maxY: 70 })
  })

  it('rounded rect stays inside the rect bbox and rounds the corners', () => {
    const sp = rectToPath(0, 0, 100, 100, 20)
    const b = bboxOfSubPaths(sp)!
    expect(b.minX).toBeCloseTo(0, 4)
    expect(b.minY).toBeCloseTo(0, 4)
    expect(b.maxX).toBeCloseTo(100, 4)
    expect(b.maxY).toBeCloseTo(100, 4)
    // Corner point is cut off, edge midpoints are filled.
    expect(pointInSubPaths({ x: 1, y: 1 }, sp)).toBe(false)
    expect(pointInSubPaths({ x: 50, y: 1 }, sp)).toBe(true)
    expect(pointInSubPaths({ x: 50, y: 50 }, sp)).toBe(true)
  })

  it('ellipseToPath (4 kappa cubics) has an exact bbox and near-circular radius', () => {
    const sp = ellipseToPath(0, 0, 50, 30)
    const b = bboxOfSubPaths(sp)!
    expect(b.minX).toBeCloseTo(-50, 6)
    expect(b.maxX).toBeCloseTo(50, 6)
    expect(b.minY).toBeCloseTo(-30, 6)
    expect(b.maxY).toBeCloseTo(30, 6)
    // Kappa approximation error is < 0.03% of radius.
    expect(pointInSubPaths({ x: 49.5, y: 0 }, sp)).toBe(true)
    expect(pointInSubPaths({ x: 0, y: 29.5 }, sp)).toBe(true)
    expect(pointInSubPaths({ x: 49.5, y: 29.5 }, sp)).toBe(false)
  })

  it('polygonToPath places `sides` vertices on the radius, first pointing up', () => {
    const sp = polygonToPath(0, 0, 100, 6)
    const anchors = sp[0]!.anchors
    expect(anchors).toHaveLength(6)
    expect(anchors[0]!.point.x).toBeCloseTo(0)
    expect(anchors[0]!.point.y).toBeCloseTo(-100)
    for (const a of anchors) {
      expect(Math.hypot(a.point.x, a.point.y)).toBeCloseTo(100)
    }
  })

  it('starToPath alternates outer and inner radii', () => {
    const sp = starToPath(0, 0, 100, 40, 5)
    const anchors = sp[0]!.anchors
    expect(anchors).toHaveLength(10)
    for (let i = 0; i < anchors.length; i++) {
      const r = Math.hypot(anchors[i]!.point.x, anchors[i]!.point.y)
      expect(r).toBeCloseTo(i % 2 === 0 ? 100 : 40)
    }
  })

  it('lineToPath is a two-anchor open subpath', () => {
    const sp = lineToPath(0, 0, 10, 10)
    expect(sp[0]!.closed).toBe(false)
    expect(sp[0]!.anchors).toHaveLength(2)
  })
})
