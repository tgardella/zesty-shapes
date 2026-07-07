/**
 * Layer helpers. Layers are GroupNodes with `isLayer: true`. The document
 * root holds LAYERS as its direct children; objects and nested sublayers live
 * inside layers (Illustrator's model). These helpers are pure — the store
 * layer wires them into commands and boot/migration.
 */

import type { Document, GroupNode, NodeId, SceneNode } from './types'
import { createDocument } from './document'
import { createGroupNode } from './nodes'

/** Minimal document view the read-only layer helpers need. */
type DocView = Pick<Document, 'nodes' | 'root'>

/** Illustrator-style rotating layer color palette (hex). */
export const LAYER_COLORS: string[] = [
  '#4a90d9', // light blue (Illustrator's default Layer 1)
  '#e0457b', // red-pink
  '#2ea44f', // green
  '#8e44ad', // purple
  '#e67e22', // orange
  '#16a5a5', // teal
  '#d4a017', // gold
  '#c0392b', // red
  '#2c3e50', // dark slate
  '#7f8c8d', // gray
]

export const DEFAULT_LAYER_COLOR = LAYER_COLORS[0]!

/** Next palette color not already used by a layer (cycles when exhausted). */
export function nextLayerColor(used: Iterable<string>): string {
  const set = new Set(used)
  for (const c of LAYER_COLORS) if (!set.has(c)) return c
  return LAYER_COLORS[set.size % LAYER_COLORS.length]!
}

export function isLayerNode(node: SceneNode | undefined): node is GroupNode {
  return !!node && node.type === 'group' && node.isLayer === true
}

/** Root's direct children that are layers, painted order (bottom -> top). */
export function topLevelLayers(doc: DocView): GroupNode[] {
  const root = doc.nodes[doc.root]
  if (!root || root.type !== 'group') return []
  return root.children
    .map((id) => doc.nodes[id])
    .filter((n): n is GroupNode => isLayerNode(n))
}

export function documentHasLayers(doc: DocView): boolean {
  return topLevelLayers(doc).length > 0
}

/**
 * The top-level LAYER a node belongs to (the layer ancestor that is a direct
 * child of the root), or null if the node isn't inside a layer.
 */
export function layerOfNode(doc: DocView, id: NodeId): GroupNode | null {
  let cur = doc.nodes[id]
  let childOfRoot: SceneNode | null = null
  while (cur && cur.parent !== null) {
    if (cur.parent === doc.root) childOfRoot = cur
    cur = doc.nodes[cur.parent]
  }
  return isLayerNode(childOfRoot ?? undefined) ? (childOfRoot as GroupNode) : null
}

/**
 * The NEAREST layer a node belongs to (the node itself if it is a layer, else
 * the closest layer/sublayer ancestor). Objects inherit color + state from
 * their immediate container, so this — not the top-level layer — drives the
 * highlight color and dim/template resolution.
 */
export function nearestLayer(doc: DocView, id: NodeId): GroupNode | null {
  let cur: SceneNode | undefined = doc.nodes[id]
  while (cur) {
    if (isLayerNode(cur)) return cur
    cur = cur.parent === null ? undefined : doc.nodes[cur.parent]
  }
  return null
}

/** Nearest-layer highlight color for a node, or null when it has none. */
export function layerColorOf(doc: DocView, id: NodeId): string | null {
  return nearestLayer(doc, id)?.layerColor ?? null
}

/**
 * Opacity multiplier (0-1) for an IMAGE node from the nearest ancestor layer
 * that specifies a dim: an explicit "Dim Images to N%" wins, else a template
 * layer dims to 50%. Walks up so a sublayer inherits its parent layer's dim.
 */
export function imageDimFactor(doc: DocView, id: NodeId): number {
  let cur: SceneNode | undefined = doc.nodes[id]
  while (cur) {
    if (isLayerNode(cur)) {
      if (typeof cur.dimImages === 'number') return Math.max(0, Math.min(100, cur.dimImages)) / 100
      if (cur.template) return 0.5
    }
    cur = cur.parent === null ? undefined : doc.nodes[cur.parent]
  }
  return 1
}

/** Create a LAYER group (isLayer) with a name and highlight color. */
export function createLayerNode(name: string, color: string): GroupNode {
  const layer = createGroupNode({ name, isLayer: true })
  layer.layerColor = color
  return layer
}

/** A fresh document with a single empty "Layer 1" (the app's boot document). */
export function createInitialDocument(): Document {
  const doc = createDocument()
  return normalizeLayers(doc)
}

/**
 * Ensure the document's root holds only LAYERS. Loose objects at the root
 * (legacy documents, or imports before this feature) are wrapped into a new
 * "Layer 1". Idempotent: a document already organized into layers is
 * untouched. Mutates `doc`. World positions are preserved because layers
 * carry the identity transform and sit at the root.
 */
export function normalizeLayers(doc: Document): Document {
  const root = doc.nodes[doc.root]
  if (!root || root.type !== 'group') return doc
  const loose = root.children.filter((id) => !isLayerNode(doc.nodes[id]))
  if (loose.length === 0 && root.children.length > 0) return doc // already layered

  if (root.children.length === 0) {
    // Empty document: give it an empty default layer.
    const layer = createLayerNode('Layer 1', DEFAULT_LAYER_COLOR)
    layer.parent = doc.root
    doc.nodes[layer.id] = layer
    root.children.push(layer.id)
    return doc
  }

  // Wrap ALL current root children into one new bottom layer, preserving order.
  const layer = createLayerNode('Layer 1', DEFAULT_LAYER_COLOR)
  layer.parent = doc.root
  layer.children = [...root.children]
  for (const id of layer.children) {
    const child = doc.nodes[id]
    if (child) child.parent = layer.id
  }
  doc.nodes[layer.id] = layer
  root.children = [layer.id]
  return doc
}
