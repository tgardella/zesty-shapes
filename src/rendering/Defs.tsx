/**
 * Live <defs> for the document SVG: gradient defs from the LIVE registry
 * (store/liveDefs), which dedupes identical paints, keeps ids stable while in
 * use, and GC's entries when their last user is deleted. Emission mirrors
 * model/defs.ts (the export source of truth): unit-space geometry,
 * gradientUnits="userSpaceOnUse", paint.transform as gradientTransform.
 */

import { cssColor, type DefsEntry } from '../model/defs'
import { isIdentity, toSvgTransform } from '../geometry/matrix'
import { liveDefs } from '../store/liveDefs'
import { useEditor } from '../store/store'

export function Defs() {
  const nodes = useEditor((s) => s.document.nodes)
  const reg = liveDefs.ensure(nodes)
  const entries = Object.values(reg.entries)
  if (entries.length === 0) return null
  return (
    <defs>
      {entries.map((entry) => (
        <GradientDef key={entry.id} entry={entry} />
      ))}
    </defs>
  )
}

function GradientDef({ entry }: { entry: DefsEntry }) {
  const { paint, id } = entry
  const gradientTransform = isIdentity(paint.transform)
    ? undefined
    : toSvgTransform(paint.transform)
  const stops = paint.stops.map((s, i) => (
    <stop
      key={i}
      offset={s.offset}
      stopColor={cssColor(s.color)}
      stopOpacity={s.color.a < 1 ? s.color.a : undefined}
    />
  ))
  if (paint.gradientType === 'linear') {
    return (
      <linearGradient
        id={id}
        gradientUnits="userSpaceOnUse"
        x1={0}
        y1={0}
        x2={1}
        y2={0}
        gradientTransform={gradientTransform}
      >
        {stops}
      </linearGradient>
    )
  }
  return (
    <radialGradient
      id={id}
      gradientUnits="userSpaceOnUse"
      cx={0.5}
      cy={0.5}
      r={0.5}
      gradientTransform={gradientTransform}
    >
      {stops}
    </radialGradient>
  )
}
