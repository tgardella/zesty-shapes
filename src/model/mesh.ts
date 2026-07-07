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

// ---------------------------------------------------------------------------
// Curved surface: tensor-product Catmull-Rom over the grid points.
// Approximates Illustrator's bezier mesh lines without handle UI — dragging a
// point warps its neighborhood SMOOTHLY. Border control points clamp
// (duplicate), so a straight-edged grid stays exactly straight: with
// collinear controls every CR term is a multiple of the segment direction.
// ---------------------------------------------------------------------------

function crVec(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, t: number): Vec2 {
  const t2 = t * t
  const t3 = t2 * t
  const w0 = -0.5 * t3 + t2 - 0.5 * t
  const w1 = 1.5 * t3 - 2.5 * t2 + 1
  const w2 = -1.5 * t3 + 2 * t2 + 0.5 * t
  const w3 = 0.5 * t3 - 0.5 * t2
  return {
    x: w0 * p0.x + w1 * p1.x + w2 * p2.x + w3 * p3.x,
    y: w0 * p0.y + w1 * p1.y + w2 * p2.y + w3 * p3.y,
  }
}

function clampIndex(v: number, max: number): number {
  return v < 0 ? 0 : v > max ? max : v
}

/** Point on horizontal grid line `r` at local `s` across cell column `c`. */
export function meshRowPoint(node: MeshNode, r: number, c: number, s: number): Vec2 {
  const at = (cc: number): Vec2 => node.points[meshIndex(node, r, clampIndex(cc, node.cols))]!.p
  return crVec(at(c - 1), at(c), at(c + 1), at(c + 2), s)
}

/** Point on vertical grid line `c` at local `t` across cell row `r`. */
export function meshColPoint(node: MeshNode, c: number, r: number, t: number): Vec2 {
  const at = (rr: number): Vec2 => node.points[meshIndex(node, clampIndex(rr, node.rows), c)]!.p
  return crVec(at(r - 1), at(r), at(r + 1), at(r + 2), t)
}

/** Smooth surface position inside cell (r, c) at local (s, t). */
export function meshSurfacePoint(node: MeshNode, r: number, c: number, s: number, t: number): Vec2 {
  const q = (rr: number): Vec2 => meshRowPoint(node, clampIndex(rr, node.rows), c, s)
  return crVec(q(r - 1), q(r), q(r + 1), q(r + 2), t)
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
 * Positions follow the CURVED Catmull-Rom surface (meshSurfacePoint); colors
 * interpolate bilinearly within their cell. Each quad also gets stroked with
 * its own color at seamWidth to hide antialiasing seams between neighbors.
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
      // Shared sample lattice so neighboring sub-quads seam exactly.
      const lattice: Vec2[][] = []
      for (let j = 0; j <= subdiv; j++) {
        const rowPts: Vec2[] = []
        for (let i = 0; i <= subdiv; i++) {
          rowPts.push(meshSurfacePoint(node, r, c, i / subdiv, j / subdiv))
        }
        lattice.push(rowPts)
      }
      for (let i = 0; i < subdiv; i++) {
        for (let j = 0; j < subdiv; j++) {
          quads.push({
            pts: [lattice[j]![i]!, lattice[j]![i + 1]!, lattice[j + 1]![i + 1]!, lattice[j + 1]![i]!],
            color: bilerpColor(
              p00.color,
              p10.color,
              p01.color,
              p11.color,
              (i + 0.5) / subdiv,
              (j + 0.5) / subdiv,
            ),
          })
        }
      }
    }
  }
  return quads
}

/**
 * The grid lines of the CURVED surface as local-space polylines (rows first,
 * then columns) — the overlay draws these so the on-canvas grid matches the
 * painted surface exactly.
 */
export function meshGridLines(node: MeshNode, samples = 6): Vec2[][] {
  const lines: Vec2[][] = []
  for (let r = 0; r <= node.rows; r++) {
    const line: Vec2[] = [node.points[meshIndex(node, r, 0)]!.p]
    for (let c = 0; c < node.cols; c++) {
      for (let k = 1; k <= samples; k++) line.push(meshRowPoint(node, r, c, k / samples))
    }
    lines.push(line)
  }
  for (let c = 0; c <= node.cols; c++) {
    const line: Vec2[] = [node.points[meshIndex(node, 0, c)]!.p]
    for (let r = 0; r < node.rows; r++) {
      for (let k = 1; k <= samples; k++) line.push(meshColPoint(node, c, r, k / samples))
    }
    lines.push(line)
  }
  return lines
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

  // Insert the new COLUMN at (col + u): every row gains one point ON its
  // curved row line (meshRowPoint), color-lerped between its neighbors.
  // Sample all positions BEFORE splicing — the spline reads the old grid.
  const oldCols = node.cols
  const colAt = hit.col
  const columnInserts: MeshPoint[] = []
  for (let r = 0; r <= node.rows; r++) {
    const a = node.points[r * (oldCols + 1) + colAt]!
    const b = node.points[r * (oldCols + 1) + colAt + 1]!
    columnInserts.push({ p: meshRowPoint(node, r, colAt, u), color: lerpColor(a.color, b.color, u) })
  }
  const newPoints: MeshPoint[] = []
  for (let r = 0; r <= node.rows; r++) {
    for (let c = 0; c <= oldCols; c++) {
      newPoints.push(node.points[r * (oldCols + 1) + c]!)
      if (c === colAt) newPoints.push(columnInserts[r]!)
    }
  }
  node.cols = oldCols + 1
  node.points = newPoints

  // Insert the new ROW at (row + v) against the widened grid, again ON the
  // curved column lines.
  const cols1 = node.cols + 1
  const rowAt = hit.row
  const rowInserts: MeshPoint[] = []
  for (let c = 0; c < cols1; c++) {
    const a = node.points[rowAt * cols1 + c]!
    const b = node.points[(rowAt + 1) * cols1 + c]!
    rowInserts.push({ p: meshColPoint(node, c, rowAt, v), color: lerpColor(a.color, b.color, v) })
  }
  const withRow: MeshPoint[] = []
  for (let r = 0; r <= node.rows; r++) {
    for (let c = 0; c < cols1; c++) withRow.push(node.points[r * cols1 + c]!)
    if (r === rowAt) withRow.push(...rowInserts)
  }
  node.rows += 1
  node.points = withRow

  // The clicked intersection is the new (rowAt+1, colAt+1) grid point.
  if (color) {
    const idx = meshIndex(node, rowAt + 1, colAt + 1)
    node.points[idx] = { p: node.points[idx]!.p, color: { ...color } }
  }
}
