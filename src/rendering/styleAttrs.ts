/**
 * Style -> SVG presentation props for live rendering. Mirrors the semantics
 * of serialize.ts (the export source of truth) — keep them in agreement.
 * Gradient paints resolve to url(#id) through the live defs registry; without
 * a resolver (or an unregistered paint) they fall back to their first stop.
 */

import type { GradientPaint, Paint, Style } from '../model/types'
import { cssColor } from '../model/defs'

export interface SvgPaintProps {
  fill: string
  fillOpacity?: number
  stroke: string
  strokeOpacity?: number
  strokeWidth?: number
  strokeLinecap?: 'butt' | 'round' | 'square'
  strokeLinejoin?: 'miter' | 'round' | 'bevel'
  strokeDasharray?: string
}

/** url(#...) id for a def-backed paint; null falls back to the first stop. */
export type DefIdResolver = (paint: GradientPaint) => string | null

function paintValue(
  paint: Paint,
  resolveDef?: DefIdResolver,
): { color: string; opacity: number } {
  if (paint.type === 'solid') {
    return { color: cssColor(paint.color), opacity: paint.color.a }
  }
  const defId = resolveDef?.(paint)
  if (defId) return { color: `url(#${defId})`, opacity: 1 } // stop alpha lives in the def
  const first = paint.stops[0]
  return first
    ? { color: cssColor(first.color), opacity: first.color.a }
    : { color: '#000', opacity: 1 }
}

export function svgPaintProps(style: Style, resolveDef?: DefIdResolver): SvgPaintProps {
  const props: SvgPaintProps = { fill: 'none', stroke: 'none' }
  if (style.fill) {
    const { color, opacity } = paintValue(style.fill, resolveDef)
    props.fill = color
    if (opacity < 1) props.fillOpacity = opacity
  }
  if (style.stroke) {
    const { color, opacity } = paintValue(style.stroke, resolveDef)
    props.stroke = color
    if (opacity < 1) props.strokeOpacity = opacity
    props.strokeWidth = style.strokeWidth
    if (style.strokeCap !== 'butt') props.strokeLinecap = style.strokeCap
    if (style.strokeJoin !== 'miter') props.strokeLinejoin = style.strokeJoin
    if (style.strokeDash.length > 0) props.strokeDasharray = style.strokeDash.join(' ')
  }
  return props
}
