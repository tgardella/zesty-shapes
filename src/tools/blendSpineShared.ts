/**
 * Blend spine editing geometry, shared by the Blend tool (hit testing) and the
 * Overlay (drawing) so they can never disagree. Control points go LOCAL ->
 * world (worldTransform) -> screen (docToScreen); the smooth spine polyline is
 * sampled through the same control points the exporter/renderer follow.
 */

import { applyToPoint } from '../geometry/matrix'
import type { Vec2 } from '../geometry/vec2'
import type { NodeId, SceneNode } from '../model/types'
import { blendSpineControls, spinePolyline } from '../model/blend'
import { docToScreen, type ViewportState } from '../store/coords'
import { worldTransform } from '../store/worldTransform'

/** Grab radius for spine control points / the insert handle (screen px). */
export const SPINE_POINT_HIT_PX = 8

export interface BlendSpineLayout {
  groupId: NodeId
  /** Control points in the group's LOCAL space (index-aligned with screen). */
  controlsLocal: Vec2[]
  controlsScreen: Vec2[]
  /** The smooth spine as a screen polyline. */
  polylineScreen: Vec2[]
  /** Add-point handle at the spine's arc midpoint. */
  insert: { afterIndex: number; local: Vec2; screen: Vec2 }
}

/** The first selected live-blend group's spine, in screen space. Null hides it. */
export function blendSpineLayout(
  nodes: Record<NodeId, SceneNode>,
  selection: NodeId[],
  viewport: ViewportState,
): BlendSpineLayout | null {
  for (const id of selection) {
    const controls = blendSpineControls(nodes, id)
    if (!controls || controls.length < 2) continue
    const world = worldTransform(nodes, id)
    const toScreen = (p: Vec2): Vec2 => docToScreen(viewport, applyToPoint(world, p))
    const polyLocal = spinePolyline(controls)
    return {
      groupId: id,
      controlsLocal: controls,
      controlsScreen: controls.map(toScreen),
      polylineScreen: polyLocal.map(toScreen),
      insert: insertHandle(controls, toScreen),
    }
  }
  return null
}

/** Midpoint of the longest control-to-control segment: the bend affordance. */
function insertHandle(
  controls: Vec2[],
  toScreen: (p: Vec2) => Vec2,
): { afterIndex: number; local: Vec2; screen: Vec2 } {
  let best = 0
  let bestLen = -1
  for (let i = 0; i < controls.length - 1; i++) {
    const a = controls[i]!
    const b = controls[i + 1]!
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    if (len > bestLen) {
      bestLen = len
      best = i
    }
  }
  const a = controls[best]!
  const b = controls[best + 1]!
  const local = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  return { afterIndex: best, local, screen: toScreen(local) }
}

/** Which control point (if any) is under `screenPoint`. Returns the index or -1. */
export function hitSpinePoint(layout: BlendSpineLayout, screenPoint: Vec2): number {
  let best = -1
  let bestD = SPINE_POINT_HIT_PX
  for (let i = 0; i < layout.controlsScreen.length; i++) {
    const p = layout.controlsScreen[i]!
    const d = Math.hypot(p.x - screenPoint.x, p.y - screenPoint.y)
    if (d <= bestD) {
      bestD = d
      best = i
    }
  }
  return best
}

/** True when `screenPoint` grabs the insert (add-control) handle. */
export function hitSpineInsert(layout: BlendSpineLayout, screenPoint: Vec2): boolean {
  const p = layout.insert.screen
  return Math.hypot(p.x - screenPoint.x, p.y - screenPoint.y) <= SPINE_POINT_HIT_PX
}
