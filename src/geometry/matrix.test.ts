import { describe, expect, it } from 'vitest'
import {
  applyToPoint,
  compose,
  decompose,
  identity,
  invert,
  matEquals,
  multiply,
  recompose,
  rotateMat,
  scaleMat,
  toSvgTransform,
  translate,
  type Mat,
} from './matrix'

function expectMatClose(actual: Mat, expected: Mat, epsilon = 1e-9): void {
  for (let i = 0; i < 6; i++) {
    expect(actual[i]).toBeCloseTo(expected[i]!, 9)
  }
  expect(matEquals(actual, expected, epsilon)).toBe(true)
}

describe('matrix multiply order (column-vector, M*p)', () => {
  it('multiply(A, B) applies B first, then A', () => {
    const T = translate(10, 0)
    const S = scaleMat(2)
    const p = { x: 1, y: 1 }
    // (T*S)p = T(S(p)) = (2,2) + (10,0)
    expect(applyToPoint(multiply(T, S), p)).toEqual({ x: 12, y: 2 })
    // (S*T)p = S(T(p)) = 2*(11,1)
    expect(applyToPoint(multiply(S, T), p)).toEqual({ x: 22, y: 2 })
  })

  it('compose(...) reads left-to-right as outermost-first (SVG nesting order)', () => {
    const p = { x: 1, y: 0 }
    const m = compose(translate(5, 0), rotateMat(Math.PI / 2))
    // rotate first: (1,0) -> (0,1); translate second -> (5,1)
    const out = applyToPoint(m, p)
    expect(out.x).toBeCloseTo(5)
    expect(out.y).toBeCloseTo(1)
  })

  it('rotateMat about a center keeps the center fixed', () => {
    const c = { x: 3, y: 4 }
    const m = rotateMat(1.234, c)
    const out = applyToPoint(m, c)
    expect(out.x).toBeCloseTo(c.x)
    expect(out.y).toBeCloseTo(c.y)
  })
})

describe('matrix invert', () => {
  it('invert(compose(...)) * compose(...) == identity', () => {
    const m = compose(translate(12, -7), rotateMat(0.7), scaleMat(2, 3))
    expectMatClose(multiply(invert(m), m), identity())
    expectMatClose(multiply(m, invert(m)), identity())
  })

  it('inverse maps transformed points back', () => {
    const m = compose(translate(5, 5), rotateMat(1.1), scaleMat(0.5, 4))
    const p = { x: -3, y: 11 }
    const back = applyToPoint(invert(m), applyToPoint(m, p))
    expect(back.x).toBeCloseTo(p.x)
    expect(back.y).toBeCloseTo(p.y)
  })

  it('throws on a singular matrix', () => {
    expect(() => invert([0, 0, 0, 0, 3, 4])).toThrow()
  })
})

describe('matrix decompose', () => {
  it('round-trips T*R*S through recompose', () => {
    const m = compose(translate(10, 20), rotateMat(Math.PI / 6), scaleMat(2, 3))
    const dec = decompose(m)
    expect(dec.tx).toBeCloseTo(10)
    expect(dec.ty).toBeCloseTo(20)
    expect(dec.rotation).toBeCloseTo(Math.PI / 6)
    expect(dec.scaleX).toBeCloseTo(2)
    expect(dec.scaleY).toBeCloseTo(3)
    expect(dec.skew).toBeCloseTo(0)
    expectMatClose(recompose(dec), m)
  })

  it('round-trips matrices with shear', () => {
    const shear: Mat = [1, 0, 0.8, 1, 0, 0]
    const m = compose(translate(-4, 9), rotateMat(2.1), shear, scaleMat(1.5, -2.5))
    expectMatClose(recompose(decompose(m)), m)
  })

  it('round-trips reflections (negative determinant)', () => {
    const m = compose(rotateMat(0.4), scaleMat(2, -3))
    const dec = decompose(m)
    expect(dec.scaleY).toBeLessThan(0)
    expectMatClose(recompose(dec), m)
  })
})

describe('svg emission', () => {
  it('emits matrix(a,b,c,d,e,f)', () => {
    expect(toSvgTransform([1, 2, 3, 4, 5, 6])).toBe('matrix(1,2,3,4,5,6)')
  })
})
