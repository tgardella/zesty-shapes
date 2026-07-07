import { describe, expect, it } from 'vitest'
import {
  cmdAddArtboard,
  cmdDeleteArtboard,
  cmdDuplicateArtboard,
  cmdUpdateArtboard,
} from './artboardCommands'
import { createEditorStore } from './store'

describe('artboard commands', () => {
  it('adds artboards with unique names as ONE undo step each', () => {
    const store = createEditorStore()
    const id = cmdAddArtboard(store, { x: 1200, y: 0, w: 400, h: 300 })
    const state = store.getState()
    expect(state.document.artboards).toHaveLength(2)
    const ab = state.document.artboards.find((a) => a.id === id)!
    expect(ab.name).toBe('Artboard 2')
    expect(state.history.undoStack.at(-1)!.label).toBe('Add Artboard')
    state.undo()
    expect(store.getState().document.artboards).toHaveLength(1)
  })

  it('update clamps to the minimum size', () => {
    const store = createEditorStore()
    const id = store.getState().document.artboards[0]!.id
    cmdUpdateArtboard(store, id, 'Resize Artboard', (ab) => {
      ab.w = 2
      ab.h = 500
    })
    const ab = store.getState().document.artboards[0]!
    expect(ab.w).toBeGreaterThanOrEqual(16)
    expect(ab.h).toBe(500)
  })

  it('duplicate copies the frame beside the source', () => {
    const store = createEditorStore()
    const src = store.getState().document.artboards[0]!
    const dupId = cmdDuplicateArtboard(store, src.id)!
    const dup = store.getState().document.artboards.find((a) => a.id === dupId)!
    expect(dup.w).toBe(src.w)
    expect(dup.h).toBe(src.h)
    expect(dup.x).toBe(src.x + src.w + 20)
    expect(dup.name).not.toBe(src.name)
  })

  it('never deletes the last artboard', () => {
    const store = createEditorStore()
    const only = store.getState().document.artboards[0]!.id
    expect(cmdDeleteArtboard(store, only)).toBe(false)
    const second = cmdAddArtboard(store, { x: 0, y: 900, w: 100, h: 100 })
    expect(cmdDeleteArtboard(store, second)).toBe(true)
    expect(store.getState().document.artboards).toHaveLength(1)
    store.getState().undo() // restores the deleted artboard
    expect(store.getState().document.artboards).toHaveLength(2)
  })
})
