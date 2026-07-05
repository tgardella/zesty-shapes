/**
 * The bridge between the model (SubPath/Anchor), rendering, and export:
 *
 *   subpathsToPathData(subpaths)  ->  SVG `d` string
 *   parsePathData(d)              ->  SubPath[]  (tolerant parser)
 *
 * Round-trip contract: subpaths -> d -> subpaths preserves geometry exactly
 * (up to NUM_PRECISION decimal places). Parsing allocates fresh subpath/anchor
 * ids (a `d` string carries none) and infers anchor types from handle geometry.
 *
 * Parser tolerance: absolute+relative commands, H/V/S/T shorthands, Q/T
 * quadratics (converted to cubics), A arcs (converted to cubic approximations),
 * implicit repeated commands, comma/whitespace flexibility, and `M` followed by
 * multiple coordinate pairs (implicit lineto per the SVG spec).
 */

import { nanoid } from 'nanoid'
import type { Anchor, AnchorType, SubPath } from '../model/types'
import type { Vec2 } from './vec2'
import { equals, length, normalize, sub } from './vec2'
import type { Mat } from './matrix'
import { applyToPoint } from './matrix'
import type { CubicSegment } from './bezier'

// ---------------------------------------------------------------------------
// Segment iteration (shared by bbox, hittest, serialization)
// ---------------------------------------------------------------------------

export type PathSeg =
  | { kind: 'line'; a: Vec2; b: Vec2 }
  | { kind: 'cubic'; cubic: CubicSegment }

/**
 * Expand a subpath into its drawable segments, including the implicit closing
 * segment when `closed`. A segment is a cubic iff either adjacent handle exists.
 */
export function segmentsOfSubPath(subpath: SubPath): PathSeg[] {
  const { anchors, closed } = subpath
  const segs: PathSeg[] = []
  if (anchors.length < 2) return segs
  const count = closed ? anchors.length : anchors.length - 1
  for (let i = 0; i < count; i++) {
    const from = anchors[i]!
    const to = anchors[(i + 1) % anchors.length]!
    if (from.handleOut === null && to.handleIn === null) {
      segs.push({ kind: 'line', a: from.point, b: to.point })
    } else {
      segs.push({
        kind: 'cubic',
        cubic: {
          p0: from.point,
          p1: from.handleOut ?? from.point,
          p2: to.handleIn ?? to.point,
          p3: to.point,
        },
      })
    }
  }
  return segs
}

/**
 * Map subpaths through an affine transform (points AND absolute handles —
 * affine maps preserve bezier geometry exactly). Ids are preserved; the
 * result is a derived copy, typically local -> world for hit-testing.
 */
export function transformSubPaths(m: Mat, subpaths: SubPath[]): SubPath[] {
  return subpaths.map((sp) => ({
    ...sp,
    anchors: sp.anchors.map((a) => ({
      ...a,
      point: applyToPoint(m, a.point),
      handleIn: a.handleIn ? applyToPoint(m, a.handleIn) : null,
      handleOut: a.handleOut ? applyToPoint(m, a.handleOut) : null,
    })),
  }))
}

// ---------------------------------------------------------------------------
// Serializer: subpaths -> d
// ---------------------------------------------------------------------------

/** Decimal places emitted into `d` strings. */
const NUM_PRECISION = 6

function fmt(n: number): string {
  if (!Number.isFinite(n)) throw new Error(`pathData: non-finite coordinate ${n}`)
  const rounded = Number(n.toFixed(NUM_PRECISION))
  // Number() normalizes -0 and drops trailing zeros via String().
  return String(rounded === 0 ? 0 : rounded)
}

function fmtPoint(p: Vec2): string {
  return `${fmt(p.x)} ${fmt(p.y)}`
}

export function subpathToPathData(subpath: SubPath): string {
  const { anchors, closed } = subpath
  if (anchors.length === 0) return ''
  const first = anchors[0]!
  const parts: string[] = [`M ${fmtPoint(first.point)}`]
  if (anchors.length === 1) {
    return closed ? `${parts[0]} Z` : parts[0]!
  }
  for (let i = 1; i < anchors.length; i++) {
    parts.push(segmentCommand(anchors[i - 1]!, anchors[i]!))
  }
  if (closed) {
    const last = anchors[anchors.length - 1]!
    // Emit the closing segment explicitly when it curves; a bare Z closes with a line.
    if (last.handleOut !== null || first.handleIn !== null) {
      parts.push(segmentCommand(last, first))
    }
    parts.push('Z')
  }
  return parts.join(' ')
}

function segmentCommand(from: Anchor, to: Anchor): string {
  if (from.handleOut === null && to.handleIn === null) {
    return `L ${fmtPoint(to.point)}`
  }
  const c1 = from.handleOut ?? from.point
  const c2 = to.handleIn ?? to.point
  return `C ${fmtPoint(c1)} ${fmtPoint(c2)} ${fmtPoint(to.point)}`
}

export function subpathsToPathData(subpaths: SubPath[]): string {
  return subpaths
    .map(subpathToPathData)
    .filter((s) => s.length > 0)
    .join(' ')
}

// ---------------------------------------------------------------------------
// Parser: d -> subpaths
// ---------------------------------------------------------------------------

const NUM_RE = /[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/y
const WS_RE = /[\s,]*/y

class DScanner {
  private pos = 0
  constructor(private readonly d: string) {}

  private skipSeparators(): void {
    WS_RE.lastIndex = this.pos
    const m = WS_RE.exec(this.d)
    if (m) this.pos += m[0].length
  }

  /** Next command letter, or null at end. Throws on garbage. */
  nextCommand(prev: string | null): string | null {
    this.skipSeparators()
    if (this.pos >= this.d.length) return null
    const ch = this.d[this.pos]!
    if (/[a-zA-Z]/.test(ch)) {
      this.pos++
      return ch
    }
    // A number where a command could be = implicit repeat of the previous command
    // (M/m repeats as L/l per the SVG spec).
    if (prev !== null && /[-+.\d]/.test(ch)) {
      if (prev === 'M') return 'L'
      if (prev === 'm') return 'l'
      return prev
    }
    throw new Error(`pathData: unexpected character '${ch}' at ${this.pos}`)
  }

  number(): number {
    this.skipSeparators()
    NUM_RE.lastIndex = this.pos
    const m = NUM_RE.exec(this.d)
    if (!m) throw new Error(`pathData: expected number at ${this.pos} in '${this.d}'`)
    this.pos += m[0].length
    return parseFloat(m[0])
  }

  /** Arc flags may be smashed together ('11' = two flags), so parse a single digit. */
  flag(): number {
    this.skipSeparators()
    const ch = this.d[this.pos]
    if (ch === '0' || ch === '1') {
      this.pos++
      return ch === '1' ? 1 : 0
    }
    throw new Error(`pathData: expected arc flag at ${this.pos}`)
  }
}

/** Mutable accumulation state for one subpath being parsed. */
interface PendingSubPath {
  anchors: Anchor[]
  closed: boolean
}

function makeAnchor(point: Vec2): Anchor {
  return { id: nanoid(), point, handleIn: null, handleOut: null, type: 'corner' }
}

/**
 * Infer anchor type from handle geometry (a `d` string carries no anchor types):
 * collinear opposite handles = smooth; collinear AND equal length = symmetric.
 */
function inferAnchorType(anchor: Anchor): AnchorType {
  const { point, handleIn, handleOut } = anchor
  if (!handleIn || !handleOut) return 'corner'
  const din = sub(handleIn, point)
  const dout = sub(handleOut, point)
  const lin = length(din)
  const lout = length(dout)
  if (lin < 1e-9 || lout < 1e-9) return 'corner'
  const nin = normalize(din)
  const nout = normalize(dout)
  // Opposite directions => collinear through the anchor.
  const collinear = Math.abs(nin.x + nout.x) < 1e-6 && Math.abs(nin.y + nout.y) < 1e-6
  if (!collinear) return 'corner'
  return Math.abs(lin - lout) < 1e-6 ? 'symmetric' : 'smooth'
}

function finalizeSubPath(pending: PendingSubPath): SubPath | null {
  const { anchors, closed } = pending
  if (anchors.length === 0) return null
  // If a closing segment returned exactly to the start, fold the trailing
  // anchor's handleIn into the first anchor and drop the duplicate.
  if (closed && anchors.length > 1) {
    const first = anchors[0]!
    const last = anchors[anchors.length - 1]!
    if (equals(first.point, last.point, 1e-9)) {
      first.handleIn = last.handleIn
      anchors.pop()
    }
  }
  for (const a of anchors) a.type = inferAnchorType(a)
  return { id: nanoid(), closed, anchors }
}

export function parsePathData(d: string): SubPath[] {
  const scanner = new DScanner(d)
  const subpaths: SubPath[] = []
  let pending: PendingSubPath | null = null
  let current: Vec2 = { x: 0, y: 0 }
  let subpathStart: Vec2 = { x: 0, y: 0 }
  /**
   * Last cubic control point (for S) / quadratic control (for T). Held in an
   * object because TS control-flow analysis cannot see the closure writes to
   * plain `let` bindings and would narrow them to `never`.
   */
  const refl: { cubicC2: Vec2 | null; quadC: Vec2 | null } = { cubicC2: null, quadC: null }
  let prevCmd: string | null = null

  const flush = (): void => {
    if (pending) {
      const sp = finalizeSubPath(pending)
      if (sp) subpaths.push(sp)
      pending = null
    }
  }

  const ensurePending = (): PendingSubPath => {
    if (!pending) {
      // Tolerate a path that starts without M: implicit M 0 0.
      pending = { anchors: [makeAnchor({ ...current })], closed: false }
      subpathStart = { ...current }
    }
    return pending
  }

  const lastAnchor = (): Anchor => {
    const p = ensurePending()
    return p.anchors[p.anchors.length - 1]!
  }

  const lineTo = (to: Vec2): void => {
    ensurePending().anchors.push(makeAnchor(to))
    current = to
    refl.cubicC2 = null
    refl.quadC = null
  }

  const cubicTo = (c1: Vec2, c2: Vec2, to: Vec2): void => {
    const from = lastAnchor()
    if (!equals(c1, from.point, 1e-12)) from.handleOut = c1
    const anchor = makeAnchor(to)
    if (!equals(c2, to, 1e-12)) anchor.handleIn = c2
    ensurePending().anchors.push(anchor)
    current = to
    refl.cubicC2 = c2
    refl.quadC = null
  }

  const quadTo = (q: Vec2, to: Vec2): void => {
    // Exact quadratic -> cubic elevation.
    const from = current
    const c1 = { x: from.x + (2 / 3) * (q.x - from.x), y: from.y + (2 / 3) * (q.y - from.y) }
    const c2 = { x: to.x + (2 / 3) * (q.x - to.x), y: to.y + (2 / 3) * (q.y - to.y) }
    cubicTo(c1, c2, to)
    refl.quadC = q
  }

  const arcTo = (
    rx: number,
    ry: number,
    xRotDeg: number,
    largeArc: number,
    sweep: number,
    to: Vec2,
  ): void => {
    for (const cubic of arcToCubics(current, rx, ry, xRotDeg, largeArc, sweep, to)) {
      cubicTo(cubic.p1, cubic.p2, cubic.p3)
    }
    if (equals(current, to, 1e-12)) return
    current = to
  }

  for (;;) {
    const cmd = scanner.nextCommand(prevCmd)
    if (cmd === null) break
    const rel = cmd === cmd.toLowerCase()
    const rp = (): Vec2 => {
      const x = scanner.number()
      const y = scanner.number()
      return rel ? { x: current.x + x, y: current.y + y } : { x, y }
    }

    switch (cmd.toUpperCase()) {
      case 'M': {
        flush()
        const to = rp()
        pending = { anchors: [makeAnchor(to)], closed: false }
        current = to
        subpathStart = { ...to }
        refl.cubicC2 = null
        refl.quadC = null
        break
      }
      case 'L':
        lineTo(rp())
        break
      case 'H': {
        const x = scanner.number()
        lineTo({ x: rel ? current.x + x : x, y: current.y })
        break
      }
      case 'V': {
        const y = scanner.number()
        lineTo({ x: current.x, y: rel ? current.y + y : y })
        break
      }
      case 'C': {
        const c1 = rp()
        const c2 = rp()
        cubicTo(c1, c2, rp())
        break
      }
      case 'S': {
        const prev = refl.cubicC2
        const c1 = prev
          ? { x: 2 * current.x - prev.x, y: 2 * current.y - prev.y }
          : { ...current }
        const c2 = rp()
        cubicTo(c1, c2, rp())
        break
      }
      case 'Q':
        {
          const q = rp()
          quadTo(q, rp())
        }
        break
      case 'T': {
        const prev = refl.quadC
        const q = prev
          ? { x: 2 * current.x - prev.x, y: 2 * current.y - prev.y }
          : { ...current }
        quadTo(q, rp())
        break
      }
      case 'A': {
        const rx = scanner.number()
        const ry = scanner.number()
        const rot = scanner.number()
        const largeArc = scanner.flag()
        const sweep = scanner.flag()
        arcTo(rx, ry, rot, largeArc, sweep, rp())
        break
      }
      case 'Z': {
        if (pending !== null) {
          ;(pending as PendingSubPath).closed = true
          flush()
        }
        current = { ...subpathStart }
        refl.cubicC2 = null
        refl.quadC = null
        break
      }
      default:
        throw new Error(`pathData: unsupported command '${cmd}'`)
    }
    prevCmd = cmd
  }
  flush()
  return subpaths
}

// ---------------------------------------------------------------------------
// Elliptical arc -> cubic approximation (SVG endpoint parameterization)
// ---------------------------------------------------------------------------

/**
 * Standard endpoint -> center conversion (SVG 1.1 F.6.5) then one cubic per
 * <= 90° sweep slice. Error is far below render/hit tolerance.
 */
function arcToCubics(
  from: Vec2,
  rx: number,
  ry: number,
  xRotDeg: number,
  largeArc: number,
  sweep: number,
  to: Vec2,
): CubicSegment[] {
  if (rx === 0 || ry === 0 || equals(from, to, 1e-12)) {
    // Degenerate arc renders as a straight line per spec.
    return [
      {
        p0: from,
        p1: { x: from.x + (to.x - from.x) / 3, y: from.y + (to.y - from.y) / 3 },
        p2: { x: from.x + (2 * (to.x - from.x)) / 3, y: from.y + (2 * (to.y - from.y)) / 3 },
        p3: to,
      },
    ]
  }
  let arx = Math.abs(rx)
  let ary = Math.abs(ry)
  const phi = (xRotDeg * Math.PI) / 180
  const cosPhi = Math.cos(phi)
  const sinPhi = Math.sin(phi)

  // F.6.5.1: midpoint-relative coordinates in the rotated frame.
  const dx2 = (from.x - to.x) / 2
  const dy2 = (from.y - to.y) / 2
  const x1p = cosPhi * dx2 + sinPhi * dy2
  const y1p = -sinPhi * dx2 + cosPhi * dy2

  // F.6.6: scale radii up if they cannot span the endpoints.
  const lambda = (x1p * x1p) / (arx * arx) + (y1p * y1p) / (ary * ary)
  if (lambda > 1) {
    const s = Math.sqrt(lambda)
    arx *= s
    ary *= s
  }

  // F.6.5.2: center in the rotated frame.
  const rx2 = arx * arx
  const ry2 = ary * ary
  const num = rx2 * ry2 - rx2 * y1p * y1p - ry2 * x1p * x1p
  const den = rx2 * y1p * y1p + ry2 * x1p * x1p
  const coef = (largeArc !== sweep ? 1 : -1) * Math.sqrt(Math.max(0, num / den))
  const cxp = (coef * (arx * y1p)) / ary
  const cyp = (coef * (-ary * x1p)) / arx

  // F.6.5.3: back to the original frame.
  const cx = cosPhi * cxp - sinPhi * cyp + (from.x + to.x) / 2
  const cy = sinPhi * cxp + cosPhi * cyp + (from.y + to.y) / 2

  const angleOf = (ux: number, uy: number, vx: number, vy: number): number => {
    const dot = ux * vx + uy * vy
    const len = Math.hypot(ux, uy) * Math.hypot(vx, vy)
    let ang = Math.acos(Math.min(1, Math.max(-1, dot / len)))
    if (ux * vy - uy * vx < 0) ang = -ang
    return ang
  }

  const theta1 = angleOf(1, 0, (x1p - cxp) / arx, (y1p - cyp) / ary)
  let dTheta = angleOf(
    (x1p - cxp) / arx,
    (y1p - cyp) / ary,
    (-x1p - cxp) / arx,
    (-y1p - cyp) / ary,
  )
  if (sweep === 0 && dTheta > 0) dTheta -= 2 * Math.PI
  if (sweep === 1 && dTheta < 0) dTheta += 2 * Math.PI

  const slices = Math.max(1, Math.ceil(Math.abs(dTheta) / (Math.PI / 2)))
  const delta = dTheta / slices
  // Cubic control length for a `delta` arc slice on the unit circle.
  const k = ((4 / 3) * Math.tan(delta / 4))

  const pointOn = (theta: number): Vec2 => {
    const x = arx * Math.cos(theta)
    const y = ary * Math.sin(theta)
    return {
      x: cosPhi * x - sinPhi * y + cx,
      y: sinPhi * x + cosPhi * y + cy,
    }
  }
  const derivativeOn = (theta: number): Vec2 => {
    const x = -arx * Math.sin(theta)
    const y = ary * Math.cos(theta)
    return {
      x: cosPhi * x - sinPhi * y,
      y: sinPhi * x + cosPhi * y,
    }
  }

  const out: CubicSegment[] = []
  let t0 = theta1
  let start = from
  for (let i = 0; i < slices; i++) {
    const t1 = t0 + delta
    const end = i === slices - 1 ? to : pointOn(t1)
    const d0 = derivativeOn(t0)
    const d1 = derivativeOn(t1)
    out.push({
      p0: start,
      p1: { x: start.x + k * d0.x, y: start.y + k * d0.y },
      p2: { x: end.x - k * d1.x, y: end.y - k * d1.y },
      p3: end,
    })
    t0 = t1
    start = end
  }
  return out
}
