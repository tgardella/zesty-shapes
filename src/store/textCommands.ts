/**
 * Text commands: attribute edits over selected TextNodes and Convert to
 * Outlines. Outline geometry comes from an injected provider (the runtime
 * font kit) so the store layer stays DOM-free and testable.
 */

import type { NodeId, PathNode, SubPath, TextNode } from '../model/types'
import { cloneStyle } from '../model/nodes'
import type { EditorStoreApi } from './store'

/**
 * End an in-place editing session: COMMIT the open 'Add Text'/'Edit Text'
 * transaction (Illustrator's Escape commits, it doesn't discard) — unless the
 * text ended up empty, in which case the whole session rolls back (a freshly
 * created node evaporates; an emptied existing node reverts).
 */
export function finishTextEdit(store: EditorStoreApi): void {
  const state = store.getState()
  const edit = state.ui.textEdit
  if (!edit) return
  const node = state.document.nodes[edit.nodeId]
  state.setTextEdit(null)
  if (!node || (node.type === 'text' && node.text.trim() === '')) {
    state.cancelTransaction()
  } else {
    state.commitTransaction()
  }
}

/** Every TextNode reachable from `ids` (groups recurse; locked skipped). */
export function textLeafIds(store: EditorStoreApi, ids: NodeId[]): NodeId[] {
  const doc = store.getState().document
  const out: NodeId[] = []
  const seen = new Set<NodeId>()
  const visit = (id: NodeId): void => {
    if (seen.has(id) || id === doc.root) return
    seen.add(id)
    const node = doc.nodes[id]
    if (!node || node.locked || node.hidden) return
    if (node.type === 'group') {
      for (const child of node.children) visit(child)
      return
    }
    if (node.type === 'text') out.push(id)
  }
  for (const id of ids) visit(id)
  return out
}

/** Mutate every selected TextNode's typography as ONE labeled undo step. */
export function cmdSetTextAttrs(
  store: EditorStoreApi,
  ids: NodeId[],
  label: string,
  mutate: (node: TextNode) => void,
): void {
  const targets = textLeafIds(store, ids)
  if (targets.length === 0) return
  store.getState().applyCommand(label, (doc) => {
    for (const id of targets) {
      const node = doc.nodes[id]
      if (node?.type === 'text') mutate(node)
    }
  })
}

/**
 * Convert TextNodes to PathNodes IN PLACE (same id, transform, z-position —
 * the convertToPath contract). `outline` supplies LOCAL-space glyph subpaths
 * (rendering/fontKit.textToOutlineSubPaths after ensureFontsLoaded()).
 * Returns the converted ids.
 */
export function cmdConvertTextToOutlines(
  store: EditorStoreApi,
  ids: NodeId[],
  outline: (node: TextNode) => SubPath[] | null,
): NodeId[] {
  const doc = store.getState().document
  const jobs: Array<{ id: NodeId; replacement: PathNode }> = []
  for (const id of textLeafIds(store, ids)) {
    const source = doc.nodes[id]
    if (!source || source.type !== 'text') continue
    const subpaths = outline(JSON.parse(JSON.stringify(source)) as TextNode)
    if (!subpaths || subpaths.length === 0) continue
    const style = cloneStyle(source.style)
    style.fillRule = 'nonzero' // font winding encodes counters (holes)
    jobs.push({
      id,
      replacement: {
        id: source.id,
        type: 'path',
        name: source.name === 'Text' ? 'Outlines' : source.name,
        parent: source.parent,
        transform: [...source.transform] as PathNode['transform'],
        style,
        opacity: source.opacity,
        blendMode: source.blendMode,
        locked: source.locked,
        hidden: source.hidden,
        subpaths,
      },
    })
  }
  if (jobs.length === 0) return []
  store.getState().applyCommand(
    'Convert to Outlines',
    (draft) => {
      for (const job of jobs) draft.nodes[job.id] = job.replacement
    },
    { selectAfter: jobs.map((j) => j.id) },
  )
  return jobs.map((j) => j.id)
}
