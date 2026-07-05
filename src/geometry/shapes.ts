/**
 * Parametric shape -> SubPath[] derivations, all in LOCAL space.
 * These back both rendering (as path data) and "Convert to Path".
 * Fresh subpath/anchor ids are allocated on every call.
 */

import { nanoid } from 'nanoid'
import type { Anchor, SubPath } from '../model/types'
import type { Vec2 } from './vec2'

/** Circle-from-cubics constant: control length = radius * KAPPA per 90° arc. */
export const KAPPA = 0.5522847498307936

function corner(point: Vec2): Anchor {
  return { id: nanoid(), point, handleIn: null, handleOut: null, type: 'corner' }
}

function anchor(point: Vec2, handleIn: Vec2 | null, handleOut: Vec2 | null, type: Anchor['type']): Anchor {
  return { id: nanoid(), point, handleIn, handleOut, type }
}

function closedSubPath(anchors: Anchor[]): SubPath[] {
  return [{ id: nanoid(), closed: true, anchors }]
}

/**
 * Rectangle spanning (x,y)-(x+w,y+h); rx/ry > 0 rounds the corners with
 * quarter-ellipse cubics. Radii are clamped to half the side lengths.
 */
export function rectToPath(x: number, y: number, w: number, h: number, rx = 0, ry = rx): SubPath[] {
  const crx = Math.min(Math.abs(rx), Math.abs(w) / 2)
  const cry = Math.min(Math.abs(ry), Math.abs(h) / 2)
  if (crx <= 0 || cry <= 0) {
    return closedSubPath([
      corner({ x, y }),
      corner({ x: x + w, y }),
      corner({ x: x + w, y: y + h }),
      corner({ x, y: y + h }),
    ])
  }
  const kx = crx * KAPPA
  const ky = cry * KAPPA
  const x1 = x + w
  const y1 = y + h
  // Clockwise from the top edge; each rounded corner is one smooth anchor pair
  // (arc entry and exit anchors with a single quarter-ellipse cubic between).
  return closedSubPath([
    anchor({ x: x + crx, y }, { x: x + crx - kx, y }, null, 'corner'),
    anchor({ x: x1 - crx, y }, null, { x: x1 - crx + kx, y }, 'corner'),
    anchor({ x: x1, y: y + cry }, { x: x1, y: y + cry - ky }, null, 'corner'),
    anchor({ x: x1, y: y1 - cry }, null, { x: x1, y: y1 - cry + ky }, 'corner'),
    anchor({ x: x1 - crx, y: y1 }, { x: x1 - crx + kx, y: y1 }, null, 'corner'),
    anchor({ x: x + crx, y: y1 }, null, { x: x + crx - kx, y: y1 }, 'corner'),
    anchor({ x, y: y1 - cry }, { x, y: y1 - cry + ky }, null, 'corner'),
    anchor({ x, y: y + cry }, null, { x, y: y + cry - ky }, 'corner'),
  ])
}

/** Ellipse as 4 cubic quarter-arcs (kappa 0.5523), starting at the +x extremum. */
export function ellipseToPath(cx: number, cy: number, rx: number, ry: number): SubPath[] {
  const kx = rx * KAPPA
  const ky = ry * KAPPA
  return closedSubPath([
    anchor({ x: cx + rx, y: cy }, { x: cx + rx, y: cy - ky }, { x: cx + rx, y: cy + ky }, 'symmetric'),
    anchor({ x: cx, y: cy + ry }, { x: cx + kx, y: cy + ry }, { x: cx - kx, y: cy + ry }, 'symmetric'),
    anchor({ x: cx - rx, y: cy }, { x: cx - rx, y: cy + ky }, { x: cx - rx, y: cy - ky }, 'symmetric'),
    anchor({ x: cx, y: cy - ry }, { x: cx - kx, y: cy - ry }, { x: cx + kx, y: cy - ry }, 'symmetric'),
  ])
}

/**
 * Regular polygon: `sides` vertices on the circle of `radius` around (cx,cy).
 * angle=0 points the first vertex straight up (-y, screen coordinates).
 */
export function polygonToPath(cx: number, cy: number, radius: number, sides: number, angle = 0): SubPath[] {
  const n = Math.max(3, Math.floor(sides))
  const anchors: Anchor[] = []
  for (let i = 0; i < n; i++) {
    const theta = angle - Math.PI / 2 + (i * 2 * Math.PI) / n
    anchors.push(corner({ x: cx + radius * Math.cos(theta), y: cy + radius * Math.sin(theta) }))
  }
  return closedSubPath(anchors)
}

/** Star: `points` outer vertices interleaved with inner vertices. */
export function starToPath(
  cx: number,
  cy: number,
  outerRadius: number,
  innerRadius: number,
  points: number,
  angle = 0,
): SubPath[] {
  const n = Math.max(3, Math.floor(points))
  const anchors: Anchor[] = []
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 === 0 ? outerRadius : innerRadius
    const theta = angle - Math.PI / 2 + (i * Math.PI) / n
    anchors.push(corner({ x: cx + r * Math.cos(theta), y: cy + r * Math.sin(theta) }))
  }
  return closedSubPath(anchors)
}

/** Open two-anchor line segment. */
export function lineToPath(x1: number, y1: number, x2: number, y2: number): SubPath[] {
  return [{ id: nanoid(), closed: false, anchors: [corner({ x: x1, y: y1 }), corner({ x: x2, y: y2 })] }]
}
