import { describe, expect, it } from 'vitest'
import { applyToPoint } from '../geometry/matrix'
import { pointInRegions, regionsArea } from '../geometry/boolean'
import { createEditorStore } from './store'
import { cmdAddNode } from './commands'
import {
  bladeRegions,
  cmdErase,
  cmdKnife,
  cmdOutlineStroke,
  cmdPathfinder,
  cmdShapeBuilder,
  collectOperands,
  faceAtPoint,
} from './booleanCommands'
import { buildFaces, nodeRegionsInDoc } from '../model/booleanOps'
import { documentToSVG } from '../model/serialize'
import { createPathNode, createRectNode, rgba } from '../model/nodes'
import { createAnchor, createSubPath } from '../model/pathOps'
import { worldTransform } from './worldTransform'
import type { GroupNode, PathNode } from '../model/types'
import type { EditorStoreApi } from './store'

const RED = { type: 'solid' as const, color: rgba(255, 0, 0, 1) }
const BLUE = { type: 'solid' as const, color: rgba(0, 0, 255, 1) }

/** Two overlapping squares: A (bottom, red) 0..10, B (top, blue) 5..15. */
function twoSquares(store: EditorStoreApi): { a: string; b: string } {
  const a = createRectNode({ x: 0, y: 0, w: 10, h: 10 })
  a.style.fill = { ...RED }
  const b = createRectNode({ x: 0, y: 0, w: 10, h: 10 }, { transform: [1, 0, 0, 1, 5, 5] })
  b.style.fill = { ...BLUE }
  cmdAddNode(store, a)
  cmdAddNode(store, b)
  return { a: a.id, b: b.id }
}

function docRegions(store: EditorStoreApi, id: string) {
  return nodeRegionsInDoc(store.getState().document.nodes, id)
}

describe('cmdPathfinder shape modes', () => {
  it('unite: ONE compound path, top style, world geometry preserved, one undo step', () => {
    const store = createEditorStore()
    const { a, b } = twoSquares(store)
    const undoBefore = store.getState().history.undoStack.length

    const [id] = cmdPathfinder(store, 'unite', [a, b])
    const state = store.getState()
    expect(state.history.undoStack.length - undoBefore).toBe(1)
    expect(state.history.undoStack.at(-1)!.label).toBe('Unite')
    expect(state.document.nodes[a]).toBeUndefined()
    expect(state.document.nodes[b]).toBeUndefined()

    const node = state.document.nodes[id!] as PathNode
    expect(node.type).toBe('path')
    expect(node.style.fill).toEqual(BLUE) // topmost style
    expect(node.style.fillRule).toBe('evenodd')
    expect(state.selection).toEqual([id])

    const regions = docRegions(store, id!)
    expect(regionsArea(regions)).toBeCloseTo(175)
    expect(pointInRegions(regions, { x: 12, y: 12 })).toBe(true)

    // Undo restores both operands.
    state.undo()
    expect(store.getState().document.nodes[a]).toBeDefined()
    expect(store.getState().document.nodes[b]).toBeDefined()
  })

  it('minus front: bottom minus top, BOTTOM style kept', () => {
    const store = createEditorStore()
    const { a, b } = twoSquares(store)
    const [id] = cmdPathfinder(store, 'minusFront', [a, b])
    const node = store.getState().document.nodes[id!] as PathNode
    expect(node.style.fill).toEqual(RED)
    const regions = docRegions(store, id!)
    expect(regionsArea(regions)).toBeCloseTo(75)
    expect(pointInRegions(regions, { x: 7, y: 7 })).toBe(false)
  })

  it('intersect and exclude', () => {
    const store = createEditorStore()
    const { a, b } = twoSquares(store)
    const [id] = cmdPathfinder(store, 'intersect', [a, b])
    expect(regionsArea(docRegions(store, id!))).toBeCloseTo(25)
    store.getState().undo()

    const [xid] = cmdPathfinder(store, 'exclude', [a, b])
    const regions = docRegions(store, xid!)
    expect(regionsArea(regions)).toBeCloseTo(150)
    // XOR result is a compound path with correct fill-rule for the hole edge.
    const node = store.getState().document.nodes[xid!] as PathNode
    expect(node.style.fillRule).toBe('evenodd')
    expect(node.subpaths.length).toBeGreaterThanOrEqual(2)
  })

  it('does nothing on disjoint intersect (no empty result nodes)', () => {
    const store = createEditorStore()
    const a = createRectNode({ x: 0, y: 0, w: 10, h: 10 })
    const b = createRectNode({ x: 100, y: 100, w: 10, h: 10 })
    cmdAddNode(store, a)
    cmdAddNode(store, b)
    const before = store.getState().history.undoStack.length
    expect(cmdPathfinder(store, 'intersect', [a.id, b.id])).toEqual([])
    expect(store.getState().history.undoStack.length).toBe(before)
    expect(store.getState().document.nodes[a.id]).toBeDefined()
  })

  it('divide: a group of atomic faces, overlap owned by the TOP style', () => {
    const store = createEditorStore()
    const { a, b } = twoSquares(store)
    const [groupId] = cmdPathfinder(store, 'divide', [a, b])
    const group = store.getState().document.nodes[groupId!] as GroupNode
    expect(group.type).toBe('group')
    expect(group.children).toHaveLength(3)
    const areas = group.children
      .map((cid) => regionsArea(docRegions(store, cid)))
      .sort((x, y) => x - y)
    expect(areas[0]).toBeCloseTo(25)
    expect(areas[1]).toBeCloseTo(75)
    expect(areas[2]).toBeCloseTo(75)
    // The overlap piece wears the TOP (blue) fill.
    const overlap = group.children.find((cid) =>
      pointInRegions(docRegions(store, cid), { x: 7.5, y: 7.5 }),
    )!
    expect((store.getState().document.nodes[overlap] as PathNode).style.fill).toEqual(BLUE)
  })

  it('trim strips strokes; merge unites same-fill pieces', () => {
    const store = createEditorStore()
    const { a, b } = twoSquares(store)
    // Same fill for both -> merge should yield ONE piece of area 175.
    store.getState().applyCommand('same fill', (doc) => {
      doc.nodes[b]!.style.fill = { ...RED }
    })
    const [mergedGroup] = cmdPathfinder(store, 'merge', [a, b])
    const group = store.getState().document.nodes[mergedGroup!] as GroupNode
    expect(group.children).toHaveLength(1)
    const only = store.getState().document.nodes[group.children[0]!] as PathNode
    expect(only.style.stroke).toBeNull() // trim/merge remove strokes
    expect(regionsArea(docRegions(store, only.id))).toBeCloseTo(175)
  })
})

describe('export correctness of boolean results', () => {
  it('exclude exports a compound path with fill-rule="evenodd"', () => {
    const store = createEditorStore()
    const { a, b } = twoSquares(store)
    cmdPathfinder(store, 'exclude', [a, b])
    const svg = documentToSVG(store.getState().document)
    expect(svg).toContain('fill-rule="evenodd"')
    // Compound path: multiple M commands in one d attribute.
    const d = / d="([^"]+)"/.exec(svg)![1]!
    expect(d.match(/M/g)!.length).toBeGreaterThanOrEqual(2)
  })
})

describe('cmdOutlineStroke', () => {
  it('variable-width stroke becomes a REAL filled path node', () => {
    const store = createEditorStore()
    const rect = createRectNode({ x: 0, y: 0, w: 100, h: 50 }, { transform: [1, 0, 0, 1, 20, 20] })
    rect.style.fill = null
    rect.style.stroke = { ...RED }
    rect.style.widthProfile = [
      { offset: 0, width: 2 },
      { offset: 1, width: 12 },
    ]
    cmdAddNode(store, rect)
    const [outlineId] = cmdOutlineStroke(store, [rect.id])
    const state = store.getState()
    expect(state.document.nodes[rect.id]).toBeUndefined() // fill-less source consumed
    const outline = state.document.nodes[outlineId!] as PathNode
    expect(outline.type).toBe('path')
    expect(outline.style.fill).toEqual(RED) // stroke paint became the FILL
    expect(outline.style.stroke).toBeNull()
    expect(outline.style.widthProfile).toBeUndefined()
    // The outline's world geometry covers the stroked band, not the interior.
    const regions = docRegions(store, outlineId!)
    expect(pointInRegions(regions, { x: 70, y: 20.5 })).toBe(true) // on the top edge
    expect(pointInRegions(regions, { x: 70, y: 45 })).toBe(false) // interior
    // And it round-trips through export as a plain filled path.
    const svg = documentToSVG(state.document)
    expect(svg).not.toContain('stroke-width')
  })

  it('outlines an OPEN unfilled path (a pen line) — the very point of outlining', () => {
    const store = createEditorStore()
    const line = createPathNode(
      [createSubPath([createAnchor({ x: 0, y: 0 }), createAnchor({ x: 100, y: 0 })], false)],
      { transform: [1, 0, 0, 1, 10, 10] },
    )
    line.style.fill = null
    line.style.stroke = { ...BLUE }
    line.style.strokeWidth = 8
    cmdAddNode(store, line)
    const [outlineId] = cmdOutlineStroke(store, [line.id])
    expect(outlineId).toBeDefined()
    const regions = docRegions(store, outlineId!)
    expect(regionsArea(regions)).toBeGreaterThan(790) // 100x8 + round caps
    expect(pointInRegions(regions, { x: 60, y: 13 })).toBe(true)
    expect(store.getState().document.nodes[line.id]).toBeUndefined() // fill-less source consumed
  })

  it('a filled node keeps its body and gains a sibling outline', () => {
    const store = createEditorStore()
    const rect = createRectNode({ x: 0, y: 0, w: 40, h: 40 })
    rect.style.stroke = { ...BLUE }
    rect.style.strokeWidth = 6
    cmdAddNode(store, rect)
    const [outlineId] = cmdOutlineStroke(store, [rect.id])
    const state = store.getState()
    expect(state.document.nodes[rect.id]).toBeDefined()
    expect(state.document.nodes[rect.id]!.style.stroke).toBeNull()
    const root = state.document.nodes[state.document.root] as GroupNode
    expect(root.children.indexOf(outlineId!)).toBe(root.children.indexOf(rect.id) + 1)
  })
})

describe('knife and eraser', () => {
  it('knife splits a square into two separate paths along the cut', () => {
    const store = createEditorStore()
    const rect = createRectNode({ x: 0, y: 0, w: 20, h: 20 })
    rect.style.fill = { ...RED }
    cmdAddNode(store, rect)
    // Vertical cut through the middle, overshooting both edges.
    const created = cmdKnife(store, [
      { x: 10, y: -5 },
      { x: 10, y: 25 },
    ])
    expect(created).toHaveLength(2)
    expect(store.getState().document.nodes[rect.id]).toBeUndefined()
    const areas = created.map((id) => regionsArea(docRegions(store, id)))
    expect(areas[0]! + areas[1]!).toBeCloseTo(400, -1) // minus the hairline blade
    expect(Math.abs(areas[0]! - areas[1]!)).toBeLessThan(2)
    expect(store.getState().history.undoStack.at(-1)!.label).toBe('Knife')
    // Both pieces keep the source style.
    for (const id of created) {
      expect((store.getState().document.nodes[id] as PathNode).style.fill).toEqual(RED)
    }
  })

  it('knife ignores objects the blade misses', () => {
    const store = createEditorStore()
    const rect = createRectNode({ x: 0, y: 0, w: 20, h: 20 })
    cmdAddNode(store, rect)
    expect(
      cmdKnife(store, [
        { x: 100, y: 100 },
        { x: 120, y: 120 },
      ]),
    ).toEqual([])
    expect(store.getState().document.nodes[rect.id]).toBeDefined()
  })

  it('eraser removes a bite; erasing everything deletes the node', () => {
    const store = createEditorStore()
    const rect = createRectNode({ x: 0, y: 0, w: 30, h: 30 })
    cmdAddNode(store, rect)
    const [survivor] = cmdErase(store, [{ x: 15, y: 15 }, { x: 16, y: 15 }], 5)
    expect(survivor).toBeDefined()
    const regions = docRegions(store, survivor!)
    expect(pointInRegions(regions, { x: 15, y: 15 })).toBe(false) // the bite
    expect(pointInRegions(regions, { x: 2, y: 2 })).toBe(true)
    expect(regionsArea(regions)).toBeLessThan(900)

    // Erase with a blob covering everything -> node deleted.
    const gone = cmdErase(store, [{ x: -20, y: 15 }, { x: 50, y: 15 }], 60)
    expect(gone).toEqual([])
    const root = store.getState().document.nodes[store.getState().document.root] as GroupNode
    expect(root.children).toHaveLength(0)
  })

  it('bladeRegions builds a thin blade from a trail', () => {
    const blade = bladeRegions(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      0.2,
    )
    expect(regionsArea(blade)).toBeCloseTo(20, 0)
  })
})

describe('shape builder command', () => {
  it('merging two faces produces their union; the rest survive as paths', () => {
    const store = createEditorStore()
    const { a, b } = twoSquares(store)
    const doc = store.getState().document
    const operands = collectOperands(doc, [a, b])
    const faces = buildFaces(
      [...operands].reverse().map((o) => ({ id: o.id, regions: o.regions, style: o.style })),
    )
    expect(faces).toHaveLength(3)
    // Merge the A-only face with the overlap face.
    const aOnly = faceAtPoint(faces, { x: 2, y: 2 })
    const overlap = faceAtPoint(faces, { x: 7.5, y: 7.5 })
    expect(aOnly).not.toBe(-1)
    expect(overlap).not.toBe(-1)

    const created = cmdShapeBuilder(store, [a, b], faces, [aOnly, overlap], 'merge')
    expect(created).toHaveLength(2) // merged + the remaining B-only face
    const merged = store.getState().document.nodes[created[0]!] as PathNode
    expect(regionsArea(docRegions(store, merged.id))).toBeCloseTo(100)
    expect(store.getState().document.nodes[a]).toBeUndefined()
    expect(store.getState().history.undoStack.at(-1)!.label).toBe('Shape Builder')
  })

  it('alt-delete removes the picked face and keeps the rest', () => {
    const store = createEditorStore()
    const { a, b } = twoSquares(store)
    const doc = store.getState().document
    const operands = collectOperands(doc, [a, b])
    const faces = buildFaces(
      [...operands].reverse().map((o) => ({ id: o.id, regions: o.regions, style: o.style })),
    )
    const overlap = faceAtPoint(faces, { x: 7.5, y: 7.5 })
    const created = cmdShapeBuilder(store, [a, b], faces, [overlap], 'delete')
    expect(created).toHaveLength(2) // the two non-overlap faces
    const total = created.reduce((sum, id) => sum + regionsArea(docRegions(store, id)), 0)
    expect(total).toBeCloseTo(150)
  })
})

describe('positioning rule on results', () => {
  it('result anchors are LOCAL; placement lives in the transform', () => {
    const store = createEditorStore()
    const a = createRectNode({ x: 0, y: 0, w: 10, h: 10 }, { transform: [1, 0, 0, 1, 200, 300] })
    const b = createRectNode({ x: 0, y: 0, w: 10, h: 10 }, { transform: [1, 0, 0, 1, 205, 305] })
    cmdAddNode(store, a)
    cmdAddNode(store, b)
    const [id] = cmdPathfinder(store, 'unite', [a.id, b.id])
    const node = store.getState().document.nodes[id!] as PathNode
    // Local anchors sit near the origin; the transform carries the placement.
    const firstAnchor = node.subpaths[0]!.anchors[0]!
    expect(Math.abs(firstAnchor.point.x)).toBeLessThan(20)
    const world = applyToPoint(
      worldTransform(store.getState().document.nodes, node.id),
      firstAnchor.point,
    )
    expect(world.x).toBeGreaterThanOrEqual(200)
    expect(world.y).toBeGreaterThanOrEqual(300)
  })
})
