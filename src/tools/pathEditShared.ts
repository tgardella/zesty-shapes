/**
 * Shared screen-space hit-testing for the path-editing tools (Direct
 * Selection, Pen, Curvature, Scissors). Everything goes screen -> doc ->
 * world -> LOCAL through worldTransform and its inverse, so anchors of
 * rotated/nested paths hit exactly where they are drawn. Tolerances are
 * SCREEN pixels — constant feel at any zoom.
 */

import { applyToPoint, invert } from '../geometry/matrix'
import type { Vec2 } from '../geometry/vec2'
import { distance } from '../geometry/vec2'
import type { AnchorId, NodeId, PathNode, SceneNode, SubPathId } from '../model/types'
import { nearestOnSubPaths, subPathSegments } from '../model/pathOps'
import { docToScreen, screenToDoc, type ViewportState } from '../store/coords'
import { worldTransform } from '../store/worldTransform'

export const ANCHOR_HIT_PX = 6
export const HANDLE_HIT_PX = 5
export const SEGMENT_HIT_PX = 5

export function pathNodeOf(
  nodes: Record<NodeId, SceneNode>,
  id: NodeId | null | undefined,
): PathNode | null {
  if (!id) return null
  const node = nodes[id]
  return node && node.type === 'path' && !node.locked && !node.hidden ? node : null
}

/** LOCAL point of a doc-space point for node `id`. */
export function docPointToLocal(
  nodes: Record<NodeId, SceneNode>,
  id: NodeId,
  docPoint: Vec2,
): Vec2 {
  return applyToPoint(invert(worldTransform(nodes, id)), docPoint)
}

/** Screen point of a LOCAL point of node `id`. */
export function localPointToScreen(
  nodes: Record<NodeId, SceneNode>,
  id: NodeId,
  viewport: ViewportState,
  localPoint: Vec2,
): Vec2 {
  return docToScreen(viewport, applyToPoint(worldTransform(nodes, id), localPoint))
}

export interface AnchorHit {
  subPathId: SubPathId
  anchorId: AnchorId
  /** Index within its subpath. */
  index: number
}

/** The anchor of `node` under a screen point, or null. Closest wins. */
export function anchorAtScreenPoint(
  nodes: Record<NodeId, SceneNode>,
  node: PathNode,
  viewport: ViewportState,
  screenPoint: Vec2,
  tolerancePx = ANCHOR_HIT_PX,
): AnchorHit | null {
  let best: AnchorHit | null = null
  let bestDist = tolerancePx
  for (const sp of node.subpaths) {
    for (let i = 0; i < sp.anchors.length; i++) {
      const a = sp.anchors[i]!
      const s = localPointToScreen(nodes, node.id, viewport, a.point)
      const d = distance(s, screenPoint)
      if (d <= bestDist) {
        best = { subPathId: sp.id, anchorId: a.id, index: i }
        bestDist = d
      }
    }
  }
  return best
}

export interface HandleHit extends AnchorHit {
  end: 'in' | 'out'
}

/**
 * A bezier handle dot under the screen point — only handles of the given
 * (selected) anchors are grabbable, matching what the overlay draws.
 */
export function handleAtScreenPoint(
  nodes: Record<NodeId, SceneNode>,
  node: PathNode,
  viewport: ViewportState,
  visibleAnchorIds: ReadonlySet<AnchorId>,
  screenPoint: Vec2,
  tolerancePx = HANDLE_HIT_PX,
): HandleHit | null {
  let best: HandleHit | null = null
  let bestDist = tolerancePx
  for (const sp of node.subpaths) {
    for (let i = 0; i < sp.anchors.length; i++) {
      const a = sp.anchors[i]!
      if (!visibleAnchorIds.has(a.id)) continue
      for (const end of ['in', 'out'] as const) {
        const h = end === 'in' ? a.handleIn : a.handleOut
        if (!h) continue
        const s = localPointToScreen(nodes, node.id, viewport, h)
        const d = distance(s, screenPoint)
        if (d <= bestDist) {
          best = { subPathId: sp.id, anchorId: a.id, index: i, end }
          bestDist = d
        }
      }
    }
  }
  return best
}

export interface SegmentHit {
  subPathId: SubPathId
  segIndex: number
  t: number
  /** LOCAL-space point on the curve. */
  localPoint: Vec2
}

/**
 * The path segment under a screen point (for add-anchor / scissors). The
 * nearest point is found in LOCAL space, then verified in SCREEN space so the
 * tolerance stays zoom- and rotation-proof.
 */
export function segmentAtScreenPoint(
  nodes: Record<NodeId, SceneNode>,
  node: PathNode,
  viewport: ViewportState,
  screenPoint: Vec2,
  tolerancePx = SEGMENT_HIT_PX,
): SegmentHit | null {
  const local = docPointToLocal(nodes, node.id, screenToDoc(viewport, screenPoint))
  const near = nearestOnSubPaths(node.subpaths, local)
  if (!near) return null
  const screen = localPointToScreen(nodes, node.id, viewport, near.point)
  if (distance(screen, screenPoint) > tolerancePx) return null
  return { subPathId: near.subPathId, segIndex: near.segIndex, t: near.t, localPoint: near.point }
}

/** Is the anchor an endpoint of an OPEN subpath? ('start' | 'end' | null) */
export function openEndpointKind(node: PathNode, anchorId: AnchorId): 'start' | 'end' | null {
  for (const sp of node.subpaths) {
    if (sp.closed || sp.anchors.length === 0) continue
    if (sp.anchors[0]!.id === anchorId) return 'start'
    if (sp.anchors[sp.anchors.length - 1]!.id === anchorId) return 'end'
  }
  return null
}

/** Segment count guard used by tools before splitAt indexes. */
export function segmentCount(node: PathNode, subPathId: SubPathId): number {
  const sp = node.subpaths.find((s) => s.id === subPathId)
  return sp ? subPathSegments(sp).length : 0
}
