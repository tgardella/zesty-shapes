/**
 * Blend interpolation (Blend tool, W): pure geometry/style interpolation
 * between two objects' DOC-space outlines. The store command (blendCommands)
 * turns the interpolated rings into step PathNodes; nothing here touches a
 * document.
 *
 * Strategy: flatten both objects to polygon rings (booleanOps), resample each
 * ring to a fixed vertex count by arc length, align winding and start vertex,
 * then lerp vertex-by-vertex. Mismatched ring counts pair the extras with a
 * degenerate ring at the partner's centroid, so extra pieces grow from /
 * shrink to a point.
 */

import type { Vec2 } from '../geometry/vec2'
import type { Ring, Regions } from '../geometry/boolean'
import type { NodeId, Paint, SceneNode, Style } from './types'
import { crVec, lerpColor } from './mesh'
import { cloneStyle } from './nodes'
import { nodeRegionsInDoc } from './booleanOps'
import { getWorldTransform } from './document'
import { applyToPoint, invert } from '../geometry/matrix'

/** Vertices per interpolated ring (fidelity vs node weight). */
export const BLEND_RING_SAMPLES = 64

function signedArea(ring: Ring): number {
  let area = 0
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!
    const b = ring[(i + 1) % ring.length]!
    area += a.x * b.y - b.x * a.y
  }
  return area / 2
}

export function ringCentroid(ring: Ring): Vec2 {
  let x = 0
  let y = 0
  for (const p of ring) {
    x += p.x
    y += p.y
  }
  const n = Math.max(1, ring.length)
  return { x: x / n, y: y / n }
}

/** Resample a closed polygon ring to exactly `k` points, uniform by arc length. */
export function resampleRing(ring: Ring, k: number = BLEND_RING_SAMPLES): Ring {
  if (ring.length === 0) return []
  const lengths: number[] = []
  let total = 0
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!
    const b = ring[(i + 1) % ring.length]!
    const d = Math.hypot(b.x - a.x, b.y - a.y)
    lengths.push(d)
    total += d
  }
  if (total === 0) return Array.from({ length: k }, () => ({ ...ring[0]! }))
  const out: Ring = []
  let seg = 0
  let walked = 0
  for (let i = 0; i < k; i++) {
    const target = (i / k) * total
    while (walked + lengths[seg]! < target && seg < ring.length - 1) {
      walked += lengths[seg]!
      seg++
    }
    const a = ring[seg]!
    const b = ring[(seg + 1) % ring.length]!
    const t = lengths[seg]! === 0 ? 0 : (target - walked) / lengths[seg]!
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
  }
  return out
}

/**
 * Rotate (and reverse when winding disagrees) ring `b` so its vertices best
 * correspond to `a`'s — both must already share the same vertex count.
 */
export function alignRing(a: Ring, b: Ring): Ring {
  let candidate = b
  if (signedArea(a) * signedArea(b) < 0) candidate = [...b].reverse()
  const k = a.length
  let bestOffset = 0
  let bestCost = Infinity
  for (let off = 0; off < k; off++) {
    let cost = 0
    // Sparse sample of the correspondence cost — exact enough, 8x cheaper.
    for (let i = 0; i < k; i += 4) {
      const p = a[i]!
      const q = candidate[(i + off) % k]!
      cost += (p.x - q.x) ** 2 + (p.y - q.y) ** 2
      if (cost >= bestCost) break
    }
    if (cost < bestCost) {
      bestCost = cost
      bestOffset = off
    }
  }
  if (bestOffset === 0) return candidate
  return candidate.map((_, i) => candidate[(i + bestOffset) % k]!)
}

export function lerpRing(a: Ring, b: Ring, t: number): Ring {
  return a.map((p, i) => {
    const q = b[i]!
    return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t }
  })
}

/** A ring collapsed to a single point, sized to pair with `k`-vertex rings. */
export function degenerateRing(center: Vec2, k: number = BLEND_RING_SAMPLES): Ring {
  return Array.from({ length: k }, () => ({ ...center }))
}

export interface RingPair {
  a: Ring
  b: Ring
}

/**
 * Pair two objects' rings for interpolation: rings sort by |area| descending
 * (big pieces pair with big pieces), extras pair with a degenerate ring at
 * the partner side's overall centroid. All output rings share one vertex
 * count and aligned correspondence.
 */
export function pairRings(aRegions: Regions, bRegions: Regions): RingPair[] {
  const flatten = (regions: Regions): Ring[] =>
    regions
      .flat()
      .filter((r) => r.length >= 3)
      .sort((r1, r2) => Math.abs(signedArea(r2)) - Math.abs(signedArea(r1)))
  const aRings = flatten(aRegions).map((r) => resampleRing(r))
  const bRings = flatten(bRegions).map((r) => resampleRing(r))
  if (aRings.length === 0 || bRings.length === 0) return []
  const count = Math.max(aRings.length, bRings.length)
  const aCenter = ringCentroid(aRings[0]!)
  const bCenter = ringCentroid(bRings[0]!)
  const pairs: RingPair[] = []
  for (let i = 0; i < count; i++) {
    const a = aRings[i] ?? degenerateRing(bCenter)
    const b = bRings[i] ?? degenerateRing(aCenter)
    pairs.push({ a, b: alignRing(a, b) })
  }
  return pairs
}

// ---------------------------------------------------------------------------
// Style interpolation
// ---------------------------------------------------------------------------

function lerpPaint(a: Paint | null, b: Paint | null, t: number): Paint | null {
  if (a && b && a.type === 'solid' && b.type === 'solid') {
    return { type: 'solid', color: lerpColor(a.color, b.color, t) }
  }
  // Gradient or one-sided paints don't interpolate smoothly — switch halfway.
  const winner = t < 0.5 ? a : b
  return winner ? (JSON.parse(JSON.stringify(winner)) as Paint) : null
}

/** Interpolated style for a blend step (solid colors lerp; the rest switches). */
export function interpolateStyle(a: Style, b: Style, t: number): Style {
  const base = cloneStyle(t < 0.5 ? a : b)
  base.fill = lerpPaint(a.fill, b.fill, t)
  base.stroke = lerpPaint(a.stroke, b.stroke, t)
  base.strokeWidth = a.strokeWidth + (b.strokeWidth - a.strokeWidth) * t
  delete base.widthProfile
  return base
}

// ---------------------------------------------------------------------------
// Spine: the path the interpolated steps follow
// ---------------------------------------------------------------------------

/** Catmull-Rom polyline through the spine control points (>= 2), local space. */
export function spinePolyline(controls: Vec2[], per = 24): Vec2[] {
  if (controls.length <= 1) return controls.map((p) => ({ ...p }))
  if (controls.length === 2) return [{ ...controls[0]! }, { ...controls[1]! }]
  const at = (i: number): Vec2 => controls[Math.max(0, Math.min(controls.length - 1, i))]!
  const out: Vec2[] = [{ ...controls[0]! }]
  for (let i = 0; i < controls.length - 1; i++) {
    for (let k = 1; k <= per; k++) out.push(crVec(at(i - 1), at(i), at(i + 1), at(i + 2), k / per))
  }
  return out
}

interface SpinePath {
  poly: Vec2[]
  /** Cumulative arc length at each polyline vertex. */
  cum: number[]
  total: number
}

function buildSpine(controls: Vec2[]): SpinePath {
  const poly = spinePolyline(controls)
  const cum: number[] = [0]
  for (let i = 1; i < poly.length; i++) {
    cum.push(cum[i - 1]! + Math.hypot(poly[i]!.x - poly[i - 1]!.x, poly[i]!.y - poly[i - 1]!.y))
  }
  return { poly, cum, total: cum[cum.length - 1] ?? 0 }
}

export interface SpineSample {
  pos: Vec2
  /** Tangent direction (radians). */
  angle: number
}

/** Position + tangent at arc-length fraction `u` (0-1) along the spine. */
function sampleSpine(spine: SpinePath, u: number): SpineSample {
  const { poly, cum, total } = spine
  if (poly.length < 2 || total === 0) {
    const p = poly[0] ?? { x: 0, y: 0 }
    return { pos: { ...p }, angle: 0 }
  }
  const target = Math.max(0, Math.min(1, u)) * total
  let i = 1
  while (i < poly.length - 1 && cum[i]! < target) i++
  const a = poly[i - 1]!
  const b = poly[i]!
  const seg = cum[i]! - cum[i - 1]!
  const t = seg === 0 ? 0 : (target - cum[i - 1]!) / seg
  return {
    pos: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t },
    angle: Math.atan2(b.y - a.y, b.x - a.x),
  }
}

// ---------------------------------------------------------------------------
// LIVE blend: derived step geometry for a blend group
// ---------------------------------------------------------------------------

interface BlendOperand {
  regions: Regions
  first: Style
  last: Style
}

/** Union centroid of every ring in the regions (doc space). */
function regionsCentroid(regions: Regions): Vec2 {
  let x = 0
  let y = 0
  let n = 0
  for (const ring of regions.flat()) {
    for (const p of ring) {
      x += p.x
      y += p.y
      n++
    }
  }
  return n === 0 ? { x: 0, y: 0 } : { x: x / n, y: y / n }
}

/** DOC-space fill regions + first/last leaf styles of a blend endpoint subtree. */
function collectEndpoint(nodes: Record<NodeId, SceneNode>, id: NodeId): BlendOperand | null {
  const regions: Regions = []
  let first: Style | null = null
  let last: Style | null = null
  const visit = (nid: NodeId): void => {
    const node = nodes[nid]
    if (!node || node.hidden) return
    if (node.type === 'group') {
      for (const child of node.children) visit(child)
      return
    }
    if (node.type === 'text') return
    const r = nodeRegionsInDoc(nodes, nid)
    if (r.length === 0) return
    regions.push(...r)
    first ??= node.style
    last = node.style
  }
  visit(id)
  if (regions.length === 0 || !first || !last) return null
  return { regions, first, last }
}

export interface BlendStep {
  /** Step outline rings in the blend GROUP's local space. */
  regions: Regions
  style: Style
}

/**
 * The derived steps of a LIVE blend group (group.blend set, exactly two
 * children): interpolated outlines in the group's LOCAL space, bottom step
 * first. Renderer and exporter both consume this, so canvas and SVG can
 * never disagree. Returns [] when the group isn't a valid blend.
 */
export function blendStepGeometry(
  nodes: Record<NodeId, SceneNode>,
  groupId: NodeId,
): BlendStep[] {
  const group = nodes[groupId]
  if (!group || group.type !== 'group' || !group.blend || group.children.length !== 2) return []
  const a = collectEndpoint(nodes, group.children[0]!)
  const b = collectEndpoint(nodes, group.children[1]!)
  if (!a || !b) return []
  const pairs = pairRings(a.regions, b.regions)
  if (pairs.length === 0) return []

  const toLocal = invert(getWorldTransform(nodes, groupId))
  // The default straight spine runs between the two endpoint centroids
  // (LOCAL space); the lerped step centroid at t is exactly that line, so with
  // no explicit spine the offset below is a no-op.
  const aCenter = applyToPoint(toLocal, regionsCentroid(a.regions))
  const bCenter = applyToPoint(toLocal, regionsCentroid(b.regions))
  const controls = group.blend.spine ?? [aCenter, bCenter]
  const spine = buildSpine(controls)
  const baseAngle = Math.atan2(
    controls[controls.length - 1]!.y - controls[0]!.y,
    controls[controls.length - 1]!.x - controls[0]!.x,
  )
  const align = group.blend.spineAlign !== false

  const n = Math.max(1, Math.round(group.blend.steps))
  const steps: BlendStep[] = []
  for (let i = 1; i <= n; i++) {
    const t = i / (n + 1)
    // Default step position (straight spine) is the lerp of the centroids.
    const base = { x: aCenter.x + (bCenter.x - aCenter.x) * t, y: aCenter.y + (bCenter.y - aCenter.y) * t }
    const sample = sampleSpine(spine, t)
    const da = align ? sample.angle - baseAngle : 0
    const cos = Math.cos(da)
    const sin = Math.sin(da)
    // Rigid transform: rotate each ring about its base centroid by `da`, then
    // translate the centroid from `base` to the spine sample position.
    const place = (p: Vec2): Vec2 => {
      const dx = p.x - base.x
      const dy = p.y - base.y
      return { x: sample.pos.x + dx * cos - dy * sin, y: sample.pos.y + dx * sin + dy * cos }
    }
    const regions: Regions = pairs.map((pair) => [
      lerpRing(pair.a, pair.b, t).map((p) => place(applyToPoint(toLocal, p))),
    ])
    steps.push({ regions, style: interpolateStyle(a.first, b.last, t) })
  }
  return steps
}

/**
 * The effective spine control points of a live blend in its GROUP-LOCAL space:
 * the explicit `blend.spine` if set, else the straight line between the two
 * endpoint centroids. Null when the group isn't a valid live blend. Used by
 * the Blend tool + overlay for interactive spine editing.
 */
export function blendSpineControls(
  nodes: Record<NodeId, SceneNode>,
  groupId: NodeId,
): Vec2[] | null {
  const group = nodes[groupId]
  if (!group || group.type !== 'group' || !group.blend || group.children.length !== 2) return null
  const explicit = group.blend.spine
  if (explicit && explicit.length >= 2) return explicit.map((p) => ({ ...p }))
  const a = collectEndpoint(nodes, group.children[0]!)
  const b = collectEndpoint(nodes, group.children[1]!)
  if (!a || !b) return null
  const toLocal = invert(getWorldTransform(nodes, groupId))
  return [
    applyToPoint(toLocal, regionsCentroid(a.regions)),
    applyToPoint(toLocal, regionsCentroid(b.regions)),
  ]
}
