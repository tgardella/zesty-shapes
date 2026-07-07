/**
 * Runtime font services (DOM side of the text system):
 * - registers the canvas-based measurer into model/textMetrics at import time
 * - loads the bundled Inter faces (400/700) BOTH as document fonts (FontFace,
 *   so <text> renders them) and as opentype.js fonts (so Convert to Outlines
 *   produces the exact glyph geometry the screen shows)
 * - converts glyph paths (font units, y-up, quadratics) into the model's
 *   cubic SubPaths (px, y-down)
 *
 * Families other than the bundled ones render through the platform font
 * stack; outlining them falls back to Inter (stated in the phase notes).
 */

import { parse as parseFont, type Font, type PathCommand } from 'opentype.js'
import interRegularUrl from '@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf?url'
import interBoldUrl from '@expo-google-fonts/inter/700Bold/Inter_700Bold.ttf?url'
import type { SubPath, TextNode } from '../model/types'
import { registerTextMeasurer, type FontSpec } from '../model/textMetrics'
import { createAnchor, createSubPath } from '../model/pathOps'
import { layoutText, type GlyphPlacement } from '../model/textLayout'
import type { Vec2 } from '../geometry/vec2'

/** Families offered by the Text panel. Bundled ones can be outlined exactly. */
export const FONT_FAMILIES = ['Inter', 'Helvetica', 'Georgia', 'Courier New'] as const

// ---------------------------------------------------------------------------
// Measurement (canvas)
// ---------------------------------------------------------------------------

let ctx: CanvasRenderingContext2D | null = null
const widthCache = new Map<string, number>()

function measureCanvas(text: string, font: FontSpec): number {
  if (text === '') return 0
  if (!ctx) {
    ctx = document.createElement('canvas').getContext('2d')
    if (!ctx) return text.length * font.size * 0.6
  }
  const key = `${font.weight}|${font.size}|${font.family}|${font.kerning}|${text}`
  const cached = widthCache.get(key)
  if (cached !== undefined) return cached
  ctx.font = `${font.weight} ${font.size}px "${font.family}"`
  if ('fontKerning' in ctx) ctx.fontKerning = font.kerning ? 'auto' : 'none'
  // (fontKerning is baseline in modern browsers; guarded for older ones.)
  const w = ctx.measureText(text).width
  if (widthCache.size > 20000) widthCache.clear()
  widthCache.set(key, w)
  return w
}

if (typeof document !== 'undefined') {
  registerTextMeasurer(measureCanvas)
}

// ---------------------------------------------------------------------------
// Bundled faces: FontFace (rendering) + opentype (outlines)
// ---------------------------------------------------------------------------

const outlineFonts = new Map<string, Font>() // 'weight' bucket: '400' | '700'
let loadPromise: Promise<void> | null = null

async function loadFace(url: string, weight: string): Promise<void> {
  const buffer = await (await fetch(url)).arrayBuffer()
  outlineFonts.set(weight, parseFont(buffer))
  const face = new FontFace('Inter', buffer, { weight })
  await face.load()
  document.fonts.add(face)
}

/** Idempotent; resolves when Inter 400/700 are usable for render + outline. */
export function ensureFontsLoaded(): Promise<void> {
  loadPromise ??= Promise.all([
    loadFace(interRegularUrl, '400'),
    loadFace(interBoldUrl, '700'),
  ]).then(() => {
    widthCache.clear() // measurements before the face loaded used a fallback
  })
  return loadPromise
}

// ---------------------------------------------------------------------------
// Glyph outlines -> SubPaths
// ---------------------------------------------------------------------------

/** The opentype face used to outline `weight` (bold cutoff at 600). */
function outlineFontFor(weight: number): Font | null {
  return outlineFonts.get(weight >= 600 ? '700' : '400') ?? null
}

function commandsToSubPaths(commands: PathCommand[]): SubPath[] {
  const out: SubPath[] = []
  let anchors: ReturnType<typeof createAnchor>[] = []
  let cur: Vec2 = { x: 0, y: 0 }
  const flush = (): void => {
    if (anchors.length >= 2) out.push(createSubPath(anchors, true))
    anchors = []
  }
  for (const cmd of commands) {
    switch (cmd.type) {
      case 'M':
        flush()
        cur = { x: cmd.x, y: cmd.y }
        anchors.push(createAnchor(cur))
        break
      case 'L':
        cur = { x: cmd.x, y: cmd.y }
        anchors.push(createAnchor(cur))
        break
      case 'Q': {
        // Quadratic -> cubic: c1 = p0 + 2/3(q - p0), c2 = p3 + 2/3(q - p3).
        const q = { x: cmd.x1, y: cmd.y1 }
        const end = { x: cmd.x, y: cmd.y }
        const prev = anchors[anchors.length - 1]
        if (prev) {
          prev.handleOut = {
            x: cur.x + (2 / 3) * (q.x - cur.x),
            y: cur.y + (2 / 3) * (q.y - cur.y),
          }
        }
        anchors.push(
          createAnchor(end, {
            handleIn: { x: end.x + (2 / 3) * (q.x - end.x), y: end.y + (2 / 3) * (q.y - end.y) },
          }),
        )
        cur = end
        break
      }
      case 'C': {
        const prev = anchors[anchors.length - 1]
        if (prev) prev.handleOut = { x: cmd.x1, y: cmd.y1 }
        anchors.push(createAnchor({ x: cmd.x, y: cmd.y }, { handleIn: { x: cmd.x2, y: cmd.y2 } }))
        cur = { x: cmd.x, y: cmd.y }
        break
      }
      case 'Z':
        flush()
        break
    }
  }
  flush()
  return out
}

/**
 * Outline every glyph of `node` at its LAID-OUT position (the same layout
 * the renderer draws), returning LOCAL-space subpaths. Requires
 * ensureFontsLoaded(); non-bundled families outline with Inter metrics.
 */
export function textToOutlineSubPaths(node: TextNode): SubPath[] | null {
  const font = outlineFontFor(node.fontWeight)
  if (!font) return null
  const layout = layoutText(node)
  const placements: GlyphPlacement[] =
    layout.mode === 'glyphs'
      ? layout.glyphs
      : layout.lines.flatMap((line) =>
          [...line.text].map((char, i) => ({ char, x: line.xs[i]!, y: line.y })),
        )
  const out: SubPath[] = []
  for (const g of placements) {
    if (g.char === ' ') continue
    // opentype emits y-DOWN px when given a baseline point + fontSize.
    const path = font.getPath(g.char, 0, 0, node.fontSize)
    let subpaths = commandsToSubPaths(path.commands)
    if (g.rotate !== undefined && g.rotate !== 0) {
      const rad = (g.rotate * Math.PI) / 180
      const cos = Math.cos(rad)
      const sin = Math.sin(rad)
      const rot = (p: Vec2): Vec2 => ({ x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos })
      subpaths = subpaths.map((sp) => ({
        ...sp,
        anchors: sp.anchors.map((a) => ({
          ...a,
          point: rot(a.point),
          handleIn: a.handleIn ? rot(a.handleIn) : null,
          handleOut: a.handleOut ? rot(a.handleOut) : null,
        })),
      }))
    }
    for (const sp of subpaths) {
      for (const a of sp.anchors) {
        a.point = { x: a.point.x + g.x, y: a.point.y + g.y }
        if (a.handleIn) a.handleIn = { x: a.handleIn.x + g.x, y: a.handleIn.y + g.y }
        if (a.handleOut) a.handleOut = { x: a.handleOut.x + g.x, y: a.handleOut.y + g.y }
      }
      out.push(sp)
    }
  }
  return out.length > 0 ? out : null
}
