/**
 * On-canvas gradient annotator geometry, shared by the Gradient tool (hit
 * testing) and the Overlay (drawing) so they can never disagree. All points
 * go paint unit space -> node LOCAL (paint.transform) -> world
 * (worldTransform) -> screen (docToScreen); the widgets themselves are
 * constant screen size.
 */

import { applyToPoint } from '../geometry/matrix'
import type { Vec2 } from '../geometry/vec2'
import { distance } from '../geometry/vec2'
import type { GradientPaint, NodeId, SceneNode } from '../model/types'
import { linearAxisOf, radialAxisOf } from '../model/gradientGeometry'
import { paintNeedsDef } from '../model/defs'
import { docToScreen, type ViewportState } from '../store/coords'
import type { StyleTarget } from '../store/store'
import { worldTransform } from '../store/worldTransform'

/** Grab radius for the annotator endpoints (screen px). */
export const GRADIENT_HANDLE_HIT_PX = 8

export interface GradientAnnotatorLayout {
  nodeId: NodeId
  kind: 'linear' | 'radial'
  paint: GradientPaint
  /** Linear: axis start. Radial: center. (screen space) */
  aScreen: Vec2
  /** Linear: axis end. Radial: radius edge point. (screen space) */
  bScreen: Vec2
  /** Radial only: the gradient circle sampled into a screen polygon. */
  circleScreen: Vec2[] | null
}

/**
 * Annotator for the FIRST selected node whose `target` paint is a gradient
 * (the node the Gradient tool edits). Null hides the annotator.
 */
export function gradientAnnotatorLayout(
  nodes: Record<NodeId, SceneNode>,
  selection: NodeId[],
  target: StyleTarget,
  viewport: ViewportState,
): GradientAnnotatorLayout | null {
  for (const id of selection) {
    const node = nodes[id]
    if (!node || node.type === 'group' || node.hidden) continue
    const paint = node.style[target]
    if (!paintNeedsDef(paint)) continue

    const world = worldTransform(nodes, id)
    const toScreen = (local: Vec2): Vec2 => docToScreen(viewport, applyToPoint(world, local))

    if (paint.gradientType === 'linear') {
      const { a, b } = linearAxisOf(paint)
      return {
        nodeId: id,
        kind: 'linear',
        paint,
        aScreen: toScreen(a),
        bScreen: toScreen(b),
        circleScreen: null,
      }
    }
    const { center, edge } = radialAxisOf(paint)
    const circleScreen: Vec2[] = []
    for (let i = 0; i < 32; i++) {
      const t = (i / 32) * Math.PI * 2
      const unit = { x: 0.5 + 0.5 * Math.cos(t), y: 0.5 + 0.5 * Math.sin(t) }
      circleScreen.push(toScreen(applyToPoint(paint.transform, unit)))
    }
    return {
      nodeId: id,
      kind: 'radial',
      paint,
      aScreen: toScreen(center),
      bScreen: toScreen(edge),
      circleScreen,
    }
  }
  return null
}

export type GradientHandleKind = 'start' | 'end'

/** Which annotator endpoint (if any) is under `screenPoint`. */
export function hitGradientHandle(
  layout: GradientAnnotatorLayout,
  screenPoint: Vec2,
): GradientHandleKind | null {
  // End first: for a fresh radial the center and edge can overlap on tiny radii.
  if (distance(screenPoint, layout.bScreen) <= GRADIENT_HANDLE_HIT_PX) return 'end'
  if (distance(screenPoint, layout.aScreen) <= GRADIENT_HANDLE_HIT_PX) return 'start'
  return null
}
