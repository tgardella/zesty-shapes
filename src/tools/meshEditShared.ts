/**
 * Gradient Mesh editing geometry, shared by the Gradient Mesh tool (hit
 * testing) and the Overlay (drawing) so they can never disagree. Grid points
 * go LOCAL -> world (worldTransform) -> screen (docToScreen); the widgets
 * themselves are constant screen size.
 */

import { applyToPoint } from '../geometry/matrix'
import type { Vec2 } from '../geometry/vec2'
import type { MeshNode, NodeId, SceneNode } from '../model/types'
import {
  meshGridLines,
  meshPointHandleTargets,
  type MeshHandleDir,
} from '../model/mesh'
import { docToScreen, type ViewportState } from '../store/coords'
import { worldTransform } from '../store/worldTransform'

/** Grab radius for mesh grid points (screen px). */
export const MESH_POINT_HIT_PX = 7
/** Grab radius for mesh tangent handles (screen px). */
export const MESH_HANDLE_HIT_PX = 7

export interface MeshOverlayLayout {
  nodeId: NodeId
  /** Every grid point in screen space, index-aligned with node.points. */
  pointsScreen: Vec2[]
  /** Grid lines (rows then columns) as screen polylines. */
  linesScreen: Vec2[][]
}

/** The first selected mesh node's grid, in screen space. Null hides the grid. */
export function meshOverlayLayout(
  nodes: Record<NodeId, SceneNode>,
  selection: NodeId[],
  viewport: ViewportState,
): MeshOverlayLayout | null {
  for (const id of selection) {
    const node = nodes[id]
    if (!node || node.type !== 'mesh' || node.hidden) continue
    return layoutFor(nodes, node, viewport)
  }
  return null
}

function layoutFor(
  nodes: Record<NodeId, SceneNode>,
  node: MeshNode,
  viewport: ViewportState,
): MeshOverlayLayout {
  const world = worldTransform(nodes, node.id)
  const toScreen = (p: Vec2): Vec2 => docToScreen(viewport, applyToPoint(world, p))
  const pointsScreen = node.points.map((mp) => toScreen(mp.p))
  // Grid lines follow the CURVED surface (model/mesh.meshGridLines), so the
  // annotator matches the painted mesh exactly.
  const linesScreen = meshGridLines(node).map((line) => line.map(toScreen))
  return { nodeId: node.id, pointsScreen, linesScreen }
}

export interface MeshHandleLayout {
  nodeId: NodeId
  index: number
  /** The point the handles belong to, screen space. */
  pointScreen: Vec2
  handles: { dir: MeshHandleDir; local: Vec2; screen: Vec2 }[]
}

/** Tangent handles of the tool's selected mesh point, in screen space. */
export function meshHandleLayout(
  nodes: Record<NodeId, SceneNode>,
  edit: { nodeId: NodeId; pointIndex: number } | null,
  viewport: ViewportState,
): MeshHandleLayout | null {
  if (!edit) return null
  const node = nodes[edit.nodeId]
  if (!node || node.type !== 'mesh' || node.hidden) return null
  const point = node.points[edit.pointIndex]
  if (!point) return null
  const world = worldTransform(nodes, node.id)
  const toScreen = (p: Vec2): Vec2 => docToScreen(viewport, applyToPoint(world, p))
  return {
    nodeId: node.id,
    index: edit.pointIndex,
    pointScreen: toScreen(point.p),
    handles: meshPointHandleTargets(node, edit.pointIndex).map((h) => ({
      dir: h.dir,
      local: h.local,
      screen: toScreen(h.local),
    })),
  }
}

/** Which handle (if any) is under `screenPoint`. Returns its direction or null. */
export function hitMeshHandle(layout: MeshHandleLayout, screenPoint: Vec2): MeshHandleDir | null {
  let best: MeshHandleDir | null = null
  let bestD = MESH_HANDLE_HIT_PX
  for (const h of layout.handles) {
    const d = Math.hypot(h.screen.x - screenPoint.x, h.screen.y - screenPoint.y)
    if (d <= bestD) {
      bestD = d
      best = h.dir
    }
  }
  return best
}

/** Which grid point (if any) is under `screenPoint`. Returns the index or -1. */
export function hitMeshPoint(layout: MeshOverlayLayout, screenPoint: Vec2): number {
  let best = -1
  let bestD = MESH_POINT_HIT_PX
  for (let i = 0; i < layout.pointsScreen.length; i++) {
    const p = layout.pointsScreen[i]!
    const d = Math.hypot(p.x - screenPoint.x, p.y - screenPoint.y)
    if (d <= bestD) {
      bestD = d
      best = i
    }
  }
  return best
}
