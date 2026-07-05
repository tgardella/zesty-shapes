/**
 * Document factory + pure CRUD helpers.
 *
 * All helpers MUTATE the document they are given and are designed to run
 * inside an Immer `produce` (the store layer, phase 0b) — but they work on
 * plain objects too (tests). They never touch global state.
 *
 * CONTRACTS:
 * - `parent` and `children` stay in sync atomically: every insertion/removal
 *   updates both sides in the same call.
 * - `reparent` PRESERVES the node's world position by baking the transform
 *   delta between the old and new parent into the node's transform.
 */

import { nanoid } from 'nanoid'
import type { Mat } from '../geometry/matrix'
import { identity, invert, multiply } from '../geometry/matrix'
import type { Artboard, Document, GroupNode, NodeId, SceneNode } from './types'
import { createGroupNode } from './nodes'

export const DEFAULT_ARTBOARD_SIZE = { w: 1024, h: 768 }

export function createArtboard(overrides: Partial<Artboard> = {}): Artboard {
  return {
    id: overrides.id ?? nanoid(),
    name: overrides.name ?? 'Artboard 1',
    x: overrides.x ?? 0,
    y: overrides.y ?? 0,
    w: overrides.w ?? DEFAULT_ARTBOARD_SIZE.w,
    h: overrides.h ?? DEFAULT_ARTBOARD_SIZE.h,
  }
}

export function createDocument(overrides: { id?: string; name?: string } = {}): Document {
  const root = createGroupNode({ name: 'Root' })
  return {
    version: 1,
    id: overrides.id ?? nanoid(),
    name: overrides.name ?? 'Untitled',
    nodes: { [root.id]: root },
    root: root.id,
    artboards: [createArtboard()],
  }
}

export function getNode(doc: Document, id: NodeId): SceneNode {
  const node = doc.nodes[id]
  if (!node) throw new Error(`document: no node '${id}'`)
  return node
}

export function getGroup(doc: Document, id: NodeId): GroupNode {
  const node = getNode(doc, id)
  if (node.type !== 'group') throw new Error(`document: node '${id}' is not a group`)
  return node
}

export function isAncestorOf(doc: Document, maybeAncestor: NodeId, id: NodeId): boolean {
  let cur = doc.nodes[id]?.parent ?? null
  while (cur !== null) {
    if (cur === maybeAncestor) return true
    cur = doc.nodes[cur]?.parent ?? null
  }
  return false
}

/**
 * EFFECTIVE (world) transform: the product of ALL ancestor group transforms
 * times the node's own transform — the single source of truth for a node's
 * world placement. (The store layer adds a memoized wrapper in 0b; this is
 * the pure computation.)
 */
export function getWorldTransform(nodes: Record<NodeId, SceneNode>, id: NodeId): Mat {
  let out = identity()
  let cur: NodeId | null = id
  while (cur !== null) {
    const node: SceneNode | undefined = nodes[cur]
    if (!node) throw new Error(`document: no node '${cur}' while walking ancestors`)
    out = multiply(node.transform, out)
    cur = node.parent
  }
  return out
}

/**
 * Insert `node` under `parentId` (default: document root) at `index`
 * (default: end = top of z-order). Sets node.parent atomically.
 */
export function addNode(doc: Document, node: SceneNode, parentId?: NodeId, index?: number): void {
  const pid = parentId ?? doc.root
  const parent = getGroup(doc, pid)
  if (doc.nodes[node.id]) throw new Error(`document: node '${node.id}' already exists`)
  doc.nodes[node.id] = node
  node.parent = pid
  const i = index === undefined ? parent.children.length : clampIndex(index, parent.children.length)
  parent.children.splice(i, 0, node.id)
}

/**
 * Remove a node and its entire subtree. Returns the removed ids
 * (depth-first, the requested node first).
 */
export function removeNode(doc: Document, id: NodeId): NodeId[] {
  const node = getNode(doc, id)
  if (id === doc.root) throw new Error('document: cannot remove the root node')
  if (node.parent !== null) {
    const parent = getGroup(doc, node.parent)
    const i = parent.children.indexOf(id)
    if (i !== -1) parent.children.splice(i, 1)
  }
  const removed: NodeId[] = []
  const stack: NodeId[] = [id]
  while (stack.length > 0) {
    const cur = stack.pop()!
    const n = doc.nodes[cur]
    if (!n) continue
    removed.push(cur)
    if (n.type === 'group') stack.push(...n.children)
    delete doc.nodes[cur]
  }
  return removed
}

/**
 * Apply a focused mutation to one node. The updater mutates the node in
 * place (Immer-draft-friendly); tree fields (parent) must not be edited here —
 * use reparent/reorder for structure.
 */
export function updateNode(doc: Document, id: NodeId, updater: (node: SceneNode) => void): void {
  updater(getNode(doc, id))
}

/**
 * Move `id` under `newParentId` at `index` (default: end). PRESERVES the
 * node's world position: newLocal = inverse(world(newParent)) * world(node).
 */
export function reparent(doc: Document, id: NodeId, newParentId: NodeId, index?: number): void {
  const node = getNode(doc, id)
  if (id === doc.root) throw new Error('document: cannot reparent the root node')
  if (id === newParentId || isAncestorOf(doc, id, newParentId)) {
    throw new Error('document: reparent would create a cycle')
  }
  const newParent = getGroup(doc, newParentId)

  // Bake the transform delta BEFORE relinking so world positions are computed
  // against the current tree.
  const worldOfNode = getWorldTransform(doc.nodes, id)
  const worldOfNewParent = getWorldTransform(doc.nodes, newParentId)
  node.transform = multiply(invert(worldOfNewParent), worldOfNode)

  if (node.parent !== null) {
    const oldParent = getGroup(doc, node.parent)
    const i = oldParent.children.indexOf(id)
    if (i !== -1) oldParent.children.splice(i, 1)
  }
  node.parent = newParentId
  const i = index === undefined ? newParent.children.length : clampIndex(index, newParent.children.length)
  newParent.children.splice(i, 0, id)
}

/** Move `id` to `newIndex` within its current parent (z-order change only). */
export function reorder(doc: Document, id: NodeId, newIndex: number): void {
  const node = getNode(doc, id)
  if (node.parent === null) throw new Error('document: cannot reorder the root node')
  const parent = getGroup(doc, node.parent)
  const from = parent.children.indexOf(id)
  if (from === -1) throw new Error(`document: '${id}' missing from its parent's children`)
  parent.children.splice(from, 1)
  parent.children.splice(clampIndex(newIndex, parent.children.length), 0, id)
}

function clampIndex(i: number, len: number): number {
  return Math.max(0, Math.min(len, i))
}

/** Depth-first traversal from `startId` (default root), parents before children. */
export function* walk(doc: Document, startId?: NodeId): Generator<SceneNode> {
  const start = startId ?? doc.root
  const stack: NodeId[] = [start]
  while (stack.length > 0) {
    const id = stack.pop()!
    const node = doc.nodes[id]
    if (!node) continue
    yield node
    if (node.type === 'group') {
      // Push in reverse so children yield in z-order.
      for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i]!)
    }
  }
}
