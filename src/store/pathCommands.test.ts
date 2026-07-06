import { describe, expect, it } from 'vitest'
import { cmdAddNode, cmdConvertToPath, cmdDeleteAnchors } from './commands'
import { createEditorStore } from './store'
import { addNode } from '../model/document'
import { createGroupNode, createRectNode, createPathNode } from '../model/nodes'
import { createAnchor, createSubPath } from '../model/pathOps'
import {
  applyToPoint,
  applyToVector,
  compose,
  invert,
  matEquals,
  rotateMat,
  translate,
} from '../geometry/matrix'
import { worldTransform } from './worldTransform'
import type { GroupNode, PathNode } from '../model/types'

describe('cmdConvertToPath', () => {
  it('replaces the shape IN PLACE: same id, transform, parent, z-position', () => {
    const store = createEditorStore()
    const a = createRectNode({ x: 0, y: 0, w: 10, h: 10 })
    const rect = createRectNode(
      { x: 5, y: 5, w: 100, h: 60, rx: 8 },
      { transform: compose(translate(40, 30), rotateMat(0.6)) },
    )
    const b = createRectNode({ x: 0, y: 0, w: 10, h: 10 })
    for (const n of [a, rect, b]) cmdAddNode(store, n)
    const worldBefore = worldTransform(store.getState().document.nodes, rect.id)

    const converted = cmdConvertToPath(store, [rect.id])
    expect(converted).toEqual([rect.id])
    const state = store.getState()
    const node = state.document.nodes[rect.id] as PathNode
    expect(node.type).toBe('path')
    expect(node.subpaths.length).toBeGreaterThan(0)
    expect(node.transform).toEqual(rect.transform) // PRESERVED
    expect(matEquals(worldTransform(state.document.nodes, rect.id), worldBefore, 1e-9)).toBe(true)
    const rootChildren = (state.document.nodes[state.document.root] as GroupNode).children
    expect(rootChildren).toEqual([a.id, rect.id, b.id]) // z-position kept

    // Undo restores the parametric shape.
    store.getState().undo()
    expect(store.getState().document.nodes[rect.id]!.type).toBe('rect')
  })

  it('geometry lands where the shape was drawn (anchors LOCAL + transform)', () => {
    const store = createEditorStore()
    const rect = createRectNode({ x: 0, y: 0, w: 100, h: 50 }, { transform: translate(200, 100) })
    cmdAddNode(store, rect)
    cmdConvertToPath(store, [rect.id])
    const node = store.getState().document.nodes[rect.id] as PathNode
    const first = node.subpaths[0]!.anchors[0]!
    // Anchors stay local (0..100); world position comes from the transform.
    expect(first.point.x).toBeGreaterThanOrEqual(0)
    expect(first.point.x).toBeLessThanOrEqual(100)
    const world = applyToPoint(worldTransform(store.getState().document.nodes, rect.id), first.point)
    expect(world.x).toBeGreaterThanOrEqual(200)
  })

  it('skips locked shapes, groups, and existing paths', () => {
    const store = createEditorStore()
    const locked = createRectNode({ x: 0, y: 0, w: 10, h: 10 }, { locked: true })
    const group = createGroupNode()
    store.getState().applyCommand('Build', (doc) => {
      addNode(doc, locked)
      addNode(doc, group)
    })
    expect(cmdConvertToPath(store, [locked.id, group.id, 'missing'])).toEqual([])
  })
})

describe('cmdDeleteAnchors', () => {
  function trianglePath() {
    return createPathNode([
      createSubPath(
        [
          createAnchor({ x: 0, y: 0 }),
          createAnchor({ x: 100, y: 0 }),
          createAnchor({ x: 50, y: 80 }),
        ],
        true,
      ),
    ])
  }

  it('removes anchors in one undoable entry', () => {
    const store = createEditorStore()
    const path = trianglePath()
    cmdAddNode(store, path)
    const doomed = path.subpaths[0]!.anchors[2]!.id
    cmdDeleteAnchors(store, path.id, [doomed])
    const node = store.getState().document.nodes[path.id] as PathNode
    expect(node.subpaths[0]!.anchors).toHaveLength(2)
    store.getState().undo()
    expect((store.getState().document.nodes[path.id] as PathNode).subpaths[0]!.anchors).toHaveLength(3)
  })

  it('deletes the whole node when nothing survives', () => {
    const store = createEditorStore()
    const path = trianglePath()
    cmdAddNode(store, path, { select: true })
    const ids = path.subpaths[0]!.anchors.slice(0, 2).map((a) => a.id)
    cmdDeleteAnchors(store, path.id, ids) // leaves 1 anchor -> subpath dies -> node dies
    expect(store.getState().document.nodes[path.id]).toBeUndefined()
    expect(store.getState().selection).toEqual([])
  })
})

describe('anchor edits through rotated/nested transforms (the A-tool math)', () => {
  it('a doc-space drag maps into local space exactly through inverse world', () => {
    const store = createEditorStore()
    const group = createGroupNode({ transform: compose(translate(100, 50), rotateMat(Math.PI / 2)) })
    const path = createPathNode(
      [createSubPath([createAnchor({ x: 0, y: 0 }), createAnchor({ x: 40, y: 0 })], false)],
      { transform: translate(10, 10) },
    )
    store.getState().applyCommand('Build', (doc) => {
      addNode(doc, group)
      addNode(doc, path, group.id)
    })
    const nodes = store.getState().document.nodes
    const world = worldTransform(nodes, path.id)
    const anchor = (nodes[path.id] as PathNode).subpaths[0]!.anchors[0]!
    const worldBefore = applyToPoint(world, anchor.point)

    // Simulate the Direct Selection drag: doc delta -> local via the inverse
    // world transform's linear part — the exact code path the tool uses.
    const docDelta = { x: 25, y: -15 }
    const localDelta = applyToVector(invert(world), docDelta)
    store.getState().applyCommand('Move Anchors', (doc) => {
      const n = doc.nodes[path.id] as PathNode
      const a = n.subpaths[0]!.anchors[0]!
      a.point = { x: a.point.x + localDelta.x, y: a.point.y + localDelta.y }
    })
    const worldAfter = applyToPoint(
      worldTransform(store.getState().document.nodes, path.id),
      (store.getState().document.nodes[path.id] as PathNode).subpaths[0]!.anchors[0]!.point,
    )
    // The anchor's WORLD position moved by exactly the doc-space drag delta.
    expect(worldAfter.x - worldBefore.x).toBeCloseTo(docDelta.x)
    expect(worldAfter.y - worldBefore.y).toBeCloseTo(docDelta.y)
  })
})
