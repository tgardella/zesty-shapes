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

import type { GroupNode, NodeId, PathNode, SubPath } from '../model/types'
import type { Vec2 } from '../geometry/vec2'
import { addNode, getWorldTransform, removeNode, reparent } from '../model/document'
import { createGroupNode, createPathNode, toSubPaths } from '../model/nodes'
import { blendStepGeometry } from '../model/blend'
import { collectOperands } from './booleanCommands'
import { rebaseRegions, regionsBBoxMin, regionsToSubPaths } from '../model/booleanOps'
import { applyToPoint, invert, translate } from '../geometry/matrix'
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

/**
 * Release live blends back to their two original endpoints: the derived steps
 * (never real nodes) simply vanish, the endpoints reparent to the group's
 * parent keeping their world placement, and the empty blend group is removed.
 * Returns the surviving endpoint ids.
 */
export function cmdReleaseBlend(store: EditorStoreApi, ids: NodeId[]): NodeId[] {
  const doc = store.getState().document
  const targets = liveBlendIds(store, ids)
  if (targets.length === 0) return []

  const survivors: NodeId[] = []
  const jobs = targets.map((groupId) => {
    const group = doc.nodes[groupId] as GroupNode
    const parentId = group.parent ?? doc.root
    const children = [...group.children]
    survivors.push(...children)
    return { groupId, parentId, children }
  })

  store.getState().applyCommand(
    'Release Blend',
    (draft) => {
      for (const job of jobs) {
        const group = draft.nodes[job.groupId]
        if (group?.type !== 'group') continue
        const parent = draft.nodes[job.parentId] as GroupNode | undefined
        const at = parent ? parent.children.indexOf(job.groupId) : -1
        // Endpoints keep their world placement (reparent bakes the delta).
        job.children.forEach((childId, i) =>
          reparent(draft, childId, job.parentId, at === -1 ? undefined : at + i),
        )
        removeNode(draft, job.groupId)
      }
    },
    { selectAfter: survivors },
  )
  return survivors
}

/**
 * Set (or clear, with null) the spine control points of the given live blends.
 * `controls` are in each group's LOCAL space; passing null drops back to the
 * default straight spine. Used by interactive spine editing and Reset Spine.
 */
export function cmdSetBlendSpine(
  store: EditorStoreApi,
  ids: NodeId[],
  controls: Vec2[] | null,
): void {
  const targets = liveBlendIds(store, ids)
  if (targets.length === 0) return
  store.getState().applyCommand('Edit Blend Spine', (draft) => {
    for (const id of targets) {
      const group = draft.nodes[id]
      if (group?.type !== 'group' || !group.blend) continue
      if (controls && controls.length >= 2) {
        group.blend = { ...group.blend, spine: controls.map((p) => ({ x: p.x, y: p.y })) }
      } else {
        const { spine: _drop, ...rest } = group.blend
        group.blend = rest
      }
    }
  })
}

/** Sample a subpath's anchor points as spine control points (local to the path). */
function subpathControls(subpaths: SubPath[]): Vec2[] {
  const sp = subpaths.find((s) => s.anchors.length >= 2)
  if (!sp) return []
  return sp.anchors.map((a) => ({ ...a.point }))
}

/**
 * Replace a live blend's spine with a selected path/shape's outline (Object >
 * Blend > Replace Spine). `blendId` is the live blend group; `pathId` is any
 * node with outline geometry. The path's anchors map into the blend group's
 * local space. Returns true when a spine was applied.
 */
export function cmdReplaceSpine(
  store: EditorStoreApi,
  blendId: NodeId,
  pathId: NodeId,
): boolean {
  const [target] = liveBlendIds(store, [blendId])
  if (!target) return false
  const doc = store.getState().document
  const path = doc.nodes[pathId]
  if (!path || path.type === 'group' || path.type === 'text' || path.type === 'image') return false
  const controlsLocalToPath = subpathControls(toSubPaths(path))
  if (controlsLocalToPath.length < 2) return false
  // path-local -> world -> blend-group-local.
  const pathWorld = getWorldTransform(doc.nodes, pathId)
  const toGroupLocal = invert(getWorldTransform(doc.nodes, target))
  const controls = controlsLocalToPath.map((p) =>
    applyToPoint(toGroupLocal, applyToPoint(pathWorld, p)),
  )
  cmdSetBlendSpine(store, [target], controls)
  return true
}
