/**
 * Width-tool handle geometry, shared by the Width tool (hit testing) and the
 * Overlay (drawing). Each width stop shows a diamond ON the path spine plus
 * two dots at the visual half-width extents; spine/dot positions go local ->
 * world -> screen so they land on the true rendered geometry at any
 * zoom/rotation, while the markers themselves stay constant screen size.
 */

import { applyToPoint } from '../geometry/matrix'
import type { Vec2 } from '../geometry/vec2'
import { distance } from '../geometry/vec2'
import type { NodeId, SceneNode } from '../model/types'
import { toSubPaths } from '../model/nodes'
import { pointAtOffset, samplePath, type SampledPath } from '../model/widthProfile'
import { docToScreen, type ViewportState } from '../store/coords'
import { worldTransform } from '../store/worldTransform'

export const WIDTH_HANDLE_HIT_PX = 7

export interface WidthStopHandle {
  index: number
  offset: number
  width: number
  spineScreen: Vec2
  dotAScreen: Vec2
  dotBScreen: Vec2
}

export interface WidthHandleLayout {
  nodeId: NodeId
  stops: WidthStopHandle[]
}

/** The node's local-space arc-length sampling, or null when unusable. */
export function sampledPathOf(node: SceneNode): SampledPath | null {
  if (node.type === 'group' || node.type === 'text') return null
  return samplePath(toSubPaths(node))
}

export function widthHandleLayout(
  nodes: Record<NodeId, SceneNode>,
  nodeId: NodeId | null,
  viewport: ViewportState,
): WidthHandleLayout | null {
  if (!nodeId) return null
  const node = nodes[nodeId]
  if (!node || node.hidden || node.type === 'group' || node.type === 'text') return null
  const profile = node.style.widthProfile
  if (!profile || profile.length === 0) return null
  const sampled = sampledPathOf(node)
  if (!sampled) return null

  const world = worldTransform(nodes, nodeId)
  const toScreen = (local: Vec2): Vec2 => docToScreen(viewport, applyToPoint(world, local))

  const stops: WidthStopHandle[] = profile.map((stop, index) => {
    const { point, normal } = pointAtOffset(sampled, stop.offset)
    const half = stop.width / 2
    return {
      index,
      offset: stop.offset,
      width: stop.width,
      spineScreen: toScreen(point),
      dotAScreen: toScreen({ x: point.x + normal.x * half, y: point.y + normal.y * half }),
      dotBScreen: toScreen({ x: point.x - normal.x * half, y: point.y - normal.y * half }),
    }
  })
  return { nodeId, stops }
}

export type WidthHandleHit =
  | { kind: 'width'; index: number }
  | { kind: 'slide'; index: number }
  | null

/** Width dots win over the spine diamond (they can overlap on thin strokes). */
export function hitWidthHandle(layout: WidthHandleLayout, screenPoint: Vec2): WidthHandleHit {
  for (const stop of layout.stops) {
    if (
      distance(screenPoint, stop.dotAScreen) <= WIDTH_HANDLE_HIT_PX ||
      distance(screenPoint, stop.dotBScreen) <= WIDTH_HANDLE_HIT_PX
    ) {
      return { kind: 'width', index: stop.index }
    }
  }
  for (const stop of layout.stops) {
    if (distance(screenPoint, stop.spineScreen) <= WIDTH_HANDLE_HIT_PX) {
      return { kind: 'slide', index: stop.index }
    }
  }
  return null
}
