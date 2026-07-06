/**
 * The <defs> registry: paints that need SVG defs (gradients now, patterns
 * later) allocate STABLE ids, identical paints DEDUPE to one def, and defs are
 * garbage-collected when their last user releases them.
 *
 * The registry is plain JSON (usable inside an Immer store slice later). It is
 * NOT part of the Document — it is derived state, rebuilt on load/export.
 *
 * Only gradient paints ship in a later phase, but the registry is fully
 * implemented now so Style/serialize never need a schema change.
 */

import type { GradientPaint, Paint, RGBA } from './types'
import { toSvgTransform, isIdentity } from '../geometry/matrix'

export interface DefsEntry {
  /** Stable def id, used as url(#id). */
  id: string
  /** Canonical dedupe key of the paint. */
  key: string
  paint: GradientPaint
  /** User ids (typically NodeIds) currently referencing this def. */
  users: Record<string, true>
}

export interface DefsRegistry {
  /** key -> entry. */
  entries: Record<string, DefsEntry>
  /** Monotonic counter for stable id allocation. */
  nextId: number
}

export function createDefsRegistry(): DefsRegistry {
  return { entries: {}, nextId: 1 }
}

/** True when the paint requires a <defs> entry to render. */
export function paintNeedsDef(paint: Paint | null): paint is GradientPaint {
  return paint !== null && paint.type === 'gradient'
}

/** Canonical dedupe key: identical paints (deep) produce identical keys. */
export function paintKey(paint: GradientPaint): string {
  const stops = paint.stops
    .map((s) => `${s.offset}:${s.color.r},${s.color.g},${s.color.b},${s.color.a}`)
    .join(';')
  return `g|${paint.gradientType}|${stops}|${paint.transform.join(',')}`
}

/**
 * Register `userId` as a user of `paint`; returns the def id to reference as
 * url(#id). Identical paints share one entry; re-acquiring is idempotent.
 */
export function acquireDef(reg: DefsRegistry, paint: GradientPaint, userId: string): string {
  const key = paintKey(paint)
  let entry = reg.entries[key]
  if (!entry) {
    entry = {
      id: `grad-${reg.nextId++}`,
      key,
      // Deep-copy so later paint edits can't silently mutate the registry.
      paint: JSON.parse(JSON.stringify(paint)) as GradientPaint,
      users: {},
    }
    reg.entries[key] = entry
  }
  entry.users[userId] = true
  return entry.id
}

/**
 * Drop `userId` from the def that owns `defId`; the entry is GC'd when its
 * last user releases. Unknown ids are ignored (release is idempotent).
 */
export function releaseDef(reg: DefsRegistry, defId: string, userId: string): void {
  for (const key of Object.keys(reg.entries)) {
    const entry = reg.entries[key]!
    if (entry.id !== defId) continue
    delete entry.users[userId]
    if (Object.keys(entry.users).length === 0) delete reg.entries[key]
    return
  }
}

/** Release every def held by `userId` (call when a node is deleted). */
export function releaseAllForUser(reg: DefsRegistry, userId: string): void {
  for (const key of Object.keys(reg.entries)) {
    const entry = reg.entries[key]!
    if (entry.users[userId]) {
      delete entry.users[userId]
      if (Object.keys(entry.users).length === 0) delete reg.entries[key]
    }
  }
}

export function defCount(reg: DefsRegistry): number {
  return Object.keys(reg.entries).length
}

// ---------------------------------------------------------------------------
// SVG emission
// ---------------------------------------------------------------------------

/** CSS color (without alpha — alpha is emitted as *-opacity attributes). */
export function cssColor(c: RGBA): string {
  return `rgb(${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)})`
}

function gradientToSVG(entry: DefsEntry): string {
  const { paint, id } = entry
  const stops = paint.stops
    .map(
      (s) =>
        `<stop offset="${s.offset}" stop-color="${cssColor(s.color)}"` +
        (s.color.a < 1 ? ` stop-opacity="${s.color.a}"` : '') +
        '/>',
    )
    .join('')
  const gradientTransform = isIdentity(paint.transform)
    ? ''
    : ` gradientTransform="${toSvgTransform(paint.transform)}"`
  // gradientUnits="userSpaceOnUse": unit-space coordinates land in the
  // element's LOCAL space (the element renders inside its own transform), so
  // paint.transform maps unit space -> local exactly as the model convention
  // says. objectBoundingBox would compose with the bbox instead — wrong for
  // rotated axes, and it would break gradient continuity across the
  // variable-width stroke chunks.
  if (paint.gradientType === 'linear') {
    return (
      `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="1" y2="0"` +
      `${gradientTransform}>${stops}</linearGradient>`
    )
  }
  return (
    `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="0.5" cy="0.5" r="0.5"` +
    `${gradientTransform}>${stops}</radialGradient>`
  )
}

/** The <defs> block, or '' when the registry is empty. */
export function defsToSVG(reg: DefsRegistry): string {
  const entries = Object.values(reg.entries)
  if (entries.length === 0) return ''
  return `<defs>${entries.map(gradientToSVG).join('')}</defs>`
}
