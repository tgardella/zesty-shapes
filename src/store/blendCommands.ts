/**
 * Blend commands (Blend tool, W). A blend is LIVE: the "Blend" group holds
 * only the two endpoints plus a `blend: { steps }` marker; the interpolated
 * steps are DERIVED at render/export time (model/blend.blendStepGeometry),
 * so moving or restyling an endpoint re-blends automatically.
 *
 * - cmdBlend: wrap two objects into a live blend group (ONE undo step; the
 *   endpoints keep their world positions via the reparent bake).
 * - cmdSetBlendSteps: change a live blend's step count.
 * - cmdExpandBlend: bake the derived steps into real PathNodes and drop the
 *   live marker (Object > Expand Blend).
 */

import type { GroupNode, NodeId, PathNode } from '../model/types'
import { addNode, reparent } from '../model/document'
import { createGroupNode, createPathNode } from '../model/nodes'
import { blendStepGeometry } from '../model/blend'
import { collectOperands } from './booleanCommands'
import { rebaseRegions, regionsBBoxMin, regionsToSubPaths } from '../model/booleanOps'
import { translate } from '../geometry/matrix'
import type { EditorStoreApi } from './store'

export const DEFAULT_BLEND_STEPS = 5

/** The selected ids that are LIVE blend groups. */
export function liveBlendIds(store: EditorStoreApi, ids: NodeId[]): NodeId[] {
  const nodes = store.getState().document.nodes
  return ids.filter((id) => {
    const n = nodes[id]
    return n?.type === 'group' && n.blend !== undefined && n.children.length === 2
  })
}

/**
 * Blend `aId` (painted first / bottom) into `bId` (top) with `steps`
 * interpolated objects. Returns the live blend group's id, or null when
 * either side has no usable fill region.
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
  // Both sides need a fill region for the interpolation to mean anything.
  if (collectOperands(doc, [aId]).length === 0 || collectOperands(doc, [bId]).length === 0) {
    return null
  }

  const parentId = b.parent ?? doc.root
  const group = createGroupNode({ name: 'Blend' })
  group.blend = { steps: Math.max(1, Math.round(steps)) }

  store.getState().applyCommand(
    'Blend',
    (draft) => {
      const parent = draft.nodes[parentId] as GroupNode | undefined
      const zIndex = parent ? parent.children.indexOf(bId) : -1
      addNode(draft, group, parentId, zIndex === -1 ? undefined : zIndex)
      // Endpoints keep their world placement (reparent bakes the delta).
      reparent(draft, aId, group.id)
      reparent(draft, bId, group.id)
    },
    { selectAfter: [group.id] },
  )
  return group.id
}

/** Change the step count of the given live blend groups. */
export function cmdSetBlendSteps(store: EditorStoreApi, ids: NodeId[], steps: number): void {
  const targets = liveBlendIds(store, ids)
  const n = Math.max(1, Math.round(steps))
  if (targets.length === 0) return
  const nodes = store.getState().document.nodes
  if (targets.every((id) => (nodes[id] as GroupNode).blend!.steps === n)) return
  store.getState().applyCommand('Blend Steps', (draft) => {
    for (const id of targets) {
      const group = draft.nodes[id]
      if (group?.type === 'group' && group.blend) group.blend = { steps: n }
    }
  })
}

/**
 * Expand live blends: bake the derived steps into real PathNodes between the
 * endpoints and drop the live marker. Returns the baked step ids.
 */
export function cmdExpandBlend(store: EditorStoreApi, ids: NodeId[]): NodeId[] {
  const doc = store.getState().document
  const targets = liveBlendIds(store, ids)
  if (targets.length === 0) return []

  // Bake OUTSIDE the recipe (pure reads), splice inside it.
  const jobs = targets.map((groupId) => {
    const stepNodes: PathNode[] = blendStepGeometry(doc.nodes, groupId).map((step, i) => {
      const origin = regionsBBoxMin(step.regions)
      const node = createPathNode(regionsToSubPaths(rebaseRegions(step.regions, origin)), {
        name: `Step ${i + 1}`,
        transform: translate(origin.x, origin.y),
        style: step.style,
      })
      node.style.fillRule = 'evenodd'
      return node
    })
    return { groupId, stepNodes }
  })

  const created = jobs.flatMap((j) => j.stepNodes.map((n) => n.id))
  store.getState().applyCommand(
    'Expand Blend',
    (draft) => {
      for (const job of jobs) {
        const group = draft.nodes[job.groupId]
        if (group?.type !== 'group' || !group.blend) continue
        delete group.blend
        // Steps paint between the endpoints: insert above child 0.
        job.stepNodes.forEach((step, i) => addNode(draft, step, job.groupId, 1 + i))
      }
    },
    { selectAfter: targets },
  )
  return created
}
