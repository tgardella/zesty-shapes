// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { importSVG, parseColor, parseTransformList } from './svgImport'
import type { GroupNode, PathNode, RectNode, TextNode } from '../model/types'

describe('parseColor', () => {
  it('handles hex, rgb(), rgba(), and named colors', () => {
    expect(parseColor('#ff8000')).toEqual({ r: 255, g: 128, b: 0, a: 1 })
    expect(parseColor('#f80')).toEqual({ r: 255, g: 136, b: 0, a: 1 })
    expect(parseColor('#ff800080')!.a).toBeCloseTo(0.5, 1)
    expect(parseColor('rgb(10, 20, 30)')).toEqual({ r: 10, g: 20, b: 30, a: 1 })
    expect(parseColor('rgba(10,20,30,0.4)')!.a).toBeCloseTo(0.4)
    expect(parseColor('red')).toEqual({ r: 255, g: 0, b: 0, a: 1 })
    expect(parseColor('none-sense')).toBeNull()
  })
})

describe('parseTransformList', () => {
  it('composes translate/scale/rotate/matrix left-to-right', () => {
    expect(parseTransformList('translate(10 20)')).toEqual([1, 0, 0, 1, 10, 20])
    expect(parseTransformList('scale(2)')).toEqual([2, 0, 0, 2, 0, 0])
    const m = parseTransformList('translate(10,0) scale(2,3)')
    expect(m).toEqual([2, 0, 0, 3, 10, 0])
    const r = parseTransformList('rotate(90)')
    expect(r[0]).toBeCloseTo(0)
    expect(r[1]).toBeCloseTo(1)
  })
})

const SAMPLE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100">
  <defs>
    <linearGradient id="lg" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#ff0000"/>
      <stop offset="100%" stop-color="#0000ff" stop-opacity="0.5"/>
    </linearGradient>
  </defs>
  <rect id="frame" x="5" y="6" width="40" height="30" rx="4" fill="#336699" stroke="black" stroke-width="2"/>
  <circle cx="50" cy="50" r="10" fill="url(#lg)"/>
  <g transform="translate(100 0)" fill="lime" opacity="0.5">
    <path d="M 0 0 L 10 0 A 5 5 0 0 1 20 10 Z"/>
    <rect x="0" y="20" width="10" height="10" fill="rgb(1,2,3)"/>
  </g>
  <polygon points="0,0 10,0 5,8" fill="orange"/>
  <text x="10" y="90" font-size="12" font-family="Georgia" text-anchor="middle">Hi</text>
  <rect x="0" y="0" width="5" height="5" display="none"/>
  <unsupported-thing/>
</svg>`

describe('importSVG', () => {
  const result = importSVG(SAMPLE)
  const byName = (name: string) => result.nodes.find((n) => n.name === name)

  it('creates one root per top-level element and skips hidden/unsupported', () => {
    // rect, circle, g, polygon, text = 5 roots (display:none + unknown skipped)
    expect(result.roots).toHaveLength(5)
    expect(result.viewBox).toEqual({ minX: 0, minY: 0, maxX: 200, maxY: 100 })
  })

  it('parses shapes with params LOCAL and styles resolved', () => {
    const rect = byName('frame') as RectNode
    expect(rect.type).toBe('rect')
    expect([rect.x, rect.y, rect.w, rect.h, rect.rx]).toEqual([5, 6, 40, 30, 4])
    expect(rect.style.fill).toEqual({ type: 'solid', color: { r: 51, g: 102, b: 153, a: 1 } })
    expect(rect.style.stroke).toEqual({ type: 'solid', color: { r: 0, g: 0, b: 0, a: 1 } })
    expect(rect.style.strokeWidth).toBe(2)
  })

  it('resolves gradient fills to unit-space GradientPaint', () => {
    const circle = result.nodes.find((n) => n.type === 'ellipse')!
    const paint = circle.style.fill
    expect(paint?.type).toBe('gradient')
    if (paint?.type !== 'gradient') return
    expect(paint.gradientType).toBe('linear')
    expect(paint.stops).toHaveLength(2)
    expect(paint.stops[0]!.color.r).toBe(255)
    expect(paint.stops[1]!.color.a).toBeCloseTo(0.5)
    // objectBoundingBox default: the unit axis maps across the circle's bbox
    // (width 20), so the transform's x-scale is the bbox width.
    expect(paint.transform[0]).toBeCloseTo(20)
  })

  it('imports groups with inherited fill and full path grammar (arcs)', () => {
    const group = result.nodes.find((n) => n.type === 'group') as GroupNode
    expect(group.transform).toEqual([1, 0, 0, 1, 100, 0])
    expect(group.opacity).toBeCloseTo(0.5)
    expect(group.children).toHaveLength(2)
    const path = result.nodes.find((n) => n.id === group.children[0]) as PathNode
    expect(path.type).toBe('path')
    // inherited lime fill from the <g>
    expect(path.style.fill).toEqual({ type: 'solid', color: { r: 0, g: 255, b: 0, a: 1 } })
    // arc converted to cubics: more than the 3 explicit points
    expect(path.subpaths[0]!.anchors.length).toBeGreaterThan(3)
    // child rect keeps its OWN fill over the inherited one
    const child = result.nodes.find((n) => n.id === group.children[1]) as RectNode
    expect(child.style.fill).toEqual({ type: 'solid', color: { r: 1, g: 2, b: 3, a: 1 } })
  })

  it('imports polygons as closed paths and text with anchor alignment', () => {
    const poly = result.nodes.filter((n) => n.type === 'path').find((n) => n.parent === null)!
    expect((poly as PathNode).subpaths[0]!.closed).toBe(true)
    const text = result.nodes.find((n) => n.type === 'text') as TextNode
    expect(text.text).toBe('Hi')
    expect(text.fontSize).toBe(12)
    expect(text.fontFamily).toBe('Georgia')
    expect(text.textAlign).toBe('center')
    // x/y land in the transform (POSITIONING RULE), not in params
    expect(text.transform).toEqual([1, 0, 0, 1, 10, 90])
  })

  it('throws on non-SVG input', () => {
    expect(() => importSVG('this is not xml <<<')).toThrow()
  })
})
