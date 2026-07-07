/**
 * Symbolism adjuster commands (Shifter / Scruncher / Sizer / Stainer). These
 * brush over the INSTANCES of a symbol set (a group's direct children) within
 * a radius, nudging their placement or tinting their fills. Each adjuster tool
 * wraps a whole drag in one 'Symbolism' transaction, so every affected event
 * coalesces into ONE undo step (mirrors the Symbol Sprayer).
 *
 * All math runs in the target group's LOCAL space: an instance's transform is
 * already local to its group, so scaling/nudging composes cleanly there.
 */

import type { Vec2 } from '../geometry/vec2'
import type { NodeId, RGBA, SceneNode } from '../model/types'
import { getWorldTransform } from '../model/document'
import { localBBoxOfNode } from '../geometry/bbox'
import { lerpColor } from '../model/mesh'
import {
  applyToPoint,
  determinant,
  invert,
  multiply,
  scaleMat,
  translate,
  type Mat,
} from '../geometry/matrix'
import type { EditorStoreApi } from './store'

export type SymbolismKind = 'shift' | 'scrunch' | 'size' | 'stain'

export interface SymbolismParams {
  kind: SymbolismKind
  /** Brush center, DOC space. */
  center: Vec2
  /** Brush radius, DOC units. */
  radius: number
  /** Per-event intensity (0-1-ish); the tool picks a comfortable value. */
  strength: number
  /** Pointer motion since the last event, DOC space (Shifter). */
  delta?: Vec2
  /** Target tint (Stainer): the current fill color. */
  color?: RGBA
  /** Alt inverts the effect (push away / shrink). */
  alt: boolean
}

/** Uniform scale factor baked into a matrix (for mapping doc radius -> local). */
function scaleOf(m: Mat): number {
  const d = Math.abs(determinant(m))
  return d > 1e-12 ? Math.sqrt(d) : 1
}

/** Local-space center of a group child (its own bbox center under its transform). */
function childCenterLocal(node: SceneNode, nodes: Record<NodeId, SceneNode>): Vec2 | null {
  const b = localBBoxOfNode(node, nodes)
  if (!b) return null
  const c = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 }
  return applyToPoint(node.transform, c)
}

/** Tint every solid fill in a subtree toward `color` by `amount` (in the draft). */
function stainSubtree(
  nodes: Record<NodeId, SceneNode>,
  id: NodeId,
  color: RGBA,
  amount: number,
): void {
  const node = nodes[id]
  if (!node) return
  if (node.type === 'group') {
    for (const child of node.children) stainSubtree(nodes, child, color, amount)
    return
  }
  const fill = node.style.fill
  if (fill && fill.type === 'solid') fill.color = lerpColor(fill.color, color, amount)
}

/**
 * Apply one symbolism brush stamp to the instances of the given groups. An
 * instance (a direct child of the group) is affected when its center is within
 * the brush radius, weighted by a linear falloff to the edge. Returns true when
 * anything was in range.
 */
export function cmdSymbolismAdjust(
  store: EditorStoreApi,
  groupIds: NodeId[],
  params: SymbolismParams,
): boolean {
  const doc = store.getState().document
  // Pre-plan (pure reads); the recipe just applies the deltas.
  interface Job {
    id: NodeId
    transform?: Mat
    stain?: number
  }
  const jobs: Job[] = []

  for (const groupId of groupIds) {
    const group = doc.nodes[groupId]
    if (!group || group.type !== 'group') continue
    const world = getWorldTransform(doc.nodes, groupId)
    const inv = invert(world)
    const localCenter = applyToPoint(inv, params.center)
    const localRadius = params.radius / scaleOf(world)
    if (localRadius <= 0) continue
    // Pointer motion mapped into group-local space (Shifter).
    const localDelta = params.delta
      ? {
          x: applyToPoint(inv, { x: params.center.x + params.delta.x, y: params.center.y + params.delta.y }).x - localCenter.x,
          y: applyToPoint(inv, { x: params.center.x + params.delta.x, y: params.center.y + params.delta.y }).y - localCenter.y,
        }
      : { x: 0, y: 0 }

    for (const childId of group.children) {
      const child = doc.nodes[childId]
      if (!child || child.locked) continue
      const cc = childCenterLocal(child, doc.nodes)
      if (!cc) continue
      const dist = Math.hypot(cc.x - localCenter.x, cc.y - localCenter.y)
      if (dist > localRadius) continue
      const f = 1 - dist / localRadius
      const w = params.strength * f

      if (params.kind === 'shift') {
        jobs.push({ id: childId, transform: multiply(translate(localDelta.x * f, localDelta.y * f), child.transform) })
      } else if (params.kind === 'scrunch') {
        // Pull toward (or Alt: push from) the brush center.
        const dx = localCenter.x - cc.x
        const dy = localCenter.y - cc.y
        const len = Math.hypot(dx, dy) || 1
        const step = w * localRadius * 0.25 * (params.alt ? -1 : 1)
        jobs.push({ id: childId, transform: multiply(translate((dx / len) * step, (dy / len) * step), child.transform) })
      } else if (params.kind === 'size') {
        const k = params.alt ? 1 / (1 + w) : 1 + w
        const m = multiply(translate(cc.x, cc.y), multiply(scaleMat(k), translate(-cc.x, -cc.y)))
        jobs.push({ id: childId, transform: multiply(m, child.transform) })
      } else if (params.kind === 'stain' && params.color) {
        jobs.push({ id: childId, stain: Math.min(0.9, w) })
      }
    }
  }

  if (jobs.length === 0) return false
  store.getState().applyCommand('Symbolism', (draft) => {
    for (const job of jobs) {
      const node = draft.nodes[job.id]
      if (!node) continue
      if (job.transform) node.transform = job.transform
      if (job.stain !== undefined && params.color) stainSubtree(draft.nodes, job.id, params.color, job.stain)
    }
  })
  return true
}
