import { describe, expect, it } from 'vitest'
import {
  distanceToSubPaths,
  hitTestStroke,
  pointInSubPaths,
  pointNearPoint,
  rectIntersectsSubPaths,
} from './hittest'
import { ellipseToPath, rectToPath } from './shapes'

const square = rectToPath(0, 0, 100, 100)
/** Compound path: 100x100 square with a 50x50 hole (same winding direction). */
const donut = [...rectToPath(0, 0, 100, 100), ...rectToPath(25, 25, 50, 50)]

describe('pointInSubPaths', () => {
  it('detects inside/outside of a simple polygon', () => {
    expect(pointInSubPaths({ x: 50, y: 50 }, square)).toBe(true)
    expect(pointInSubPaths({ x: -1, y: 50 }, square)).toBe(false)
    expect(pointInSubPaths({ x: 150, y: 150 }, square)).toBe(false)
  })

  it('evenodd punches a hole where nonzero (same winding) does not', () => {
    const center = { x: 50, y: 50 }
    const ring = { x: 10, y: 50 }
    expect(pointInSubPaths(center, donut, 'evenodd')).toBe(false)
    expect(pointInSubPaths(ring, donut, 'evenodd')).toBe(true)
    expect(pointInSubPaths(center, donut, 'nonzero')).toBe(true)
  })

  it('handles curved fills (ellipse)', () => {
    const circle = ellipseToPath(0, 0, 50, 50)
    expect(pointInSubPaths({ x: 30, y: 30 }, circle)).toBe(true)
    expect(pointInSubPaths({ x: 45, y: 45 }, circle)).toBe(false)
  })
})

describe('stroke distance', () => {
  it('measures exact distance to the outline', () => {
    expect(distanceToSubPaths({ x: 50, y: -10 }, square)).toBeCloseTo(10)
    expect(distanceToSubPaths({ x: 50, y: 40 }, square)).toBeCloseTo(40)
  })

  it('hitTestStroke honors width + tolerance', () => {
    expect(hitTestStroke({ x: 50, y: -10 }, square, 10, 2)).toBe(false)
    expect(hitTestStroke({ x: 50, y: -6 }, square, 10, 2)).toBe(true)
    expect(hitTestStroke({ x: 50, y: 0 }, square, 1, 0)).toBe(true)
  })

  it('measures distance to a curve via projection', () => {
    const circle = ellipseToPath(0, 0, 50, 50)
    expect(distanceToSubPaths({ x: 70, y: 0 }, circle)).toBeCloseTo(20, 1)
    expect(distanceToSubPaths({ x: 0, y: 0 }, circle)).toBeCloseTo(50, 1)
  })
})

describe('pointNearPoint', () => {
  it('applies the tolerance radius', () => {
    expect(pointNearPoint({ x: 0, y: 0 }, { x: 3, y: 4 }, 5)).toBe(true)
    expect(pointNearPoint({ x: 0, y: 0 }, { x: 3, y: 4 }, 4.9)).toBe(false)
  })
})

describe('rectIntersectsSubPaths (marquee)', () => {
  it('true when the rect crosses the outline', () => {
    expect(rectIntersectsSubPaths({ minX: -10, minY: 40, maxX: 10, maxY: 60 }, square)).toBe(true)
  })

  it('true when the rect contains the whole path', () => {
    expect(rectIntersectsSubPaths({ minX: -10, minY: -10, maxX: 110, maxY: 110 }, square)).toBe(true)
  })

  it('true when the rect is entirely inside the fill', () => {
    expect(rectIntersectsSubPaths({ minX: 40, minY: 40, maxX: 60, maxY: 60 }, square)).toBe(true)
  })

  it('false when fully outside (even inside the bbox of an L-shape corner)', () => {
    expect(rectIntersectsSubPaths({ minX: 200, minY: 200, maxX: 300, maxY: 300 }, square)).toBe(false)
    // Inside the hole of the donut, touching nothing (evenodd fill).
    expect(
      rectIntersectsSubPaths({ minX: 45, minY: 45, maxX: 55, maxY: 55 }, donut, 'evenodd'),
    ).toBe(false)
  })
})
