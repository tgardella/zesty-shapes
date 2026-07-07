/**
 * Store-level tests for the Blend / Blob Brush / Gradient Mesh / Symbol
 * Sprayer commands (one undoable step each, layer-routed placement).
 */

import { describe, expect, it } from 'vitest'
import { createEditorStore } from './store'
import { cmdAddNode } from './commands'
import { cmdBlend } from './blendCommands'
import { cmdBlobPaint } from './brushCommands'
import { cmdConvertToMesh, cmdMeshAddDivision, cmdMeshMovePoint } from './meshCommands'
import { cmdCreateSymbolSet, cmdSprayStamp } from './sprayCommands'
import { createInitialDocument, topLevelLayers } from '../model/layers'
import { createRectNode } from '../model/nodes'
import { documentFromJSON, documentToJSON, documentToSVG } from '../model/serialize'
import { translate } from '../geometry/matrix'
import type { GroupNode, MeshNode, SolidPaint } from '../model/types'

function layeredStore() {
  return createEditorStore(createInitialDocument())
}

const red: SolidPaint = { type: 'solid', color: { r: 255, g: 0, b: 0, a: 1 } }
const blue: SolidPaint = { type: 'solid', color: { r: 0, g: 0, b: 255, a: 1 } }

describe('cmdBlend', () => {
  it('groups the originals with N interpolated steps, one undo step', () => {
    const store = layeredStore()
    const a = createRectNode({ x: 0, y: 0, w: 20, h: 20 })
    const b = createRectNode({ x: 0, y: 0, w: 20, h: 20 }, { transform: translate(100, 0) })
    cmdAddNode(store, a)
    cmdAddNode(store, b)
    const groupId = cmdBlend(store, a.id, b.id, 3)
    expect(groupId).toBeTruthy()
    const doc = store.getState().document
    const group = doc.nodes[groupId!] as GroupNode
    expect(group.type).toBe('group')
    expect(group.name).toBe('Blend')
    expect(group.children).toHaveLength(5) // a + 3 steps + b
    expect(group.children[0]).toBe(a.id)
    expect(group.children[4]).toBe(b.id)
    // Steps are paths between the two originals.
    const step = doc.nodes[group.children[2]!]!
    expect(step.type).toBe('path')
    // ONE undo restores both originals to the layer.
    store.getState().undo()
    const after = store.getState().document
    expect(after.nodes[groupId!]).toBeUndefined()
    expect(after.nodes[a.id]!.parent).toBe(topLevelLayers(after)[0]!.id)
    // Undo restores the pre-command selection (nothing was selected).
    expect(store.getState().selection).toEqual([])
  })

  it('returns null for missing or degenerate operands', () => {
    const store = layeredStore()
    const a = createRectNode({ x: 0, y: 0, w: 20, h: 20 })
    cmdAddNode(store, a)
    expect(cmdBlend(store, a.id, a.id, 3)).toBeNull()
    expect(cmdBlend(store, a.id, 'nope', 3)).toBeNull()
  })
})

describe('cmdBlobPaint', () => {
  it('creates a filled blob in the active layer', () => {
    const store = layeredStore()
    const id = cmdBlobPaint(store, [{ x: 0, y: 0 }, { x: 50, y: 0 }], 10, red)
    expect(id).toBeTruthy()
    const doc = store.getState().document
    const node = doc.nodes[id!]!
    expect(node.type).toBe('path')
    expect(node.style.fill).toEqual(red)
    expect(node.style.stroke).toBeNull()
    expect(node.parent).toBe(topLevelLayers(doc)[0]!.id)
  })

  it('merges overlapping same-colored blobs into one node', () => {
    const store = layeredStore()
    const first = cmdBlobPaint(store, [{ x: 0, y: 0 }, { x: 50, y: 0 }], 10, red)!
    const second = cmdBlobPaint(store, [{ x: 40, y: 0 }, { x: 90, y: 0 }], 10, red)!
    const doc = store.getState().document
    expect(doc.nodes[first]).toBeUndefined() // consumed by the merge
    expect(doc.nodes[second]).toBeDefined()
    const layer = topLevelLayers(doc)[0]!
    expect(layer.children).toHaveLength(1)
  })

  it('leaves different-colored blobs separate', () => {
    const store = layeredStore()
    cmdBlobPaint(store, [{ x: 0, y: 0 }, { x: 50, y: 0 }], 10, red)
    cmdBlobPaint(store, [{ x: 40, y: 0 }, { x: 90, y: 0 }], 10, blue)
    const doc = store.getState().document
    expect(topLevelLayers(doc)[0]!.children).toHaveLength(2)
  })
})

describe('gradient mesh commands', () => {
  it('cmdConvertToMesh swaps the node in place (id preserved, undoable)', () => {
    const store = layeredStore()
    const rect = createRectNode({ x: 0, y: 0, w: 100, h: 50 })
    cmdAddNode(store, rect)
    expect(cmdConvertToMesh(store, rect.id)).toBe(true)
    const mesh = store.getState().document.nodes[rect.id] as MeshNode
    expect(mesh.type).toBe('mesh')
    expect(mesh.points).toHaveLength(4)
    store.getState().undo()
    expect(store.getState().document.nodes[rect.id]!.type).toBe('rect')
  })

  it('cmdMeshAddDivision grows the grid; cmdMeshMovePoint warps it', () => {
    const store = layeredStore()
    const rect = createRectNode({ x: 0, y: 0, w: 100, h: 50 })
    cmdAddNode(store, rect)
    cmdConvertToMesh(store, rect.id)
    const index = cmdMeshAddDivision(store, rect.id, { x: 50, y: 25 }, red.color)
    expect(index).toBeGreaterThan(-1)
    let mesh = store.getState().document.nodes[rect.id] as MeshNode
    expect(mesh.rows).toBe(2)
    expect(mesh.cols).toBe(2)
    expect(mesh.points[index]!.color).toEqual(red.color)
    cmdMeshMovePoint(store, rect.id, index, { x: 60, y: 30 })
    mesh = store.getState().document.nodes[rect.id] as MeshNode
    expect(mesh.points[index]!.p).toEqual({ x: 60, y: 30 })
  })

  it('meshes survive SVG export and JSON round-trip', () => {
    const store = layeredStore()
    const rect = createRectNode({ x: 0, y: 0, w: 100, h: 50 })
    cmdAddNode(store, rect)
    cmdConvertToMesh(store, rect.id)
    const doc = store.getState().document
    const svg = documentToSVG(doc)
    expect(svg).toContain('<polygon')
    expect(svg).toContain('clipPath')
    const roundTripped = documentFromJSON(documentToJSON(doc))
    const mesh = roundTripped.nodes[rect.id] as MeshNode
    expect(mesh.type).toBe('mesh')
    expect(mesh.points).toHaveLength(4)
  })
})

describe('symbol sprayer commands', () => {
  it('stamps clones centered on the spray point inside the symbol set', () => {
    const store = layeredStore()
    const rect = createRectNode({ x: 0, y: 0, w: 10, h: 10 })
    cmdAddNode(store, rect)
    const groupId = cmdCreateSymbolSet(store)
    const cloneIds = cmdSprayStamp(
      store,
      [rect.id],
      { docPoint: { x: 100, y: 100 }, rotation: 0, scale: 1 },
      groupId,
    )
    expect(cloneIds).toHaveLength(1)
    const doc = store.getState().document
    const clone = doc.nodes[cloneIds[0]!]!
    expect(clone.parent).toBe(groupId)
    // Symbol center (5,5) lands on (100,100): translate(95,95).
    expect(clone.transform[4]).toBeCloseTo(95)
    expect(clone.transform[5]).toBeCloseTo(95)
    // The original stays where it was.
    expect(doc.nodes[rect.id]!.parent).toBe(topLevelLayers(doc)[0]!.id)
  })
})
