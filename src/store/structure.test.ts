import { describe, expect, it } from 'vitest'
import {
  cmdAddNode,
  cmdAlignNodes,
  cmdDistributeNodes,
  cmdGroupNodes,
  cmdPlaceNode,
  cmdUngroupNodes,
} from './commands'
import { createEditorStore } from './store'
import { worldTransform } from './worldTransform'
import { addNode } from '../model/document'
import { createGroupNode, createRectNode } from '../model/nodes'
import { compose, matEquals, rotateMat, translate, type Mat } from '../geometry/matrix'
import { localBBoxOfNode, transformBBox } from '../geometry/bbox'
import type { GroupNode, NodeId } from '../model/types'
import { nodesInDocRect } from '../tools/hitTest'

function worldOf(store: ReturnType<typeof createEditorStore>, id: NodeId): Mat {
  return worldTransform(store.getState().document.nodes, id)
}

describe('cmdGroupNodes', () => {
  it('groups preserve every member world position and relative z-order', () => {
    const store = createEditorStore()
    const a = createRectNode({ x: 0, y: 0, w: 10, h: 10 }, { transform: translate(10, 10) })
    const b = createRectNode(
      { x: 0, y: 0, w: 10, h: 10 },
      { transform: compose(translate(200, 40), rotateMat(0.7)) },
    )
    cmdAddNode(store, a)
    cmdAddNode(store, b)
    const worldA = worldOf(store, a.id)
    const worldB = worldOf(store, b.id)

    const groupId = cmdGroupNodes(store, [a.id, b.id])!
    const state = store.getState()
    expect(state.selection).toEqual([groupId])
    const group = state.document.nodes[groupId] as GroupNode
    expect(group.children).toEqual([a.id, b.id]) // z-order kept
    expect(matEquals(worldOf(store, a.id), worldA, 1e-9)).toBe(true)
    expect(matEquals(worldOf(store, b.id), worldB, 1e-9)).toBe(true)

    // ONE undo restores the flat structure AND the prior selection.
    store.getState().undo()
    expect(store.getState().document.nodes[groupId]).toBeUndefined()
    expect(store.getState().document.nodes[a.id]!.parent).toBe(store.getState().document.root)
  })

  it('grouping inside a transformed parent bakes the delta', () => {
    const store = createEditorStore()
    const outer = createGroupNode({ transform: compose(translate(100, 0), rotateMat(0.5)) })
    const child = createRectNode({ x: 0, y: 0, w: 10, h: 10 }, { transform: translate(7, 3) })
    store.getState().applyCommand('Build', (doc) => {
      addNode(doc, outer)
      addNode(doc, child, outer.id)
    })
    const worldBefore = worldOf(store, child.id)
    cmdGroupNodes(store, [child.id])
    expect(matEquals(worldOf(store, child.id), worldBefore, 1e-9)).toBe(true)
  })
})

describe('cmdUngroupNodes', () => {
  it('pushes the group transform into children — NOTHING moves on screen', () => {
    const store = createEditorStore()
    const a = createRectNode({ x: 0, y: 0, w: 10, h: 10 }, { transform: translate(20, 0) })
    const b = createRectNode({ x: 0, y: 0, w: 10, h: 10 }, { transform: translate(60, 0) })
    cmdAddNode(store, a)
    cmdAddNode(store, b)
    const groupId = cmdGroupNodes(store, [a.id, b.id])!
    // Rotate + move the group, then ungroup.
    store.getState().applyCommand('Spin', (doc) => {
      doc.nodes[groupId]!.transform = compose(translate(300, 100), rotateMat(1.1))
    })
    const worldA = worldOf(store, a.id)
    const worldB = worldOf(store, b.id)

    const released = cmdUngroupNodes(store, [groupId])
    expect(released).toEqual([a.id, b.id])
    const state = store.getState()
    expect(state.document.nodes[groupId]).toBeUndefined()
    expect(state.document.nodes[a.id]!.parent).toBe(state.document.root)
    expect(state.selection).toEqual([a.id, b.id])
    expect(matEquals(worldOf(store, a.id), worldA, 1e-9)).toBe(true)
    expect(matEquals(worldOf(store, b.id), worldB, 1e-9)).toBe(true)

    // Children take the group's z-position in order.
    const rootChildren = (state.document.nodes[state.document.root] as GroupNode).children
    expect(rootChildren).toEqual([a.id, b.id])
  })

  it('undo of ungroup restores the group exactly', () => {
    const store = createEditorStore()
    const a = createRectNode({ x: 0, y: 0, w: 10, h: 10 })
    cmdAddNode(store, a)
    const groupId = cmdGroupNodes(store, [a.id])!
    cmdUngroupNodes(store, [groupId])
    store.getState().undo()
    const group = store.getState().document.nodes[groupId] as GroupNode
    expect(group).toBeDefined()
    expect(group.children).toEqual([a.id])
    expect(store.getState().selection).toEqual([groupId])
  })
})

describe('align & distribute', () => {
  function threeRects(store: ReturnType<typeof createEditorStore>) {
    const a = createRectNode({ x: 0, y: 0, w: 10, h: 10 }, { transform: translate(0, 0) })
    const b = createRectNode({ x: 0, y: 0, w: 20, h: 20 }, { transform: translate(50, 30) })
    const c = createRectNode({ x: 0, y: 0, w: 10, h: 10 }, { transform: translate(200, 90) })
    cmdAddNode(store, a)
    cmdAddNode(store, b)
    cmdAddNode(store, c)
    return { a, b, c }
  }
  const bboxOf = (store: ReturnType<typeof createEditorStore>, id: NodeId) => {
    const doc = store.getState().document
    return transformBBox(worldTransform(doc.nodes, id), localBBoxOfNode(doc.nodes[id]!, doc.nodes)!)
  }

  it('align left snaps every left edge to the union left edge, one undo entry', () => {
    const store = createEditorStore()
    const { a, b, c } = threeRects(store)
    const depth = store.getState().history.undoStack.length
    cmdAlignNodes(store, [a.id, b.id, c.id], 'left')
    for (const id of [a.id, b.id, c.id]) expect(bboxOf(store, id).minX).toBeCloseTo(0)
    expect(store.getState().history.undoStack.length).toBe(depth + 1)
  })

  it('align bottom + hcenter use union extremes/centers', () => {
    const store = createEditorStore()
    const { a, b, c } = threeRects(store)
    cmdAlignNodes(store, [a.id, b.id, c.id], 'bottom')
    for (const id of [a.id, b.id, c.id]) expect(bboxOf(store, id).maxY).toBeCloseTo(100)
    cmdAlignNodes(store, [a.id, b.id, c.id], 'hcenter')
    const centers = [a.id, b.id, c.id].map((id) => {
      const bb = bboxOf(store, id)
      return (bb.minX + bb.maxX) / 2
    })
    expect(centers[0]).toBeCloseTo(centers[1]!)
    expect(centers[1]).toBeCloseTo(centers[2]!)
  })

  it('distribute spaces bbox centers evenly, endpoints unmoved', () => {
    const store = createEditorStore()
    const { a, b, c } = threeRects(store)
    cmdDistributeNodes(store, [a.id, b.id, c.id], 'h')
    const centers = [a.id, b.id, c.id]
      .map((id) => {
        const bb = bboxOf(store, id)
        return (bb.minX + bb.maxX) / 2
      })
      .sort((x, y) => x - y)
    expect(centers[0]).toBeCloseTo(5) // first stays
    expect(centers[2]).toBeCloseTo(205) // last stays
    expect(centers[1]).toBeCloseTo((5 + 205) / 2)
  })

  it('align is a no-op below 2 nodes; distribute below 3', () => {
    const store = createEditorStore()
    const a = createRectNode({ x: 0, y: 0, w: 10, h: 10 })
    cmdAddNode(store, a)
    cmdAlignNodes(store, [a.id], 'left')
    cmdDistributeNodes(store, [a.id], 'h')
    expect(store.getState().history.undoStack).toHaveLength(1) // just the add
  })
})

describe('cmdPlaceNode (layers drag-drop) + deep lock', () => {
  it("'above'/'below' reorder within the ref's parent (panel semantics)", () => {
    const store = createEditorStore()
    const a = createRectNode({ x: 0, y: 0, w: 1, h: 1 })
    const b = createRectNode({ x: 0, y: 0, w: 1, h: 1 })
    const c = createRectNode({ x: 0, y: 0, w: 1, h: 1 })
    for (const n of [a, b, c]) cmdAddNode(store, n)
    const rootChildren = () =>
      (store.getState().document.nodes[store.getState().document.root] as GroupNode).children

    cmdPlaceNode(store, a.id, c.id, 'above') // visually above c = after c in array
    expect(rootChildren()).toEqual([b.id, c.id, a.id])
    cmdPlaceNode(store, a.id, b.id, 'below') // visually below b = before b
    expect(rootChildren()).toEqual([a.id, b.id, c.id])
  })

  it("'inside' nests into a group preserving world position; cycles are refused", () => {
    const store = createEditorStore()
    const group = createGroupNode({ transform: compose(translate(80, 0), rotateMat(0.4)) })
    const rect = createRectNode({ x: 0, y: 0, w: 10, h: 10 }, { transform: translate(30, 30) })
    store.getState().applyCommand('Build', (doc) => {
      addNode(doc, group)
      addNode(doc, rect)
    })
    const worldBefore = worldOf(store, rect.id)
    cmdPlaceNode(store, rect.id, group.id, 'inside')
    expect(store.getState().document.nodes[rect.id]!.parent).toBe(group.id)
    expect(matEquals(worldOf(store, rect.id), worldBefore, 1e-9)).toBe(true)

    // Dropping a group into its own descendant must be refused.
    const depth = store.getState().history.undoStack.length
    cmdPlaceNode(store, group.id, rect.id, 'above') // rect is inside group -> cycle
    expect(store.getState().history.undoStack.length).toBe(depth)
  })

  it('locking a group makes its children unreachable by marquee (inheritance)', () => {
    const store = createEditorStore()
    const group = createGroupNode()
    const rect = createRectNode({ x: 0, y: 0, w: 10, h: 10 })
    store.getState().applyCommand('Build', (doc) => {
      addNode(doc, group)
      addNode(doc, rect, group.id)
    })
    const hit = { minX: -5, minY: -5, maxX: 15, maxY: 15 }
    expect(nodesInDocRect(store.getState().document, hit)).toEqual([group.id])
    // Lock the GROUP: even scoped marquee inside it finds nothing.
    store.getState().applyCommand('Lock', (doc) => {
      doc.nodes[group.id]!.locked = true
    })
    expect(nodesInDocRect(store.getState().document, hit)).toEqual([])
    expect(
      nodesInDocRect(store.getState().document, hit, { scopeId: group.id }),
    ).toEqual([])
  })
})
