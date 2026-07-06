/**
 * Variable-width stroke engine (Width tool, Shift+W).
 *
 * The model stores Style.widthProfile: WidthStop[] — (offset 0-1 along the
 * TOTAL path length, width in local units). This module provides the shared
 * math for BOTH the live renderer and the SVG exporter, so they stay in
 * agreement:
 *  - arc-length sampling of a node's subpaths (local space)
 *  - width interpolation along the profile (linear between stops, clamped
 *    beyond the first/last stop)
 *  - the rendered APPROXIMATION: many short polyline chunks, each stroked at
 *    its interpolated width with round caps/joins.
 *
 * A TRUE outlined variable-width stroke (a filled offset-curve outline) is
 * boolean/offset-engine work and lands after Prompt 5 — this approximation is
 * the deliberate stand-in until then.
 */

import type { Vec2 } from '../geometry/vec2'
import { distance } from '../geometry/vec2'
import { flatten } from '../geometry/bezier'
import { subPathSegments } from './pathOps'
import type { Style, SubPath, WidthStop } from './types'

/** One flattened sample along the concatenated subpaths. */
export interface PathSample {
  point: Vec2
  /** Unit tangent (forward direction along the path). */
  tangent: Vec2
  /** Arc-length offset 0-1 along the TOTAL length of all subpaths. */
  u: number
  /** Which subpath run this sample belongs to. */
  run: number
}

export interface SampledPath {
  samples: PathSample[]
  /** Per-subpath sample index ranges: [start, end) — chunks never cross runs. */
  runs: Array<{ start: number; end: number }>
  totalLength: number
}

const FLATTEN_STEPS = 12

/** True when the style renders as a variable-width stroke. */
export function hasWidthProfile(style: Style): boolean {
  return style.stroke !== null && (style.widthProfile?.length ?? 0) > 0
}

/** Profile stops sorted by offset (new array; input untouched). */
export function sortedProfile(profile: WidthStop[]): WidthStop[] {
  return [...profile].sort((a, b) => a.offset - b.offset)
}

/**
 * Width at offset `u` (0-1): linear between stops, clamped to the first/last
 * stop beyond the profile's ends. `fallback` (the uniform strokeWidth) is
 * used only for an empty profile.
 */
export function widthAt(profile: WidthStop[], u: number, fallback: number): number {
  if (profile.length === 0) return fallback
  const stops = sortedProfile(profile)
  const first = stops[0]!
  if (u <= first.offset) return first.width
  const last = stops[stops.length - 1]!
  if (u >= last.offset) return last.width
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i]!
    const b = stops[i + 1]!
    if (u >= a.offset && u <= b.offset) {
      const span = b.offset - a.offset
      const t = span < 1e-9 ? 0 : (u - a.offset) / span
      return a.width + (b.width - a.width) * t
    }
  }
  return last.width
}

/**
 * Flatten subpaths into arc-length parameterized samples (LOCAL space).
 * Returns null when there is no measurable geometry.
 */
export function samplePath(subpaths: SubPath[], stepsPerSegment = FLATTEN_STEPS): SampledPath | null {
  const samples: PathSample[] = []
  const runs: Array<{ start: number; end: number }> = []
  const lengths: number[] = [] // cumulative length per sample, pre-normalization

  let total = 0
  for (const sp of subpaths) {
    const start = samples.length
    const segs = subPathSegments(sp)
    for (let si = 0; si < segs.length; si++) {
      const pts = flatten(segs[si]!.cubic, stepsPerSegment)
      // Skip the first point of every segment after the run's first — it
      // duplicates the previous segment's endpoint.
      for (let pi = samples.length === start ? 0 : 1; pi < pts.length; pi++) {
        const p = pts[pi]!
        if (samples.length > start) {
          total += distance(samples[samples.length - 1]!.point, p)
        }
        samples.push({ point: p, tangent: { x: 1, y: 0 }, u: 0, run: runs.length })
        lengths.push(total)
      }
    }
    if (samples.length - start >= 2) {
      runs.push({ start, end: samples.length })
    } else {
      // Degenerate subpath (single point): drop its samples.
      samples.length = start
      lengths.length = start
    }
  }
  if (total < 1e-9 || samples.length < 2) return null

  for (let i = 0; i < samples.length; i++) {
    samples[i]!.u = lengths[i]! / total
  }
  // Tangents from neighbors within each run.
  for (const run of runs) {
    for (let i = run.start; i < run.end; i++) {
      const prev = samples[Math.max(run.start, i - 1)]!
      const next = samples[Math.min(run.end - 1, i + 1)]!
      const dx = next.point.x - prev.point.x
      const dy = next.point.y - prev.point.y
      const len = Math.hypot(dx, dy)
      samples[i]!.tangent = len < 1e-9 ? { x: 1, y: 0 } : { x: dx / len, y: dy / len }
    }
  }
  return { samples, runs, totalLength: total }
}

/** Point/tangent/normal at offset `u` (interpolated between samples). */
export function pointAtOffset(
  sampled: SampledPath,
  u: number,
): { point: Vec2; tangent: Vec2; normal: Vec2 } {
  const { samples } = sampled
  const target = Math.min(1, Math.max(0, u))
  // Binary search for the sample pair bracketing `u`.
  let lo = 0
  let hi = samples.length - 1
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1
    if (samples[mid]!.u <= target) lo = mid
    else hi = mid
  }
  const a = samples[lo]!
  const b = samples[hi]!
  const span = b.u - a.u
  const t = span < 1e-12 || a.run !== b.run ? 0 : (target - a.u) / span
  const point = {
    x: a.point.x + (b.point.x - a.point.x) * t,
    y: a.point.y + (b.point.y - a.point.y) * t,
  }
  const tangent = t < 0.5 ? a.tangent : b.tangent
  return { point, tangent, normal: { x: -tangent.y, y: tangent.x } }
}

/** Nearest point on the sampled path to `p` (LOCAL space); distance included. */
export function nearestOffsetOnPath(
  sampled: SampledPath,
  p: Vec2,
): { u: number; point: Vec2; distance: number } {
  let best = { u: 0, point: sampled.samples[0]!.point, distance: Infinity }
  for (const run of sampled.runs) {
    for (let i = run.start; i < run.end - 1; i++) {
      const a = sampled.samples[i]!
      const b = sampled.samples[i + 1]!
      const abx = b.point.x - a.point.x
      const aby = b.point.y - a.point.y
      const len2 = abx * abx + aby * aby
      const t =
        len2 < 1e-12
          ? 0
          : Math.min(1, Math.max(0, ((p.x - a.point.x) * abx + (p.y - a.point.y) * aby) / len2))
      const q = { x: a.point.x + abx * t, y: a.point.y + aby * t }
      const d = distance(p, q)
      if (d < best.distance) {
        best = { u: a.u + (b.u - a.u) * t, point: q, distance: d }
      }
    }
  }
  return best
}

/** One stroke chunk of the rendered approximation. */
export interface WidthChunk {
  points: Vec2[]
  width: number
}

/**
 * The rendered approximation: consecutive sample pairs become 2-point chunks
 * stroked at the width of their midpoint offset. Round caps/joins hide the
 * joints. Returns null when the style has no variable width to render.
 */
export function widthChunks(subpaths: SubPath[], style: Style): WidthChunk[] | null {
  if (!hasWidthProfile(style)) return null
  const sampled = samplePath(subpaths)
  if (!sampled) return null
  const profile = sortedProfile(style.widthProfile!)
  const chunks: WidthChunk[] = []
  for (const run of sampled.runs) {
    for (let i = run.start; i < run.end - 1; i++) {
      const a = sampled.samples[i]!
      const b = sampled.samples[i + 1]!
      const w = widthAt(profile, (a.u + b.u) / 2, style.strokeWidth)
      if (w <= 0) continue
      chunks.push({ points: [a.point, b.point], width: w })
    }
  }
  return chunks
}

/** Chunk -> SVG path data ("M x y L x y"). */
export function chunkPathData(chunk: WidthChunk): string {
  const n = (v: number) => String(Math.round(v * 1000) / 1000)
  let d = `M ${n(chunk.points[0]!.x)} ${n(chunk.points[0]!.y)}`
  for (let i = 1; i < chunk.points.length; i++) {
    d += ` L ${n(chunk.points[i]!.x)} ${n(chunk.points[i]!.y)}`
  }
  return d
}
