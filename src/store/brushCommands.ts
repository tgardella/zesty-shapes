/**
 * Blob Brush command (Shift+B): a drag trail becomes a filled blob (the
 * trail's round stroke outline). Like Illustrator, the blob MERGES with any
 * existing same-colored blob/filled path it touches — painting repeatedly
 * builds up one shape instead of stacking strokes. One drag = one undo step.
 */

import type { Vec2 } from '../geometry/vec2'
import { intersection, union, type Regions } from '../geometry/boolean'
import type { GroupNode, NodeId, PathNode, SolidPaint, Style } from '../model/types'
import { addNode, removeNode } from '../model/document'
import { createPathNode } from '../model/nodes'
import {
  dropSlivers,
  rebaseRegions,
  regionsBBoxMin,
  regionsToParentSpace,
  regionsToSubPaths,
} from '../model/booleanOps'
import { bladeRegions, collectLeaves } from './booleanCommands'
import { translate } from '../geometry/matrix'
import { nodeRegionsInDoc } from '../model/booleanOps'
import { resolveInsertionParent, type EditorStoreApi } from './store'

function sameSolid(a: SolidPaint, b: SolidPaint): boolean {
  return (
    a.color.r === b.color.r &&
    a.color.g === b.color.g &&
    a.color.b === b.color.b &&
    a.color.a === b.color.a
  )
}

/** Build a blob-result PathNode in `parentId`'s space from doc-space regions. */
function blobNode(
  store: EditorStoreApi,
  parentId: NodeId,
  regions: Regions,
  paint: SolidPaint,
): PathNode {
  const doc = store.getState().document
  const local = regionsToParentSpace(doc.nodes, parentId, doc.root, regions)
  const origin = regionsBBoxMin(local)
  const style: Style = {
    fill: { type: 'solid', color: { ...paint.color } },
    stroke: null,
    strokeWidth: 1,
    strokeCap: 'butt',
    strokeJoin: 'round',
    strokeDash: [],
    fillRule: 'evenodd',
  }
  return createPathNode(regionsToSubPaths(rebaseRegions(local, origin)), {
    name: 'Blob',
    transform: translate(origin.x, origin.y),
    style,
  })
}

/**
 * Paint one blob-brush stroke. `paint` is the blob's solid color; existing
 * PATH nodes with the identical solid fill (and no stroke) that the blob
 * touches are unioned into the result — the topmost keeps its z-position,
 * the rest are consumed. Returns the resulting node id (null for a
 * degenerate trail).
 */
export function cmdBlobPaint(
  store: EditorStoreApi,
  trail: Vec2[],
  diameter: number,
  paint: SolidPaint,
): NodeId | null {
  const doc = store.getState().document
  const stroke = trail.length > 1 ? trail : [...trail, { x: (trail[0]?.x ?? 0) + 0.1, y: trail[0]?.y ?? 0 }]
  let blob = bladeRegions(stroke, Math.max(0.5, diameter))
  if (blob.length === 0) return null

  // Same-appearance merge targets the blob actually touches.
  const leaves = collectLeaves(doc, (doc.nodes[doc.root] as GroupNode).children)
  const merged: NodeId[] = []
  for (const id of leaves) {
    const node = doc.nodes[id]!
    if (node.type !== 'path') continue
    if (!node.style.fill || node.style.fill.type !== 'solid') continue
    if (node.style.stroke !== null) continue
    if (!sameSolid(node.style.fill, paint)) continue
    const regions = nodeRegionsInDoc(doc.nodes, id)
    if (dropSlivers(intersection(regions, blob)).length === 0) continue
    blob = union(blob, regions)
    merged.push(id)
  }

  // The topmost merged node's slot keeps the result's z; otherwise new art on top.
  const anchorId = merged.length > 0 ? merged[merged.length - 1]! : null
  const parentId = anchorId
    ? doc.nodes[anchorId]!.parent ?? doc.root
    : resolveInsertionParent(store.getState())
  const result = blobNode(store, parentId, dropSlivers(blob), paint)

  store.getState().applyCommand(
    'Blob Brush',
    (draft) => {
      let index: number | undefined
      if (anchorId && draft.nodes[anchorId]) {
        const parent = draft.nodes[parentId] as GroupNode | undefined
        const at = parent ? parent.children.indexOf(anchorId) : -1
        index = at === -1 ? undefined : at
        for (const id of merged) if (draft.nodes[id]) removeNode(draft, id)
      }
      const parent = draft.nodes[parentId] as GroupNode | undefined
      const count = parent ? parent.children.length : 0
      addNode(draft, result, parentId, index === undefined ? undefined : Math.min(index, count))
    },
    { selectAfter: [result.id] },
  )
  return result.id
}
