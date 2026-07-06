import { describe, expect, it } from 'vitest'
import { applyToPoint } from '../geometry/matrix'
import { createRectNode, rgba } from './nodes'
import {
  defaultGradientFrom,
  defaultGradientTransform,
  linearAxisOf,
  linearAxisTransform,
  radialAxisOf,
  radialCircleTransform,
} from './gradientGeometry'

describe('linear axis <-> transform', () => {
  it('round-trips arbitrary axes', () => {
    const a = { x: 12, y: -5 }
    const b = { x: 80, y: 33 }
    const t = linearAxisTransform(a, b)
    const axis = linearAxisOf({ type: 'gradient', gradientType: 'linear', stops: [], transform: t })
    expect(axis.a.x).toBeCloseTo(a.x)
    expect(axis.a.y).toBeCloseTo(a.y)
    expect(axis.b.x).toBeCloseTo(b.x)
    expect(axis.b.y).toBeCloseTo(b.y)
  })

  it('keeps unit space conformal (y axis = rotated x axis)', () => {
    const t = linearAxisTransform({ x: 0, y: 0 }, { x: 0, y: 50 }) // straight down
    // Unit (0,1) must map perpendicular to the axis at the same length.
    const up = applyToPoint(t, { x: 0, y: 1 })
    expect(Math.hypot(up.x, up.y)).toBeCloseTo(50)
    expect(up.x * 0 + up.y * 50).toBeCloseTo(0) // perpendicular to (0,50)
  })
})

describe('radial circle <-> transform', () => {
  it('round-trips center and radius', () => {
    const t = radialCircleTransform({ x: 40, y: 25 }, 15)
    const { center, edge } = radialAxisOf({
      type: 'gradient',
      gradientType: 'radial',
      stops: [],
      transform: t,
    })
    expect(center.x).toBeCloseTo(40)
    expect(center.y).toBeCloseTo(25)
    expect(Math.hypot(edge.x - center.x, edge.y - center.y)).toBeCloseTo(15)
  })
})

describe('defaults', () => {
  it('defaultGradientTransform spans the local bbox', () => {
    const rect = createRectNode({ x: 10, y: 20, w: 100, h: 50 })
    const t = defaultGradientTransform(rect, { [rect.id]: rect }, 'linear')
    const axis = linearAxisOf({ type: 'gradient', gradientType: 'linear', stops: [], transform: t })
    expect(axis.a.x).toBeCloseTo(10)
    expect(axis.b.x).toBeCloseTo(110)
    expect(axis.a.y).toBeCloseTo(45) // vertical center
  })

  it('defaultGradientFrom fades the source color out', () => {
    const paint = defaultGradientFrom(rgba(200, 40, 40, 1), 'linear', [1, 0, 0, 1, 0, 0])
    expect(paint.stops).toHaveLength(2)
    expect(paint.stops[0]!.color.r).toBe(200)
    expect(paint.stops[0]!.color.a).toBe(1)
    expect(paint.stops[1]!.color.a).toBe(0)
  })
})
