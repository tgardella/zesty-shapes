import { describe, expect, it } from 'vitest'
import { cmdAddNode, cmdDuplicateNodes, cmdMoveNodesBy } from './commands'
import { createEditorStore } from './store'
import { addNode } from '../model/document'
import { createGroupNode, createRectNode } from '../model/nodes'
import { compose, rotateMat, translate } from '../geometry/matrix'
import { worldTransform } from './worldTransform'
import { applyToPoint } from '../geometry/matrix'
import type { GroupNode } from '../model/types'

describe('cmdMoveNodesBy (nudge)', () => {
  it('moves top-level nodes by the doc delta via transform e,f only', () => {
    const store = createEditorStore()
    const rect = createRectNode({ x: 0, y: 0, w: 10, h: 10 }, { transform: translate(5, 5) })
    cmdAddNode(store, rect, { select: true })
    cmdMoveNodesBy(store, [rect.id], { x: 1, y: 0 }, 'Nudge')
    const node = store.getState().document.nodes[rect.id]!
    expect(node.transform).toEqual(translate(6, 5))
    expect((node as { x: number }).x).toBe(0) // params never move a shape
    expect(store.getState().history.undoStack.at(-1)!.label).toBe('Nudge')
  })

  it('maps the doc delta into a ROTATED parent space so screen motion is exact', () => {
    const store = createEditorStore()
    const group = createGroupNode({ transform: rotateMat(Math.PI / 2) })
    const rect = createRectNode({ x: 0, y: 0, w: 10, h: 10 })
    store.getState().applyCommand('Build', (doc) => {
      addNode(doc, group)
      addNode(doc, rect, group.id)
    })
    const before = applyToPoint(worldTransform(store.getState().document.nodes, rect.id), {
      x: 0,
      y: 0,
    })
    cmdMoveNodesBy(store, [rect.id], { x: 10, y: 0 }, 'Nudge')
    const after = applyToPoint(worldTransform(store.getState().document.nodes, rect.id), {
      x: 0,
      y: 0,
    })
    expect(after.x - before.x).toBeCloseTo(10)
    expect(after.y - before.y).toBeCloseTo(0)
  })

  it('skips locked nodes', () => {
    const store = createEditorStore()
    const rect = createRectNode({ x: 0, y: 0, w: 10, h: 10 }, { locked: true })
    cmdAddNode(store, rect)
    cmdMoveNodesBy(store, [rect.id], { x: 5, y: 5 })
    expect(store.getState().document.nodes[rect.id]!.transform).toEqual([1, 0, 0, 1, 0, 0])
  })
})

describe('cmdDuplicateNodes', () => {
  it('places each duplicate right above its source, selected, ONE undo entry', () => {
    const store = createEditorStore()
    const a = createRectNode({ x: 0, y: 0, w: 10, h: 10 })
    const b = createRectNode({ x: 0, y: 0, w: 10, h: 10 })
    cmdAddNode(store, a)
    cmdAddNode(store, b)
    const depth = store.getState().history.undoStack.length

    store.getState().setSelection([a.id])
    const dupes = cmdDuplicateNodes(store, [a.id], { offset: { x: 10, y: 10 } })
    expect(dupes).toHaveLength(1)

    const state = store.getState()
    const rootChildren = (state.document.nodes[state.document.root] as GroupNode).children
    expect(rootChildren).toEqual([a.id, dupes[0]!, b.id]) // right above the source
    expect(state.document.nodes[dupes[0]!]!.transform).toEqual(translate(10, 10))
    expect(state.selection).toEqual(dupes)
    expect(state.history.undoStack.length).toBe(depth + 1)

    store.getState().undo()
    expect(store.getState().document.nodes[dupes[0]!]).toBeUndefined()
    expect(store.getState().selection).toEqual([a.id]) // selection restored
  })

  it('duplicates whole subtrees preserving structure and world placement', () => {
    const store = createEditorStore()
    const group = createGroupNode({ transform: compose(translate(50, 50), rotateMat(0.5)) })
    const child = createRectNode({ x: 0, y: 0, w: 10, h: 10 }, { transform: translate(5, 5) })
    store.getState().applyCommand('Build', (doc) => {
      addNode(doc, group)
      addNode(doc, child, group.id)
    })
    const dupes = cmdDuplicateNodes(store, [group.id])
    const doc = store.getState().document
    const dupeGroup = doc.nodes[dupes[0]!] as GroupNode
    expect(dupeGroup.children).toHaveLength(1)
    const dupeChildId = dupeGroup.children[0]!
    // Same world transform as the original child (no offset requested).
    const worldOriginal = worldTransform(doc.nodes, child.id)
    const worldDupe = worldTransform(doc.nodes, dupeChildId)
    for (let i = 0; i < 6; i++) expect(worldDupe[i]).toBeCloseTo(worldOriginal[i]!)
  })

  it('returns [] for an empty selection without touching history', () => {
    const store = createEditorStore()
    expect(cmdDuplicateNodes(store, [])).toEqual([])
    expect(store.getState().history.undoStack).toHaveLength(0)
  })
})
