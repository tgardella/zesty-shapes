/**
 * Store-level tests for the Blend / Blob Brush / Gradient Mesh / Symbol
 * Sprayer commands (one undoable step each, layer-routed placement).
 */

import { describe, expect, it } from 'vitest'
import { createEditorStore } from './store'
import { cmdAddNode, cmdMoveNodesBy } from './commands'
import {
  cmdBlend,
  cmdExpandBlend,
  cmdReleaseBlend,
  cmdReplaceSpine,
  cmdSetBlendSpine,
  cmdSetBlendSteps,
} from './blendCommands'
import { blendStepGeometry } from '../model/blend'
import { cmdBlobPaint } from './brushCommands'
import {
  cmdConvertToMesh,
  cmdMeshAddDivision,
  cmdMeshMovePoint,
  cmdMeshSetHandle,
} from './meshCommands'
import { cmdCreateSymbolSet, cmdSprayStamp } from './sprayCommands'
import { cmdSymbolismAdjust } from './symbolismCommands'
import { cmdBrushArtwork } from './brushArtworkCommands'
import { brushById } from '../model/brushLibrary'
import {
  cmdCreateSymbol,
  cmdDeleteSymbol,
  cmdRenameSymbol,
  cmdStampSymbol,
} from './symbolCommands'
import { createInitialDocument, topLevelLayers } from '../model/layers'
import { createGroupNode, createRectNode } from '../model/nodes'
import { reparent } from '../model/document'
import { documentFromJSON, documentToJSON, documentToSVG } from '../model/serialize'
import { determinant, translate, type Mat } from '../geometry/matrix'

/** Uniform-scale factor squared (area scale) of a matrix. */
const det2 = (m: Mat): number => Math.abs(determinant(m))
import type { GroupNode, MeshNode, SolidPaint } from '../model/types'

function layeredStore() {
  return createEditorStore(createInitialDocument())
}

const red: SolidPaint = { type: 'solid', color: { r: 255, g: 0, b: 0, a: 1 } }
const blue: SolidPaint = { type: 'solid', color: { r: 0, g: 0, b: 255, a: 1 } }

describe('cmdBlend (live)', () => {
  function blendedStore() {
    const store = layeredStore()
    const a = createRectNode({ x: 0, y: 0, w: 20, h: 20 })
    const b = createRectNode({ x: 0, y: 0, w: 20, h: 20 }, { transform: translate(100, 0) })
    cmdAddNode(store, a)
    cmdAddNode(store, b)
    const groupId = cmdBlend(store, a.id, b.id, 3)!
    return { store, a, b, groupId }
  }

  it('creates a LIVE blend group holding only the endpoints', () => {
    const { store, a, b, groupId } = blendedStore()
    const doc = store.getState().document
    const group = doc.nodes[groupId] as GroupNode
    expect(group.name).toBe('Blend')
    expect(group.blend).toEqual({ steps: 3 })
    expect(group.children).toEqual([a.id, b.id])
    // Steps derive on demand.
    expect(blendStepGeometry(doc.nodes, groupId)).toHaveLength(3)
    // ONE undo restores both originals to the layer.
    store.getState().undo()
    const after = store.getState().document
    expect(after.nodes[groupId]).toBeUndefined()
    expect(after.nodes[a.id]!.parent).toBe(topLevelLayers(after)[0]!.id)
    expect(store.getState().selection).toEqual([])
  })

  it('re-derives steps when an endpoint moves (live update)', () => {
    const { store, b, groupId } = blendedStore()
    const before = blendStepGeometry(store.getState().document.nodes, groupId)
    const beforeX = before[1]!.regions[0]![0]![0]!.x
    cmdMoveNodesBy(store, [b.id], { x: 200, y: 0 })
    const after = blendStepGeometry(store.getState().document.nodes, groupId)
    const afterX = after[1]!.regions[0]![0]![0]!.x
    expect(afterX).toBeGreaterThan(beforeX + 50) // middle step followed the endpoint
  })

  it('cmdSetBlendSteps retunes the step count', () => {
    const { store, groupId } = blendedStore()
    cmdSetBlendSteps(store, [groupId], 7)
    const doc = store.getState().document
    expect((doc.nodes[groupId] as GroupNode).blend).toEqual({ steps: 7 })
    expect(blendStepGeometry(doc.nodes, groupId)).toHaveLength(7)
  })

  it('cmdExpandBlend bakes the steps into real nodes and drops the marker', () => {
    const { store, a, b, groupId } = blendedStore()
    const created = cmdExpandBlend(store, [groupId])
    expect(created).toHaveLength(3)
    const doc = store.getState().document
    const group = doc.nodes[groupId] as GroupNode
    expect(group.blend).toBeUndefined()
    expect(group.children).toHaveLength(5)
    expect(group.children[0]).toBe(a.id)
    expect(group.children[4]).toBe(b.id)
    expect(doc.nodes[group.children[2]!]!.type).toBe('path')
    // Once expanded there is nothing live left to derive.
    expect(blendStepGeometry(doc.nodes, groupId)).toHaveLength(0)
  })

  it('exports the derived steps into the SVG', () => {
    const { store } = blendedStore()
    const svg = documentToSVG(store.getState().document)
    // 2 endpoint rects + 3 derived step paths inside the blend group.
    expect(svg.match(/fill-rule="evenodd"/g)).toHaveLength(3)
  })

  it('returns null for missing or degenerate operands', () => {
    const store = layeredStore()
    const a = createRectNode({ x: 0, y: 0, w: 20, h: 20 })
    cmdAddNode(store, a)
    expect(cmdBlend(store, a.id, a.id, 3)).toBeNull()
    expect(cmdBlend(store, a.id, 'nope', 3)).toBeNull()
  })

  it('cmdReleaseBlend returns the two endpoints and drops the group', () => {
    const { store, a, b, groupId } = blendedStore()
    const survivors = cmdReleaseBlend(store, [groupId])
    expect(survivors).toEqual([a.id, b.id])
    const doc = store.getState().document
    expect(doc.nodes[groupId]).toBeUndefined()
    expect(doc.nodes[a.id]!.parent).toBe(topLevelLayers(doc)[0]!.id)
    expect(doc.nodes[b.id]!.parent).toBe(topLevelLayers(doc)[0]!.id)
    expect(store.getState().selection).toEqual([a.id, b.id])
  })

  it('cmdSetBlendSpine bends the steps off the straight line', () => {
    const { store, groupId } = blendedStore()
    // Default straight spine keeps every step within the endpoints' y range.
    const straight = blendStepGeometry(store.getState().document.nodes, groupId)
    const straightMinY = Math.min(...straight[1]!.regions[0]![0]!.map((p) => p.y))
    expect(straightMinY).toBeGreaterThan(-5)
    // A control bumped far up pulls the middle step up with it.
    cmdSetBlendSpine(store, [groupId], [
      { x: 10, y: 10 },
      { x: 60, y: -60 },
      { x: 110, y: 10 },
    ])
    const doc = store.getState().document
    expect((doc.nodes[groupId] as GroupNode).blend!.spine).toHaveLength(3)
    const bent = blendStepGeometry(doc.nodes, groupId)
    const bentMinY = Math.min(...bent[1]!.regions[0]![0]!.map((p) => p.y))
    expect(bentMinY).toBeLessThan(-20)
    // Null clears back to the straight spine.
    cmdSetBlendSpine(store, [groupId], null)
    expect((store.getState().document.nodes[groupId] as GroupNode).blend!.spine).toBeUndefined()
  })

  it('cmdReplaceSpine adopts a selected path outline as the spine', () => {
    const { store, groupId } = blendedStore()
    const path = createRectNode({ x: 0, y: 0, w: 40, h: 40 }, { transform: translate(0, 80) })
    cmdAddNode(store, path)
    expect(cmdReplaceSpine(store, groupId, path.id)).toBe(true)
    const spine = (store.getState().document.nodes[groupId] as GroupNode).blend!.spine
    expect(spine && spine.length).toBeGreaterThanOrEqual(2)
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

  it('cmdMeshSetHandle sets a handle and mirrors the opposite (smooth)', () => {
    const store = layeredStore()
    const rect = createRectNode({ x: 0, y: 0, w: 100, h: 50 })
    cmdAddNode(store, rect)
    cmdConvertToMesh(store, rect.id)
    // Grow to a 2x2 grid so the center point (index 4) has all four handles.
    cmdMeshAddDivision(store, rect.id, { x: 50, y: 25 })
    // Center point sits at (50,25); drag its right handle to (75,10).
    cmdMeshSetHandle(store, rect.id, 4, 'right', { x: 75, y: 10 }, true)
    const mesh = store.getState().document.nodes[rect.id] as MeshNode
    const h = mesh.points[4]!.handles!
    expect(h.right).toEqual({ x: 75, y: 10 })
    // Mirror keeps the left handle symmetric about the point.
    expect(h.left).toEqual({ x: 25, y: 40 })
  })

  it('moving a point carries its explicit handles rigidly', () => {
    const store = layeredStore()
    const rect = createRectNode({ x: 0, y: 0, w: 100, h: 50 })
    cmdAddNode(store, rect)
    cmdConvertToMesh(store, rect.id)
    // Corner point 0 (0,0): set a right handle, then move the point by (10,5).
    cmdMeshSetHandle(store, rect.id, 0, 'right', { x: 25, y: 0 }, false)
    cmdMeshMovePoint(store, rect.id, 0, { x: 10, y: 5 })
    const mesh = store.getState().document.nodes[rect.id] as MeshNode
    expect(mesh.points[0]!.p).toEqual({ x: 10, y: 5 })
    expect(mesh.points[0]!.handles!.right).toEqual({ x: 35, y: 5 })
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

describe('symbol library', () => {
  it('cmdCreateSymbol snapshots the selection without touching the canvas', () => {
    const store = layeredStore()
    const rect = createRectNode({ x: 0, y: 0, w: 10, h: 10 })
    cmdAddNode(store, rect, { select: true })
    const symbolId = cmdCreateSymbol(store)!
    const doc = store.getState().document
    expect(doc.symbols).toHaveLength(1)
    const def = doc.symbols![0]!
    expect(def.id).toBe(symbolId)
    expect(def.rootIds).toHaveLength(1)
    // Fresh ids: the snapshot never aliases live nodes.
    expect(def.rootIds[0]).not.toBe(rect.id)
    expect(doc.nodes[rect.id]).toBeDefined()
    // Round-trips through JSON.
    const round = documentFromJSON(documentToJSON(doc))
    expect(round.symbols![0]!.name).toBe(def.name)
  })

  it('cmdStampSymbol places an instance centered on the doc point', () => {
    const store = layeredStore()
    const rect = createRectNode({ x: 0, y: 0, w: 10, h: 10 })
    cmdAddNode(store, rect, { select: true })
    const symbolId = cmdCreateSymbol(store)!
    const [placed] = cmdStampSymbol(store, symbolId, {
      docPoint: { x: 100, y: 100 },
      rotation: 0,
      scale: 1,
    })
    const doc = store.getState().document
    const node = doc.nodes[placed!]!
    expect(node.parent).toBe(topLevelLayers(doc)[0]!.id)
    expect(node.transform[4]).toBeCloseTo(95)
    expect(node.transform[5]).toBeCloseTo(95)
  })

  it('rename and delete edit the library (undoably)', () => {
    const store = layeredStore()
    const rect = createRectNode({ x: 0, y: 0, w: 10, h: 10 })
    cmdAddNode(store, rect, { select: true })
    const symbolId = cmdCreateSymbol(store)!
    cmdRenameSymbol(store, symbolId, 'Leaf')
    expect(store.getState().document.symbols![0]!.name).toBe('Leaf')
    cmdDeleteSymbol(store, symbolId)
    expect(store.getState().document.symbols).toHaveLength(0)
    store.getState().undo()
    expect(store.getState().document.symbols![0]!.name).toBe('Leaf')
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

describe('cmdBrushArtwork', () => {
  const line: { x: number; y: number }[] = Array.from({ length: 21 }, (_, i) => ({ x: i * 10, y: 0 }))

  it('scatters symbol copies along the trail in a group', () => {
    const store = layeredStore()
    const rect = createRectNode({ x: 0, y: 0, w: 10, h: 10 })
    cmdAddNode(store, rect, { select: true })
    const symbolId = cmdCreateSymbol(store)!
    const groupId = cmdBrushArtwork(store, {
      brush: brushById('scatter'),
      polyline: line,
      size: 8,
      color: { r: 0, g: 0, b: 0, a: 1 },
      symbolId,
    })!
    const doc = store.getState().document
    const group = doc.nodes[groupId] as GroupNode
    expect(group.name).toBe('Scatter Brush')
    expect(group.children.length).toBeGreaterThan(1)
    // Every copy lands near the horizontal trail (y around 0, within jitter).
    for (const id of group.children) {
      expect(Math.abs(doc.nodes[id]!.transform[5])).toBeLessThan(60)
    }
  })

  it('falls back to a dot when no symbol is active', () => {
    const store = layeredStore()
    const groupId = cmdBrushArtwork(store, {
      brush: brushById('pattern'),
      polyline: line,
      size: 6,
      color: { r: 10, g: 20, b: 30, a: 1 },
      symbolId: null,
    })!
    const doc = store.getState().document
    const group = doc.nodes[groupId] as GroupNode
    expect(group.name).toBe('Pattern Brush')
    expect(doc.nodes[group.children[0]!]!.type).toBe('ellipse')
  })

  it('art brush warps a symbol outline into one path following the trail', () => {
    const store = layeredStore()
    const rect = createRectNode({ x: 0, y: 0, w: 20, h: 20 })
    cmdAddNode(store, rect, { select: true })
    const symbolId = cmdCreateSymbol(store)!
    const groupId = cmdBrushArtwork(store, {
      brush: brushById('art'),
      polyline: line,
      size: 10,
      color: { r: 0, g: 0, b: 0, a: 1 },
      symbolId,
    })!
    const doc = store.getState().document
    const group = doc.nodes[groupId] as GroupNode
    expect(group.children).toHaveLength(1)
    expect(doc.nodes[group.children[0]!]!.type).toBe('path')
  })

  it('returns null for a degenerate (zero-length) trail', () => {
    const store = layeredStore()
    expect(
      cmdBrushArtwork(store, {
        brush: brushById('scatter'),
        polyline: [{ x: 5, y: 5 }, { x: 5, y: 5 }],
        size: 8,
        color: { r: 0, g: 0, b: 0, a: 1 },
        symbolId: null,
      }),
    ).toBeNull()
  })
})

describe('cmdSymbolismAdjust', () => {
  // A symbol set with two instances: one at the origin, one far to the right.
  function symbolSet() {
    const store = layeredStore()
    const near = createRectNode({ x: 0, y: 0, w: 20, h: 20 })
    near.style.fill = { ...red }
    const far = createRectNode({ x: 0, y: 0, w: 20, h: 20 }, { transform: translate(300, 0) })
    far.style.fill = { ...red }
    const group = createGroupNode({ name: 'Symbol Set' })
    cmdAddNode(store, group)
    cmdAddNode(store, near)
    cmdAddNode(store, far)
    // Reparent both rects under the group (world placement baked).
    store.getState().applyCommand('setup', (draft) => {
      reparent(draft, near.id, group.id)
      reparent(draft, far.id, group.id)
    })
    return { store, groupId: group.id, near, far }
  }

  it('Sizer grows only the in-range instance', () => {
    const { store, near, far } = symbolSet()
    const ok = cmdSymbolismAdjust(store, [near.id, far.id], {
      kind: 'size',
      center: { x: 10, y: 10 },
      radius: 40,
      strength: 0.5,
      alt: false,
    })
    expect(ok).toBe(true)
    const doc = store.getState().document
    expect(det2(doc.nodes[near.id]!.transform)).toBeGreaterThan(1.1)
    expect(det2(doc.nodes[far.id]!.transform)).toBeCloseTo(1)
  })

  it('Shifter translates the in-range instance by the pointer delta', () => {
    const { store, near, far } = symbolSet()
    cmdSymbolismAdjust(store, [near.id, far.id], {
      kind: 'shift',
      center: { x: 10, y: 10 },
      radius: 40,
      strength: 1,
      delta: { x: 12, y: 0 },
      alt: false,
    })
    // Falloff at the exact center is 1, so the full delta applies.
    expect(store.getState().document.nodes[near.id]!.transform[4]).toBeCloseTo(12)
  })

  it('Stainer tints the in-range instance toward the target color', () => {
    const { store, near, far } = symbolSet()
    cmdSymbolismAdjust(store, [near.id, far.id], {
      kind: 'stain',
      center: { x: 10, y: 10 },
      radius: 40,
      strength: 0.5,
      color: { r: 0, g: 0, b: 255, a: 1 },
      alt: false,
    })
    const doc = store.getState().document
    const nearFill = doc.nodes[near.id]!.style.fill
    const farFill = doc.nodes[far.id]!.style.fill
    expect(nearFill && nearFill.type === 'solid' && nearFill.color.b).toBeGreaterThan(50)
    expect(farFill && farFill.type === 'solid' && farFill.color.b).toBe(0)
  })

  it('does nothing when no instance is in range', () => {
    const { store, near, far } = symbolSet()
    expect(
      cmdSymbolismAdjust(store, [near.id, far.id], {
        kind: 'size',
        center: { x: 1000, y: 1000 },
        radius: 10,
        strength: 0.5,
        alt: false,
      }),
    ).toBe(false)
  })

  it('stains a standalone shape (a leaf acts as its own instance)', () => {
    const store = layeredStore()
    const rect = createRectNode({ x: 0, y: 0, w: 20, h: 20 })
    rect.style.fill = { ...red }
    cmdAddNode(store, rect)
    const ok = cmdSymbolismAdjust(store, [rect.id], {
      kind: 'stain',
      center: { x: 10, y: 10 },
      radius: 40,
      strength: 0.6,
      color: { r: 0, g: 0, b: 255, a: 1 },
      alt: false,
    })
    expect(ok).toBe(true)
    const fill = store.getState().document.nodes[rect.id]!.style.fill
    expect(fill && fill.type === 'solid' && fill.color.b).toBeGreaterThan(50)
  })
})
