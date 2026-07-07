/**
 * Internal clipboard for copy / cut / paste. The clipboard holds a deep
 * plain-JSON SNAPSHOT of the copied subtrees (original ids); every paste
 * re-clones with fresh ids, so pasting twice yields independent objects and
 * the snapshot survives any later document edits.
 */

import { cloneSubtrees, orderedSubtreeRoots } from '../model/clone'
import type { NodeId, SceneNode } from '../model/types'
import {
  cmdDeleteNodes,
  cmdInsertSubtrees,
  docDeltaInParentSpace,
  type SubtreePlacement,
} from './commands'
import { resolveInsertionParent, type EditorStoreApi } from './store'

export const PASTE_OFFSET = 10

interface ClipboardSnapshot {
  nodes: Record<NodeId, SceneNode>
  rootIds: NodeId[]
}

let snapshot: ClipboardSnapshot | null = null

export function clipboardIsEmpty(): boolean {
  return snapshot === null
}

/** Test hook: reset module state between test cases. */
export function clearClipboard(): void {
  snapshot = null
}

/** Copy the current selection (top-most roots, z-order). Returns copied count. */
export function copySelection(store: EditorStoreApi): number {
  const { document: doc, selection } = store.getState()
  const rootIds = orderedSubtreeRoots(doc, selection)
  if (rootIds.length === 0) return 0
  const nodes: Record<NodeId, SceneNode> = {}
  const stack = [...rootIds]
  while (stack.length > 0) {
    const id = stack.pop()!
    const node = doc.nodes[id]
    if (!node || nodes[id]) continue
    nodes[id] = JSON.parse(JSON.stringify(node)) as SceneNode
    if (node.type === 'group') stack.push(...node.children)
  }
  snapshot = { nodes, rootIds }
  return rootIds.length
}

/** Cut = copy + delete (single 'Cut' undo entry restores selection on undo). */
export function cutSelection(store: EditorStoreApi): number {
  const count = copySelection(store)
  if (count > 0) {
    cmdDeleteNodes(store, orderedSubtreeRoots(store.getState().document, store.getState().selection), 'Cut')
  }
  return count
}

/**
 * Paste into the ACTIVE layer (the isolation scope when inside a group, else
 * the active layer / topmost — resolveInsertionParent), offset by (+10, +10)
 * doc units, appended on top. Fresh ids per paste; the pasted nodes become the
 * selection. Returns the new root ids.
 */
export function pasteClipboard(store: EditorStoreApi): NodeId[] {
  if (!snapshot) return []
  const state = store.getState()
  const doc = state.document
  const target = resolveInsertionParent(state)
  const clones = cloneSubtrees(snapshot.nodes, snapshot.rootIds)
  if (clones.rootIds.length === 0) return []

  const offset = docDeltaInParentSpace(
    doc.nodes,
    target === doc.root ? null : target,
    doc.root,
    { x: PASTE_OFFSET, y: PASTE_OFFSET },
  )
  const placements: Record<NodeId, SubtreePlacement> = {}
  for (const rootId of clones.rootIds) {
    placements[rootId] = { parentId: target }
    const clone = clones.nodes.find((n) => n.id === rootId)!
    clone.transform = [
      clone.transform[0],
      clone.transform[1],
      clone.transform[2],
      clone.transform[3],
      clone.transform[4] + offset.x,
      clone.transform[5] + offset.y,
    ]
  }
  cmdInsertSubtrees(store, clones, placements, 'Paste')
  return clones.rootIds
}
