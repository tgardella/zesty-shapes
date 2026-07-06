import { describe, expect, it } from 'vitest'
import { createTextNode } from './nodes'
import { createAnchor, createSubPath } from './pathOps'
import { layoutText, wrapText } from './textLayout'
import type { MeasureFn } from './textMetrics'

/** Deterministic measurer: every char is exactly half an em wide. */
const measure: MeasureFn = (text, font) => [...text].length * font.size * 0.5

describe('point text layout', () => {
  it('first baseline at the origin; lines advance by leading', () => {
    const node = createTextNode({ text: 'ab\ncd', fontSize: 20, leading: 1.5 })
    const layout = layoutText(node, measure)
    expect(layout.mode).toBe('lines')
    expect(layout.lines).toHaveLength(2)
    expect(layout.lines[0]!.y).toBe(0)
    expect(layout.lines[1]!.y).toBe(30) // 20 * 1.5
    // Char x positions: 0.5em = 10px per char.
    expect(layout.lines[0]!.xs).toEqual([0, 10])
    expect(layout.bbox.minY).toBeLessThan(0) // ascent above the baseline
  })

  it('alignment shifts lines around the anchor', () => {
    const center = createTextNode({ text: 'abcd', fontSize: 20, textAlign: 'center' })
    expect(layoutText(center, measure).lines[0]!.xs[0]).toBe(-20) // width 40, centered
    const right = createTextNode({ text: 'abcd', fontSize: 20, textAlign: 'right' })
    expect(layoutText(right, measure).lines[0]!.xs[0]).toBe(-40)
  })

  it('tracking spreads chars by 1/1000 em increments', () => {
    const node = createTextNode({ text: 'ab', fontSize: 20, tracking: 500 }) // +0.5em
    const layout = layoutText(node, measure)
    expect(layout.lines[0]!.xs).toEqual([0, 20]) // 10 advance + 10 tracking
  })
})

describe('area text layout', () => {
  it('wraps words inside the box and respects explicit breaks', () => {
    const font = { family: 'x', size: 10, weight: 400, kerning: true }
    // Each char 5px; 'hello world again' with maxWidth 40 -> lines <= 8 chars.
    expect(wrapText('hello world again', 40, font, 0, measure)).toEqual([
      'hello',
      'world',
      'again',
    ])
    expect(wrapText('ab\ncd', 100, font, 0, measure)).toEqual(['ab', 'cd'])
  })

  it('positions lines inside the box with the first baseline one ascent down', () => {
    const node = createTextNode({
      text: 'hello world',
      fontSize: 10,
      leading: 1.2,
      kind: 'area',
      width: 40,
      height: 60,
    })
    const layout = layoutText(node, measure)
    expect(layout.lines).toHaveLength(2)
    expect(layout.lines[0]!.y).toBeCloseTo(8) // ascent = 0.8 * 10
    expect(layout.lines[1]!.y).toBeCloseTo(20)
    expect(layout.bbox).toEqual({ minX: 0, minY: 0, maxX: 40, maxY: 60 })
  })
})

describe('vertical type', () => {
  it('stacks glyphs downward; columns advance right-to-left', () => {
    const node = createTextNode({ text: 'ab\ncd', fontSize: 20, leading: 1.2, vertical: true })
    const layout = layoutText(node, measure)
    expect(layout.mode).toBe('glyphs')
    const [a, b, c] = layout.glyphs
    expect(a!.y).toBe(0)
    expect(b!.y).toBe(20) // char step = fontSize
    expect(c!.x).toBeLessThan(a!.x) // second column is LEFT of the first
  })
})

describe('type on a path', () => {
  it('glyphs follow the path with tangent rotation', () => {
    // An L-shaped path: right 100, then down 100.
    const path = createSubPath(
      [
        createAnchor({ x: 0, y: 0 }),
        createAnchor({ x: 100, y: 0 }),
        createAnchor({ x: 100, y: 100 }),
      ],
      false,
    )
    // 20 chars * 8px = 160 along the 200-long path: spans both legs.
    const node = createTextNode({ text: 'a'.repeat(20), fontSize: 16, textPath: [path] })
    const layout = layoutText(node, measure)
    expect(layout.mode).toBe('glyphs')
    expect(layout.glyphs.length).toBeGreaterThan(15)
    const first = layout.glyphs[0]!
    const last = layout.glyphs[layout.glyphs.length - 1]!
    // Early glyphs run along the horizontal leg…
    expect(Math.abs(first.rotate!)).toBeLessThan(1)
    expect(Math.abs(first.y)).toBeLessThan(1)
    // …late glyphs sit on the vertical leg, rotated 90°.
    expect(Math.abs(last.rotate! - 90)).toBeLessThan(1)
    expect(last.x).toBeGreaterThan(95)
    expect(last.y).toBeGreaterThan(10)
  })

  it('start offset pushes glyphs along; overflow past the end is hidden', () => {
    const path = createSubPath(
      [createAnchor({ x: 0, y: 0 }), createAnchor({ x: 100, y: 0 })],
      false,
    )
    const base = createTextNode({ text: 'aaaa', fontSize: 16, textPath: [path] })
    const offset = createTextNode({
      text: 'aaaa',
      fontSize: 16,
      textPath: [path],
      pathStartOffset: 0.5,
    })
    const x0 = layoutText(base, measure).glyphs[0]!.x
    const x1 = layoutText(offset, measure).glyphs[0]!.x
    expect(x1 - x0).toBeCloseTo(50, 0)

    const overflowing = createTextNode({
      text: 'aaaaaaaaaaaaaaaaaaaaaaaa', // 24 chars * 8px = 192 > 100
      fontSize: 16,
      textPath: [path],
    })
    const glyphs = layoutText(overflowing, measure).glyphs
    expect(glyphs.length).toBeLessThan(24)
    expect(glyphs.every((g) => g.x <= 100)).toBe(true)
  })
})
