/**
 * Semantic command creators — the ONLY way tools and UI mutate the document.
 * Each wraps store.applyCommand with a labeled recipe built from the pure
 * model helpers (src/model/document.ts). Structural commands set selection
 * alongside the mutation so undo/redo restores it.
 */

import type { NodeId, SceneNode, Style } from '../model/types'
import { addNode, getNode, removeNode, reorder, reparent } from '../model/document'
import type { Mat } from '../geometry/matrix'
import type { EditorStoreApi } from './store'

export interface AddNodeOptions {
  parentId?: NodeId
  index?: number
  /** Select the new node (and restore that selection on redo). */
  select?: boolean
}

export function cmdAddNode(store: EditorStoreApi, node: SceneNode, opts: AddNodeOptions = {}): void {
  store.getState().applyCommand(
    `Add ${node.name}`,
    (doc) => addNode(doc, node, opts.parentId, opts.index),
    opts.select ? { selectAfter: [node.id] } : undefined,
  )
}

export function cmdDeleteNodes(store: EditorStoreApi, ids: NodeId[]): void {
  if (ids.length === 0) return
  store.getState().applyCommand(
    ids.length === 1 ? 'Delete' : `Delete ${ids.length} objects`,
    (doc) => {
      // An id may already be gone if an ancestor in `ids` was removed first.
      for (const id of ids) if (doc.nodes[id]) removeNode(doc, id)
    },
    { selectAfter: [] },
  )
}

/** Focused mutation of a single node (params, name, flags ... not structure). */
export function cmdUpdateNode(
  store: EditorStoreApi,
  id: NodeId,
  label: string,
  mutate: (node: SceneNode) => void,
): void {
  store.getState().applyCommand(label, (doc) => {
    mutate(getNode(doc, id))
  })
}

/**
 * Set whole transforms (move/scale/rotate results). Per the POSITIONING RULE
 * this is the only way objects move — shape params are never touched.
 */
export function cmdSetTransforms(
  store: EditorStoreApi,
  entries: ReadonlyArray<{ id: NodeId; transform: Mat }>,
  label = 'Move',
): void {
  if (entries.length === 0) return
  store.getState().applyCommand(label, (doc) => {
    for (const e of entries) {
      const node = doc.nodes[e.id]
      if (node) node.transform = [...e.transform] as Mat
    }
  })
}

export function cmdSetStyle(
  store: EditorStoreApi,
  ids: NodeId[],
  label: string,
  mutate: (style: Style) => void,
): void {
  if (ids.length === 0) return
  store.getState().applyCommand(label, (doc) => {
    for (const id of ids) {
      const node = doc.nodes[id]
      if (node) mutate(node.style)
    }
  })
}

/** Structural moves preserve world position via the model reparent contract. */
export function cmdReparent(
  store: EditorStoreApi,
  id: NodeId,
  newParentId: NodeId,
  index?: number,
): void {
  store.getState().applyCommand('Reparent', (doc) => reparent(doc, id, newParentId, index))
}

export function cmdReorder(store: EditorStoreApi, id: NodeId, newIndex: number): void {
  store.getState().applyCommand('Reorder', (doc) => reorder(doc, id, newIndex))
}
