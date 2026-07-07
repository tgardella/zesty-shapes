/**
 * Import insertion: one undoable 'Import' command that adds a parsed node
 * forest to the document root, grouped when multiple roots arrived, and
 * centered on the active artboard (content keeps its internal layout — only
 * the root placement transform moves, per the POSITIONING RULE).
 */

import type { BBox } from '../geometry/bbox'
import { localBBoxOfNode, transformBBox, unionBBox } from '../geometry/bbox'
import { bboxCenter } from '../geometry/bbox'
import { multiply, translate } from '../geometry/matrix'
import type { Mat } from '../geometry/matrix'
import { createGroupNode } from '../model/nodes'
import type { GroupNode, NodeId, SceneNode } from '../model/types'
import type { EditorStoreApi } from './store'

/** World bounds of the forest before insertion (its own space = doc space). */
function forestBounds(nodes: SceneNode[], roots: string[]): BBox | null {
  const map: Record<NodeId, SceneNode> = {}
  for (const n of nodes) map[n.id] = n
  let out: BBox | null = null
  for (const id of roots) {
    const node = map[id]
    if (!node) continue
    const local = localBBoxOfNode(node, map)
    if (local) out = unionBBox(out, transformBBox(node.transform, local))
  }
  return out
}

export interface InsertImportOptions {
  /** Doc-space point to center the imported content on (default: keep as-is). */
  centerOn?: { x: number; y: number }
  label?: string
  groupName?: string
}

/**
 * Insert an imported forest (from svgImport or an image factory). Returns the
 * inserted top-level id(s) — a wrapper group id when there were multiple roots.
 */
export function cmdInsertImportedNodes(
  store: EditorStoreApi,
  nodes: SceneNode[],
  roots: string[],
  opts: InsertImportOptions = {},
): NodeId[] {
  if (roots.length === 0) return []
  const label = opts.label ?? 'Import'

  // Optional recentering delta, applied to the ROOT transforms only.
  let delta: Mat | null = null
  if (opts.centerOn) {
    const bounds = forestBounds(nodes, roots)
    if (bounds) {
      const c = bboxCenter(bounds)
      delta = translate(opts.centerOn.x - c.x, opts.centerOn.y - c.y)
    }
  }

  // Multiple roots arrive wrapped in one group for easy manipulation.
  let wrapper: GroupNode | null = null
  if (roots.length > 1) {
    wrapper = createGroupNode({ name: opts.groupName ?? 'Imported' })
  }
  const topIds = wrapper ? [wrapper.id] : [...roots]

  store.getState().applyCommand(
    label,
    (doc) => {
      const rootGroup = doc.nodes[doc.root] as GroupNode
      for (const node of nodes) {
        doc.nodes[node.id] = node
      }
      if (wrapper) {
        if (delta) wrapper.transform = multiply(delta, wrapper.transform)
        wrapper.children = [...roots]
        wrapper.parent = doc.root
        doc.nodes[wrapper.id] = wrapper
        for (const id of roots) {
          const n = doc.nodes[id]
          if (n) n.parent = wrapper.id
        }
        rootGroup.children.push(wrapper.id)
      } else {
        for (const id of roots) {
          const n = doc.nodes[id]
          if (!n) continue
          if (delta) n.transform = multiply(delta, n.transform)
          n.parent = doc.root
          rootGroup.children.push(id)
        }
      }
    },
    { selectAfter: topIds },
  )
  return topIds
}
