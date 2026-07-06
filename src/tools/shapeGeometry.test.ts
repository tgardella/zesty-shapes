import { describe, expect, it } from 'vitest'
import {
  dragRectGeometry,
  lineDragParams,
  radialDragParams,
} from './behaviors/ShapeToolBase'
import type { ToolModifiers } from './types'

const none: ToolModifiers = { shift: false, alt: false, meta: false, ctrl: false }
const shift: ToolModifiers = { ...none, shift: true }
const alt: ToolModifiers = { ...none, alt: true }
const shiftAlt: ToolModifiers = { ...none, shift: true, alt: true }

describe('dragRectGeometry', () => {
  it('normalizes any drag direction to a min-corner box', () => {
    expect(dragRectGeometry({ x: 10, y: 10 }, { x: 30, y: 50 }, none)).toEqual({
      x: 10,
      y: 10,
      w: 20,
      h: 40,
    })
    expect(dragRectGeometry({ x: 30, y: 50 }, { x: 10, y: 10 }, none)).toEqual({
      x: 10,
      y: 10,
      w: 20,
      h: 40,
    })
  })

  it('Shift = square of the dominant dimension, toward the cursor', () => {
    const g = dragRectGeometry({ x: 0, y: 0 }, { x: 30, y: -10 }, shift)
    expect(g).toEqual({ x: 0, y: -30, w: 30, h: 30 })
  })

  it('Alt = draw from center; Shift+Alt = square from center', () => {
    expect(dragRectGeometry({ x: 100, y: 100 }, { x: 120, y: 110 }, alt)).toEqual({
      x: 80,
      y: 90,
      w: 40,
      h: 20,
    })
    expect(dragRectGeometry({ x: 100, y: 100 }, { x: 120, y: 110 }, shiftAlt)).toEqual({
      x: 80,
      y: 80,
      w: 40,
      h: 40,
    })
  })
})

describe('radialDragParams (polygon/star)', () => {
  it('radius = drag distance, first vertex points at the cursor', () => {
    const right = radialDragParams({ x: 0, y: 0 }, { x: 50, y: 0 }, none)
    expect(right.radius).toBeCloseTo(50)
    expect(right.angle).toBeCloseTo(Math.PI / 2) // shapes.ts angle 0 = up; +90° = right

    const up = radialDragParams({ x: 0, y: 0 }, { x: 0, y: -50 }, none)
    expect(up.angle).toBeCloseTo(0)
  })

  it('Shift = upright regardless of drag direction', () => {
    const g = radialDragParams({ x: 0, y: 0 }, { x: 37, y: 21 }, shift)
    expect(g.angle).toBe(0)
    expect(g.radius).toBeCloseTo(Math.hypot(37, 21))
  })
})

describe('lineDragParams', () => {
  it('plain drag: local end = delta, placed at the origin', () => {
    expect(lineDragParams({ x: 10, y: 20 }, { x: 40, y: 60 }, none)).toEqual({
      end: { x: 30, y: 40 },
      position: { x: 10, y: 20 },
    })
  })

  it('Alt extends symmetrically around the origin', () => {
    expect(lineDragParams({ x: 100, y: 100 }, { x: 130, y: 100 }, alt)).toEqual({
      end: { x: 60, y: 0 },
      position: { x: 70, y: 100 },
    })
  })
})
