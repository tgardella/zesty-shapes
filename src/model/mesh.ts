/**
 * Gradient mesh helpers (Gradient Mesh tool, U). A MeshNode is a grid of
 * colored points; colors spread smoothly across the surface. Everything here
 * is a pure free function over plain JSON (see model/types.ts invariants).
 *
 * Rendering strategy: SVG has no native mesh gradients, so the mesh is
 * approximated by subdividing each cell into SUBDIV x SUBDIV sub-quads,
 * each flat-filled with the bilinearly interpolated color at its center.
 * NodeView and the SVG exporter both consume meshQuads() so canvas and
 * export can never disagree.
 */

import { nanoid } from 'nanoid'
import type { Vec2 } from '../geometry/vec2'
import type {
  MeshNode,
  MeshPoint,
  PathNode,
  RGBA,
  ShapeNode,
  SubPath,
} from './types'
import { bboxOfSubPaths } from '../geometry/bbox'
import { toSubPaths } from './nodes'

/** Sub-quads per cell edge (rendering fidelity vs element count). */
export const MESH_SUBDIV = 8

/** Grid point index for row r, column c. */
export function meshIndex(node: Pick<MeshNode, 'cols'>, r: number, c: number): number {
  return r * (node.cols + 1) + c
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function lerpVec(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) }
}

export function lerpColor(a: RGBA, b: RGBA, t: number): RGBA {
  return {
    r: lerp(a.r, b.r, t),
    g: lerp(a.g, b.g, t),
    b: lerp(a.b, b.b, t),
    a: lerp(a.a, b.a, t),
  }
}

/** Bilinear position inside one cell (corners p00 p10 p01 p11, u right, v down). */
function bilerpVec(p00: Vec2, p10: Vec2, p01: Vec2, p11: Vec2, u: number, v: number): Vec2 {
  return lerpVec(lerpVec(p00, p10, u), lerpVec(p01, p11, u), v)
}

function bilerpColor(c00: RGBA, c10: RGBA, c01: RGBA, c11: RGBA, u: number, v: number): RGBA {
  return lerpColor(lerpColor(c00, c10, u), lerpColor(c01, c11, u), v)
}

/**
 * Convert a shape/path into a fresh 1x1 mesh, PRESERVING id / transform /
 * tree fields (mirrors convertToPath). Corner colors seed from the solid
 * fill (white when the fill is absent or a gradient); the source outline
 * becomes the mesh clip. The mesh paints itself, so style.fill drops to null.
 */
export function meshFromShape(node: ShapeNode | PathNode): MeshNode {
  const subpaths = toSubPaths(node)
  const b = bboxOfSubPaths(subpaths)
  const minX = b?.minX ?? 0
  const minY = b?.minY ?? 0
  const maxX = b?.maxX ?? 100
  const maxY = b?.maxY ?? 100
  const fill = node.style.fill
  const color: RGBA =
    fill && fill.type === 'solid' ? { ...fill.color } : { r: 255, g: 255, b: 255, a: 1 }
  const points: MeshPoint[] = [
    { p: { x: minX, y: minY }, color: { ...color } },
    { p: { x: maxX, y: minY }, color: { ...color } },
    { p: { x: minX, y: maxY }, color: { ...color } },
    { p: { x: maxX, y: maxY }, color: { ...color } },
  ]
  const { id, name, parent, transform, style, opacity, blendMode, locked, hidden, clip } = node
  const mesh: MeshNode = {
    id,
    type: 'mesh',
    name: name === 'Path' || /^(Rectangle|Ellipse|Polygon|Star|Line)/.test(name) ? 'Mesh' : name,
    parent,
    transform,
    style: { ...style, fill: null, stroke: null },
    opacity,
    blendMode,
    locked,
    hidden,
    rows: 1,
    cols: 1,
    points,
    // Deep copy with fresh ids so the mesh never shares anchors with the source.
    outline: subpaths.map((sp) => ({
      id: nanoid(),
      closed: true,
      anchors: sp.anchors.map((a) => ({
        id: nanoid(),
        point: { ...a.point },
        handleIn: a.handleIn ? { ...a.handleIn } : null,
        handleOut: a.handleOut ? { ...a.handleOut } : null,
        type: a.type,
      })),
    })),
  }
  if (clip !== undefined) mesh.clip = clip
  return mesh
}

/** Grid boundary as one closed polygonal subpath (hit/selection fallback). */
export function meshBoundary(node: MeshNode): SubPath[] {
  const ring: Vec2[] = []
  const { rows, cols } = node
  const at = (r: number, c: number): Vec2 => node.points[meshIndex(node, r, c)]!.p
  for (let c = 0; c <= cols; c++) ring.push(at(0, c))
  for (let r = 1; r <= rows; r++) ring.push(at(r, cols))
  for (let c = cols - 1; c >= 0; c--) ring.push(at(rows, c))
  for (let r = rows - 1; r >= 1; r--) ring.push(at(r, 0))
  return [
    {
      id: `mesh-boundary-${node.id}`,
      closed: true,
      anchors: ring.map((p, i) => ({
        id: `mb-${node.id}-${i}`,
        point: { ...p },
        handleIn: null,
        handleOut: null,
        type: 'corner' as const,
      })),
    },
  ]
}

export interface MeshQuad {
  /** 4 corners in LOCAL space, in polygon order. */
  pts: [Vec2, Vec2, Vec2, Vec2]
  color: RGBA
}

/**
 * The flat-shaded sub-quads approximating the smooth mesh (LOCAL space).
 * Each quad also gets stroked with its own color at seamWidth to hide
 * antialiasing seams between neighbors.
 */
export function meshQuads(node: MeshNode, subdiv: number = MESH_SUBDIV): MeshQuad[] {
  const quads: MeshQuad[] = []
  const { rows, cols } = node
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const p00 = node.points[meshIndex(node, r, c)]!
      const p10 = node.points[meshIndex(node, r, c + 1)]!
      const p01 = node.points[meshIndex(node, r + 1, c)]!
      const p11 = node.points[meshIndex(node, r + 1, c + 1)]!
      for (let i = 0; i < subdiv; i++) {
        for (let j = 0; j < subdiv; j++) {
          const u0 = i / subdiv
          const u1 = (i + 1) / subdiv
          const v0 = j / subdiv
          const v1 = (j + 1) / subdiv
          quads.push({
            pts: [
              bilerpVec(p00.p, p10.p, p01.p, p11.p, u0, v0),
              bilerpVec(p00.p, p10.p, p01.p, p11.p, u1, v0),
              bilerpVec(p00.p, p10.p, p01.p, p11.p, u1, v1),
              bilerpVec(p00.p, p10.p, p01.p, p11.p, u0, v1),
            ],
            color: bilerpColor(
              p00.color,
              p10.color,
              p01.color,
              p11.color,
              (u0 + u1) / 2,
              (v0 + v1) / 2,
            ),
          })
        }
      }
    }
  }
  return quads
}

/** Seam-hiding stroke width for the sub-quads, from the mesh's typical cell size. */
export function meshSeamWidth(node: MeshNode, subdiv: number = MESH_SUBDIV): number {
  const b = bboxOfSubPaths(meshBoundary(node))
  if (!b) return 0.5
  const span = Math.max(b.maxX - b.minX, b.maxY - b.minY)
  return Math.max(0.1, span / Math.max(node.rows, node.cols) / subdiv / 3)
}

// ---------------------------------------------------------------------------
// Cell lookup / inverse bilinear (for adding divisions at a clicked point)
// ---------------------------------------------------------------------------

function pointInQuad(p: Vec2, quad: [Vec2, Vec2, Vec2, Vec2]): boolean {
  // Winding sign test; works for convex quads (mesh cells stay near-convex).
  let sign = 0
  for (let i = 0; i < 4; i++) {
    const a = quad[i]!
    const b = quad[(i + 1) % 4]!
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)
    if (cross === 0) continue
    const s = cross > 0 ? 1 : -1
    if (sign === 0) sign = s
    else if (s !== sign) return false
  }
  return true
}

/** Newton-iterate the inverse bilinear map of one cell; returns (u,v) in [0,1]². */
function inverseBilinear(p: Vec2, p00: Vec2, p10: Vec2, p01: Vec2, p11: Vec2): Vec2 {
  let u = 0.5
  let v = 0.5
  for (let iter = 0; iter < 12; iter++) {
    const f = bilerpVec(p00, p10, p01, p11, u, v)
    const rx = f.x - p.x
    const ry = f.y - p.y
    if (Math.abs(rx) < 1e-6 && Math.abs(ry) < 1e-6) break
    // Partials of the bilinear map.
    const dxu = lerp(p10.x - p00.x, p11.x - p01.x, v)
    const dyu = lerp(p10.y - p00.y, p11.y - p01.y, v)
    const dxv = lerp(p01.x - p00.x, p11.x - p10.x, u)
    const dyv = lerp(p01.y - p00.y, p11.y - p10.y, u)
    const det = dxu * dyv - dxv * dyu
    if (Math.abs(det) < 1e-12) break
    u -= (rx * dyv - ry * dxv) / det
    v -= (ry * dxu - rx * dyu) / det
    u = Math.min(1, Math.max(0, u))
    v = Math.min(1, Math.max(0, v))
  }
  return { x: u, y: v }
}

export interface MeshCellHit {
  row: number
  col: number
  /** Position within the cell, 0-1. */
  u: number
  v: number
}

/** Which cell (if any) contains the LOCAL-space point. */
export function meshCellAt(node: MeshNode, p: Vec2): MeshCellHit | null {
  for (let r = 0; r < node.rows; r++) {
    for (let c = 0; c < node.cols; c++) {
      const p00 = node.points[meshIndex(node, r, c)]!.p
      const p10 = node.points[meshIndex(node, r, c + 1)]!.p
      const p01 = node.points[meshIndex(node, r + 1, c)]!.p
      const p11 = node.points[meshIndex(node, r + 1, c + 1)]!.p
      if (!pointInQuad(p, [p00, p10, p11, p01])) continue
      const uv = inverseBilinear(p, p00, p10, p01, p11)
      return { row: r, col: c, u: uv.x, v: uv.y }
    }
  }
  return null
}

/** Nearest grid-point index within `tol` (LOCAL units), or -1. */
export function meshPointAt(node: MeshNode, p: Vec2, tol: number): number {
  let best = -1
  let bestD = tol
  for (let i = 0; i < node.points.length; i++) {
    const q = node.points[i]!.p
    const d = Math.hypot(q.x - p.x, q.y - p.y)
    if (d <= bestD) {
      bestD = d
      best = i
    }
  }
  return best
}

/**
 * Insert a row AND column of grid points through the clicked cell position
 * (Illustrator's click-to-add-mesh-point). Mutates the node (call inside an
 * Immer recipe). New points interpolate position and color from their cell;
 * the new intersection point takes `color` when given.
 */
export function meshAddDivision(node: MeshNode, hit: MeshCellHit, color?: RGBA): void {
  const EDGE = 0.02
  const u = Math.min(1 - EDGE, Math.max(EDGE, hit.u))
  const v = Math.min(1 - EDGE, Math.max(EDGE, hit.v))

  // Insert the new COLUMN at (col + u): every row gains one point between
  // columns col and col+1, interpolated along that row's cell edge span.
  const oldCols = node.cols
  const colAt = hit.col
  const newPoints: MeshPoint[] = []
  for (let r = 0; r <= node.rows; r++) {
    for (let c = 0; c <= oldCols; c++) {
      newPoints.push(node.points[r * (oldCols + 1) + c]!)
      if (c === colAt) {
        const a = node.points[r * (oldCols + 1) + c]!
        const b = node.points[r * (oldCols + 1) + c + 1]!
        newPoints.push({ p: lerpVec(a.p, b.p, u), color: lerpColor(a.color, b.color, u) })
      }
    }
  }
  node.cols = oldCols + 1
  node.points = newPoints

  // Insert the new ROW at (row + v) against the widened grid.
  const cols1 = node.cols + 1
  const rowAt = hit.row
  const withRow: MeshPoint[] = []
  for (let r = 0; r <= node.rows; r++) {
    for (let c = 0; c < cols1; c++) withRow.push(node.points[r * cols1 + c]!)
    if (r === rowAt) {
      for (let c = 0; c < cols1; c++) {
        const a = node.points[r * cols1 + c]!
        const b = node.points[(r + 1) * cols1 + c]!
        withRow.push({ p: lerpVec(a.p, b.p, v), color: lerpColor(a.color, b.color, v) })
      }
    }
  }
  node.rows += 1
  node.points = withRow

  // The clicked intersection is the new (rowAt+1, colAt+1) grid point.
  if (color) {
    const idx = meshIndex(node, rowAt + 1, colAt + 1)
    node.points[idx] = { p: node.points[idx]!.p, color: { ...color } }
  }
}
