import { describe, expect, it } from 'vitest'
import { createEditorStore, resolveInsertionParent } from './store'
import { cmdAddNode } from './commands'
import {
  cmdCreateLayer,
  cmdCreateSublayer,
  cmdDeleteLayer,
  cmdDuplicateLayer,
  cmdFlattenArtwork,
  cmdMergeLayers,
  cmdSetLayerOptions,
} from './layerCommands'
import { createInitialDocument, imageDimFactor, layerOfNode, normalizeLayers, topLevelLayers } from '../model/layers'
import { createDocument, addNode } from '../model/document'
import { createImageNode, createRectNode } from '../model/nodes'

/** A store booted with a real Layer 1 (mirrors the app). */
function layeredStore() {
  return createEditorStore(createInitialDocument())
}

describe('normalizeLayers', () => {
  it('gives an empty document a single Layer 1', () => {
    const doc = normalizeLayers(createDocument())
    const layers = topLevelLayers(doc)
    expect(layers).toHaveLength(1)
    expect(layers[0]!.name).toBe('Layer 1')
    expect(layers[0]!.isLayer).toBe(true)
    expect(layers[0]!.layerColor).toBeTruthy()
  })

  it('wraps loose root objects into one layer, preserving order', () => {
    const doc = createDocument()
    const a = createRectNode({ x: 0, y: 0, w: 1, h: 1 })
    const b = createRectNode({ x: 0, y: 0, w: 1, h: 1 })
    addNode(doc, a)
    addNode(doc, b)
    normalizeLayers(doc)
    const layers = topLevelLayers(doc)
    expect(layers).toHaveLength(1)
    expect(layers[0]!.children).toEqual([a.id, b.id])
    expect(doc.nodes[a.id]!.parent).toBe(layers[0]!.id)
  })

  it('is idempotent for an already-layered document', () => {
    const doc = createInitialDocument()
    const before = JSON.stringify(doc)
    normalizeLayers(doc)
    expect(JSON.stringify(doc)).toBe(before)
  })
})

describe('active-layer insertion', () => {
  it('new art lands in the active layer, not the root', () => {
    const store = layeredStore()
    const layer = topLevelLayers(store.getState().document)[0]!
    const rect = createRectNode({ x: 0, y: 0, w: 10, h: 10 })
    cmdAddNode(store, rect, { select: true })
    expect(store.getState().document.nodes[rect.id]!.parent).toBe(layer.id)
    expect(layer.id).not.toBe(store.getState().document.root)
  })

  it('bare (layer-free) documents fall back to the root', () => {
    const store = createEditorStore()
    expect(resolveInsertionParent(store.getState())).toBe(store.getState().document.root)
    const rect = createRectNode({ x: 0, y: 0, w: 10, h: 10 })
    cmdAddNode(store, rect)
    expect(store.getState().document.nodes[rect.id]!.parent).toBe(store.getState().document.root)
  })
})

describe('layer commands', () => {
  it('cmdCreateLayer adds a layer above the active one and makes it active', () => {
    const store = layeredStore()
    const first = topLevelLayers(store.getState().document)[0]!
    const id = cmdCreateLayer(store)
    const layers = topLevelLayers(store.getState().document)
    expect(layers).toHaveLength(2)
    expect(layers[1]!.id).toBe(id) // new layer on top
    expect(layers[0]!.id).toBe(first.id)
    expect(store.getState().ui.activeLayerId).toBe(id)
    // distinct colors
    expect(layers[0]!.layerColor).not.toBe(layers[1]!.layerColor)
  })

  it('cmdCreateSublayer nests inside the active layer', () => {
    const store = layeredStore()
    const parent = topLevelLayers(store.getState().document)[0]!
    const id = cmdCreateSublayer(store, parent.id)!
    expect(store.getState().document.nodes[id]!.parent).toBe(parent.id)
    expect(layerOfNode(store.getState().document, id)!.id).toBe(parent.id)
  })

  it('cmdDeleteLayer never removes the last layer', () => {
    const store = layeredStore()
    const only = topLevelLayers(store.getState().document)[0]!
    cmdDeleteLayer(store, [only.id])
    const layers = topLevelLayers(store.getState().document)
    expect(layers).toHaveLength(1) // backfilled
    expect(layers[0]!.id).not.toBe(only.id)
  })

  it('cmdDuplicateLayer copies a layer and its contents above the source', () => {
    const store = layeredStore()
    const layer = topLevelLayers(store.getState().document)[0]!
    const rect = createRectNode({ x: 0, y: 0, w: 10, h: 10 })
    cmdAddNode(store, rect)
    const [copyId] = cmdDuplicateLayer(store, [layer.id])
    const layers = topLevelLayers(store.getState().document)
    expect(layers).toHaveLength(2)
    const copy = store.getState().document.nodes[copyId!]!
    expect(copy.name).toBe(`${layer.name} copy`)
    expect((copy as { children: string[] }).children).toHaveLength(1)
  })

  it('cmdMergeLayers moves art into the bottom-most layer and drops the rest', () => {
    const store = layeredStore()
    const bottom = topLevelLayers(store.getState().document)[0]!
    const topId = cmdCreateLayer(store)
    // put a rect on the top layer (it is active after creation)
    const rect = createRectNode({ x: 0, y: 0, w: 10, h: 10 })
    cmdAddNode(store, rect)
    expect(store.getState().document.nodes[rect.id]!.parent).toBe(topId)
    cmdMergeLayers(store, [bottom.id, topId])
    const layers = topLevelLayers(store.getState().document)
    expect(layers).toHaveLength(1)
    expect(layers[0]!.id).toBe(bottom.id)
    expect(store.getState().document.nodes[rect.id]!.parent).toBe(bottom.id)
  })

  it('cmdFlattenArtwork collapses everything into one layer', () => {
    const store = layeredStore()
    cmdCreateLayer(store)
    cmdCreateLayer(store)
    const rect = createRectNode({ x: 0, y: 0, w: 10, h: 10 })
    cmdAddNode(store, rect)
    cmdFlattenArtwork(store)
    const layers = topLevelLayers(store.getState().document)
    expect(layers).toHaveLength(1)
    expect(store.getState().document.nodes[rect.id]!.parent).toBe(layers[0]!.id)
  })
})

describe('layer options', () => {
  it('template auto-locks and dims images', () => {
    const store = layeredStore()
    const layer = topLevelLayers(store.getState().document)[0]!
    const img = createImageNode({ href: 'data:,x', w: 100, h: 100 })
    cmdAddNode(store, img)
    cmdSetLayerOptions(store, layer.id, { template: true })
    const updated = store.getState().document.nodes[layer.id]!
    expect((updated as { locked: boolean }).locked).toBe(true)
    expect((updated as { template?: boolean }).template).toBe(true)
    expect(imageDimFactor(store.getState().document, img.id)).toBe(0.5)
  })

  it('dim images sets an explicit factor', () => {
    const store = layeredStore()
    const layer = topLevelLayers(store.getState().document)[0]!
    const img = createImageNode({ href: 'data:,x', w: 10, h: 10 })
    cmdAddNode(store, img)
    cmdSetLayerOptions(store, layer.id, { dimImages: 30 })
    expect(imageDimFactor(store.getState().document, img.id)).toBeCloseTo(0.3)
    cmdSetLayerOptions(store, layer.id, { dimImages: null })
    expect(imageDimFactor(store.getState().document, img.id)).toBe(1)
  })
})

describe('paste + selection route through the active layer', () => {
  it('pasteClipboard places copied art into the active layer, not the root', async () => {
    const { clearClipboard, copySelection, pasteClipboard } = await import('./clipboard')
    clearClipboard()
    const store = layeredStore()
    const layer = topLevelLayers(store.getState().document)[0]!
    const rect = createRectNode({ x: 0, y: 0, w: 10, h: 10 })
    cmdAddNode(store, rect, { select: true })
    copySelection(store)
    const [pastedId] = pasteClipboard(store)
    expect(pastedId).toBeTruthy()
    expect(store.getState().document.nodes[pastedId!]!.parent).toBe(layer.id)
    expect(store.getState().document.nodes[pastedId!]!.parent).not.toBe(store.getState().document.root)
  })

  it('selecting an object makes its layer the active layer', () => {
    const store = layeredStore()
    const l1 = topLevelLayers(store.getState().document)[0]!
    const l2 = cmdCreateLayer(store) // now active
    // Draw a rect on l2, then a rect on l1 by switching active back.
    const r2 = createRectNode({ x: 0, y: 0, w: 10, h: 10 })
    cmdAddNode(store, r2)
    store.getState().setActiveLayer(l1.id)
    const r1 = createRectNode({ x: 0, y: 0, w: 10, h: 10 })
    cmdAddNode(store, r1)
    expect(store.getState().document.nodes[r1.id]!.parent).toBe(l1.id)
    // Selecting the l2 rect flips the active layer to l2.
    store.getState().setSelection([r2.id])
    expect(store.getState().ui.activeLayerId).toBe(l2)
    // Clearing the selection LEAVES the active layer intact.
    store.getState().setSelection([])
    expect(store.getState().ui.activeLayerId).toBe(l2)
  })
})
