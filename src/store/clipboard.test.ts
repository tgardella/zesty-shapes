import { beforeEach, describe, expect, it } from 'vitest'
import { clearClipboard, copySelection, cutSelection, pasteClipboard, PASTE_OFFSET } from './clipboard'
import { cmdAddNode } from './commands'
import { createEditorStore } from './store'
import { addNode } from '../model/document'
import { createGroupNode, createRectNode } from '../model/nodes'
import { translate } from '../geometry/matrix'
import type { GroupNode, RectNode } from '../model/types'

beforeEach(() => clearClipboard())

describe('clipboard', () => {
  it('copy + paste creates fresh ids at a (+10,+10) offset and selects the paste', () => {
    const store = createEditorStore()
    const rect = createRectNode({ x: 0, y: 0, w: 10, h: 10 }, { transform: translate(100, 50) })
    cmdAddNode(store, rect, { select: true })

    expect(copySelection(store)).toBe(1)
    const pasted = pasteClipboard(store)
    expect(pasted).toHaveLength(1)
    const clone = store.getState().document.nodes[pasted[0]!]! as RectNode
    expect(clone.id).not.toBe(rect.id)
    expect(clone.transform[4]).toBeCloseTo(100 + PASTE_OFFSET)
    expect(clone.transform[5]).toBeCloseTo(50 + PASTE_OFFSET)
    expect(clone.w).toBe(10)
    expect(store.getState().selection).toEqual(pasted)
    // Original untouched.
    expect(store.getState().document.nodes[rect.id]!.transform[4]).toBe(100)
  })

  it('pasting twice yields two independent copies', () => {
    const store = createEditorStore()
    const rect = createRectNode({ x: 0, y: 0, w: 10, h: 10 })
    cmdAddNode(store, rect, { select: true })
    copySelection(store)
    const first = pasteClipboard(store)
    const second = pasteClipboard(store)
    expect(first[0]).not.toBe(second[0])
    expect(Object.keys(store.getState().document.nodes)).toHaveLength(4) // root + 3 rects
  })

  it('paste goes into the current edit scope', () => {
    const store = createEditorStore()
    const group = createGroupNode({ transform: translate(200, 0) })
    const rect = createRectNode({ x: 0, y: 0, w: 10, h: 10 })
    store.getState().applyCommand('Build', (doc) => {
      addNode(doc, group)
      addNode(doc, rect)
    })
    store.getState().setSelection([rect.id])
    copySelection(store)
    store.getState().setScope(group.id)
    const pasted = pasteClipboard(store)
    expect(store.getState().document.nodes[pasted[0]!]!.parent).toBe(group.id)
    expect((store.getState().document.nodes[group.id] as GroupNode).children).toEqual(pasted)
  })

  it('cut removes the selection in ONE undoable entry that restores it', () => {
    const store = createEditorStore()
    const rect = createRectNode({ x: 0, y: 0, w: 10, h: 10 })
    cmdAddNode(store, rect, { select: true })
    const depth = store.getState().history.undoStack.length

    expect(cutSelection(store)).toBe(1)
    expect(store.getState().document.nodes[rect.id]).toBeUndefined()
    expect(store.getState().history.undoStack.length).toBe(depth + 1)
    expect(store.getState().history.undoStack.at(-1)!.label).toBe('Cut')

    store.getState().undo()
    expect(store.getState().document.nodes[rect.id]).toBeDefined()
    expect(store.getState().selection).toEqual([rect.id])

    // The clipboard still pastes after undoing the cut.
    store.getState().redo()
    const pasted = pasteClipboard(store)
    expect(pasted).toHaveLength(1)
  })

  it('copy with empty selection is a no-op', () => {
    const store = createEditorStore()
    expect(copySelection(store)).toBe(0)
    expect(pasteClipboard(store)).toEqual([])
  })
})
