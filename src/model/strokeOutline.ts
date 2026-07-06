/**
 * Stroke outlining / offset primitive: turn a stroked path into the FILLED
 * region its stroke covers, as boolean-engine Regions in LOCAL space.
 *
 * Construction: the path is arc-length sampled (model/widthProfile.samplePath
 * — the same basis the Width tool edits against), each side offset by the
 * half-width along the sample normal, ends closed with round caps (open runs)
 * or paired into an annulus (closed runs). A final self-union through the
 * boolean engine resolves the self-intersections tight curves produce.
 *
 * Uniform strokes pass width via style.strokeWidth; variable-width strokes
 * interpolate style.widthProfile. This is what makes variable-width strokes
 * REAL geometry: NodeView and the SVG exporter both render the outline, and
 * "Outline Stroke" bakes it into an editable, boolean-able path.
 */

import type { Vec2 } from '../geometry/vec2'
import { union, xor, type Regions, type Ring } from '../geometry/boolean'
import type { Style, SubPath } from './types'
import { samplePath, sortedProfile, widthAt } from './widthProfile'

const CAP_SEGMENTS = 8

/**
 * Half circle from `from` around `center` to the opposite point (round cap).
 * Sweeps NEGATIVE angles: with n = rot90(t), that path passes through the
 * outward tangent direction (beyond the path end), not the stroke interior —
 * end cap runs left(+n) -> +t -> right(-n), start cap right(-n) -> -t ->
 * left(+n).
 */
function capArc(center: Vec2, from: Vec2, segments = CAP_SEGMENTS): Ring {
  const r = Math.hypot(from.x - center.x, from.y - center.y)
  if (r < 1e-9) return []
  const start = Math.atan2(from.y - center.y, from.x - center.x)
  const pts: Ring = []
  for (let i = 1; i < segments; i++) {
    const a = start - (Math.PI * i) / segments
    pts.push({ x: center.x + r * Math.cos(a), y: center.y + r * Math.sin(a) })
  }
  return pts
}

/**
 * The stroke's filled region (LOCAL space), or null when there is nothing to
 * outline (no stroke, degenerate geometry, zero width everywhere).
 */
export function outlineStroke(subpaths: SubPath[], style: Style): Regions | null {
  if (style.stroke === null) return null
  const sampled = samplePath(subpaths)
  if (!sampled) return null
  const profile = sortedProfile(style.widthProfile ?? [])

  const pieces: Regions[] = []
  for (const run of sampled.runs) {
    const left: Ring = []
    const right: Ring = []
    for (let i = run.start; i < run.end; i++) {
      const s = sampled.samples[i]!
      const half = widthAt(profile, s.u, style.strokeWidth) / 2
      const nx = -s.tangent.y
      const ny = s.tangent.x
      left.push({ x: s.point.x + nx * half, y: s.point.y + ny * half })
      right.push({ x: s.point.x - nx * half, y: s.point.y - ny * half })
    }
    if (left.length < 2) continue

    if (run.closed) {
      // Closed run: the stroke covers the annulus between the two offset
      // loops. XOR of the loops builds it regardless of winding or which
      // loop ends up inside.
      const annulus = xor([[left]], [[right]])
      if (annulus.length > 0) pieces.push(annulus)
    } else {
      // Open run: left side out, round end cap, right side back, start cap.
      const first = sampled.samples[run.start]!
      const last = sampled.samples[run.end - 1]!
      const ring: Ring = [
        ...left,
        ...capArc(last.point, left[left.length - 1]!),
        ...right.slice().reverse(),
        ...capArc(first.point, right[0]!),
      ]
      if (ring.length >= 3) pieces.push([[ring]])
    }
  }
  if (pieces.length === 0) return null
  // Self-union resolves self-intersections and merges overlapping pieces.
  const result = union(pieces[0]!, ...pieces.slice(1))
  return result.length > 0 ? result : null
}
