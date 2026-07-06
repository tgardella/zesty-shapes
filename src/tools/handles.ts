/**
 * Shared overlay-handle geometry — the Overlay renders these markers and the
 * Selection tool hit-tests the SAME positions, so the two can never drift.
 * All outputs are SCREEN-space points (constant size at any zoom).
 */

import { applyToPoint } from '../geometry/matrix'
import type { Vec2 } from '../geometry/vec2'
import { distance } from '../geometry/vec2'
import type { BBox } from '../geometry/bbox'
import { localBBoxOfNode, transformBBox, unionBBox } from '../geometry/bbox'
import { docToScreen, type ViewportState } from '../store/coords'
import { worldTransform } from '../store/worldTransform'
import type { NodeId, RectNode, SceneNode } from '../model/types'

/** Screen-px pull radius for grabbing an overlay handle. */
export const HANDLE_GRAB_RADIUS_PX = 7

/** Rotation affordance geometry (screen px) — shared by Overlay and tools. */
export const ROTATE_STEM_PX = 16
export const ROTATE_KNOB_RADIUS_PX = 4.5
export const HANDLE_SIZE_PX = 8

/**
 * The 8 bbox handles as unit offsets, clockwise from top-left:
 * 0 TL, 1 TM, 2 TR, 3 MR, 4 BR, 5 BM, 6 BL, 7 ML.
 * The scale gesture's axis masks and opposite-anchor rule ((i+4)%8) depend on
 * this exact ordering — Overlay renders from the same table.
 */
export const HANDLE_UNITS: ReadonlyArray<Vec2> = [
  { x: 0, y: 0 },
  { x: 0.5, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 0.5 },
  { x: 1, y: 1 },
  { x: 0.5, y: 1 },
  { x: 0, y: 1 },
  { x: 0, y: 0.5 },
]

export interface SelectionHandleLayout {
  /** Union of the selection's world bboxes, DOC space. */
  bboxDoc: BBox
  /** The same box in screen space. */
  boxScreen: { x: number; y: number; w: number; h: number }
  /** 8 handle centers, screen space, ordered per HANDLE_UNITS. */
  handlesScreen: Vec2[]
  /** Rotation knob center, screen space (outside the box, top-center). */
  rotationKnobScreen: Vec2
}

/**
 * The selection's transform-handle layout — THE single geometry source for
 * both the Overlay (rendering) and the transform gestures (hit-testing), so
 * the two can never drift. Returns null when nothing measurable is selected.
 */
export function selectionHandleLayout(
  nodes: Record<NodeId, SceneNode>,
  selection: NodeId[],
  viewport: ViewportState,
): SelectionHandleLayout | null {
  let union: BBox | null = null
  for (const id of selection) {
    const node = nodes[id]
    if (!node) continue
    const local = localBBoxOfNode(node, nodes)
    if (!local) continue
    union = unionBBox(union, transformBBox(worldTransform(nodes, id), local))
  }
  if (!union) return null
  const tl = docToScreen(viewport, { x: union.minX, y: union.minY })
  const br = docToScreen(viewport, { x: union.maxX, y: union.maxY })
  const boxScreen = { x: tl.x, y: tl.y, w: br.x - tl.x, h: br.y - tl.y }
  const handlesScreen = HANDLE_UNITS.map((u) => ({
    x: boxScreen.x + boxScreen.w * u.x,
    y: boxScreen.y + boxScreen.h * u.y,
  }))
  return {
    bboxDoc: union,
    boxScreen,
    handlesScreen,
    rotationKnobScreen: {
      x: boxScreen.x + boxScreen.w / 2,
      y: boxScreen.y - HANDLE_SIZE_PX / 2 - ROTATE_STEM_PX - ROTATE_KNOB_RADIUS_PX,
    },
  }
}

export type TransformHandleHit =
  | { kind: 'scale'; handleIndex: number }
  | { kind: 'rotate' }

/** Which transform handle (if any) sits under a screen point. */
export function hitTransformHandle(
  layout: SelectionHandleLayout,
  screenPoint: Vec2,
): TransformHandleHit | null {
  if (
    distance(screenPoint, layout.rotationKnobScreen) <=
    ROTATE_KNOB_RADIUS_PX + HANDLE_GRAB_RADIUS_PX / 2
  ) {
    return { kind: 'rotate' }
  }
  let best = -1
  let bestDist = HANDLE_GRAB_RADIUS_PX
  for (let i = 0; i < layout.handlesScreen.length; i++) {
    const d = distance(screenPoint, layout.handlesScreen[i]!)
    if (d <= bestDist) {
      best = i
      bestDist = d
    }
  }
  return best >= 0 ? { kind: 'scale', handleIndex: best } : null
}

/** Minimum inset of the corner-radius widget from the corner, in screen px. */
const RADIUS_HANDLE_MIN_INSET_PX = 14

export interface RadiusHandleInfo {
  nodeId: NodeId
  /** Diamond marker position, screen space. */
  screenPoint: Vec2
  rx: number
  maxRadius: number
}

/**
 * The live corner-radius widget for a single selected RectNode: a diamond
 * sitting on the top-left corner's 45° diagonal, inset by the current radius
 * (with a minimum inset so it never collides with the bbox corner handle).
 * Returns null unless exactly one unlocked RectNode is selected.
 */
export function rectRadiusHandle(
  nodes: Record<NodeId, SceneNode>,
  selection: NodeId[],
  viewport: ViewportState,
): RadiusHandleInfo | null {
  if (selection.length !== 1) return null
  const node = nodes[selection[0]!]
  if (!node || node.type !== 'rect' || node.locked || node.hidden) return null
  const rect: RectNode = node
  const maxRadius = Math.min(Math.abs(rect.w), Math.abs(rect.h)) / 2
  if (maxRadius <= 0) return null
  const minInset = RADIUS_HANDLE_MIN_INSET_PX / viewport.zoom
  const t = Math.min(Math.max(rect.rx, minInset), maxRadius)
  const local = { x: rect.x + t, y: rect.y + t }
  const world = applyToPoint(worldTransform(nodes, rect.id), local)
  return { nodeId: rect.id, screenPoint: docToScreen(viewport, world), rx: rect.rx, maxRadius }
}
