import { describe, expect, it } from 'vitest'
import {
  addNode,
  createDocument,
  getWorldTransform,
  isAncestorOf,
  removeNode,
  reorder,
  reparent,
  updateNode,
  walk,
} from './document'
import { createGroupNode, createRectNode } from './nodes'
import { applyToPoint, compose, matEquals, rotateMat, translate } from '../geometry/matrix'
import type { GroupNode } from './types'

describe('document CRUD', () => {
  it('addNode keeps parent and children in sync atomically', () => {
    const doc = createDocument()
    const rect = createRectNode({ x: 0, y: 0, w: 10, h: 10 })
    addNode(doc, rect)
    expect(rect.parent).toBe(doc.root)
    expect((doc.nodes[doc.root] as GroupNode).children).toEqual([rect.id])
  })

  it('addNode inserts at an explicit index (z-order)', () => {
    const doc = createDocument()
    const a = createRectNode({ x: 0, y: 0, w: 1, h: 1 })
    const b = createRectNode({ x: 0, y: 0, w: 1, h: 1 })
    const c = createRectNode({ x: 0, y: 0, w: 1, h: 1 })
    addNode(doc, a)
    addNode(doc, b)
    addNode(doc, c, doc.root, 1)
    expect((doc.nodes[doc.root] as GroupNode).children).toEqual([a.id, c.id, b.id])
  })

  it('removeNode removes the whole subtree and unlinks from the parent', () => {
    const doc = createDocument()
    const group = createGroupNode()
    const rect = createRectNode({ x: 0, y: 0, w: 10, h: 10 })
    addNode(doc, group)
    addNode(doc, rect, group.id)
    const removed = removeNode(doc, group.id)
    expect(removed.sort()).toEqual([group.id, rect.id].sort())
    expect(doc.nodes[group.id]).toBeUndefined()
    expect(doc.nodes[rect.id]).toBeUndefined()
    expect((doc.nodes[doc.root] as GroupNode).children).toEqual([])
  })

  it('rejects removing or reparenting the root', () => {
    const doc = createDocument()
    expect(() => removeNode(doc, doc.root)).toThrow()
    const group = createGroupNode()
    addNode(doc, group)
    expect(() => reparent(doc, doc.root, group.id)).toThrow()
  })

  it('rejects reparenting into a descendant (cycle)', () => {
    const doc = createDocument()
    const outer = createGroupNode()
    const inner = createGroupNode()
    addNode(doc, outer)
    addNode(doc, inner, outer.id)
    expect(isAncestorOf(doc, outer.id, inner.id)).toBe(true)
    expect(() => reparent(doc, outer.id, inner.id)).toThrow()
  })

  it('reorder moves within the same parent only', () => {
    const doc = createDocument()
    const a = createRectNode({ x: 0, y: 0, w: 1, h: 1 })
    const b = createRectNode({ x: 0, y: 0, w: 1, h: 1 })
    const c = createRectNode({ x: 0, y: 0, w: 1, h: 1 })
    for (const n of [a, b, c]) addNode(doc, n)
    reorder(doc, a.id, 2)
    expect((doc.nodes[doc.root] as GroupNode).children).toEqual([b.id, c.id, a.id])
    reorder(doc, a.id, 0)
    expect((doc.nodes[doc.root] as GroupNode).children).toEqual([a.id, b.id, c.id])
  })

  it('updateNode applies a focused mutation', () => {
    const doc = createDocument()
    const rect = createRectNode({ x: 0, y: 0, w: 10, h: 10 })
    addNode(doc, rect)
    updateNode(doc, rect.id, (n) => {
      n.name = 'Hero'
    })
    expect(doc.nodes[rect.id]!.name).toBe('Hero')
  })

  it('walk yields depth-first in z-order', () => {
    const doc = createDocument()
    const g = createGroupNode()
    const a = createRectNode({ x: 0, y: 0, w: 1, h: 1 })
    const b = createRectNode({ x: 0, y: 0, w: 1, h: 1 })
    addNode(doc, g)
    addNode(doc, a, g.id)
    addNode(doc, b)
    expect([...walk(doc)].map((n) => n.id)).toEqual([doc.root, g.id, a.id, b.id])
  })
})

describe('world transforms', () => {
  it('getWorldTransform is the product of ALL ancestor transforms', () => {
    const doc = createDocument()
    const group = createGroupNode({ transform: translate(100, 0) })
    const rect = createRectNode(
      { x: 0, y: 0, w: 10, h: 10 },
      { transform: compose(translate(0, 50), rotateMat(Math.PI / 2)) },
    )
    addNode(doc, group)
    addNode(doc, rect, group.id)
    const world = getWorldTransform(doc.nodes, rect.id)
    const expected = compose(translate(100, 0), translate(0, 50), rotateMat(Math.PI / 2))
    expect(matEquals(world, expected, 1e-9)).toBe(true)
  })

  it('reparent PRESERVES world position by baking the transform delta', () => {
    const doc = createDocument()
    const groupA = createGroupNode({ transform: compose(translate(100, 20), rotateMat(0.5)) })
    const groupB = createGroupNode({ transform: compose(translate(-30, 7), rotateMat(-1.2)) })
    const rect = createRectNode(
      { x: 0, y: 0, w: 10, h: 10 },
      { transform: compose(translate(5, 5), rotateMat(0.3)) },
    )
    addNode(doc, groupA)
    addNode(doc, groupB)
    addNode(doc, rect, groupA.id)

    const worldBefore = getWorldTransform(doc.nodes, rect.id)
    reparent(doc, rect.id, groupB.id)
    const worldAfter = getWorldTransform(doc.nodes, rect.id)

    expect(rect.parent).toBe(groupB.id)
    expect((doc.nodes[groupA.id] as GroupNode).children).toEqual([])
    expect((doc.nodes[groupB.id] as GroupNode).children).toEqual([rect.id])
    expect(matEquals(worldAfter, worldBefore, 1e-9)).toBe(true)
    // A concrete corner lands on the same world point.
    const cornerBefore = applyToPoint(worldBefore, { x: 10, y: 10 })
    const cornerAfter = applyToPoint(worldAfter, { x: 10, y: 10 })
    expect(cornerAfter.x).toBeCloseTo(cornerBefore.x)
    expect(cornerAfter.y).toBeCloseTo(cornerBefore.y)
  })
})
