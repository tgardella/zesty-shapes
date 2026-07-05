import { describe, expect, it } from 'vitest'
import { nodesInDocRect } from './hitTest'
import { addNode, createDocument } from '../model/document'
import { createGroupNode, createRectNode } from '../model/nodes'
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
