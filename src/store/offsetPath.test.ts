import { describe, expect, it } from 'vitest'
import { createEditorStore } from './store'
import { cmdAddNode } from './commands'
import { cmdOffsetPath, offsetRegions } from './booleanCommands'
import { nodeRegionsInDoc } from '../model/booleanOps'
import { regionsArea } from '../geometry/boolean'
import { createRectNode, rgba } from '../model/nodes'
import type { EditorStoreApi } from './store'
import type { GroupNode } from '../model/types'

function square(store: EditorStoreApi, size = 10): string {
  const n = createRectNode({ x: 0, y: 0, w: size, h: size })
  n.style.fill = { type: 'solid', color: rgba(200, 100, 50, 1) }
  cmdAddNode(store, n)
  return n.id
}

describe('offsetRegions', () => {
  it('grows area for a positive distance and shrinks for a negative one', () => {
    const store = createEditorStore()
    const id = square(store, 10)
    const regions = nodeRegionsInDoc(store.getState().document.nodes, id)
    const base = Math.abs(regionsArea(regions))

    const grown = Math.abs(regionsArea(offsetRegions(regions, 3)))
    const shrunk = Math.abs(regionsArea(offsetRegions(regions, -3)))
    expect(grown).toBeGreaterThan(base)
    expect(shrunk).toBeLessThan(base)
    expect(shrunk).toBeGreaterThan(0)
  })

  it('is a no-op for zero distance', () => {
    const store = createEditorStore()
    const id = square(store)
    const regions = nodeRegionsInDoc(store.getState().document.nodes, id)
    expect(offsetRegions(regions, 0)).toBe(regions)
  })
})

describe('cmdOffsetPath', () => {
  it('adds an offset sibling above the source (source kept), one undo step', () => {
    const store = createEditorStore()
    const id = square(store, 20)
    const root = () => store.getState().document.nodes[store.getState().document.root] as GroupNode
    const undoBefore = store.getState().history.undoStack.length

    const [newId] = cmdOffsetPath(store, [id], 5)
    expect(newId).toBeTruthy()

    const state = store.getState()
    expect(state.history.undoStack.length - undoBefore).toBe(1)
    expect(state.history.undoStack.at(-1)!.label).toBe('Offset Path')
    // Source kept; the offset path sits just above it.
    expect(state.document.nodes[id]).toBeDefined()
    const kids = root().children
    expect(kids.indexOf(newId!)).toBe(kids.indexOf(id) + 1)
    expect(state.selection).toEqual([newId])

    // The offset path really is larger than the 20×20 source.
    const grownArea = Math.abs(regionsArea(nodeRegionsInDoc(state.document.nodes, newId!)))
    expect(grownArea).toBeGreaterThan(400)
  })

  it('undo removes the offset path and restores the original state', () => {
    const store = createEditorStore()
    const id = square(store, 20)
    const before = [...(store.getState().document.nodes[store.getState().document.root] as GroupNode).children]

    cmdOffsetPath(store, [id], 5)
    store.getState().undo()

    const after = (store.getState().document.nodes[store.getState().document.root] as GroupNode).children
    expect(after).toEqual(before)
  })

  it('is a no-op with no filled selection', () => {
    const store = createEditorStore()
    const undoBefore = store.getState().history.undoStack.length
    expect(cmdOffsetPath(store, [], 5)).toEqual([])
    expect(store.getState().history.undoStack.length).toBe(undoBefore)
  })
})
