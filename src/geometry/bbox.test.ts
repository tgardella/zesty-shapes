import { describe, expect, it } from 'vitest'
import { localBBoxOfNode, transformBBox, unionBBox, worldBBoxOfNode } from './bbox'
import { addNode, createDocument, getWorldTransform } from '../model/document'
import { createGroupNode, createRectNode } from '../model/nodes'
import { rotateMat, translate } from './matrix'

describe('bbox', () => {
  it('unionBBox merges and tolerates null', () => {
    const a = { minX: 0, minY: 0, maxX: 10, maxY: 10 }
    const b = { minX: 5, minY: -5, maxX: 20, maxY: 8 }
    expect(unionBBox(a, b)).toEqual({ minX: 0, minY: -5, maxX: 20, maxY: 10 })
    expect(unionBBox(null, a)).toEqual(a)
    expect(unionBBox(a, null)).toEqual(a)
  })

  it('transformBBox returns the AABB of the transformed corners', () => {
    const b = { minX: 0, minY: 0, maxX: 10, maxY: 10 }
    const rotated = transformBBox(rotateMat(Math.PI / 4), b)
    const half = 10 * Math.SQRT1_2
    expect(rotated.minX).toBeCloseTo(-half)
    expect(rotated.maxX).toBeCloseTo(half)
    expect(rotated.maxY).toBeCloseTo(2 * half)
  })

  it('group local bbox unions children through their transforms', () => {
    const doc = createDocument()
    const group = createGroupNode()
    const a = createRectNode({ x: 0, y: 0, w: 10, h: 10 })
    const b = createRectNode({ x: 0, y: 0, w: 10, h: 10 }, { transform: translate(100, 0) })
    addNode(doc, group)
    addNode(doc, a, group.id)
    addNode(doc, b, group.id)
    expect(localBBoxOfNode(doc.nodes[group.id]!, doc.nodes)).toEqual({
      minX: 0,
      minY: 0,
      maxX: 110,
      maxY: 10,
    })
  })

  it('world bbox applies the EFFECTIVE (ancestor-composed) transform', () => {
    const doc = createDocument()
    const group = createGroupNode({ transform: translate(1000, 0) })
    const rect = createRectNode({ x: 0, y: 0, w: 10, h: 10 }, { transform: translate(5, 5) })
    addNode(doc, group)
    addNode(doc, rect, group.id)
    const world = getWorldTransform(doc.nodes, rect.id)
    expect(worldBBoxOfNode(doc.nodes, rect.id, world)).toEqual({
      minX: 1005,
      minY: 5,
      maxX: 1015,
      maxY: 15,
    })
  })
})
