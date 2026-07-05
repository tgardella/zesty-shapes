import { describe, expect, it } from 'vitest'
import { createEditorStore } from './store'
import { cmdAddNode, cmdDeleteNodes, cmdSetTransforms } from './commands'
import { createGroupNode, createRectNode } from '../model/nodes'
import { addNode } from '../model/document'
import { screenToDoc } from './coords'
import { worldTransform } from './worldTransform'
import { compose, matEquals, translate } from '../geometry/matrix'
import type { Mat } from '../geometry/matrix'

function makeRect() {
  return createRectNode({ x: 0, y: 0, w: 10, h: 10 })
}

describe('commands + undo/redo', () => {
  it('add -> undo removes the node -> redo restores it with selection', () => {
    const store = createEditorStore()
    const rect = makeRect()
    cmdAddNode(store, rect, { select: true })
    expect(store.getState().document.nodes[rect.id]).toBeDefined()
    expect(store.getState().selection).toEqual([rect.id])

    store.getState().undo()
    expect(store.getState().document.nodes[rect.id]).toBeUndefined()
    expect(store.getState().selection).toEqual([])

    store.getState().redo()
    expect(store.getState().document.nodes[rect.id]).toBeDefined()
    expect(store.getState().selection).toEqual([rect.id])
  })

  it('undo of a delete restores the nodes AND the prior selection', () => {
    const store = createEditorStore()
    const a = makeRect()
    const b = makeRect()
    cmdAddNode(store, a)
    cmdAddNode(store, b)
    store.getState().setSelection([a.id, b.id])
    cmdDeleteNodes(store, [a.id, b.id])
    expect(store.getState().document.nodes[a.id]).toBeUndefined()
    expect(store.getState().selection).toEqual([])

    store.getState().undo()
    expect(store.getState().document.nodes[a.id]).toBeDefined()
    expect(store.getState().document.nodes[b.id]).toBeDefined()
    expect(store.getState().selection).toEqual([a.id, b.id])
  })

  it('bare selection changes create NO history entries', () => {
    const store = createEditorStore()
    const rect = makeRect()
    cmdAddNode(store, rect)
    const depth = store.getState().history.undoStack.length
    store.getState().setSelection([rect.id])
    store.getState().clearSelection()
    store.getState().setSelection([rect.id])
    expect(store.getState().history.undoStack.length).toBe(depth)
  })

  it('deleting a group deletes its subtree and undo restores it intact', () => {
    const store = createEditorStore()
    const group = createGroupNode()
    const child = makeRect()
    store.getState().applyCommand('Build', (doc) => {
      addNode(doc, group)
      addNode(doc, child, group.id)
    })
    cmdDeleteNodes(store, [group.id])
    expect(store.getState().document.nodes[child.id]).toBeUndefined()
    store.getState().undo()
    const restored = store.getState().document
    expect(restored.nodes[group.id]).toBeDefined()
    expect(restored.nodes[child.id]).toBeDefined()
    expect(restored.nodes[child.id]!.parent).toBe(group.id)
  })
})

describe('transactions (one gesture = ONE undo step)', () => {
  it('coalesces many intra-transaction updates into a single squashed entry', () => {
    const store = createEditorStore()
    const rect = makeRect()
    cmdAddNode(store, rect)
    const depthBefore = store.getState().history.undoStack.length

    store.getState().beginTransaction('Move')
    for (let i = 1; i <= 20; i++) {
      cmdSetTransforms(store, [{ id: rect.id, transform: translate(i, i) }])
    }
    expect(store.getState().inTransaction()).toBe(true)
    store.getState().commitTransaction()

    const history = store.getState().history
    expect(history.undoStack.length).toBe(depthBefore + 1)
    const entry = history.undoStack[history.undoStack.length - 1]!
    expect(entry.label).toBe('Move')
    // 20 writes to one path squash to one forward + one inverse patch.
    expect(entry.patches.length).toBe(1)
    expect(entry.inversePatches.length).toBe(1)
    expect(store.getState().document.nodes[rect.id]!.transform).toEqual(translate(20, 20))

    store.getState().undo()
    expect(store.getState().document.nodes[rect.id]!.transform).toEqual([1, 0, 0, 1, 0, 0])
    store.getState().redo()
    expect(store.getState().document.nodes[rect.id]!.transform).toEqual(translate(20, 20))
  })

  it('cancelTransaction rolls the document back and adds no history', () => {
    const store = createEditorStore()
    const rect = makeRect()
    cmdAddNode(store, rect)
    const depth = store.getState().history.undoStack.length

    store.getState().beginTransaction('Move')
    cmdSetTransforms(store, [{ id: rect.id, transform: translate(50, 0) }])
    expect(store.getState().document.nodes[rect.id]!.transform).toEqual(translate(50, 0))
    store.getState().cancelTransaction()

    expect(store.getState().document.nodes[rect.id]!.transform).toEqual([1, 0, 0, 1, 0, 0])
    expect(store.getState().history.undoStack.length).toBe(depth)
  })

  it('a create inside a transaction cancels away completely', () => {
    const store = createEditorStore()
    const rect = makeRect()
    store.getState().beginTransaction('Draw Rectangle')
    cmdAddNode(store, rect)
    store.getState().cancelTransaction()
    expect(store.getState().document.nodes[rect.id]).toBeUndefined()
    expect(store.getState().history.undoStack.length).toBe(0)
  })

  it('undo/redo are blocked while a transaction is open', () => {
    const store = createEditorStore()
    const rect = makeRect()
    cmdAddNode(store, rect)
    store.getState().beginTransaction('Move')
    cmdSetTransforms(store, [{ id: rect.id, transform: translate(5, 5) }])
    store.getState().undo() // must be ignored
    expect(store.getState().document.nodes[rect.id]).toBeDefined()
    store.getState().commitTransaction()
  })
})

describe('viewport', () => {
  it('zoomAtPoint keeps the doc point under the cursor fixed', () => {
    const store = createEditorStore()
    const screenPoint = { x: 313, y: 179 }
    const before = screenToDoc(store.getState().viewport, screenPoint)
    store.getState().zoomAtPoint(screenPoint, 2.5)
    const after = screenToDoc(store.getState().viewport, screenPoint)
    expect(after.x).toBeCloseTo(before.x)
    expect(after.y).toBeCloseTo(before.y)
    expect(store.getState().viewport.zoom).toBeCloseTo(2.5)
  })

  it('viewport changes are never undoable', () => {
    const store = createEditorStore()
    store.getState().panBy(100, 50)
    store.getState().zoomAtPoint({ x: 0, y: 0 }, 2)
    expect(store.getState().history.undoStack.length).toBe(0)
    store.getState().undo() // no-op, must not touch viewport
    expect(store.getState().viewport.zoom).toBeCloseTo(2)
  })
})

describe('memoized worldTransform', () => {
  it('composes ALL ancestor transforms and caches per document version', () => {
    const store = createEditorStore()
    const group = createGroupNode({ transform: translate(100, 0) })
    const rect = createRectNode({ x: 0, y: 0, w: 10, h: 10 }, { transform: translate(5, 5) })
    store.getState().applyCommand('Build', (doc) => {
      addNode(doc, group)
      addNode(doc, rect, group.id)
    })
    const nodes = store.getState().document.nodes
    const world = worldTransform(nodes, rect.id)
    expect(matEquals(world, compose(translate(100, 0), translate(5, 5)), 1e-12)).toBe(true)
    // Same nodes map identity -> same cached Mat instance.
    expect(worldTransform(nodes, rect.id)).toBe(world)

    // Mutating the document produces a new nodes map -> fresh computation.
    cmdSetTransforms(store, [{ id: group.id, transform: translate(200, 0) as Mat }], 'Move')
    const world2 = worldTransform(store.getState().document.nodes, rect.id)
    expect(matEquals(world2, compose(translate(200, 0), translate(5, 5)), 1e-12)).toBe(true)
  })
})
