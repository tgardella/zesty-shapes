import { describe, expect, it } from 'vitest'
import { nodesInDocRect, resolveTopLevel } from './hitTest'
import { rectRadiusHandle } from './handles'
import { addNode, createDocument } from '../model/document'
import { createGroupNode, createRectNode } from '../model/nodes'
import { translate } from '../geometry/matrix'

function buildScopedDoc() {
  const doc = createDocument()
  const group = createGroupNode({ transform: translate(100, 0) })
  const inner = createRectNode({ x: 0, y: 0, w: 10, h: 10 })
  const outer = createRectNode({ x: 0, y: 0, w: 10, h: 10 }, { transform: translate(300, 0) })
  addNode(doc, group)
  addNode(doc, inner, group.id)
  addNode(doc, outer)
  return { doc, group, inner, outer }
}

describe('resolveTopLevel (scope-aware click resolution)', () => {
  it('resolves to child-of-root by default, child-of-scope when isolated', () => {
    const { doc, group, inner } = buildScopedDoc()
    expect(resolveTopLevel(doc, inner.id, doc.root)).toBe(group.id)
    expect(resolveTopLevel(doc, inner.id, group.id)).toBe(inner.id)
  })

  it('falls back to child-of-root for nodes OUTSIDE the scope subtree', () => {
    const { doc, group, outer } = buildScopedDoc()
    expect(resolveTopLevel(doc, outer.id, group.id)).toBe(outer.id)
  })

  it('returns null for the root, the scope itself, and unknown ids', () => {
    const { doc, group } = buildScopedDoc()
    expect(resolveTopLevel(doc, doc.root, doc.root)).toBeNull()
    expect(resolveTopLevel(doc, group.id, group.id)).toBeNull()
    expect(resolveTopLevel(doc, 'missing', doc.root)).toBeNull()
  })
})

describe('nodesInDocRect: scope + contain mode', () => {
  it('marquee inside a scope selects the scope CHILDREN, not the group', () => {
    const { doc, group, inner } = buildScopedDoc()
    const rect = { minX: 95, minY: -5, maxX: 115, maxY: 15 } // inner is at world 100..110
    expect(nodesInDocRect(doc, rect)).toEqual([group.id])
    expect(nodesInDocRect(doc, rect, { scopeId: group.id })).toEqual([inner.id])
  })

  it("'contain' requires the whole node inside the rect; 'intersect' does not", () => {
    const doc = createDocument()
    const rect = createRectNode({ x: 0, y: 0, w: 100, h: 100 })
    addNode(doc, rect)
    const partial = { minX: -10, minY: -10, maxX: 50, maxY: 50 }
    const full = { minX: -10, minY: -10, maxX: 110, maxY: 110 }
    expect(nodesInDocRect(doc, partial, { mode: 'intersect' })).toEqual([rect.id])
    expect(nodesInDocRect(doc, partial, { mode: 'contain' })).toEqual([])
    expect(nodesInDocRect(doc, full, { mode: 'contain' })).toEqual([rect.id])
  })
})

describe('rectRadiusHandle', () => {
  const viewport = { tx: 0, ty: 0, zoom: 1 }

  it('appears for exactly one selected RectNode, inset on the corner diagonal', () => {
    const doc = createDocument()
    const rect = createRectNode(
      { x: 0, y: 0, w: 100, h: 100, rx: 20 },
      { transform: translate(50, 50) },
    )
    addNode(doc, rect)
    const handle = rectRadiusHandle(doc.nodes, [rect.id], viewport)
    expect(handle).not.toBeNull()
    expect(handle!.nodeId).toBe(rect.id)
    // rx=20 > min inset: the diamond sits at local (20,20) -> world (70,70).
    expect(handle!.screenPoint).toEqual({ x: 70, y: 70 })
    expect(handle!.rx).toBe(20)
  })

  it('enforces a minimum inset so rx=0 never collides with the corner handle', () => {
    const doc = createDocument()
    const rect = createRectNode({ x: 0, y: 0, w: 100, h: 100, rx: 0 })
    addNode(doc, rect)
    const handle = rectRadiusHandle(doc.nodes, [rect.id], viewport)!
    expect(handle.screenPoint.x).toBeGreaterThan(5)
    expect(handle.screenPoint.x).toBe(handle.screenPoint.y)
  })

  it('returns null for multi-selection, non-rects, and locked rects', () => {
    const doc = createDocument()
    const a = createRectNode({ x: 0, y: 0, w: 10, h: 10 })
    const b = createRectNode({ x: 0, y: 0, w: 10, h: 10 })
    const locked = createRectNode({ x: 0, y: 0, w: 10, h: 10 }, { locked: true })
    addNode(doc, a)
    addNode(doc, b)
    addNode(doc, locked)
    expect(rectRadiusHandle(doc.nodes, [a.id, b.id], viewport)).toBeNull()
    expect(rectRadiusHandle(doc.nodes, [locked.id], viewport)).toBeNull()
    expect(rectRadiusHandle(doc.nodes, [], viewport)).toBeNull()
  })
})
