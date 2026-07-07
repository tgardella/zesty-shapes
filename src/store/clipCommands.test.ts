import { describe, expect, it } from 'vitest'
import { createEditorStore } from './store'
import { cmdAddNode, cmdGroupNodes } from './commands'
import {
  canMakeClipMask,
  canReleaseClipMask,
  cmdMakeClipMask,
  cmdReleaseClipMask,
} from './clipCommands'
import { documentToSVG } from '../model/serialize'
import { createEllipseNode, createRectNode, rgba } from '../model/nodes'
import type { GroupNode } from '../model/types'
import type { EditorStoreApi } from './store'

const RED = { type: 'solid' as const, color: rgba(255, 0, 0, 1) }
const BLUE = { type: 'solid' as const, color: rgba(0, 0, 255, 1) }

/** A (bottom, red rect) and B (top, blue ellipse) — B is the natural mask. */
function rectAndEllipse(store: EditorStoreApi): { a: string; b: string } {
  const a = createRectNode({ x: 0, y: 0, w: 40, h: 40 })
  a.style.fill = { ...RED }
  const b = createEllipseNode({ cx: 20, cy: 20, rx: 15, ry: 15 })
  b.style.fill = { ...BLUE }
  cmdAddNode(store, a)
  cmdAddNode(store, b)
  return { a: a.id, b: b.id }
}

describe('cmdMakeClipMask', () => {
  it('groups the selection and clips to the topmost object, one undo step', () => {
    const store = createEditorStore()
    const { a, b } = rectAndEllipse(store)
    const undoBefore = store.getState().history.undoStack.length

    const groupId = cmdMakeClipMask(store, [a, b])
    expect(groupId).not.toBeNull()

    const state = store.getState()
    expect(state.history.undoStack.length - undoBefore).toBe(1)
    expect(state.history.undoStack.at(-1)!.label).toBe('Make Clipping Mask')

    const group = state.document.nodes[groupId!] as GroupNode
    expect(group.type).toBe('group')
    expect(group.clip).toBe(b) // topmost object is the mask
    expect(group.children).toEqual([a, b]) // z-order preserved, both kept
    expect(state.selection).toEqual([groupId])
  })

  it('undo restores the ungrouped originals', () => {
    const store = createEditorStore()
    const { a, b } = rectAndEllipse(store)
    const rootChildrenBefore = [...(store.getState().document.nodes[store.getState().document.root] as GroupNode).children]

    cmdMakeClipMask(store, [a, b])
    store.getState().undo()

    const state = store.getState()
    const root = state.document.nodes[state.document.root] as GroupNode
    expect(root.children).toEqual(rootChildrenBefore)
    expect(state.document.nodes[a]!.parent).toBe(state.document.root)
    expect(state.document.nodes[b]!.parent).toBe(state.document.root)
  })

  it('reuses an existing single group, marking its topmost child as the mask', () => {
    const store = createEditorStore()
    const { a, b } = rectAndEllipse(store)
    const gid = cmdGroupNodes(store, [a, b])!

    const result = cmdMakeClipMask(store, [gid])
    expect(result).toBe(gid)
    const group = store.getState().document.nodes[gid] as GroupNode
    expect(group.clip).toBe(b)
    expect(group.children).toEqual([a, b])
  })

  it('is not applicable for a single non-group object', () => {
    const store = createEditorStore()
    const { b } = rectAndEllipse(store)
    expect(canMakeClipMask(store, [b])).toBe(false)
    expect(cmdMakeClipMask(store, [b])).toBeNull()
  })

  it('is not applicable when the topmost object is a group (no single silhouette)', () => {
    const store = createEditorStore()
    const a = createRectNode({ x: 0, y: 0, w: 40, h: 40 })
    cmdAddNode(store, a)
    const b = createRectNode({ x: 0, y: 0, w: 10, h: 10 })
    const c = createRectNode({ x: 20, y: 20, w: 10, h: 10 })
    cmdAddNode(store, b)
    cmdAddNode(store, c)
    // Group b+c: the group becomes the topmost object above `a`.
    const topGroup = cmdGroupNodes(store, [b.id, c.id])!
    expect(canMakeClipMask(store, [a.id, topGroup])).toBe(false)
  })
})

describe('cmdReleaseClipMask', () => {
  it('clears the clip, keeping the group and its children, one undo step', () => {
    const store = createEditorStore()
    const { a, b } = rectAndEllipse(store)
    const groupId = cmdMakeClipMask(store, [a, b])!
    const undoBefore = store.getState().history.undoStack.length

    expect(canReleaseClipMask(store, [groupId])).toBe(true)
    cmdReleaseClipMask(store, [groupId])

    const state = store.getState()
    expect(state.history.undoStack.length - undoBefore).toBe(1)
    const group = state.document.nodes[groupId] as GroupNode
    expect(group.clip).toBeUndefined()
    expect(group.children).toEqual([a, b])
  })

  it('is a no-op when nothing selected is a clip group', () => {
    const store = createEditorStore()
    const { a, b } = rectAndEllipse(store)
    expect(canReleaseClipMask(store, [a, b])).toBe(false)
    const undoBefore = store.getState().history.undoStack.length
    cmdReleaseClipMask(store, [a, b])
    expect(store.getState().history.undoStack.length).toBe(undoBefore)
  })
})

describe('clipping mask SVG export', () => {
  it('emits a clipPath referenced by the clipped content group', () => {
    const store = createEditorStore()
    const { a, b } = rectAndEllipse(store)
    const groupId = cmdMakeClipMask(store, [a, b])!

    const svg = documentToSVG(store.getState().document)
    expect(svg).toContain(`<clipPath id="clip-${groupId}">`)
    expect(svg).toContain(`clip-path="url(#clip-${groupId})"`)
    // The mask ellipse's own <ellipse>/<path> is not painted as visible art;
    // it appears only inside the clipPath. The clipped rect is still present.
    expect(svg).toContain('<path') // clip source outline inside clipPath
  })

  it('round-trips the clip field through JSON', () => {
    const store = createEditorStore()
    const { a, b } = rectAndEllipse(store)
    const groupId = cmdMakeClipMask(store, [a, b])!
    const json = JSON.stringify(store.getState().document)
    const parsed = JSON.parse(json)
    expect(parsed.nodes[groupId].clip).toBe(b)
  })
})
