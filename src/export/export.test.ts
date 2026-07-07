import { describe, expect, it } from 'vitest'
import { documentToSVG, nodesBounds } from '../model/serialize'
import { cmdAddNode } from '../store/commands'
import { createEditorStore } from '../store/store'
import { createGroupNode, createImageNode, createRectNode, rgba } from '../model/nodes'
import { addNode, createDocument } from '../model/document'
import { translate } from '../geometry/matrix'
import { cmdInsertImportedNodes } from '../store/importCommands'

describe('scoped SVG export', () => {
  it('bounds option drives the viewBox (per-artboard export)', () => {
    const doc = createDocument()
    const svg = documentToSVG(doc, { bounds: { minX: 10, minY: 20, maxX: 110, maxY: 70 } })
    expect(svg).toContain('viewBox="10 20 100 50"')
    expect(svg).toContain('width="100"')
    expect(svg).toContain('height="50"')
  })

  it('ids subset exports nested nodes at their WORLD placement', () => {
    const doc = createDocument()
    const group = createGroupNode({ transform: translate(100, 50) })
    const rect = createRectNode({ x: 0, y: 0, w: 10, h: 10 }, { transform: translate(5, 5) })
    addNode(doc, group)
    addNode(doc, rect, group.id)
    const svg = documentToSVG(doc, { ids: [rect.id] })
    // Parent world transform wraps the node so it lands at world (105,55).
    expect(svg).toContain('transform="matrix(1,0,0,1,100,50)"')
    expect(svg).toContain('transform="matrix(1,0,0,1,5,5)"')
    const bounds = nodesBounds(doc, [rect.id])!
    expect(bounds).toEqual({ minX: 105, minY: 55, maxX: 115, maxY: 65 })
  })

  it('background option emits a base rect (JPG export)', () => {
    const doc = createDocument()
    const svg = documentToSVG(doc, {
      bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
      background: '#ffffff',
    })
    expect(svg).toContain('<rect x="0" y="0" width="10" height="10" fill="#ffffff"/>')
  })

  it('image nodes export as <image> with their data href', () => {
    const store = createEditorStore()
    const img = createImageNode(
      { href: 'data:image/png;base64,AAAA', w: 32, h: 16 },
      { transform: translate(3, 4) },
    )
    cmdAddNode(store, img)
    const svg = documentToSVG(store.getState().document)
    expect(svg).toContain('<image id="' + img.id + '"')
    expect(svg).toContain('href="data:image/png;base64,AAAA"')
    expect(svg).toContain('width="32"')
    // JSON round-trip keeps the image intact
    const back = JSON.parse(JSON.stringify(store.getState().document))
    expect(back.nodes[img.id]).toEqual(store.getState().document.nodes[img.id])
  })
})

describe('cmdInsertImportedNodes', () => {
  it('groups multiple roots, recenters, selects, and undoes as ONE step', () => {
    const store = createEditorStore()
    const a = createRectNode({ x: 0, y: 0, w: 10, h: 10 })
    const b = createRectNode({ x: 0, y: 0, w: 10, h: 10 }, { transform: translate(30, 0) })
    a.style.fill = { type: 'solid', color: rgba(9, 9, 9, 1) }
    const before = store.getState().history.undoStack.length
    const [topId] = cmdInsertImportedNodes(store, [a, b], [a.id, b.id], {
      centerOn: { x: 500, y: 500 },
      label: 'Import SVG',
    })
    const state = store.getState()
    expect(state.history.undoStack.length - before).toBe(1)
    expect(state.history.undoStack.at(-1)!.label).toBe('Import SVG')
    const wrapper = state.document.nodes[topId!]!
    expect(wrapper.type).toBe('group')
    expect(state.selection).toEqual([topId])
    // Content spanned (0,0)-(40,10), center (20,5) -> moved to (500,500).
    expect(wrapper.transform[4]).toBe(480)
    expect(wrapper.transform[5]).toBe(495)
    state.undo()
    expect(store.getState().document.nodes[a.id]).toBeUndefined()
    expect(store.getState().document.nodes[topId!]).toBeUndefined()
  })

  it('single root inserts without a wrapper group', () => {
    const store = createEditorStore()
    const a = createRectNode({ x: 0, y: 0, w: 10, h: 10 })
    const [topId] = cmdInsertImportedNodes(store, [a], [a.id])
    expect(topId).toBe(a.id)
    expect(store.getState().document.nodes[a.id]!.parent).toBe(
      store.getState().document.root,
    )
  })
})
