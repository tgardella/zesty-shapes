/**
 * Clipping masks (Object > Clipping Mask > Make / Release). The topmost
 * selected object becomes the mask: its silhouette clips everything below it
 * inside a group. Implemented through the reserved GroupNode `clip` field —
 * the id of the child used as the clip source. That child is NOT painted as
 * visible art; the renderer and exporter wrap the remaining children in a
 * <clipPath> built from its outline (see NodeView / serialize).
 *
 * Per the POSITIONING RULE nothing here touches shape params or bakes pixels:
 * the mask stays a live, editable object and can be released at any time.
 */

import type { NodeId, SceneNode } from '../model/types'
import { addNode, reparent } from '../model/document'
import { orderedSubtreeRoots } from '../model/clone'
import { createGroupNode } from '../model/nodes'
import type { EditorStoreApi } from './store'

/** Node types whose outline can serve as a clip source (a single silhouette). */
const CLIPPABLE = new Set<SceneNode['type']>(['rect', 'ellipse', 'polygon', 'star', 'line', 'path'])

function isClippable(node: SceneNode | undefined): boolean {
  return node !== undefined && CLIPPABLE.has(node.type)
}

/**
 * Resolve what a "Make Clipping Mask" on `ids` would act on, or null if it is
 * not applicable. Two shapes:
 *  - a single already-existing group whose topmost child is clippable, or
 *  - two or more roots whose topmost is clippable (they get grouped).
 * `maskId` is the clip source; `groupId` is the existing group to reuse (null
 * means a new group must be created around `roots`).
 */
export function resolveClipTarget(
  store: EditorStoreApi,
  ids: NodeId[],
): { roots: NodeId[]; maskId: NodeId; groupId: NodeId | null } | null {
  const doc = store.getState().document
  const roots = orderedSubtreeRoots(doc, ids)
  if (roots.length === 0) return null

  if (roots.length === 1) {
    const only = doc.nodes[roots[0]!]
    if (!only || only.type !== 'group' || only.isLayer || only.clip) return null
    const maskId = only.children[only.children.length - 1]
    if (!maskId || !isClippable(doc.nodes[maskId])) return null
    return { roots, maskId, groupId: only.id }
  }

  const maskId = roots[roots.length - 1]!
  if (!isClippable(doc.nodes[maskId])) return null
  return { roots, maskId, groupId: null }
}

/** True when "Make Clipping Mask" would do something for this selection. */
export function canMakeClipMask(store: EditorStoreApi, ids: NodeId[]): boolean {
  return resolveClipTarget(store, ids) !== null
}

/**
 * Make a clipping mask from the selection. The topmost object becomes the
 * mask; the rest are clipped to it inside a group (an existing single group is
 * reused, otherwise the roots are grouped — world positions preserved). ONE
 * undo step. Returns the group id, or null if not applicable.
 */
export function cmdMakeClipMask(store: EditorStoreApi, ids: NodeId[]): NodeId | null {
  const target = resolveClipTarget(store, ids)
  if (!target) return null
  const { roots, maskId } = target

  if (target.groupId !== null) {
    const groupId = target.groupId
    store.getState().applyCommand(
      'Make Clipping Mask',
      (draft) => {
        const g = draft.nodes[groupId]
        if (g && g.type === 'group') g.clip = maskId
      },
      { selectAfter: [groupId] },
    )
    return groupId
  }

  const group = createGroupNode()
  const topRoot = roots[roots.length - 1]!
  const parentId = store.getState().document.nodes[topRoot]!.parent ?? store.getState().document.root
  store.getState().applyCommand(
    'Make Clipping Mask',
    (draft) => {
      const parent = draft.nodes[parentId]
      const index = parent?.type === 'group' ? parent.children.indexOf(topRoot) : undefined
      addNode(draft, group, parentId, index === -1 ? undefined : index)
      for (const rootId of roots) reparent(draft, rootId, group.id) // bakes deltas
      const g = draft.nodes[group.id]
      if (g && g.type === 'group') g.clip = maskId
    },
    { selectAfter: [group.id] },
  )
  return group.id
}

/** True when "Release Clipping Mask" would do something for this selection. */
export function canReleaseClipMask(store: EditorStoreApi, ids: NodeId[]): boolean {
  const doc = store.getState().document
  return ids.some((id) => {
    const n = doc.nodes[id]
    return n?.type === 'group' && n.clip !== undefined
  })
}

/**
 * Release the clip on every selected clip-group: the mask object becomes
 * ordinary art again (nothing is deleted or moved). ONE undo step. The groups
 * stay selected.
 */
export function cmdReleaseClipMask(store: EditorStoreApi, ids: NodeId[]): void {
  const doc = store.getState().document
  const targets = ids.filter((id) => {
    const n = doc.nodes[id]
    return n?.type === 'group' && n.clip !== undefined
  })
  if (targets.length === 0) return
  store.getState().applyCommand(
    'Release Clipping Mask',
    (draft) => {
      for (const id of targets) {
        const n = draft.nodes[id]
        if (n && n.type === 'group') delete n.clip
      }
    },
    { selectAfter: targets },
  )
}
