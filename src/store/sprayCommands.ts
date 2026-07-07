/**
 * Symbol Sprayer commands (Shift+S): stamp copies of a "symbol" (a snapshot
 * of selected art) along the spray path into a "Symbol Set" group. The tool
 * wraps a whole drag in one transaction, so every stamp of a spray coalesces
 * into ONE undo step.
 */

import type { Vec2 } from '../geometry/vec2'
import type { NodeId } from '../model/types'
import { addNode, getWorldTransform } from '../model/document'
import { cloneSubtrees, orderedSubtreeRoots } from '../model/clone'
import { createGroupNode } from '../model/nodes'
import { localBBoxOfNode, transformBBox, unionBBox, type BBox } from '../geometry/bbox'
import {
  compose,
  invert,
  multiply,
  rotateMat,
  scaleMat,
  translate,
  type Mat,
} from '../geometry/matrix'
import { resolveInsertionParent, type EditorStoreApi } from './store'

export interface SprayStamp {
  /** Where the stamp's center lands (DOC space). */
  docPoint: Vec2
  /** Random jitter, radians. */
  rotation: number
  /** Random jitter, uniform scale. */
  scale: number
}

/** World-space union bbox of the symbol sources (the stamp centers on it). */
export function symbolBounds(store: EditorStoreApi, sourceIds: NodeId[]): BBox | null {
  const doc = store.getState().document
  let out: BBox | null = null
  for (const id of sourceIds) {
    const node = doc.nodes[id]
    if (!node) continue
    const local = localBBoxOfNode(node, doc.nodes)
    if (!local) continue
    out = unionBBox(out, transformBBox(getWorldTransform(doc.nodes, id), local))
  }
  return out
}

/** Create the (empty) symbol-set group the spray stamps into. */
export function cmdCreateSymbolSet(store: EditorStoreApi): NodeId {
  const group = createGroupNode({ name: 'Symbol Set' })
  const parentId = resolveInsertionParent(store.getState())
  store.getState().applyCommand('Spray Symbols', (draft) => {
    addNode(draft, group, parentId)
  })
  return group.id
}

/**
 * Stamp one sprayed instance: clone the source subtrees and place them so the
 * symbol's center lands on `stamp.docPoint`, jittered by rotation/scale.
 * Returns the clone root ids (empty when the sources vanished).
 */
export function cmdSprayStamp(
  store: EditorStoreApi,
  sourceIds: NodeId[],
  stamp: SprayStamp,
  groupId: NodeId,
): NodeId[] {
  const doc = store.getState().document
  const group = doc.nodes[groupId]
  if (!group || group.type !== 'group') return []
  const roots = orderedSubtreeRoots(doc, sourceIds).filter((id) => doc.nodes[id])
  if (roots.length === 0) return []
  const bounds = symbolBounds(store, roots)
  if (!bounds) return []
  const center: Vec2 = {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
  }

  // J maps the symbol's current world placement onto the stamp: recenter on
  // the symbol center, jitter-rotate/scale, then land on the spray point.
  const jitter: Mat = compose(
    translate(stamp.docPoint.x, stamp.docPoint.y),
    rotateMat(stamp.rotation),
    scaleMat(stamp.scale),
    translate(-center.x, -center.y),
  )
  const groupWorldInv = invert(getWorldTransform(doc.nodes, groupId))

  const clones = cloneSubtrees(doc.nodes, roots)
  for (let i = 0; i < roots.length; i++) {
    const sourceId = roots[i]!
    const clone = clones.nodes.find((n) => n.id === clones.rootIds[i])!
    const sourceWorld = getWorldTransform(doc.nodes, sourceId)
    // clone world = J * source world; clone.transform = inv(world(group)) * that.
    clone.transform = multiply(groupWorldInv, multiply(jitter, sourceWorld))
  }

  store.getState().applyCommand(
    'Spray Symbols',
    (draft) => {
      for (const node of clones.nodes) {
        if (draft.nodes[node.id]) throw new Error(`spray: id collision '${node.id}'`)
        draft.nodes[node.id] = node
      }
      const target = draft.nodes[groupId]
      if (!target || target.type !== 'group') return
      for (const rootId of clones.rootIds) {
        draft.nodes[rootId]!.parent = groupId
        target.children.push(rootId)
      }
    },
    { selectAfter: [groupId] },
  )
  return clones.rootIds
}
