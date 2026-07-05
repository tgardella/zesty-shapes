import { describe, expect, it } from 'vitest'
import { add, angle, dot, length, lerp, normalize, rotate, scale, sub } from './vec2'

describe('vec2', () => {
  it('add/sub/scale/dot/length', () => {
    expect(add({ x: 1, y: 2 }, { x: 3, y: 4 })).toEqual({ x: 4, y: 6 })
    expect(sub({ x: 1, y: 2 }, { x: 3, y: 4 })).toEqual({ x: -2, y: -2 })
    expect(scale({ x: 1, y: -2 }, 3)).toEqual({ x: 3, y: -6 })
    expect(dot({ x: 1, y: 2 }, { x: 3, y: 4 })).toBe(11)
    expect(length({ x: 3, y: 4 })).toBe(5)
  })

  it('normalize handles the zero vector', () => {
    expect(normalize({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 })
    const n = normalize({ x: 3, y: 4 })
    expect(length(n)).toBeCloseTo(1)
  })

  it('lerp interpolates and extrapolates', () => {
    expect(lerp({ x: 0, y: 0 }, { x: 10, y: 20 }, 0.5)).toEqual({ x: 5, y: 10 })
    expect(lerp({ x: 0, y: 0 }, { x: 10, y: 20 }, 0)).toEqual({ x: 0, y: 0 })
    expect(lerp({ x: 0, y: 0 }, { x: 10, y: 20 }, 1)).toEqual({ x: 10, y: 20 })
  })

  it('angle and rotate agree', () => {
    expect(angle({ x: 0, y: 1 })).toBeCloseTo(Math.PI / 2)
    const r = rotate({ x: 1, y: 0 }, Math.PI / 2)
    expect(r.x).toBeCloseTo(0)
    expect(r.y).toBeCloseTo(1)
    const rc = rotate({ x: 2, y: 1 }, Math.PI, { x: 1, y: 1 })
    expect(rc.x).toBeCloseTo(0)
    expect(rc.y).toBeCloseTo(1)
  })
})
