/**
 * Boolean/path engine wrapper around polygon-clipping (a Martinez-Rueda
 * implementation). This is the ONLY file that touches the library — no
 * third-party types leak past it. Everything speaks Vec2:
 *
 *   Ring    = Vec2[]      one closed loop (closing edge implicit)
 *   Region  = Ring[]      one polygon: ring 0 exterior, rest holes
 *   Regions = Region[]    a multipolygon (disjoint polygons)
 *
 * Curves are FLATTENED to polylines before boolean ops (model/booleanOps.ts
 * owns the flattening); results are polygonal — corner anchors only.
 */

import polygonClipping from 'polygon-clipping'
import type { Vec2 } from './vec2'

export type Ring = Vec2[]
export type Region = Ring[]
export type Regions = Region[]

type Geom = [number, number][][][]

function toGeom(regions: Regions): Geom {
  return regions.map((region) => region.map((ring) => ring.map((p) => [p.x, p.y])))
}

function fromGeom(geom: Geom): Regions {
  const out: Regions = []
  for (const polygon of geom) {
    const region: Region = []
    for (const ring of polygon) {
      const points: Ring = ring.map(([x, y]) => ({ x, y }))
      // polygon-clipping repeats the first point at the end; drop it (the
      // model's closed subpaths close implicitly).
      const first = points[0]
      const last = points[points.length - 1]
      if (
        points.length > 1 &&
        first &&
        last &&
        Math.abs(first.x - last.x) < 1e-12 &&
        Math.abs(first.y - last.y) < 1e-12
      ) {
        points.pop()
      }
      if (points.length >= 3) region.push(points)
    }
    if (region.length > 0) out.push(region)
  }
  return out
}

function run(
  op: (g: Geom, ...more: Geom[]) => Geom,
  first: Regions,
  rest: Regions[],
): Regions {
  const geoms = rest.filter((r) => r.length > 0).map(toGeom)
  if (first.length === 0) return []
  try {
    return fromGeom(geoms.length === 0 ? op(toGeom(first)) : op(toGeom(first), ...geoms))
  } catch {
    // Martinez can throw on pathological (degenerate/self-touching) input;
    // failing soft keeps a bad gesture from crashing the editor.
    return first
  }
}

export function union(first: Regions, ...rest: Regions[]): Regions {
  // Union tolerates an empty subject as long as SOMETHING is non-empty.
  const all = [first, ...rest].filter((r) => r.length > 0)
  if (all.length === 0) return []
  return run(polygonClipping.union, all[0]!, all.slice(1))
}

/** first MINUS everything else. */
export function difference(first: Regions, ...rest: Regions[]): Regions {
  return run(polygonClipping.difference, first, rest)
}

export function intersection(first: Regions, ...rest: Regions[]): Regions {
  if ([first, ...rest].some((r) => r.length === 0)) return []
  return run(polygonClipping.intersection, first, rest)
}

/** Symmetric difference (Exclude). */
export function xor(first: Regions, ...rest: Regions[]): Regions {
  const all = [first, ...rest].filter((r) => r.length > 0)
  if (all.length === 0) return []
  return run(polygonClipping.xor, all[0]!, all.slice(1))
}

/** Signed ring area (shoelace); sign encodes winding. */
export function ringArea(ring: Ring): number {
  let sum = 0
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!
    const b = ring[(i + 1) % ring.length]!
    sum += a.x * b.y - b.x * a.y
  }
  return sum / 2
}

/** Total absolute area of a multipolygon (exterior minus holes per region). */
export function regionsArea(regions: Regions): number {
  let total = 0
  for (const region of regions) {
    for (let i = 0; i < region.length; i++) {
      const a = Math.abs(ringArea(region[i]!))
      total += i === 0 ? a : -a
    }
  }
  return Math.max(0, total)
}

/** Even-odd point-in-polygon across all rings (holes handled naturally). */
export function pointInRegions(regions: Regions, p: Vec2): boolean {
  let inside = false
  for (const region of regions) {
    for (const ring of region) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[i]!
        const b = ring[j]!
        if (
          a.y > p.y !== b.y > p.y &&
          p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
        ) {
          inside = !inside
        }
      }
    }
  }
  return inside
}
