/**
 * Deep-cloning of node subtrees with FRESH ids everywhere — nodes, subpaths,
 * and anchors — used by copy/paste and duplicate. Pure: operates on any
 * id-keyed node record (a live document or a clipboard snapshot) and returns
 * plain-JSON clones ready to insert. Clone roots get parent=null; the insert
 * command assigns their real parent.
 */

import { nanoid } from 'nanoid'
import type { Document, NodeId, SceneNode, SubPath } from './types'

export interface SubtreeClones {
  /** Every cloned node (roots + descendants), internal references rewired. */
  nodes: SceneNode[]
  /** Clone ids corresponding 1:1 (same order) to the requested roots. */
  rootIds: NodeId[]
}

function cloneSubPathsWithNewIds(subpaths: SubPath[]): SubPath[] {
  return subpaths.map((sp) => ({
    ...sp,
    id: nanoid(),
    anchors: sp.anchors.map((a) => ({
      ...a,
      id: nanoid(),
      point: { ...a.point },
      handleIn: a.handleIn ? { ...a.handleIn } : null,
      handleOut: a.handleOut ? { ...a.handleOut } : null,
    })),
  }))
}

/**
 * Clone the subtrees rooted at `rootIds`. Descendants keep their structure;
 * every id is regenerated and parent/children/clip references are remapped.
 * References pointing OUTSIDE the cloned set (e.g. clip to an unrelated node)
 * are dropped rather than left dangling.
 */
export function cloneSubtrees(
  nodes: Record<NodeId, SceneNode>,
  rootIds: NodeId[],
): SubtreeClones {
  // Collect members depth-first so parents precede children.
  const memberIds: NodeId[] = []
  const stack = [...rootIds].reverse()
  const seen = new Set<NodeId>()
  while (stack.length > 0) {
    const id = stack.pop()!
    const node = nodes[id]
    if (!node || seen.has(id)) continue
    seen.add(id)
    memberIds.push(id)
    if (node.type === 'group') {
      for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i]!)
    }
  }

  const idMap = new Map<NodeId, NodeId>()
  for (const id of memberIds) idMap.set(id, nanoid())

  const roots = new Set(rootIds)
  const clones: SceneNode[] = memberIds.map((id) => {
    const source = nodes[id]!
    // Deep plain-JSON copy, then fix identities and references.
    const clone = JSON.parse(JSON.stringify(source)) as SceneNode
    clone.id = idMap.get(id)!
    clone.parent = roots.has(id) ? null : (idMap.get(source.parent!) ?? null)
    if (clone.clip !== undefined) {
      const mapped = idMap.get(clone.clip)
      if (mapped) clone.clip = mapped
      else delete clone.clip
    }
    if (clone.type === 'group') {
      clone.children = clone.children
        .map((childId) => idMap.get(childId))
        .filter((c): c is NodeId => c !== undefined)
    }
    if (clone.type === 'path') {
      clone.subpaths = cloneSubPathsWithNewIds(clone.subpaths)
    }
    return clone
  })

  return {
    nodes: clones,
    rootIds: rootIds.map((id) => idMap.get(id)).filter((c): c is NodeId => c !== undefined),
  }
}

/**
 * Reduce a selection to its top-most subtree roots (drop ids nested under
 * another selected id), ordered by document z-order (paint order).
 */
export function orderedSubtreeRoots(doc: Document, ids: NodeId[]): NodeId[] {
  const wanted = new Set(ids)
  const out: NodeId[] = []
  const visit = (id: NodeId): void => {
    const node = doc.nodes[id]
    if (!node) return
    if (id !== doc.root && wanted.has(id)) {
      out.push(id) // whole subtree comes along; don't descend for more roots
      return
    }
    if (node.type === 'group') for (const childId of node.children) visit(childId)
  }
  visit(doc.root)
  return out
}
