/**
 * Gradient Mesh commands (Gradient Mesh tool, U). The mesh math lives in
 * model/mesh.ts; these wrap it in undoable commands. Point moves run inside
 * the tool's drag transaction, so a whole drag is ONE undo step.
 */

import type { Vec2 } from '../geometry/vec2'
import type { NodeId, RGBA } from '../model/types'
import {
  MESH_HANDLE_OPPOSITE,
  meshAddDivision,
  meshCellAt,
  meshFromShape,
  meshRowCol,
  type MeshHandleDir,
} from '../model/mesh'
import type { EditorStoreApi } from './store'

const MESHABLE = new Set(['rect', 'ellipse', 'polygon', 'star', 'path'])

/**
 * Convert a shape/path to a fresh 1x1 gradient mesh in place (id, transform,
 * and tree position preserved — mirrors Convert to Path). Returns true when
 * the node converted.
 */
export function cmdConvertToMesh(store: EditorStoreApi, id: NodeId): boolean {
  const doc = store.getState().document
  const node = doc.nodes[id]
  if (!node || node.locked || !MESHABLE.has(node.type)) return false
  store.getState().applyCommand(
    'Create Gradient Mesh',
    (draft) => {
      const target = draft.nodes[id]
      if (
        !target ||
        target.type === 'group' ||
        target.type === 'text' ||
        target.type === 'image' ||
        target.type === 'mesh' ||
        target.type === 'line'
      ) {
        return
      }
      // Snapshot to plain JSON — the replacement must not carry draft refs.
      const plain = JSON.parse(JSON.stringify(target)) as typeof target
      draft.nodes[id] = meshFromShape(plain)
    },
    { selectAfter: [id] },
  )
  return store.getState().document.nodes[id]?.type === 'mesh'
}

/**
 * Add a mesh row+column through the LOCAL-space point (Illustrator's
 * click-to-add-mesh-point). The new intersection point takes `color` when
 * given. Returns the new point's index, or -1 when the click missed the grid.
 */
export function cmdMeshAddDivision(
  store: EditorStoreApi,
  id: NodeId,
  localPoint: Vec2,
  color?: RGBA,
): number {
  const doc = store.getState().document
  const node = doc.nodes[id]
  if (!node || node.type !== 'mesh' || node.locked) return -1
  const hit = meshCellAt(node, localPoint)
  if (!hit) return -1
  store.getState().applyCommand('Add Mesh Point', (draft) => {
    const mesh = draft.nodes[id]
    if (mesh?.type === 'mesh') meshAddDivision(mesh, hit, color)
  })
  const updated = store.getState().document.nodes[id]
  if (updated?.type !== 'mesh') return -1
  return (hit.row + 1) * (updated.cols + 1) + (hit.col + 1)
}

/** Move one mesh grid point (LOCAL space). Call inside a drag transaction. */
export function cmdMeshMovePoint(
  store: EditorStoreApi,
  id: NodeId,
  index: number,
  localPoint: Vec2,
): void {
  store.getState().applyCommand('Move Mesh Point', (draft) => {
    const mesh = draft.nodes[id]
    if (mesh?.type !== 'mesh') return
    const point = mesh.points[index]
    if (!point) return
    // Any explicit tangent handles move rigidly with the point.
    const dx = localPoint.x - point.p.x
    const dy = localPoint.y - point.p.y
    if (point.handles) {
      for (const dir of ['left', 'right', 'up', 'down'] as MeshHandleDir[]) {
        const h = point.handles[dir]
        if (h) point.handles[dir] = { x: h.x + dx, y: h.y + dy }
      }
    }
    point.p = { x: localPoint.x, y: localPoint.y }
  })
}

/**
 * Set one tangent handle of a mesh point (LOCAL space). `mirror` (default) keeps
 * the opposite handle symmetric for a smooth point; false breaks it (Alt-drag).
 * Call inside a drag transaction — a whole handle drag is ONE undo step.
 */
export function cmdMeshSetHandle(
  store: EditorStoreApi,
  id: NodeId,
  index: number,
  dir: MeshHandleDir,
  localPoint: Vec2,
  mirror: boolean,
): void {
  store.getState().applyCommand('Adjust Mesh Handle', (draft) => {
    const mesh = draft.nodes[id]
    if (mesh?.type !== 'mesh') return
    const point = mesh.points[index]
    if (!point) return
    const handles = { ...(point.handles ?? {}) }
    handles[dir] = { x: localPoint.x, y: localPoint.y }
    if (mirror) {
      const opp = MESH_HANDLE_OPPOSITE[dir]
      const { r, c } = meshRowCol(mesh, index)
      const valid =
        (opp === 'left' && c > 0) ||
        (opp === 'right' && c < mesh.cols) ||
        (opp === 'up' && r > 0) ||
        (opp === 'down' && r < mesh.rows)
      if (valid) handles[opp] = { x: 2 * point.p.x - localPoint.x, y: 2 * point.p.y - localPoint.y }
    }
    point.handles = handles
  })
}

/** Recolor one mesh grid point. */
export function cmdMeshSetPointColor(
  store: EditorStoreApi,
  id: NodeId,
  index: number,
  color: RGBA,
): void {
  store.getState().applyCommand('Recolor Mesh Point', (draft) => {
    const mesh = draft.nodes[id]
    if (mesh?.type !== 'mesh') return
    const point = mesh.points[index]
    if (point) point.color = { ...color }
  })
}
