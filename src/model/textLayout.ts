/**
 * Pure text layout: TextNode -> positioned lines/glyphs in LOCAL space.
 * Measurement is injected (model/textMetrics), so this stays unit-testable.
 *
 * Modes:
 * - 'lines'  (point + area text): per-line y and per-char x positions —
 *   rendered as one <tspan> per line with an x-list (tracking/kerning exact).
 * - 'glyphs' (path text + vertical type): per-char x/y (+rotate for path
 *   text) — rendered as one <tspan> per char.
 *
 * Conventions (see TextNode in types.ts): point text baseline starts at the
 * local origin; area text wraps inside (0,0)..(w,h); path text follows the
 * arc-length parameterization of node.textPath (same sampling engine as the
 * Width tool); vertical type stacks columns advancing right-to-left.
 */

import type { BBox } from '../geometry/bbox'
import type { TextNode } from './types'
import { ascentOf, measureText, type FontSpec, type MeasureFn } from './textMetrics'
import { pointAtOffset, samplePath } from './widthProfile'

export interface GlyphPlacement {
  char: string
  x: number
  y: number
  /** Degrees, glyph rotated about (x, y). Path text only. */
  rotate?: number
}

export interface LineLayout {
  text: string
  /** Per-char x positions (tracking/kerning baked in). */
  xs: number[]
  /** Baseline y. */
  y: number
  width: number
}

export interface TextLayoutResult {
  mode: 'lines' | 'glyphs'
  lines: LineLayout[]
  glyphs: GlyphPlacement[]
  bbox: BBox
  font: FontSpec
  ascent: number
}

export function fontSpecOf(node: TextNode): FontSpec {
  return {
    family: node.fontFamily,
    size: node.fontSize,
    weight: node.fontWeight,
    kerning: node.kerning ?? true,
  }
}

/** Tracking in px for one inter-char gap. */
function trackingPx(node: TextNode): number {
  return ((node.tracking ?? 0) / 1000) * node.fontSize
}

/** Per-char x offsets within a line starting at 0 (prefix-measured => kerning). */
function charXs(text: string, font: FontSpec, track: number, measure: MeasureFn): number[] {
  const chars = [...text]
  const xs: number[] = []
  for (let i = 0; i < chars.length; i++) {
    xs.push(measure(chars.slice(0, i).join(''), font) + i * track)
  }
  return xs
}

function lineWidth(text: string, font: FontSpec, track: number, measure: MeasureFn): number {
  const n = [...text].length
  return measure(text, font) + Math.max(0, n - 1) * track
}

/** Greedy word wrap into `maxWidth`; explicit \n always breaks. */
export function wrapText(
  text: string,
  maxWidth: number,
  font: FontSpec,
  track: number,
  measure: MeasureFn,
): string[] {
  const out: string[] = []
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(' ')
    let line = ''
    for (const word of words) {
      const candidate = line === '' ? word : `${line} ${word}`
      if (line !== '' && lineWidth(candidate, font, track, measure) > maxWidth) {
        out.push(line)
        line = word
      } else {
        line = candidate
      }
    }
    out.push(line)
  }
  return out
}

export function layoutText(node: TextNode, measure: MeasureFn = measureText): TextLayoutResult {
  if (node.textPath && node.textPath.length > 0) return layoutOnPath(node, measure)
  if (node.vertical) return layoutVertical(node, measure)
  return layoutLines(node, measure)
}

// ---------------------------------------------------------------------------
// Point / area text
// ---------------------------------------------------------------------------

function layoutLines(node: TextNode, measure: MeasureFn): TextLayoutResult {
  const font = fontSpecOf(node)
  const track = trackingPx(node)
  const ascent = ascentOf(node.fontSize)
  const lineStep = node.fontSize * node.leading
  const isArea = node.kind === 'area' && (node.width ?? 0) > 0

  const rawLines = isArea
    ? wrapText(node.text, node.width!, font, track, measure)
    : node.text.split('\n')

  const lines: LineLayout[] = []
  let maxW = 0
  for (let i = 0; i < rawLines.length; i++) {
    const text = rawLines[i]!
    const w = lineWidth(text, font, track, measure)
    maxW = Math.max(maxW, w)
    // Point text: first baseline AT the origin. Area text: one ascent down.
    const y = isArea ? ascent + i * lineStep : i * lineStep
    let offset = 0
    if (isArea) {
      offset = node.textAlign === 'center' ? (node.width! - w) / 2 : node.textAlign === 'right' ? node.width! - w : 0
    } else {
      offset = node.textAlign === 'center' ? -w / 2 : node.textAlign === 'right' ? -w : 0
    }
    lines.push({
      text,
      xs: charXs(text, font, track, measure).map((x) => x + offset),
      y,
      width: w,
    })
  }

  let bbox: BBox
  if (isArea) {
    const usedH = ascent + (rawLines.length - 1) * lineStep + node.fontSize * 0.25
    bbox = { minX: 0, minY: 0, maxX: node.width!, maxY: Math.max(node.height ?? 0, usedH) }
  } else {
    const minX =
      node.textAlign === 'center' ? -maxW / 2 : node.textAlign === 'right' ? -maxW : 0
    bbox = {
      minX,
      minY: -ascent,
      maxX: minX + maxW,
      maxY: (rawLines.length - 1) * lineStep + node.fontSize * 0.25,
    }
  }
  return { mode: 'lines', lines, glyphs: [], bbox, font, ascent }
}

// ---------------------------------------------------------------------------
// Vertical type
// ---------------------------------------------------------------------------

function layoutVertical(node: TextNode, measure: MeasureFn): TextLayoutResult {
  const font = fontSpecOf(node)
  const track = trackingPx(node)
  const ascent = ascentOf(node.fontSize)
  const charStep = node.fontSize + track
  const columnStep = node.fontSize * node.leading

  const columns = node.text.split('\n')
  const glyphs: GlyphPlacement[] = []
  let maxLen = 0
  for (let c = 0; c < columns.length; c++) {
    const chars = [...columns[c]!]
    maxLen = Math.max(maxLen, chars.length)
    // Columns advance right-to-left (like CJK vertical setting).
    const x = -c * columnStep
    for (let j = 0; j < chars.length; j++) {
      const w = measure(chars[j]!, font)
      // Center each glyph horizontally on the column axis.
      glyphs.push({ char: chars[j]!, x: x - w / 2, y: j * charStep })
    }
  }
  const bbox: BBox = {
    minX: -(columns.length - 1) * columnStep - node.fontSize / 2,
    minY: -ascent,
    maxX: node.fontSize / 2,
    maxY: Math.max(0, (maxLen - 1) * charStep) + node.fontSize * 0.25,
  }
  return { mode: 'glyphs', lines: [], glyphs, bbox, font, ascent }
}

// ---------------------------------------------------------------------------
// Type on a path
// ---------------------------------------------------------------------------

function layoutOnPath(node: TextNode, measure: MeasureFn): TextLayoutResult {
  const font = fontSpecOf(node)
  const track = trackingPx(node)
  const ascent = ascentOf(node.fontSize)
  const sampled = samplePath(node.textPath!)
  if (!sampled) {
    return {
      mode: 'glyphs',
      lines: [],
      glyphs: [],
      bbox: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
      font,
      ascent,
    }
  }
  const total = sampled.totalLength
  const text = node.text.replace(/\n/g, ' ')
  const textW = lineWidth(text, font, track, measure)
  let start = (node.pathStartOffset ?? 0) * total
  if (node.textAlign === 'center') start += (total - textW) / 2
  else if (node.textAlign === 'right') start += total - textW

  const chars = [...text]
  const xs = charXs(text, font, track, measure)
  const glyphs: GlyphPlacement[] = []
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (let i = 0; i < chars.length; i++) {
    const w = measure(chars[i]!, font)
    const centerArc = start + xs[i]! + w / 2
    if (centerArc < 0 || centerArc > total) continue // overflow hidden, like AI
    const { point, tangent } = pointAtOffset(sampled, centerArc / total)
    // Anchor the glyph's CENTER on the path; rotate along the tangent.
    const angle = (Math.atan2(tangent.y, tangent.x) * 180) / Math.PI
    const x = point.x - (w / 2) * tangent.x
    const y = point.y - (w / 2) * tangent.y
    glyphs.push({ char: chars[i]!, x, y, rotate: angle })
    minX = Math.min(minX, point.x - node.fontSize)
    minY = Math.min(minY, point.y - node.fontSize)
    maxX = Math.max(maxX, point.x + node.fontSize)
    maxY = Math.max(maxY, point.y + node.fontSize)
  }
  const bbox: BBox =
    glyphs.length > 0
      ? { minX, minY, maxX, maxY }
      : { minX: 0, minY: 0, maxX: 1, maxY: 1 }
  return { mode: 'glyphs', lines: [], glyphs, bbox, font, ascent }
}
