import { describe, expect, it } from 'vitest'
import { appearanceSimilar, paintsSimilar } from './MagicWandTool'
import { createRectNode, createTextNode, rgba } from '../model/nodes'
import { pointInRegions } from '../geometry/boolean'
import { localBBoxOfNode } from '../geometry/bbox'
import type { Paint } from '../model/types'

const solid = (r: number, g: number, b: number, a = 1): Paint => ({
  type: 'solid',
  color: rgba(r, g, b, a),
})

describe('magic wand appearance matching', () => {
  it('solids match within the per-channel tolerance', () => {
    expect(paintsSimilar(solid(100, 100, 100), solid(120, 90, 110), 32)).toBe(true)
    expect(paintsSimilar(solid(100, 100, 100), solid(150, 100, 100), 32)).toBe(false)
    expect(paintsSimilar(null, null, 32)).toBe(true)
    expect(paintsSimilar(solid(0, 0, 0), null, 32)).toBe(false)
  })

  it('gradients match by stops, not placement', () => {
    const grad = (r: number): Paint => ({
      type: 'gradient',
      gradientType: 'linear',
      stops: [
        { offset: 0, color: rgba(r, 0, 0, 1) },
        { offset: 1, color: rgba(r, 0, 0, 0) },
      ],
      transform: [Math.random() * 100 + 1, 0, 0, 100, 0, 0], // placement ignored
    })
    expect(paintsSimilar(grad(200), grad(210), 32)).toBe(true)
    expect(paintsSimilar(grad(200), grad(100), 32)).toBe(false)
  })

  it('filled seeds match on FILL COLOR only (Illustrator primary attribute)', () => {
    const a = createRectNode({ x: 0, y: 0, w: 10, h: 10 })
    a.style.fill = solid(200, 50, 50)
    const b = createRectNode({ x: 20, y: 0, w: 10, h: 10 })
    b.style.fill = solid(210, 60, 40)
    expect(appearanceSimilar(a, b)).toBe(true)
    // Differing strokes / opacity do NOT exclude a fill match.
    b.style.stroke = solid(0, 0, 0)
    b.style.strokeWidth = 10
    b.opacity = 0.5
    expect(appearanceSimilar(a, b)).toBe(true)
    b.style.fill = solid(90, 60, 40) // fill out of tolerance
    expect(appearanceSimilar(a, b)).toBe(false)
  })

  it('stroke-only seeds match on stroke paint + weight', () => {
    const a = createRectNode({ x: 0, y: 0, w: 10, h: 10 })
    a.style.fill = null
    a.style.stroke = solid(10, 10, 10)
    a.style.strokeWidth = 2
    const b = createRectNode({ x: 20, y: 0, w: 10, h: 10 })
    b.style.fill = solid(255, 0, 0) // fill irrelevant for a stroke-only seed
    b.style.stroke = solid(20, 20, 20)
    b.style.strokeWidth = 2.5
    expect(appearanceSimilar(a, b)).toBe(true)
    b.style.strokeWidth = 8
    expect(appearanceSimilar(a, b)).toBe(false)
  })
})

describe('lasso building blocks', () => {
  it('point-in-polygon works for a freehand-ish concave region', () => {
    // A "C" shape: points inside the mouth are OUTSIDE the polygon.
    const region = [
      [
        [
          { x: 0, y: 0 },
          { x: 40, y: 0 },
          { x: 40, y: 10 },
          { x: 10, y: 10 },
          { x: 10, y: 30 },
          { x: 40, y: 30 },
          { x: 40, y: 40 },
          { x: 0, y: 40 },
        ],
      ],
    ]
    expect(pointInRegions(region, { x: 5, y: 20 })).toBe(true) // spine
    expect(pointInRegions(region, { x: 25, y: 20 })).toBe(false) // mouth
  })

  it('text bbox (via the layout engine) is available for lasso hit points', () => {
    const text = createTextNode({ text: 'hello', fontSize: 20 })
    const bbox = localBBoxOfNode(text, { [text.id]: text })
    expect(bbox).not.toBeNull()
    expect(bbox!.maxX).toBeGreaterThan(0) // approximate measurer in tests
    expect(bbox!.minY).toBeLessThan(0) // ascent above the baseline
  })
})
