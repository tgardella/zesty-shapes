/**
 * Select > Same: extend the selection to every object in the document that
 * shares an appearance attribute with the "seed" (the first selected leaf) —
 * same fill, stroke color, stroke weight, or opacity. A huge time-saver for
 * recoloring/retargeting art. Pure selection change (never undoable), like
 * Select All and the Magic Wand.
 */

import type { NodeId, Paint, SceneNode } from '../model/types'
import { rgbaEquals } from '../model/color'
import { stylableLeafIds } from './commands'
import type { EditorStoreApi } from './store'

export type SameCriterion = 'fill' | 'stroke' | 'strokeWidth' | 'opacity'

export const SAME_LABEL: Record<SameCriterion, string> = {
  fill: 'Fill Color',
  stroke: 'Stroke Color',
  strokeWidth: 'Stroke Weight',
  opacity: 'Opacity',
}

/** Exact paint equality: null matches only null; solids/gradients by content. */
export function paintsEqual(a: Paint | null, b: Paint | null): boolean {
  if (a === null || b === null) return a === b
  if (a.type !== b.type) return false
  if (a.type === 'solid' && b.type === 'solid') return rgbaEquals(a.color, b.color)
  if (a.type === 'gradient' && b.type === 'gradient') {
    if (a.gradientType !== b.gradientType) return false
    if (a.stops.length !== b.stops.length) return false
    return a.stops.every((s, i) => {
      const o = b.stops[i]!
      return Math.abs(s.offset - o.offset) < 1e-4 && rgbaEquals(s.color, o.color)
    })
  }
  return false
}

/** True when `node` matches `seed` under `criterion`. Groups never match. */
function matches(seed: SceneNode, node: SceneNode, criterion: SameCriterion): boolean {
  switch (criterion) {
    case 'fill':
      return paintsEqual(seed.style.fill, node.style.fill)
    case 'stroke':
      return paintsEqual(seed.style.stroke, node.style.stroke)
    case 'strokeWidth':
      // Only meaningful when both are actually stroked.
      return (
        seed.style.stroke !== null &&
        node.style.stroke !== null &&
        seed.style.strokeWidth === node.style.strokeWidth
      )
    case 'opacity':
      return Math.abs(seed.opacity - node.opacity) < 1e-4
  }
}

/** All unlocked, visible, non-group leaves (skips locked/hidden subtrees). */
function selectableLeaves(store: EditorStoreApi): NodeId[] {
  const doc = store.getState().document
  const out: NodeId[] = []
  const visit = (id: NodeId): void => {
    const node = doc.nodes[id]
    if (!node || node.locked || node.hidden) return
    if (node.type === 'group') {
      for (const child of node.children) visit(child)
      return
    }
    out.push(id)
  }
  const root = doc.nodes[doc.root]
  if (root && root.type === 'group') for (const id of root.children) visit(id)
  return out
}

/** True when there's a stylable seed to compare against. */
export function canSelectSame(store: EditorStoreApi, ids: NodeId[]): boolean {
  const state = store.getState()
  return stylableLeafIds(state.document.nodes, ids, state.document.root).length > 0
}

/**
 * Replace the selection with every leaf matching the seed under `criterion`.
 * The seed is the first stylable leaf of the current selection. No-op when
 * nothing stylable is selected. Returns the matched ids.
 */
export function selectSame(store: EditorStoreApi, criterion: SameCriterion): NodeId[] {
  const state = store.getState()
  const doc = state.document
  const seedIds = stylableLeafIds(doc.nodes, state.selection, doc.root)
  const seed = seedIds.length > 0 ? doc.nodes[seedIds[0]!] : undefined
  if (!seed) return []
  const matched = selectableLeaves(store).filter((id) => matches(seed, doc.nodes[id]!, criterion))
  if (matched.length > 0) state.setSelection(matched)
  return matched
}
