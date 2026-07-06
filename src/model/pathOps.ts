/**
 * Pure operations on SubPath/Anchor data — the engine room for the path
 * editing tools (Direct Selection, Pen, Curvature, Pencil, Scissors).
 * Everything works in the node's LOCAL space on plain JSON; mutating helpers
 * are written to run on Immer drafts inside store commands. No tool or store
 * imports here.
 */

import { nanoid } from 'nanoid'
import type { CubicSegment } from '../geometry/bezier'
import { nearestT, splitAt } from '../geometry/bezier'
import type { Vec2 } from '../geometry/vec2'
import { add, distance, normalize, scale, sub } from '../geometry/vec2'
import type { Anchor, AnchorType, SubPath, SubPathId } from './types'

export function createAnchor(
  point: Vec2,
  opts: { handleIn?: Vec2 | null; handleOut?: Vec2 | null; type?: AnchorType } = {},
): Anchor {
  return {
    id: nanoid(),
    point: { ...point },
    handleIn: opts.handleIn ? { ...opts.handleIn } : null,
    handleOut: opts.handleOut ? { ...opts.handleOut } : null,
    type: opts.type ?? 'corner',
  }
}

export function createSubPath(anchors: Anchor[], closed = false): SubPath {
  return { id: nanoid(), closed, anchors }
}

// ---------------------------------------------------------------------------
// Segments
// ---------------------------------------------------------------------------

/** The cubic from anchor a0 to a1 (absent handles collapse to the endpoints). */
export function segmentCubic(a0: Anchor, a1: Anchor): CubicSegment {
  return {
    p0: a0.point,
    p1: a0.handleOut ?? a0.point,
    p2: a1.handleIn ?? a1.point,
    p3: a1.point,
  }
}

export interface SubPathSegment {
  cubic: CubicSegment
  /** Index of the segment's start anchor. */
  startIndex: number
  /** Index of the end anchor ((start+1) % n; 0 for the closing segment). */
  endIndex: number
}

/** All drawable segments, including the closing one for closed subpaths. */
export function subPathSegments(sp: SubPath): SubPathSegment[] {
  const out: SubPathSegment[] = []
  const n = sp.anchors.length
  if (n < 2) return out
  const last = sp.closed ? n : n - 1
  for (let i = 0; i < last; i++) {
    const j = (i + 1) % n
    out.push({ cubic: segmentCubic(sp.anchors[i]!, sp.anchors[j]!), startIndex: i, endIndex: j })
  }
  return out
}

export interface NearestSubPathHit {
  subPathId: SubPathId
  segIndex: number
  t: number
  point: Vec2
  distance: number
}

/** Closest point across all segments of all subpaths (LOCAL space). */
export function nearestOnSubPaths(subpaths: SubPath[], p: Vec2): NearestSubPathHit | null {
  let best: NearestSubPathHit | null = null
  for (const sp of subpaths) {
    const segments = subPathSegments(sp)
    for (let i = 0; i < segments.length; i++) {
      const near = nearestT(segments[i]!.cubic, p)
      if (!best || near.distance < best.distance) {
        best = {
          subPathId: sp.id,
          segIndex: i,
          t: near.t,
          point: near.point,
          distance: near.distance,
        }
      }
    }
  }
  return best
}

// ---------------------------------------------------------------------------
// Structural edits (run these on Immer drafts)
// ---------------------------------------------------------------------------

/**
 * Insert an anchor on segment `segIndex` at parameter `t`, preserving the
 * curve's exact shape (de Casteljau split). Straight segments (no handles on
 * either side) stay straight — the new anchor gets no handles. Returns the
 * new anchor.
 */
export function insertAnchorOnSegment(sp: SubPath, segIndex: number, t: number): Anchor {
  const segments = subPathSegments(sp)
  const seg = segments[segIndex]
  if (!seg) throw new Error(`insertAnchorOnSegment: no segment ${segIndex}`)
  const a0 = sp.anchors[seg.startIndex]!
  const a1 = sp.anchors[seg.endIndex]!

  let anchor: Anchor
  if (a0.handleOut === null && a1.handleIn === null) {
    // Straight segment: plain point on the line, no handles.
    anchor = createAnchor({
      x: a0.point.x + (a1.point.x - a0.point.x) * t,
      y: a0.point.y + (a1.point.y - a0.point.y) * t,
    })
  } else {
    const [left, right] = splitAt(seg.cubic, t)
    a0.handleOut = { ...left.p1 }
    a1.handleIn = { ...right.p2 }
    anchor = createAnchor(left.p3, { handleIn: left.p2, handleOut: right.p1, type: 'smooth' })
  }
  sp.anchors.splice(seg.startIndex + 1, 0, anchor)
  return anchor
}

/**
 * Remove an anchor by id. Returns true if removed. (Callers decide what to do
 * with subpaths that drop below 2 anchors.)
 */
export function removeAnchor(sp: SubPath, anchorId: string): boolean {
  const i = sp.anchors.findIndex((a) => a.id === anchorId)
  if (i === -1) return false
  sp.anchors.splice(i, 1)
  return true
}

/** Reverse direction in place (Pen "continue from the first endpoint"). */
export function reverseSubPath(sp: SubPath): void {
  sp.anchors.reverse()
  for (const a of sp.anchors) {
    const tmp = a.handleIn
    a.handleIn = a.handleOut
    a.handleOut = tmp
  }
}

/**
 * Catmull-Rom-style auto-smoothing (the Curvature tool's fit): every
 * non-corner anchor gets handles along the chord of its neighbors, scaled by
 * a third of the distance to each neighbor. Corner anchors are untouched;
 * open endpoints get a single handle toward their neighbor's tangent.
 */
export function autoSmoothSubPath(sp: SubPath): void {
  const n = sp.anchors.length
  if (n < 2) return
  for (let i = 0; i < n; i++) {
    const a = sp.anchors[i]!
    if (a.type === 'corner') continue
    const prev = sp.closed ? sp.anchors[(i - 1 + n) % n]! : i > 0 ? sp.anchors[i - 1]! : null
    const next = sp.closed ? sp.anchors[(i + 1) % n]! : i < n - 1 ? sp.anchors[i + 1]! : null
    if (prev && next) {
      const chord = sub(next.point, prev.point)
      const len = Math.hypot(chord.x, chord.y)
      if (len < 1e-9) {
        a.handleIn = null
        a.handleOut = null
        continue
      }
      const dir = { x: chord.x / len, y: chord.y / len }
      const dIn = distance(a.point, prev.point) / 3
      const dOut = distance(a.point, next.point) / 3
      a.handleIn = sub(a.point, scale(dir, dIn))
      a.handleOut = add(a.point, scale(dir, dOut))
      if (a.type !== 'symmetric') a.type = 'smooth'
    } else if (next) {
      // Open start: aim a third of the way toward the next anchor's inbound side.
      const target = next.handleIn ?? next.point
      a.handleOut = add(a.point, scale(sub(target, a.point), 1 / 3))
      a.handleIn = null
    } else if (prev) {
      const target = prev.handleOut ?? prev.point
      a.handleIn = add(a.point, scale(sub(target, a.point), 1 / 3))
      a.handleOut = null
    }
  }
}

/**
 * Scissors: split at anchor `index`. Closed subpath -> ONE open subpath
 * starting and ending at (a copy of) that anchor. Open subpath -> TWO open
 * subpaths sharing a duplicated anchor (no-op at open endpoints: returns
 * [sp]). The cut anchors keep only their outer handle.
 */
export function splitSubPathAtAnchorIndex(sp: SubPath, index: number): SubPath[] {
  const n = sp.anchors.length
  if (n < 2 || index < 0 || index >= n) return [sp]
  if (sp.closed) {
    const rotated = [...sp.anchors.slice(index), ...sp.anchors.slice(0, index)]
    const first = rotated[0]!
    const closingCopy: Anchor = {
      ...createAnchor(first.point, { handleIn: first.handleIn, type: first.type }),
    }
    const opened: Anchor[] = [
      { ...first, handleIn: null },
      ...rotated.slice(1),
      closingCopy,
    ]
    return [{ id: sp.id, closed: false, anchors: opened }]
  }
  if (index === 0 || index === n - 1) return [sp]
  const at = sp.anchors[index]!
  const firstHalf = [...sp.anchors.slice(0, index), { ...at, handleOut: null }]
  const secondHalf = [
    createAnchor(at.point, { handleOut: at.handleOut, type: at.type }),
    ...sp.anchors.slice(index + 1),
  ]
  return [
    { id: sp.id, closed: false, anchors: firstHalf },
    createSubPath(secondHalf, false),
  ]
}

/** Scissors on a segment: insert a split anchor there, then cut at it. */
export function splitSubPathAtSegment(sp: SubPath, segIndex: number, t: number): SubPath[] {
  const anchor = insertAnchorOnSegment(sp, segIndex, t)
  const index = sp.anchors.findIndex((a) => a.id === anchor.id)
  return splitSubPathAtAnchorIndex(sp, index)
}

// ---------------------------------------------------------------------------
// Pencil fitting
// ---------------------------------------------------------------------------

/** Ramer-Douglas-Peucker polyline simplification. */
export function rdpSimplify(points: Vec2[], tolerance: number): Vec2[] {
  if (points.length <= 2) return [...points]
  const keep = new Array<boolean>(points.length).fill(false)
  keep[0] = true
  keep[points.length - 1] = true
  const stack: Array<[number, number]> = [[0, points.length - 1]]
  while (stack.length > 0) {
    const [s, e] = stack.pop()!
    const a = points[s]!
    const b = points[e]!
    let maxDist = -1
    let maxIdx = -1
    for (let i = s + 1; i < e; i++) {
      const d = pointToSegmentDistance(points[i]!, a, b)
      if (d > maxDist) {
        maxDist = d
        maxIdx = i
      }
    }
    if (maxDist > tolerance && maxIdx > 0) {
      keep[maxIdx] = true
      stack.push([s, maxIdx], [maxIdx, e])
    }
  }
  return points.filter((_, i) => keep[i])
}

function pointToSegmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const ab = sub(b, a)
  const lenSq = ab.x * ab.x + ab.y * ab.y
  if (lenSq < 1e-12) return distance(p, a)
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / lenSq))
  return distance(p, { x: a.x + ab.x * t, y: a.y + ab.y * t })
}

/**
 * Fit a freehand point stream to a smooth open subpath: RDP to find the
 * significant points, then Catmull-Rom handles through them.
 */
export function fitPointsToSubPath(points: Vec2[], tolerance: number): SubPath | null {
  const simplified = rdpSimplify(points, tolerance)
  if (simplified.length < 2) return null
  const sp = createSubPath(
    simplified.map((p) => createAnchor(p, { type: 'smooth' })),
    false,
  )
  autoSmoothSubPath(sp)
  return sp
}

/** Mirror `handle` through `point` (symmetric anchors). */
export function mirrorHandle(point: Vec2, handle: Vec2): Vec2 {
  return { x: 2 * point.x - handle.x, y: 2 * point.y - handle.y }
}

/**
 * Re-aim the opposite handle after a handle drag, per anchor type:
 * symmetric = exact mirror; smooth = mirrored direction, original length.
 */
export function mirrorOppositeHandle(
  anchor: Anchor,
  dragged: 'in' | 'out',
): void {
  const h = dragged === 'in' ? anchor.handleIn : anchor.handleOut
  if (!h) return
  if (anchor.type === 'symmetric') {
    const m = mirrorHandle(anchor.point, h)
    if (dragged === 'in') anchor.handleOut = m
    else anchor.handleIn = m
  } else if (anchor.type === 'smooth') {
    const opposite = dragged === 'in' ? anchor.handleOut : anchor.handleIn
    if (!opposite) return
    const len = distance(anchor.point, opposite)
    const dir = normalize(sub(anchor.point, h))
    const m = add(anchor.point, scale(dir, len))
    if (dragged === 'in') anchor.handleOut = m
    else anchor.handleIn = m
  }
}
