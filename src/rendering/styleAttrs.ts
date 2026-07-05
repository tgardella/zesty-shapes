/**
 * Style -> SVG presentation props for live rendering. Mirrors the semantics
 * of serialize.ts (the export source of truth) — keep them in agreement.
 * Only solid paints render this phase; gradient paints fall back to their
 * first stop (they cannot be authored yet).
 */

import type { Paint, Style } from '../model/types'
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

function paintColor(paint: Paint): { color: string; opacity: number } {
  if (paint.type === 'solid') {
    return { color: cssColor(paint.color), opacity: paint.color.a }
  }
  const first = paint.stops[0]
  return first ? { color: cssColor(first.color), opacity: first.color.a } : { color: '#000', opacity: 1 }
}

export function svgPaintProps(style: Style): SvgPaintProps {
  const props: SvgPaintProps = { fill: 'none', stroke: 'none' }
  if (style.fill) {
    const { color, opacity } = paintColor(style.fill)
    props.fill = color
    if (opacity < 1) props.fillOpacity = opacity
  }
  if (style.stroke) {
    const { color, opacity } = paintColor(style.stroke)
    props.stroke = color
    if (opacity < 1) props.strokeOpacity = opacity
    props.strokeWidth = style.strokeWidth
    if (style.strokeCap !== 'butt') props.strokeLinecap = style.strokeCap
    if (style.strokeJoin !== 'miter') props.strokeLinejoin = style.strokeJoin
    if (style.strokeDash.length > 0) props.strokeDasharray = style.strokeDash.join(' ')
  }
  return props
}
