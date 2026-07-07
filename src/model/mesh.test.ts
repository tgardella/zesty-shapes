import { describe, expect, it } from 'vitest'
import {
  MESH_SUBDIV,
  meshAddDivision,
  meshBoundary,
  meshCellAt,
  meshFromShape,
  meshGridLines,
  meshIndex,
  meshPointAt,
  meshPointHandleTargets,
  meshQuads,
  meshRowPoint,
  meshRowCol,
  meshSurfacePoint,
} from './mesh'
import { createRectNode, createEllipseNode } from './nodes'
import { translate } from '../geometry/matrix'

function rectMesh() {
  const rect = createRectNode(
    { x: 0, y: 0, w: 100, h: 50 },
    { transform: translate(20, 30) },
  )
  return meshFromShape(rect)
}

describe('meshFromShape', () => {
  it('preserves id/transform and seeds a 1x1 grid from the shape bbox', () => {
    const rect = createRectNode({ x: 0, y: 0, w: 100, h: 50 }, { transform: translate(20, 30) })
    const mesh = meshFromShape(rect)
    expect(mesh.id).toBe(rect.id)
    expect(mesh.transform).toEqual(rect.transform)
    expect(mesh.rows).toBe(1)
    expect(mesh.cols).toBe(1)
    expect(mesh.points).toHaveLength(4)
    expect(mesh.points[0]!.p).toEqual({ x: 0, y: 0 })
    expect(mesh.points[3]!.p).toEqual({ x: 100, y: 50 })
    // Corner colors come from the shape's solid fill (default grey 200).
    expect(mesh.points[0]!.color.r).toBe(200)
    // The mesh paints itself; style fill/stroke drop.
    expect(mesh.style.fill).toBeNull()
    expect(mesh.outline).not.toBeNull()
  })

  it('keeps the source outline as the clip (ellipse stays elliptical)', () => {
    const ellipse = createEllipseNode({ cx: 50, cy: 50, rx: 40, ry: 20 })
    const mesh = meshFromShape(ellipse)
    expect(mesh.outline!.length).toBeGreaterThan(0)
    expect(mesh.outline![0]!.closed).toBe(true)
  })
})

describe('mesh geometry', () => {
  it('meshQuads subdivides each cell into SUBDIV^2 flat quads', () => {
    const mesh = rectMesh()
    expect(meshQuads(mesh)).toHaveLength(MESH_SUBDIV * MESH_SUBDIV)
  })

  it('meshCellAt inverts the bilinear map', () => {
    const mesh = rectMesh()
    const hit = meshCellAt(mesh, { x: 50, y: 25 })
    expect(hit).not.toBeNull()
    expect(hit!.row).toBe(0)
    expect(hit!.col).toBe(0)
    expect(hit!.u).toBeCloseTo(0.5, 3)
    expect(hit!.v).toBeCloseTo(0.5, 3)
    expect(meshCellAt(mesh, { x: 500, y: 500 })).toBeNull()
  })

  it('meshPointAt finds the nearest grid point within tolerance', () => {
    const mesh = rectMesh()
    expect(meshPointAt(mesh, { x: 99, y: 1 }, 3)).toBe(meshIndex(mesh, 0, 1))
    expect(meshPointAt(mesh, { x: 50, y: 25 }, 3)).toBe(-1)
  })

  it('meshBoundary walks the grid perimeter', () => {
    const mesh = rectMesh()
    const boundary = meshBoundary(mesh)
    expect(boundary).toHaveLength(1)
    expect(boundary[0]!.closed).toBe(true)
    expect(boundary[0]!.anchors).toHaveLength(4) // 1x1 grid: the 4 corners
  })
})

describe('curved surface (Catmull-Rom)', () => {
  it('straight grids stay exactly straight', () => {
    const mesh = rectMesh()
    const p = meshRowPoint(mesh, 0, 0, 0.3)
    expect(p.y).toBeCloseTo(0) // top edge of an unwarped rect mesh
    expect(meshSurfacePoint(mesh, 0, 0, 0.5, 0.5).x).toBeCloseTo(50)
  })

  it('grid lines curve smoothly through a dragged point', () => {
    const mesh = rectMesh()
    meshAddDivision(mesh, { row: 0, col: 0, u: 0.5, v: 0.5 })
    // Drag the center point up: the middle ROW line should bow, not kink.
    const center = meshIndex(mesh, 1, 1)
    mesh.points[center] = { p: { x: 50, y: 10 }, color: mesh.points[center]!.color }
    // Between the left edge point (0,25) and the moved center (50,10), the
    // curved line deviates from the straight chord (y = 25 - 0.3x) — the
    // spline bows through the neighborhood instead of kinking.
    const mid = meshRowPoint(mesh, 1, 0, 0.5)
    const chordY = 25 - 0.3 * mid.x
    expect(Math.abs(mid.y - chordY)).toBeGreaterThan(0.5) // curved, not straight
    // And the line still passes exactly through the grid points.
    expect(meshRowPoint(mesh, 1, 0, 1)).toEqual({ x: 50, y: 10 })
    expect(meshGridLines(mesh).length).toBe(6) // 3 row + 3 column lines
  })
})

describe('mesh tangent handles', () => {
  it('an explicit handle bends the row curve off the straight edge', () => {
    const mesh = rectMesh()
    // The unwarped top edge is flat (y = 0 everywhere).
    expect(meshRowPoint(mesh, 0, 0, 0.5).y).toBeCloseTo(0)
    // Bend the top-left point's RIGHT handle upward.
    mesh.points[0] = { ...mesh.points[0]!, handles: { right: { x: 25, y: -40 } } }
    expect(meshRowPoint(mesh, 0, 0, 0.5).y).toBeLessThan(-5)
    // The endpoints still interpolate exactly.
    expect(meshRowPoint(mesh, 0, 0, 0)).toEqual({ x: 0, y: 0 })
    expect(meshRowPoint(mesh, 0, 0, 1)).toEqual({ x: 100, y: 0 })
  })

  it('meshPointHandleTargets returns only the in-bounds directions', () => {
    const mesh = rectMesh() // 1x1: every point is a corner (two directions)
    const corner = meshPointHandleTargets(mesh, 0).map((h) => h.dir).sort()
    expect(corner).toEqual(['down', 'right'])
    expect(meshRowCol(mesh, 3)).toEqual({ r: 1, c: 1 })
  })
})

describe('meshAddDivision', () => {
  it('inserts a row+column with interpolated points and applies the new color', () => {
    const mesh = rectMesh()
    const red = { r: 255, g: 0, b: 0, a: 1 }
    meshAddDivision(mesh, { row: 0, col: 0, u: 0.5, v: 0.5 }, red)
    expect(mesh.rows).toBe(2)
    expect(mesh.cols).toBe(2)
    expect(mesh.points).toHaveLength(9)
    const center = mesh.points[meshIndex(mesh, 1, 1)]!
    expect(center.p.x).toBeCloseTo(50)
    expect(center.p.y).toBeCloseTo(25)
    expect(center.color).toEqual(red)
    // Edge midpoints interpolate their neighbors.
    expect(mesh.points[meshIndex(mesh, 0, 1)]!.p).toEqual({ x: 50, y: 0 })
    expect(mesh.points[meshIndex(mesh, 1, 0)]!.p).toEqual({ x: 0, y: 25 })
  })
})
