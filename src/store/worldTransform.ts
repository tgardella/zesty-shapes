/**
 * Memoized EFFECTIVE (world) transform — the single source of truth for a
 * node's world placement: the product of ALL ancestor group transforms times
 * the node's own transform.
 *
 * Memoization is keyed by the identity of the immutable `nodes` map (Immer
 * produces a new map on any document mutation, so the cache self-invalidates)
 * — pan/zoom never touches the document, so it never invalidates this cache.
 */

import type { Mat } from '../geometry/matrix'
import { invert, multiply } from '../geometry/matrix'
import type { NodeId, SceneNode } from '../model/types'

type NodesMap = Record<NodeId, SceneNode>

const cache = new WeakMap<NodesMap, Map<NodeId, Mat>>()

export function worldTransform(nodes: NodesMap, id: NodeId): Mat {
  let perDoc = cache.get(nodes)
  if (!perDoc) {
    perDoc = new Map()
    cache.set(nodes, perDoc)
  }
  const hit = perDoc.get(id)
  if (hit) return hit
  const node = nodes[id]
  if (!node) throw new Error(`worldTransform: no node '${id}'`)
  const result: Mat =
    node.parent === null
      ? ([...node.transform] as Mat)
      : multiply(worldTransform(nodes, node.parent), node.transform)
  perDoc.set(id, result)
  return result
}

/** world -> local for a node: invert(worldTransform). */
export function worldToLocal(nodes: NodesMap, id: NodeId): Mat {
  return invert(worldTransform(nodes, id))
}
