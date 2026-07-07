/**
 * Blend command (Blend tool, W): interpolate between two objects, producing
 * a "Blend" group containing the bottom object, N interpolated steps, and the
 * top object — ONE undo step. Interpolation math lives in model/blend.ts;
 * this file only assembles nodes.
 *
 * Like all boolean-adjacent commands, the heavy geometry runs BEFORE
 * applyCommand on pure reads; the recipe only splices nodes. The originals
 * are PRESERVED (reparented into the blend group with their world positions
 * baked, per the reparent contract).
 */

import type { GroupNode, NodeId, PathNode } from '../model/types'
import type { Regions } from '../geometry/boolean'
import { addNode, reparent } from '../model/document'
import { createGroupNode, createPathNode } from '../model/nodes'
import { interpolateStyle, lerpRing, pairRings } from '../model/blend'
import {
  rebaseRegions,
  regionsBBoxMin,
  regionsToParentSpace,
  regionsToSubPaths,
} from '../model/booleanOps'
import { collectOperands } from './booleanCommands'
import { translate } from '../geometry/matrix'
import type { EditorStoreApi } from './store'

export const DEFAULT_BLEND_STEPS = 5

/**
 * Blend `aId` (painted first / bottom) into `bId` (top) with `steps`
 * intermediate objects. Returns the blend group id, or null when either
 * object has no usable fill region.
 */
export function cmdBlend(
  store: EditorStoreApi,
  aId: NodeId,
  bId: NodeId,
  steps: number = DEFAULT_BLEND_STEPS,
): NodeId | null {
  if (aId === bId) return null
  const doc = store.getState().document
  const a = doc.nodes[aId]
  const b = doc.nodes[bId]
  if (!a || !b) return null
  if ((a.type === 'group' && a.isLayer) || (b.type === 'group' && b.isLayer)) return null

  // Union each side's leaves into one operand (groups blend as a whole).
  const aOps = collectOperands(doc, [aId])
  const bOps = collectOperands(doc, [bId])
  if (aOps.length === 0 || bOps.length === 0) return null
  const aRegions: Regions = aOps.flatMap((o) => o.regions)
  const bRegions: Regions = bOps.flatMap((o) => o.regions)
  const aStyle = aOps[0]!.style
  const bStyle = bOps[bOps.length - 1]!.style

  const pairs = pairRings(aRegions, bRegions)
  if (pairs.length === 0) return null

  const n = Math.max(1, Math.round(steps))
  const parentId = b.parent ?? doc.root

  // Steps in DOC space -> the blend group's coordinate space. The group gets
  // an identity transform under `parentId`, so its children live in
  // `parentId`'s local space — exactly what resultNode-style placement gives.
  const stepNodes: PathNode[] = []
  for (let i = 1; i <= n; i++) {
    const t = i / (n + 1)
    const regions: Regions = pairs.map((pair) => [lerpRing(pair.a, pair.b, t)])
    const local = regionsToParentSpace(doc.nodes, parentId, doc.root, regions)
    const origin = regionsBBoxMin(local)
    const node = createPathNode(regionsToSubPaths(rebaseRegions(local, origin)), {
      name: `Step ${i}`,
      transform: translate(origin.x, origin.y),
      style: interpolateStyle(aStyle, bStyle, t),
    })
    node.style.fillRule = 'evenodd'
    stepNodes.push(node)
  }

  const group = createGroupNode({ name: 'Blend' })
  store.getState().applyCommand(
    'Blend',
    (draft) => {
      const parent = draft.nodes[parentId] as GroupNode | undefined
      const zIndex = parent ? parent.children.indexOf(bId) : -1
      addNode(draft, group, parentId, zIndex === -1 ? undefined : zIndex)
      // Paint order inside the blend: bottom original, steps, top original.
      reparent(draft, aId, group.id) // bakes the world-position delta
      for (const step of stepNodes) addNode(draft, step, group.id)
      reparent(draft, bId, group.id)
    },
    { selectAfter: [group.id] },
  )
  return group.id
}
