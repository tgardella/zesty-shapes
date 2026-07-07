import { describe, expect, it } from 'vitest'
import { leafNodeAtPoint, nodesInDocRect, resolveTopLevel } from './hitTest'
import { addNode, createDocument } from '../model/document'
import { createGroupNode, createRectNode, createTextNode } from '../model/nodes'
import { compose, rotateMat, translate } from '../geometry/matrix'

describe('nodesInDocRect (marquee)', () => {
  it('returns top-level ids whose geometry intersects the doc rect', () => {
    const doc = createDocument()
    const a = createRectNode({ x: 0, y: 0, w: 10, h: 10 })
    const b = createRectNode({ x: 0, y: 0, w: 10, h: 10 }, { transform: translate(100, 0) })
    addNode(doc, a)
    addNode(doc, b)
    expect(nodesInDocRect(doc, { minX: -5, minY: -5, maxX: 15, maxY: 15 })).toEqual([a.id])
    expect(nodesInDocRect(doc, { minX: 95, minY: -5, maxX: 115, maxY: 15 })).toEqual([b.id])
    expect(nodesInDocRect(doc, { minX: -5, minY: -5, maxX: 115, maxY: 15 })).toEqual([a.id, b.id])
    expect(nodesInDocRect(doc, { minX: 40, minY: 40, maxX: 60, maxY: 60 })).toEqual([])
  })

  it('tests group members through the group EFFECTIVE transform', () => {
    const doc = createDocument()
    const group = createGroupNode({ transform: translate(50, 50) })
    const child = createRectNode({ x: 0, y: 0, w: 10, h: 10 }, { transform: translate(5, 5) })
    addNode(doc, group)
    addNode(doc, child, group.id)
    // Child sits at world 55..65 — a rect around its LOCAL position must miss.
    expect(nodesInDocRect(doc, { minX: 0, minY: 0, maxX: 20, maxY: 20 })).toEqual([])
    expect(nodesInDocRect(doc, { minX: 54, minY: 54, maxX: 70, maxY: 70 })).toEqual([group.id])
  })

  it('respects rotation (bbox overlap alone is not a hit)', () => {
    const doc = createDocument()
    // 40x4 sliver rotated 45° about its center: its AABB covers the corner
    // region, but the actual geometry stays near the diagonal.
    const sliver = createRectNode(
      { x: -20, y: -2, w: 40, h: 4 },
      { transform: compose(translate(50, 50), rotateMat(Math.PI / 4)) },
    )
    addNode(doc, sliver)
    expect(nodesInDocRect(doc, { minX: 45, minY: 45, maxX: 55, maxY: 55 })).toEqual([sliver.id])
    // Inside the rotated AABB but far from the sliver itself.
    expect(nodesInDocRect(doc, { minX: 62, minY: 34, maxX: 66, maxY: 38 })).toEqual([])
  })

  it('skips locked and hidden nodes', () => {
    const doc = createDocument()
    const locked = createRectNode({ x: 0, y: 0, w: 10, h: 10 }, { locked: true })
    const hidden = createRectNode({ x: 0, y: 0, w: 10, h: 10 }, { hidden: true })
    addNode(doc, locked)
    addNode(doc, hidden)
    expect(nodesInDocRect(doc, { minX: -5, minY: -5, maxX: 15, maxY: 15 })).toEqual([])
  })
})

describe('leafNodeAtPoint (geometric tolerance hit)', () => {
  it('hits fills inside, outlines within tolerance, and misses beyond it', () => {
    const doc = createDocument()
    const filled = createRectNode({ x: 0, y: 0, w: 20, h: 20 })
    addNode(doc, filled)
    expect(leafNodeAtPoint(doc, { x: 10, y: 10 }, 2)).toBe(filled.id)
    expect(leafNodeAtPoint(doc, { x: 21.5, y: 10 }, 2)).toBe(filled.id) // edge slop
    expect(leafNodeAtPoint(doc, { x: 30, y: 10 }, 2)).toBeNull()
  })

  it('hits the EDGE of an unfilled shape (DOM hit-test blind spot)', () => {
    const doc = createDocument()
    const hollow = createRectNode({ x: 0, y: 0, w: 20, h: 20 })
    hollow.style.fill = null
    hollow.style.stroke = { type: 'solid', color: { r: 0, g: 0, b: 0, a: 1 } }
    addNode(doc, hollow)
    expect(leafNodeAtPoint(doc, { x: 20, y: 10 }, 2)).toBe(hollow.id) // on the edge
    expect(leafNodeAtPoint(doc, { x: 10, y: 10 }, 2)).toBeNull() // hollow middle
  })

  it('prefers the topmost leaf and respects world transforms', () => {
    const doc = createDocument()
    const below = createRectNode({ x: 0, y: 0, w: 20, h: 20 })
    const group = createGroupNode({ transform: translate(5, 5) })
    const above = createRectNode({ x: 0, y: 0, w: 20, h: 20 })
    addNode(doc, below)
    addNode(doc, group)
    addNode(doc, above, group.id) // world 5..25 — painted on top
    expect(leafNodeAtPoint(doc, { x: 10, y: 10 }, 1)).toBe(above.id)
    expect(leafNodeAtPoint(doc, { x: 2, y: 2 }, 1)).toBe(below.id)
  })

  it('hits text through its layout bbox', () => {
    const doc = createDocument()
    const text = createTextNode({ text: 'hello', fontSize: 20 }, { transform: translate(50, 50) })
    addNode(doc, text)
    expect(leafNodeAtPoint(doc, { x: 60, y: 45 }, 2)).toBe(text.id) // inside the block
    expect(leafNodeAtPoint(doc, { x: 200, y: 200 }, 2)).toBeNull()
  })
})

describe('layers are transparent to selection', () => {
  it('resolveTopLevel selects the object inside a layer, never the layer', () => {
    const doc = createDocument()
    const layer = createGroupNode({ name: 'Layer 1', isLayer: true })
    const rect = createRectNode({ x: 0, y: 0, w: 10, h: 10 })
    addNode(doc, layer)
    addNode(doc, rect, layer.id)
    // Clicking the rect resolves to the rect, not the layer.
    expect(resolveTopLevel(doc, rect.id, doc.root)).toBe(rect.id)
    // Clicking the layer itself resolves to nothing (layers aren't art).
    expect(resolveTopLevel(doc, layer.id, doc.root)).toBeNull()
  })

  it('resolveTopLevel stops at the nearest layer through sublayers', () => {
    const doc = createDocument()
    const layer = createGroupNode({ name: 'Layer 1', isLayer: true })
    const sub = createGroupNode({ name: 'Sublayer', isLayer: true })
    const group = createGroupNode({ name: 'G' })
    const rect = createRectNode({ x: 0, y: 0, w: 10, h: 10 })
    addNode(doc, layer)
    addNode(doc, sub, layer.id)
    addNode(doc, group, sub.id)
    addNode(doc, rect, group.id)
    // The top-level art within the nearest layer (sub) is the group.
    expect(resolveTopLevel(doc, rect.id, doc.root)).toBe(group.id)
  })

  it('nodesInDocRect flattens layers and returns the objects', () => {
    const doc = createDocument()
    const layer = createGroupNode({ name: 'Layer 1', isLayer: true })
    const a = createRectNode({ x: 0, y: 0, w: 10, h: 10 })
    const b = createRectNode({ x: 0, y: 0, w: 10, h: 10 }, { transform: translate(100, 0) })
    addNode(doc, layer)
    addNode(doc, a, layer.id)
    addNode(doc, b, layer.id)
    expect(nodesInDocRect(doc, { minX: -5, minY: -5, maxX: 15, maxY: 15 })).toEqual([a.id])
  })
})
