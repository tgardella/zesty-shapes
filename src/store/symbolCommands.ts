/**
 * Symbol library commands (Symbols panel). A symbol is a self-contained
 * subtree snapshot stored on the DOCUMENT (document.symbols), so libraries
 * persist through JSON round-trips and autosave. Instances are fresh clones —
 * editing art on canvas never mutates the definition.
 */

import { nanoid } from 'nanoid'
import type { Vec2 } from '../geometry/vec2'
import type { NodeId, SceneNode, SymbolDef } from '../model/types'
import { cloneSubtrees, orderedSubtreeRoots } from '../model/clone'
import { getWorldTransform } from '../model/document'
import { localBBoxOfNode, transformBBox, unionBBox, type BBox } from '../geometry/bbox'
import {
  compose,
  determinant,
  IDENTITY,
  invert,
  multiply,
  rotateMat,
  scaleMat,
  translate,
  type Mat,
} from '../geometry/matrix'
import { cmdInsertSubtrees, type SubtreePlacement } from './commands'
import { resolveInsertionParent, type EditorStoreApi } from './store'
import type { SprayStamp } from './sprayCommands'

export function documentSymbols(store: EditorStoreApi): SymbolDef[] {
  return store.getState().document.symbols ?? []
}

export function symbolById(store: EditorStoreApi, id: string): SymbolDef | undefined {
  return documentSymbols(store).find((s) => s.id === id)
}

/** World-space union bbox of a symbol DEFINITION (roots have parent=null). */
export function symbolDefBounds(def: SymbolDef): BBox | null {
  let out: BBox | null = null
  for (const rootId of def.rootIds) {
    const node = def.nodes[rootId]
    if (!node) continue
    const local = localBBoxOfNode(node, def.nodes)
    if (!local) continue
    out = unionBBox(out, transformBBox(getWorldTransform(def.nodes, rootId), local))
  }
  return out
}

function uniqueSymbolName(store: EditorStoreApi, base: string): string {
  const names = new Set(documentSymbols(store).map((s) => s.name))
  if (!names.has(base)) return base
  let n = 2
  while (names.has(`${base} ${n}`)) n++
  return `${base} ${n}`
}

/**
 * Define a new symbol from the given nodes (default: the selection). The
 * source art stays on canvas untouched; the library stores an id-fresh
 * snapshot. Returns the new symbol's id (null for an empty source).
 */
export function cmdCreateSymbol(
  store: EditorStoreApi,
  ids?: NodeId[],
  name?: string,
): string | null {
  const doc = store.getState().document
  const roots = orderedSubtreeRoots(doc, ids ?? store.getState().selection)
  if (roots.length === 0) return null
  const clones = cloneSubtrees(doc.nodes, roots)
  const nodes: Record<NodeId, SceneNode> = {}
  for (const node of clones.nodes) nodes[node.id] = node
  const def: SymbolDef = {
    id: nanoid(),
    name: uniqueSymbolName(store, name ?? 'New Symbol'),
    rootIds: clones.rootIds,
    nodes,
  }
  store.getState().applyCommand('New Symbol', (draft) => {
    draft.symbols ??= []
    draft.symbols.push(def)
  })
  return def.id
}

export function cmdRenameSymbol(store: EditorStoreApi, id: string, name: string): void {
  const trimmed = name.trim()
  if (trimmed === '') return
  store.getState().applyCommand('Rename Symbol', (draft) => {
    const def = draft.symbols?.find((s) => s.id === id)
    if (def) def.name = trimmed
  })
}

export function cmdDeleteSymbol(store: EditorStoreApi, id: string): void {
  store.getState().applyCommand('Delete Symbol', (draft) => {
    if (!draft.symbols) return
    const index = draft.symbols.findIndex((s) => s.id === id)
    if (index !== -1) draft.symbols.splice(index, 1)
  })
}

/**
 * Clone a symbol definition placed so its center lands on `stamp.docPoint`
 * (jittered by the stamp's rotation/scale) and parent the clones under
 * `parentId`. Shared by the sprayer and the panel's Place action. Returns
 * the clone root ids.
 */
export function cmdStampSymbol(
  store: EditorStoreApi,
  symbolId: string,
  stamp: SprayStamp,
  parentId?: NodeId,
): NodeId[] {
  const def = symbolById(store, symbolId)
  if (!def) return []
  const bounds = symbolDefBounds(def)
  if (!bounds) return []
  const center: Vec2 = {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
  }
  const target = parentId ?? resolveInsertionParent(store.getState())
  const doc = store.getState().document
  if (!doc.nodes[target] || doc.nodes[target]!.type !== 'group') return []

  const jitter = compose(
    translate(stamp.docPoint.x, stamp.docPoint.y),
    rotateMat(stamp.rotation),
    scaleMat(stamp.scale),
    translate(-center.x, -center.y),
  )
  // Clone roots land under `target`: local = inv(world(target)) * jitter * defWorld.
  const targetWorld = getWorldTransform(doc.nodes, target)
  const inv = invertSafe(targetWorld)

  const clones = cloneSubtrees(def.nodes, def.rootIds)
  for (let i = 0; i < def.rootIds.length; i++) {
    const clone = clones.nodes.find((n) => n.id === clones.rootIds[i])!
    const defWorld = getWorldTransform(def.nodes, def.rootIds[i]!)
    clone.transform = multiply(inv, multiply(jitter, defWorld))
  }

  const placements: Record<NodeId, SubtreePlacement> = {}
  for (const rootId of clones.rootIds) placements[rootId] = { parentId: target }
  cmdInsertSubtrees(store, clones, placements, 'Place Symbol')
  return clones.rootIds
}

// A parent group's world transform is always invertible in practice; guard
// against degenerate (zero-scale) ancestors instead of throwing mid-gesture.
function invertSafe(m: Mat): Mat {
  return Math.abs(determinant(m)) < 1e-12 ? ([...IDENTITY] as Mat) : invert(m)
}
