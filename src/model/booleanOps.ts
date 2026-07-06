/**
 * Model-level boolean operations: node geometry <-> Regions (the boolean
 * engine's Vec2 multipolygons, see geometry/boolean.ts) plus the face
 * arrangement used by Divide / Trim / Merge / Shape Builder.
 *
 * Curves are flattened adaptively before clipping, so boolean RESULTS are
 * polygonal paths (corner anchors). Regions are produced in DOCUMENT space
 * (through worldTransform), operated on there, and rebased into a parent's
 * local space when a result node is built.
 */

import { applyToPoint, invert, type Mat } from '../geometry/matrix'
import type { Vec2 } from '../geometry/vec2'
import { flatten, lengthOf } from '../geometry/bezier'
import {
  difference,
  intersection,
  regionsArea,
  union,
  xor,
  type Region,
  type Regions,
  type Ring,
} from '../geometry/boolean'
import type { NodeId, SceneNode, Style, SubPath } from './types'
import { toSubPaths } from './nodes'
import { createAnchor, createSubPath, subPathSegments } from './pathOps'
import { getWorldTransform } from './document'

/** Area below which a result polygon is discarded as numeric noise. */
const SLIVER_AREA = 1e-6

// ---------------------------------------------------------------------------
// Node -> Regions (doc space)
// ---------------------------------------------------------------------------

/** Flatten one subpath to a ring (open subpaths close implicitly, like AI). */
export function flattenSubPath(sp: SubPath, transform?: Mat): Ring {
  const ring: Ring = []
  const segs = subPathSegments(sp)
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i]!
    const { cubic } = seg
    const straight =
      cubic.p1.x === cubic.p0.x &&
      cubic.p1.y === cubic.p0.y &&
      cubic.p2.x === cubic.p3.x &&
      cubic.p2.y === cubic.p3.y
    const steps = straight
      ? 1
      : Math.min(48, Math.max(8, Math.ceil(lengthOf(cubic) / 2)))
    const pts = flatten(cubic, steps)
    for (let pi = ring.length === 0 ? 0 : 1; pi < pts.length; pi++) ring.push(pts[pi]!)
  }
  // Closed subpaths brought the start point back at the end; drop the repeat.
  const first = ring[0]
  const last = ring[ring.length - 1]
  if (
    ring.length > 1 &&
    first &&
    last &&
    Math.abs(first.x - last.x) < 1e-9 &&
    Math.abs(first.y - last.y) < 1e-9
  ) {
    ring.pop()
  }
  if (transform) {
    for (let i = 0; i < ring.length; i++) ring[i] = applyToPoint(transform, ring[i]!)
  }
  return ring
}

/**
 * A node's filled region in DOCUMENT space. Multiple subpaths combine by XOR
 * (matches even-odd rendering; donut holes stay holes). Groups/text yield [].
 */
export function nodeRegionsInDoc(nodes: Record<NodeId, SceneNode>, id: NodeId): Regions {
  const node = nodes[id]
  if (!node || node.type === 'group' || node.type === 'text') return []
  const world = getWorldTransform(nodes, id)
  const rings = toSubPaths(node)
    .map((sp) => flattenSubPath(sp, world))
    .filter((ring) => ring.length >= 3)
  if (rings.length === 0) return []
  if (rings.length === 1) return [[rings[0]!]]
  return xor([[rings[0]!]], ...rings.slice(1).map((r): Regions => [[r]]))
}

// ---------------------------------------------------------------------------
// Regions -> subpaths / result placement
// ---------------------------------------------------------------------------

/** Regions -> closed corner-anchor subpaths (compound path: holes = rings). */
export function regionsToSubPaths(regions: Regions): SubPath[] {
  const out: SubPath[] = []
  for (const region of regions) {
    for (const ring of region) {
      if (ring.length < 3) continue
      out.push(createSubPath(ring.map((p) => createAnchor({ x: p.x, y: p.y })), true))
    }
  }
  return out
}

export function regionsBBoxMin(regions: Regions): Vec2 {
  let minX = Infinity
  let minY = Infinity
  for (const region of regions) {
    for (const ring of region) {
      for (const p of ring) {
        if (p.x < minX) minX = p.x
        if (p.y < minY) minY = p.y
      }
    }
  }
  return Number.isFinite(minX) ? { x: minX, y: minY } : { x: 0, y: 0 }
}

/** Map doc-space regions into `parentId`'s local space (for result nodes). */
export function regionsToParentSpace(
  nodes: Record<NodeId, SceneNode>,
  parentId: NodeId,
  rootId: NodeId,
  regions: Regions,
): Regions {
  if (parentId === rootId) return regions
  const inv = invert(getWorldTransform(nodes, parentId))
  return regions.map((region) => region.map((ring) => ring.map((p) => applyToPoint(inv, p))))
}

/** Translate regions by -origin (rebase so the node transform holds placement). */
export function rebaseRegions(regions: Regions, origin: Vec2): Regions {
  return regions.map((region) =>
    region.map((ring) => ring.map((p) => ({ x: p.x - origin.x, y: p.y - origin.y }))),
  )
}

/** Drop noise-sized polygons a boolean op can leave behind. */
export function dropSlivers(regions: Regions): Regions {
  return regions.filter((region) => regionsArea([region]) > SLIVER_AREA)
}

// ---------------------------------------------------------------------------
// Face arrangement (Divide / Trim / Merge / Shape Builder)
// ---------------------------------------------------------------------------

/** One atomic region of the overlay arrangement. */
export interface Face {
  /** One polygon (exterior + holes) in DOCUMENT space. */
  region: Region
  /** The TOPMOST operand covering this face (style source). */
  sourceId: NodeId
}

export interface ArrangementOperand {
  id: NodeId
  /** Doc-space regions (nodeRegionsInDoc). */
  regions: Regions
  style: Style
}

/**
 * Full planar arrangement: every atomic face of the overlay, each carrying
 * the topmost operand covering it (Illustrator Divide semantics). Operands
 * must be ordered TOP first. Disjoint pieces become separate faces.
 */
export function buildFaces(operandsTopFirst: ArrangementOperand[]): Face[] {
  interface Piece {
    regions: Regions
    sourceId: NodeId
  }
  let pieces: Piece[] = []
  let covered: Regions = []
  for (const operand of operandsTopFirst) {
    if (operand.regions.length === 0) continue
    // Split every existing piece along this operand's boundary (both halves
    // keep their style — their source is above this operand).
    const next: Piece[] = []
    for (const piece of pieces) {
      const inside = dropSlivers(intersection(piece.regions, operand.regions))
      const outside = dropSlivers(difference(piece.regions, operand.regions))
      if (inside.length > 0) next.push({ regions: inside, sourceId: piece.sourceId })
      if (outside.length > 0) next.push({ regions: outside, sourceId: piece.sourceId })
    }
    // The part of this operand not covered by anything above it.
    const visible = dropSlivers(difference(operand.regions, covered))
    if (visible.length > 0) next.push({ regions: visible, sourceId: operand.id })
    covered = union(covered, operand.regions)
    pieces = next
  }
  // Explode multipolygons: each disjoint polygon is its own face.
  const faces: Face[] = []
  for (const piece of pieces) {
    for (const region of piece.regions) faces.push({ region, sourceId: piece.sourceId })
  }
  return faces
}

/**
 * Trim semantics: each operand keeps only its VISIBLE part (everything above
 * it subtracted). Ordered TOP first; returns bottom pieces too. No splitting
 * of the visible parts (unlike Divide).
 */
export function trimOperands(
  operandsTopFirst: ArrangementOperand[],
): Array<{ id: NodeId; regions: Regions }> {
  const out: Array<{ id: NodeId; regions: Regions }> = []
  let covered: Regions = []
  for (const operand of operandsTopFirst) {
    const visible = dropSlivers(difference(operand.regions, covered))
    if (visible.length > 0) out.push({ id: operand.id, regions: visible })
    covered = union(covered, operand.regions)
  }
  return out
}
