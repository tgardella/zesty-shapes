import { describe, expect, it } from 'vitest'
import { createEditorStore } from './store'
import { cmdAddNode, cmdSetStyle } from './commands'
import { documentToSVG, documentFromJSON, documentToJSON } from '../model/serialize'
import { createRectNode, rgba } from '../model/nodes'
import type { DropShadow } from '../model/types'
import type { EditorStoreApi } from './store'

const SHADOW: DropShadow = { offsetX: 4, offsetY: 3, blur: 5, color: rgba(0, 0, 0, 0.5) }

function shadowedRect(store: EditorStoreApi): string {
  const n = createRectNode({ x: 0, y: 0, w: 20, h: 20 })
  n.style.fill = { type: 'solid', color: rgba(200, 100, 50, 1) }
  cmdAddNode(store, n)
  cmdSetStyle(store, [n.id], 'Drop Shadow', (style) => {
    style.dropShadow = { ...SHADOW, color: { ...SHADOW.color } }
  })
  return n.id
}

describe('drop shadow style', () => {
  it('cmdSetStyle sets and undo clears the dropShadow, one undo step', () => {
    const store = createEditorStore()
    const n = createRectNode({ x: 0, y: 0, w: 20, h: 20 })
    cmdAddNode(store, n)
    const undoBefore = store.getState().history.undoStack.length

    cmdSetStyle(store, [n.id], 'Drop Shadow', (style) => {
      style.dropShadow = { ...SHADOW, color: { ...SHADOW.color } }
    })
    expect(store.getState().history.undoStack.length - undoBefore).toBe(1)
    expect(store.getState().document.nodes[n.id]!.style.dropShadow).toEqual(SHADOW)

    store.getState().undo()
    expect(store.getState().document.nodes[n.id]!.style.dropShadow).toBeUndefined()
  })
})

describe('drop shadow SVG export', () => {
  it('emits a feDropShadow filter referenced by the wrapped leaf', () => {
    const store = createEditorStore()
    const id = shadowedRect(store)
    const svg = documentToSVG(store.getState().document)
    expect(svg).toContain(`<filter id="shadow-${id}"`)
    expect(svg).toContain('<feDropShadow')
    expect(svg).toContain('dx="4"')
    expect(svg).toContain('dy="3"')
    expect(svg).toContain('stdDeviation="5"')
    expect(svg).toContain('flood-opacity="0.5"')
    expect(svg).toContain(`filter="url(#shadow-${id})"`)
  })
})

describe('drop shadow JSON round-trip', () => {
  it('preserves the dropShadow through documentToJSON/documentFromJSON', () => {
    const store = createEditorStore()
    const id = shadowedRect(store)
    const restored = documentFromJSON(documentToJSON(store.getState().document))
    expect(restored.nodes[id]!.style.dropShadow).toEqual(SHADOW)
  })
})
