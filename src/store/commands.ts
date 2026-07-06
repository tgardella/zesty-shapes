/**
 * Semantic command creators — the ONLY way tools and UI mutate the document.
 * Each wraps store.applyCommand with a labeled recipe built from the pure
 * model helpers (src/model/document.ts). Structural commands set selection
 * alongside the mutation so undo/redo restores it.
 */

import type { GroupNode, NodeId, SceneNode, Style } from '../model/types'
import { addNode, getNode, isAncestorOf, removeNode, reorder, reparent } from '../model/document'
import { cloneSubtrees, orderedSubtreeRoots, type SubtreeClones } from '../model/clone'
import { convertToPath, createGroupNode } from '../model/nodes'
import type { Mat } from '../geometry/matrix'
import { applyToVector, invert } from '../geometry/matrix'
import type { Vec2 } from '../geometry/vec2'
import type { BBox } from '../geometry/bbox'
import { localBBoxOfNode, transformBBox } from '../geometry/bbox'
import type { EditorStoreApi } from './store'
import { worldTransform } from './worldTransform'

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

export function cmdDeleteNodes(store: EditorStoreApi, ids: NodeId[], label?: string): void {
  if (ids.length === 0) return
  store.getState().applyCommand(
    label ?? (ids.length === 1 ? 'Delete' : `Delete ${ids.length} objects`),
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

/**
 * Map a DOCUMENT-space delta into `parentId`'s local space (linear part of
 * the parent's inverse world transform) — the delta to add to a child's
 * transform e,f so it moves by `docDelta` on screen.
 */
export function docDeltaInParentSpace(
  nodes: Record<NodeId, SceneNode>,
  parentId: NodeId | null,
  rootId: NodeId,
  docDelta: Vec2,
): Vec2 {
  if (parentId === null || parentId === rootId) return docDelta
  return applyToVector(invert(worldTransform(nodes, parentId)), docDelta)
}

/**
 * Translate nodes by a DOCUMENT-space delta (nudge, paste offset). Per the
 * POSITIONING RULE only transform e,f change; the delta is mapped into each
 * node's parent space through worldTransform.
 */
export function cmdMoveNodesBy(
  store: EditorStoreApi,
  ids: NodeId[],
  docDelta: Vec2,
  label = 'Move',
): void {
  if (ids.length === 0 || (docDelta.x === 0 && docDelta.y === 0)) return
  store.getState().applyCommand(label, (doc) => {
    for (const id of ids) {
      const node = doc.nodes[id]
      if (!node || node.locked) continue
      const d = docDeltaInParentSpace(doc.nodes, node.parent, doc.root, docDelta)
      node.transform = [
        node.transform[0],
        node.transform[1],
        node.transform[2],
        node.transform[3],
        node.transform[4] + d.x,
        node.transform[5] + d.y,
      ]
    }
  })
}

export interface SubtreePlacement {
  parentId: NodeId
  /** Insertion index in the parent's children; omitted = append (top). */
  index?: number
}

/**
 * Insert pre-built subtree clones (from cloneSubtrees). Non-root members
 * arrive fully wired; each root gets its placement's parent. The clones
 * become the selection (restored on redo).
 */
export function cmdInsertSubtrees(
  store: EditorStoreApi,
  clones: SubtreeClones,
  placements: Record<NodeId, SubtreePlacement>,
  label: string,
): void {
  if (clones.rootIds.length === 0) return
  store.getState().applyCommand(
    label,
    (doc) => {
      for (const node of clones.nodes) {
        if (doc.nodes[node.id]) throw new Error(`insertSubtrees: id collision '${node.id}'`)
        doc.nodes[node.id] = node
      }
      const rootSet = new Set(clones.rootIds)
      for (const rootId of clones.rootIds) {
        const placement = placements[rootId]
        if (!placement) throw new Error(`insertSubtrees: missing placement for '${rootId}'`)
        const parent = doc.nodes[placement.parentId]
        if (!parent || parent.type !== 'group') {
          throw new Error(`insertSubtrees: parent '${placement.parentId}' is not a group`)
        }
        const node = doc.nodes[rootId]!
        node.parent = placement.parentId
        const i =
          placement.index === undefined
            ? parent.children.length
            : Math.max(0, Math.min(parent.children.length, placement.index))
        parent.children.splice(i, 0, rootId)
        rootSet.delete(rootId)
      }
    },
    { selectAfter: clones.rootIds },
  )
}

export interface DuplicateOptions {
  /** DOCUMENT-space offset applied to the duplicates (e.g. paste nudge). */
  offset?: Vec2
  label?: string
}

/**
 * Duplicate the given selection: each duplicate lands in the SAME parent as
 * its source, immediately above it in z-order, and becomes the selection.
 * ONE undoable command. Returns the new subtree-root ids (in z-order).
 */
export function cmdDuplicateNodes(
  store: EditorStoreApi,
  ids: NodeId[],
  opts: DuplicateOptions = {},
): NodeId[] {
  const doc = store.getState().document
  const sourceRoots = orderedSubtreeRoots(doc, ids)
  if (sourceRoots.length === 0) return []
  const clones = cloneSubtrees(doc.nodes, sourceRoots)

  const placements: Record<NodeId, SubtreePlacement> = {}
  for (let i = 0; i < sourceRoots.length; i++) {
    const sourceId = sourceRoots[i]!
    const cloneId = clones.rootIds[i]!
    const source = doc.nodes[sourceId]!
    const parentId = source.parent ?? doc.root
    const parent = doc.nodes[parentId]
    const sourceIndex = parent?.type === 'group' ? parent.children.indexOf(sourceId) : -1
    placements[cloneId] = {
      parentId,
      index: sourceIndex === -1 ? undefined : sourceIndex + 1,
    }
    if (opts.offset) {
      const clone = clones.nodes.find((n) => n.id === cloneId)!
      const d = docDeltaInParentSpace(doc.nodes, source.parent, doc.root, opts.offset)
      clone.transform = [
        clone.transform[0],
        clone.transform[1],
        clone.transform[2],
        clone.transform[3],
        clone.transform[4] + d.x,
        clone.transform[5] + d.y,
      ]
    }
  }

  cmdInsertSubtrees(store, clones, placements, opts.label ?? 'Duplicate')
  return clones.rootIds
}

/**
 * Expand a selection to the nodes whose style should actually change:
 * groups recurse into their (unlocked, visible) leaf descendants — styling a
 * group means styling everything in it, like Illustrator.
 */
export function stylableLeafIds(
  nodes: Record<NodeId, SceneNode>,
  ids: NodeId[],
  rootId: NodeId,
): NodeId[] {
  const out: NodeId[] = []
  const seen = new Set<NodeId>()
  const visit = (id: NodeId): void => {
    if (seen.has(id)) return
    seen.add(id)
    const node = nodes[id]
    if (!node || node.locked || node.hidden || id === rootId) return
    if (node.type === 'group') {
      for (const childId of node.children) visit(childId)
      return
    }
    out.push(id)
  }
  for (const id of ids) visit(id)
  return out
}

/**
 * Mutate the style of every stylable leaf under `ids` (groups recurse) as one
 * undoable command. The mutation runs per-node so paint objects are never
 * shared between nodes.
 */
export function cmdSetStyle(
  store: EditorStoreApi,
  ids: NodeId[],
  label: string,
  mutate: (style: Style, node: SceneNode) => void,
): void {
  const state = store.getState()
  const targets = stylableLeafIds(state.document.nodes, ids, state.document.root)
  if (targets.length === 0) return
  state.applyCommand(label, (doc) => {
    for (const id of targets) {
      const node = doc.nodes[id]
      if (node) mutate(node.style, node)
    }
  })
}

/** Swap fill and stroke PAINTS (widths/caps stay put), per Illustrator. */
export function cmdSwapFillStroke(store: EditorStoreApi, ids: NodeId[]): void {
  cmdSetStyle(store, ids, 'Swap Fill & Stroke', (style) => {
    const fill = style.fill
    style.fill = style.stroke
    style.stroke = fill
  })
}

/** Sampled appearance carried by the Eyedropper (deep-cloned on both ends). */
export interface Appearance {
  style: Style
  opacity: number
  blendMode: SceneNode['blendMode']
}

export function sampleAppearance(node: SceneNode): Appearance {
  return JSON.parse(
    JSON.stringify({ style: node.style, opacity: node.opacity, blendMode: node.blendMode }),
  ) as Appearance
}

/** Apply a sampled appearance to every stylable leaf under `ids` (one undo step). */
export function cmdApplyAppearance(
  store: EditorStoreApi,
  ids: NodeId[],
  appearance: Appearance,
  label = 'Eyedropper',
): void {
  const state = store.getState()
  const targets = stylableLeafIds(state.document.nodes, ids, state.document.root)
  if (targets.length === 0) return
  state.applyCommand(label, (doc) => {
    for (const id of targets) {
      const node = doc.nodes[id]
      if (!node) continue
      node.style = JSON.parse(JSON.stringify(appearance.style)) as Style
      node.opacity = appearance.opacity
      node.blendMode = appearance.blendMode
    }
  })
}

/** Node opacity (the BaseNode field, not paint alpha). Applies to groups as-is. */
export function cmdSetOpacity(store: EditorStoreApi, ids: NodeId[], opacity: number): void {
  if (ids.length === 0) return
  const value = Math.min(1, Math.max(0, opacity))
  store.getState().applyCommand('Opacity', (doc) => {
    for (const id of ids) {
      const node = doc.nodes[id]
      if (node && id !== doc.root) node.opacity = value
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

// ---------------------------------------------------------------------------
// Group / ungroup (world positions PRESERVED via the reparent contract)
// ---------------------------------------------------------------------------

/**
 * Group the selection's top-most roots into a new GroupNode. The group lands
 * in the topmost root's parent at that root's z-position; members keep their
 * relative z-order AND their exact world placement (reparent bakes the
 * transform delta). Returns the group id, or null for an empty selection.
 */
export function cmdGroupNodes(store: EditorStoreApi, ids: NodeId[]): NodeId | null {
  const doc = store.getState().document
  const roots = orderedSubtreeRoots(doc, ids)
  if (roots.length === 0) return null
  const group = createGroupNode()
  const topRoot = roots[roots.length - 1]!
  const parentId = doc.nodes[topRoot]!.parent ?? doc.root
  store.getState().applyCommand(
    'Group',
    (draft) => {
      const parent = draft.nodes[parentId]
      const index =
        parent?.type === 'group' ? parent.children.indexOf(topRoot) : undefined
      addNode(draft, group, parentId, index === -1 ? undefined : index)
      for (const rootId of roots) reparent(draft, rootId, group.id) // bakes deltas
    },
    { selectAfter: [group.id] },
  )
  return group.id
}

/**
 * Ungroup every selected group: each group's transform is pushed down into
 * its children (via reparent's world-preserving bake), the children take the
 * group's z-position in order, and the empty group is removed. NOTHING moves
 * on screen. Non-group ids pass through untouched and stay selected.
 */
export function cmdUngroupNodes(store: EditorStoreApi, ids: NodeId[]): NodeId[] {
  const doc = store.getState().document
  const groups = orderedSubtreeRoots(doc, ids).filter(
    (id) => doc.nodes[id]?.type === 'group' && id !== doc.root,
  )
  if (groups.length === 0) return []
  const kept = ids.filter((id) => !groups.includes(id))
  // Compute the released ids upfront (selectAfter must be known before the recipe runs).
  const released: NodeId[] = groups.flatMap((groupId) => {
    const group = doc.nodes[groupId]
    return group?.type === 'group' ? group.children : []
  })
  store.getState().applyCommand(
    'Ungroup',
    (draft) => {
      for (const groupId of groups) {
        const group = draft.nodes[groupId] as GroupNode
        const parentId = group.parent ?? draft.root
        const parent = draft.nodes[parentId] as GroupNode
        const baseIndex = parent.children.indexOf(groupId)
        const children = [...group.children]
        children.forEach((childId, i) => {
          reparent(draft, childId, parentId, baseIndex + i) // bakes group transform
        })
        removeNode(draft, groupId)
      }
    },
    { selectAfter: [...kept, ...released] },
  )
  return released
}

// ---------------------------------------------------------------------------
// Align & distribute (relative to the selection's union world bbox)
// ---------------------------------------------------------------------------

export type AlignMode = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom'

const ALIGN_LABEL: Record<AlignMode, string> = {
  left: 'Align Left',
  hcenter: 'Align Horizontal Center',
  right: 'Align Right',
  top: 'Align Top',
  vcenter: 'Align Vertical Center',
  bottom: 'Align Bottom',
}

function worldBBoxOf(doc: { nodes: Record<NodeId, SceneNode> }, id: NodeId): BBox | null {
  const node = doc.nodes[id]
  if (!node) return null
  const local = localBBoxOfNode(node, doc.nodes)
  return local ? transformBBox(worldTransform(doc.nodes, id), local) : null
}

/** Align ≥2 nodes to the selection bounds. ONE undo entry, translation only. */
export function cmdAlignNodes(store: EditorStoreApi, ids: NodeId[], mode: AlignMode): void {
  const doc = store.getState().document
  const roots = orderedSubtreeRoots(doc, ids)
  const boxes = new Map<NodeId, BBox>()
  let union: BBox | null = null
  for (const id of roots) {
    const b = worldBBoxOf(doc, id)
    if (b) {
      boxes.set(id, b)
      union = union
        ? {
            minX: Math.min(union.minX, b.minX),
            minY: Math.min(union.minY, b.minY),
            maxX: Math.max(union.maxX, b.maxX),
            maxY: Math.max(union.maxY, b.maxY),
          }
        : b
    }
  }
  if (!union || boxes.size < 2) return
  const u = union
  store.getState().applyCommand(ALIGN_LABEL[mode], (draft) => {
    for (const [id, b] of boxes) {
      let dx = 0
      let dy = 0
      if (mode === 'left') dx = u.minX - b.minX
      else if (mode === 'hcenter') dx = (u.minX + u.maxX) / 2 - (b.minX + b.maxX) / 2
      else if (mode === 'right') dx = u.maxX - b.maxX
      else if (mode === 'top') dy = u.minY - b.minY
      else if (mode === 'vcenter') dy = (u.minY + u.maxY) / 2 - (b.minY + b.maxY) / 2
      else dy = u.maxY - b.maxY
      const node = draft.nodes[id]
      if (!node || node.locked || (dx === 0 && dy === 0)) continue
      const d = docDeltaInParentSpace(draft.nodes, node.parent, draft.root, { x: dx, y: dy })
      node.transform = [
        node.transform[0],
        node.transform[1],
        node.transform[2],
        node.transform[3],
        node.transform[4] + d.x,
        node.transform[5] + d.y,
      ]
    }
  })
}

/** Distribute ≥3 nodes so their world-bbox centers are evenly spaced. */
export function cmdDistributeNodes(store: EditorStoreApi, ids: NodeId[], axis: 'h' | 'v'): void {
  const doc = store.getState().document
  const roots = orderedSubtreeRoots(doc, ids)
  const items: Array<{ id: NodeId; center: number }> = []
  for (const id of roots) {
    const b = worldBBoxOf(doc, id)
    if (b) {
      items.push({
        id,
        center: axis === 'h' ? (b.minX + b.maxX) / 2 : (b.minY + b.maxY) / 2,
      })
    }
  }
  if (items.length < 3) return
  items.sort((a, b) => a.center - b.center)
  const first = items[0]!.center
  const last = items[items.length - 1]!.center
  const step = (last - first) / (items.length - 1)
  store.getState().applyCommand(
    axis === 'h' ? 'Distribute Horizontally' : 'Distribute Vertically',
    (draft) => {
      items.forEach(({ id, center }, i) => {
        const target = first + step * i
        const delta = target - center
        const node = draft.nodes[id]
        if (!node || node.locked || delta === 0) return
        const d = docDeltaInParentSpace(
          draft.nodes,
          node.parent,
          draft.root,
          axis === 'h' ? { x: delta, y: 0 } : { x: 0, y: delta },
        )
        node.transform = [
          node.transform[0],
          node.transform[1],
          node.transform[2],
          node.transform[3],
          node.transform[4] + d.x,
          node.transform[5] + d.y,
        ]
      })
    },
  )
}

// ---------------------------------------------------------------------------
// Layers-panel operations
// ---------------------------------------------------------------------------

/**
 * Panel drag-drop placement, in PANEL semantics (panel lists top-most first;
 * the children array is bottom -> top): 'above'/'below' are visual positions
 * relative to `refId`; 'inside' drops on top of a group's stack. Uses
 * reparent, so world positions are preserved. No-ops on cycles.
 */
export function cmdPlaceNode(
  store: EditorStoreApi,
  dragId: NodeId,
  refId: NodeId,
  position: 'above' | 'below' | 'inside',
): void {
  const doc = store.getState().document
  if (dragId === refId) return
  const drag = doc.nodes[dragId]
  const ref = doc.nodes[refId]
  if (!drag || !ref || dragId === doc.root) return
  if (isAncestorOf(doc, dragId, refId)) return // would create a cycle

  if (position === 'inside') {
    if (ref.type !== 'group') return
    cmdReparent(store, dragId, refId) // append = top of the group's stack
    return
  }
  const parentId = ref.parent ?? doc.root
  const parent = doc.nodes[parentId]
  if (!parent || parent.type !== 'group') return
  const without = parent.children.filter((id) => id !== dragId)
  const refIndex = without.indexOf(refId)
  if (refIndex === -1) return
  // 'above' (visually) = later in the children array (painted after).
  const index = position === 'above' ? refIndex + 1 : refIndex
  store.getState().applyCommand('Reorder', (draft) => reparent(draft, dragId, parentId, index))
}

// ---------------------------------------------------------------------------
// Path editing
// ---------------------------------------------------------------------------

/**
 * "Convert to Path": replace parametric shapes with editable PathNodes IN
 * PLACE — same id, same transform, same tree position (the model contract).
 * Groups/text/paths pass through untouched. Returns the ids converted.
 */
export function cmdConvertToPath(store: EditorStoreApi, ids: NodeId[]): NodeId[] {
  const doc = store.getState().document
  const convertible = ids.filter((id) => {
    const n = doc.nodes[id]
    return (
      n !== undefined &&
      !n.locked &&
      (n.type === 'rect' ||
        n.type === 'ellipse' ||
        n.type === 'polygon' ||
        n.type === 'star' ||
        n.type === 'line')
    )
  })
  if (convertible.length === 0) return []
  store.getState().applyCommand('Convert to Path', (draft) => {
    for (const id of convertible) {
      const node = draft.nodes[id]
      if (!node || node.type === 'group' || node.type === 'text' || node.type === 'path') continue
      // Snapshot to plain JSON first — convertToPath must not carry draft
      // references from the node being replaced into its replacement.
      const plain = JSON.parse(JSON.stringify(node)) as typeof node
      draft.nodes[id] = convertToPath(plain)
    }
  })
  return convertible
}

/**
 * Delete anchors from a PathNode. Subpaths left with fewer than 2 anchors are
 * dropped; a node left with no subpaths is deleted entirely. ONE undo entry.
 */
export function cmdDeleteAnchors(
  store: EditorStoreApi,
  nodeId: NodeId,
  anchorIds: string[],
): void {
  if (anchorIds.length === 0) return
  const doc = store.getState().document
  const node = doc.nodes[nodeId]
  if (!node || node.type !== 'path') return
  const doomed = new Set(anchorIds)
  // Does the whole node evaporate? Compute upfront for selection handling.
  const survivingSubpaths = node.subpaths.filter(
    (sp) => sp.anchors.filter((a) => !doomed.has(a.id)).length >= 2,
  ).length
  if (survivingSubpaths === 0) {
    cmdDeleteNodes(store, [nodeId], 'Delete Anchors')
    return
  }
  store.getState().applyCommand('Delete Anchors', (draft) => {
    const n = draft.nodes[nodeId]
    if (!n || n.type !== 'path') return
    for (const sp of n.subpaths) {
      sp.anchors = sp.anchors.filter((a) => !doomed.has(a.id))
    }
    n.subpaths = n.subpaths.filter((sp) => sp.anchors.length >= 2)
  })
}

export function cmdSetNodeHidden(store: EditorStoreApi, id: NodeId, hidden: boolean): void {
  store.getState().applyCommand(hidden ? 'Hide' : 'Show', (doc) => {
    getNode(doc, id).hidden = hidden
  })
}

export function cmdSetNodeLocked(store: EditorStoreApi, id: NodeId, locked: boolean): void {
  store.getState().applyCommand(locked ? 'Lock' : 'Unlock', (doc) => {
    getNode(doc, id).locked = locked
  })
}

export function cmdRenameNode(store: EditorStoreApi, id: NodeId, name: string): void {
  const trimmed = name.trim()
  if (trimmed.length === 0) return
  store.getState().applyCommand('Rename', (doc) => {
    getNode(doc, id).name = trimmed
  })
}
