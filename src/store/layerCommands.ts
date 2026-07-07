/**
 * Layer commands (Layers panel). Layers are GroupNodes with isLayer=true that
 * sit directly under the document root; objects and sublayers live inside
 * them. Every command is one undoable step and keeps parent/children in sync.
 */

import { nanoid } from 'nanoid'
import type { GroupNode, NodeId } from '../model/types'
import {
  createLayerNode,
  isLayerNode,
  layerOfNode,
  nextLayerColor,
  normalizeLayers,
  topLevelLayers,
} from '../model/layers'
import { cloneSubtrees, orderedSubtreeRoots } from '../model/clone'
import { removeNode } from '../model/document'
import { cmdInsertSubtrees, type SubtreePlacement } from './commands'
import type { EditorStoreApi } from './store'

function usedLayerColors(store: EditorStoreApi): string[] {
  return topLevelLayers(store.getState().document)
    .map((l) => l.layerColor)
    .filter((c): c is string => !!c)
}

function uniqueLayerName(store: EditorStoreApi, base: string): string {
  const names = new Set(topLevelLayers(store.getState().document).map((l) => l.name))
  if (!names.has(base)) return base
  let n = topLevelLayers(store.getState().document).length + 1
  while (names.has(`Layer ${n}`)) n++
  return `Layer ${n}`
}

/** New top-level layer above the active one. Becomes active + selected. */
export function cmdCreateLayer(store: EditorStoreApi, name?: string): NodeId {
  const state = store.getState()
  const layer = createLayerNode(
    name ?? uniqueLayerName(store, `Layer ${topLevelLayers(state.document).length + 1}`),
    nextLayerColor(usedLayerColors(store)),
  )
  const layers = topLevelLayers(state.document)
  const activeIdx = layers.findIndex((l) => l.id === state.ui.activeLayerId)
  store.getState().applyCommand(
    'New Layer',
    (doc) => {
      const root = doc.nodes[doc.root] as GroupNode
      layer.parent = doc.root
      doc.nodes[layer.id] = layer
      // Insert just ABOVE the active layer in z-order (root children order).
      const rootIdxOfActive =
        activeIdx >= 0 ? root.children.indexOf(layers[activeIdx]!.id) : root.children.length - 1
      root.children.splice(rootIdxOfActive + 1, 0, layer.id)
    },
    { selectAfter: [layer.id] },
  )
  store.getState().setActiveLayer(layer.id)
  return layer.id
}

/** New sublayer nested inside the target layer (or the active layer). */
export function cmdCreateSublayer(store: EditorStoreApi, parentLayerId?: NodeId): NodeId | null {
  const state = store.getState()
  const parentId =
    parentLayerId ??
    state.ui.activeLayerId ??
    topLevelLayers(state.document).at(-1)?.id ??
    null
  if (!parentId || state.document.nodes[parentId]?.type !== 'group') return null
  // A sublayer inherits its parent layer's color so the whole layer reads as
  // one color on the artboard (the user can change it in Layer Options).
  const parentColor = (state.document.nodes[parentId] as GroupNode).layerColor
  const layer = createLayerNode('Sublayer', parentColor ?? nextLayerColor(usedLayerColors(store)))
  store.getState().applyCommand(
    'New Sublayer',
    (doc) => {
      const parent = doc.nodes[parentId] as GroupNode
      layer.parent = parentId
      doc.nodes[layer.id] = layer
      parent.children.push(layer.id)
    },
    { selectAfter: [layer.id] },
  )
  return layer.id
}

/** Delete layers (or any nodes). Keeps at least one top-level layer alive. */
export function cmdDeleteLayer(store: EditorStoreApi, ids: NodeId[]): void {
  const doc = store.getState().document
  const layers = topLevelLayers(doc)
  const deletingTopLevel = ids.filter((id) => layers.some((l) => l.id === id))
  // Never leave the document with zero layers.
  const survives = layers.length - deletingTopLevel.length
  store.getState().applyCommand(
    ids.length === 1 ? 'Delete Layer' : 'Delete Layers',
    (doc2) => {
      const removeSubtree = (id: NodeId): void => {
        const node = doc2.nodes[id]
        if (!node) return
        if (node.parent !== null) {
          const p = doc2.nodes[node.parent]
          if (p && p.type === 'group') p.children = p.children.filter((c) => c !== id)
        }
        const stack = [id]
        while (stack.length) {
          const cur = stack.pop()!
          const n = doc2.nodes[cur]
          if (!n) continue
          if (n.type === 'group') stack.push(...n.children)
          delete doc2.nodes[cur]
        }
      }
      for (const id of ids) removeSubtree(id)
      // Backfill a fresh empty layer if we removed the last top-level layer.
      if (survives <= 0) {
        const layer = createLayerNode('Layer 1', nextLayerColor([]))
        layer.parent = doc2.root
        doc2.nodes[layer.id] = layer
        ;(doc2.nodes[doc2.root] as GroupNode).children.push(layer.id)
      }
    },
    { selectAfter: [] },
  )
}

/** Duplicate whole layers (or nodes) in place, above their source. */
export function cmdDuplicateLayer(store: EditorStoreApi, ids: NodeId[]): NodeId[] {
  const doc = store.getState().document
  const roots = orderedSubtreeRoots(doc, ids)
  if (roots.length === 0) return []
  const clones = cloneSubtrees(doc.nodes, roots)
  const placements: Record<NodeId, SubtreePlacement> = {}
  for (let i = 0; i < roots.length; i++) {
    const source = doc.nodes[roots[i]!]!
    const parentId = source.parent ?? doc.root
    const parent = doc.nodes[parentId]
    const idx = parent?.type === 'group' ? parent.children.indexOf(roots[i]!) : -1
    placements[clones.rootIds[i]!] = { parentId, index: idx === -1 ? undefined : idx + 1 }
    // A duplicated layer gets a fresh name; keep the color.
    const clone = clones.nodes.find((n) => n.id === clones.rootIds[i]!)
    if (clone && isLayerNode(clone)) clone.name = `${source.name} copy`
  }
  cmdInsertSubtrees(store, clones, placements, ids.length === 1 ? 'Duplicate Layer' : 'Duplicate Layers')
  return clones.rootIds
}

/**
 * Merge layers: move all art from the selected layers into the BOTTOM-most
 * of them (the target keeps its name/color), then remove the emptied layers.
 * If fewer than two layers are involved, this is a no-op.
 */
export function cmdMergeLayers(store: EditorStoreApi, layerIds: NodeId[]): NodeId | null {
  const doc = store.getState().document
  const layers = topLevelLayers(doc)
  const order = new Map(layers.map((l, i) => [l.id, i]))
  const targets = layerIds
    .filter((id) => order.has(id))
    .sort((a, b) => order.get(a)! - order.get(b)!)
  if (targets.length < 2) return null
  const targetId = targets[0]! // bottom-most survives (Illustrator merges up-into-bottom)
  const sources = targets.slice(1)
  store.getState().applyCommand(
    'Merge Layers',
    (doc2) => {
      const target = doc2.nodes[targetId] as GroupNode
      const root = doc2.nodes[doc2.root] as GroupNode
      for (const sid of sources) {
        const src = doc2.nodes[sid]
        if (!src || src.type !== 'group') continue
        // Move the source's children onto the target, top of z-order.
        for (const childId of [...src.children]) {
          const child = doc2.nodes[childId]
          if (child) child.parent = target.id
          target.children.push(childId)
        }
        src.children = []
        delete doc2.nodes[sid]
        root.children = root.children.filter((c) => c !== sid)
      }
    },
    { selectAfter: [targetId] },
  )
  store.getState().setActiveLayer(targetId)
  return targetId
}

/**
 * Flatten artwork: collapse every layer's art into the bottom-most layer and
 * remove the rest. Hidden layers are discarded (Illustrator prompts; we drop
 * them, matching "Flatten Artwork" with hidden layers deleted).
 */
export function cmdFlattenArtwork(store: EditorStoreApi): NodeId | null {
  const doc = store.getState().document
  const layers = topLevelLayers(doc)
  if (layers.length === 0) return null
  const targetId = layers[0]!.id
  store.getState().applyCommand(
    'Flatten Artwork',
    (doc2) => {
      const target = doc2.nodes[targetId] as GroupNode
      const root = doc2.nodes[doc2.root] as GroupNode
      for (const layer of topLevelLayers(doc2)) {
        if (layer.id === targetId) continue
        if (layer.hidden) {
          // Drop hidden layers and their subtrees entirely.
          const stack = [layer.id]
          while (stack.length) {
            const cur = stack.pop()!
            const n = doc2.nodes[cur]
            if (!n) continue
            if (n.type === 'group') stack.push(...n.children)
            delete doc2.nodes[cur]
          }
        } else {
          for (const childId of [...layer.children]) {
            const child = doc2.nodes[childId]
            if (child) child.parent = target.id
            target.children.push(childId)
          }
          delete doc2.nodes[layer.id]
        }
      }
      root.children = [targetId]
      const t = doc2.nodes[targetId] as GroupNode
      t.template = undefined
      t.hidden = false
      t.locked = false
    },
    { selectAfter: [] },
  )
  store.getState().setActiveLayer(targetId)
  return targetId
}

export interface LayerOptions {
  name?: string
  layerColor?: string
  hidden?: boolean
  locked?: boolean
  template?: boolean
  /** Dim images to N% (1-100); null clears (100%). */
  dimImages?: number | null
}

/**
 * Apply Layer Options. Template auto-locks + dims to 50% (unless a dim is
 * given) and marks the layer as a non-printing tracing template.
 */
export function cmdSetLayerOptions(store: EditorStoreApi, id: NodeId, opts: LayerOptions): void {
  store.getState().applyCommand('Layer Options', (doc) => {
    const layer = doc.nodes[id]
    if (!layer || layer.type !== 'group') return
    if (opts.name !== undefined && opts.name.trim()) layer.name = opts.name.trim()
    if (opts.layerColor !== undefined) layer.layerColor = opts.layerColor
    if (opts.hidden !== undefined) layer.hidden = opts.hidden
    if (opts.locked !== undefined) layer.locked = opts.locked
    if (opts.dimImages !== undefined) {
      layer.dimImages = opts.dimImages === null ? undefined : opts.dimImages
    }
    if (opts.template !== undefined) {
      layer.template = opts.template || undefined
      if (opts.template) {
        layer.locked = true
        if (layer.dimImages === undefined) layer.dimImages = 50
      }
    }
  })
}

/** Ensure the document is layer-organized (used after structural imports). */
export function cmdNormalizeLayers(store: EditorStoreApi): void {
  const doc = store.getState().document
  const root = doc.nodes[doc.root]
  if (!root || root.type !== 'group') return
  const alreadyLayered =
    root.children.length > 0 && root.children.every((id) => isLayerNode(doc.nodes[id]))
  if (alreadyLayered) return
  store.getState().applyCommand('Organize Layers', (d) => {
    normalizeLayers(d)
  })
}

/**
 * File > New: clear all artwork and start over with a fresh Layer 1. ONE
 * undoable step (so an accidental New is a ⌘Z away from recovery).
 */
export function cmdNewDocument(store: EditorStoreApi): void {
  store.getState().applyCommand(
    'New Document',
    (doc) => {
      const root = doc.nodes[doc.root]
      if (!root || root.type !== 'group') return
      for (const id of [...root.children]) removeNode(doc, id)
      normalizeLayers(doc) // recreates Layer 1
    },
    { selectAfter: [] },
  )
  store.getState().setActiveLayer(null)
}

/** Convenience: the layer that owns a node (for the panel's active-layer sync). */
export function layerIdOf(store: EditorStoreApi, id: NodeId): NodeId | null {
  return layerOfNode(store.getState().document, id)?.id ?? null
}

/** Stable id helper for tests. */
export const freshId = nanoid
