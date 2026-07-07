/**
 * SVG import: parse an SVG file/string into REAL scene nodes so the file is
 * editable exactly as if drawn here. Supported subset (a genuinely useful
 * one, not a stub):
 * - structure: <svg> <g> (nested), display:none -> hidden
 * - shapes: rect (incl. rx/ry), circle, ellipse, line, polyline, polygon
 * - <path> with the FULL d grammar (arcs included) via geometry/parsePathData
 * - <text> (x/y, font-family/size/weight, anchor -> align) — single run
 * - <image> with href (data: or external) -> ImageNode
 * - presentation attrs + inline style: fill, stroke, stroke-width, -linecap,
 *   -linejoin, -dasharray, fill-rule, opacity, fill-/stroke-opacity
 * - transform lists: matrix/translate/scale/rotate/skewX/skewY (composed)
 * - defs gradients: linear/radial, userSpaceOnUse AND objectBoundingBox,
 *   gradientTransform, href stop inheritance -> our unit-space GradientPaint
 * Unsupported elements are skipped (never fail the whole import).
 */

import type { Mat } from '../geometry/matrix'
import { compose, IDENTITY, multiply, translate } from '../geometry/matrix'
import { parsePathData } from '../geometry/pathData'
import { bboxOfSubPaths, type BBox } from '../geometry/bbox'
import { createAnchor, createSubPath } from '../model/pathOps'
import {
  createEllipseNode,
  createGroupNode,
  createImageNode,
  createLineNode,
  createPathNode,
  createRectNode,
  createTextNode,
  rgba,
  toSubPaths,
} from '../model/nodes'
import { linearAxisTransform, radialCircleTransform } from '../model/gradientGeometry'
import type {
  GradientPaint,
  GradientStop,
  Paint,
  RGBA,
  SceneNode,
  Style,
  StrokeCap,
  StrokeJoin,
} from '../model/types'

export interface SvgImportResult {
  /** Every created node (groups + leaves), parent/children wired. */
  nodes: SceneNode[]
  /** Top-level node ids (parents are null until insertion). */
  roots: string[]
  /** The source's viewBox / width-height box, when declared. */
  viewBox: BBox | null
}

// ---------------------------------------------------------------------------
// Color / paint parsing
// ---------------------------------------------------------------------------

const NAMED_COLORS: Record<string, RGBA> = {
  black: rgba(0, 0, 0),
  white: rgba(255, 255, 255),
  red: rgba(255, 0, 0),
  green: rgba(0, 128, 0),
  lime: rgba(0, 255, 0),
  blue: rgba(0, 0, 255),
  yellow: rgba(255, 255, 0),
  orange: rgba(255, 165, 0),
  purple: rgba(128, 0, 128),
  pink: rgba(255, 192, 203),
  cyan: rgba(0, 255, 255),
  aqua: rgba(0, 255, 255),
  magenta: rgba(255, 0, 255),
  fuchsia: rgba(255, 0, 255),
  gray: rgba(128, 128, 128),
  grey: rgba(128, 128, 128),
  silver: rgba(192, 192, 192),
  maroon: rgba(128, 0, 0),
  navy: rgba(0, 0, 128),
  teal: rgba(0, 128, 128),
  olive: rgba(128, 128, 0),
  brown: rgba(165, 42, 42),
  gold: rgba(255, 215, 0),
  transparent: rgba(0, 0, 0, 0),
}

export function parseColor(raw: string): RGBA | null {
  const s = raw.trim().toLowerCase()
  if (s in NAMED_COLORS) return { ...NAMED_COLORS[s]! }
  if (s.startsWith('#')) {
    const hex = s.slice(1)
    if (hex.length === 3 || hex.length === 4) {
      const [r, g, b, a] = [...hex].map((c) => parseInt(c + c, 16))
      if ([r, g, b].some((v) => Number.isNaN(v!))) return null
      return rgba(r!, g!, b!, hex.length === 4 ? a! / 255 : 1)
    }
    if (hex.length === 6 || hex.length === 8) {
      const r = parseInt(hex.slice(0, 2), 16)
      const g = parseInt(hex.slice(2, 4), 16)
      const b = parseInt(hex.slice(4, 6), 16)
      const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1
      if ([r, g, b].some(Number.isNaN)) return null
      return rgba(r, g, b, a)
    }
    return null
  }
  const fn = s.match(/^(rgba?)\(([^)]*)\)$/)
  if (fn) {
    const parts = fn[2]!.split(/[\s,/]+/).filter(Boolean)
    if (parts.length < 3) return null
    const chan = (v: string): number =>
      v.endsWith('%') ? (parseFloat(v) / 100) * 255 : parseFloat(v)
    const r = chan(parts[0]!)
    const g = chan(parts[1]!)
    const b = chan(parts[2]!)
    let a = 1
    if (parts[3] !== undefined) {
      a = parts[3]!.endsWith('%') ? parseFloat(parts[3]!) / 100 : parseFloat(parts[3]!)
    }
    if ([r, g, b, a].some(Number.isNaN)) return null
    return rgba(Math.round(r), Math.round(g), Math.round(b), a)
  }
  return null
}

// ---------------------------------------------------------------------------
// Transform parsing
// ---------------------------------------------------------------------------

export function parseTransformList(raw: string | null): Mat {
  if (!raw) return [...IDENTITY] as Mat
  let m: Mat = [...IDENTITY] as Mat
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g
  let match: RegExpExecArray | null
  while ((match = re.exec(raw)) !== null) {
    const args = match[2]!
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number)
    if (args.some(Number.isNaN)) continue
    let t: Mat | null = null
    switch (match[1]) {
      case 'matrix':
        if (args.length === 6) t = args as unknown as Mat
        break
      case 'translate':
        t = translate(args[0] ?? 0, args[1] ?? 0)
        break
      case 'scale':
        t = [args[0] ?? 1, 0, 0, args[1] ?? args[0] ?? 1, 0, 0]
        break
      case 'rotate': {
        const rad = ((args[0] ?? 0) * Math.PI) / 180
        const cos = Math.cos(rad)
        const sin = Math.sin(rad)
        const rot: Mat = [cos, sin, -sin, cos, 0, 0]
        t =
          args.length >= 3
            ? compose(translate(args[1]!, args[2]!), rot, translate(-args[1]!, -args[2]!))
            : rot
        break
      }
      case 'skewX':
        t = [1, 0, Math.tan(((args[0] ?? 0) * Math.PI) / 180), 1, 0, 0]
        break
      case 'skewY':
        t = [1, Math.tan(((args[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0]
        break
    }
    if (t) m = multiply(m, t)
  }
  return m
}

// ---------------------------------------------------------------------------
// Style resolution (presentation attrs + inline style + inheritance)
// ---------------------------------------------------------------------------

interface RawStyle {
  fill?: string
  stroke?: string
  strokeWidth?: number
  strokeCap?: StrokeCap
  strokeJoin?: StrokeJoin
  strokeDash?: number[]
  fillRule?: 'nonzero' | 'evenodd'
  fillOpacity?: number
  strokeOpacity?: number
  opacity?: number
  display?: string
}

function styleOf(el: Element): RawStyle {
  const out: RawStyle = {}
  const get = (name: string): string | null => el.getAttribute(name)
  const props: Record<string, string> = {}
  const inline = get('style')
  if (inline) {
    for (const decl of inline.split(';')) {
      const i = decl.indexOf(':')
      if (i > 0) props[decl.slice(0, i).trim().toLowerCase()] = decl.slice(i + 1).trim()
    }
  }
  const val = (name: string): string | undefined => props[name] ?? get(name) ?? undefined

  const fill = val('fill')
  if (fill !== undefined) out.fill = fill
  const stroke = val('stroke')
  if (stroke !== undefined) out.stroke = stroke
  const sw = val('stroke-width')
  if (sw !== undefined) out.strokeWidth = parseFloat(sw)
  const cap = val('stroke-linecap')
  if (cap === 'butt' || cap === 'round' || cap === 'square') out.strokeCap = cap
  const join = val('stroke-linejoin')
  if (join === 'miter' || join === 'round' || join === 'bevel') out.strokeJoin = join
  const dash = val('stroke-dasharray')
  if (dash !== undefined && dash !== 'none') {
    const nums = dash.split(/[\s,]+/).map(parseFloat).filter((n) => !Number.isNaN(n))
    if (nums.length > 0) out.strokeDash = nums
  }
  const fr = val('fill-rule')
  if (fr === 'nonzero' || fr === 'evenodd') out.fillRule = fr
  const fo = val('fill-opacity')
  if (fo !== undefined) out.fillOpacity = parseFloat(fo)
  const so = val('stroke-opacity')
  if (so !== undefined) out.strokeOpacity = parseFloat(so)
  const o = val('opacity')
  if (o !== undefined) out.opacity = parseFloat(o)
  const disp = val('display')
  if (disp !== undefined) out.display = disp
  return out
}

interface Inherited {
  fill: string
  stroke: string
  strokeWidth: number
  strokeCap: StrokeCap
  strokeJoin: StrokeJoin
  strokeDash: number[]
  fillRule: 'nonzero' | 'evenodd'
  fillOpacity: number
  strokeOpacity: number
}

const SVG_DEFAULTS: Inherited = {
  fill: 'black', // the SVG spec default
  stroke: 'none',
  strokeWidth: 1,
  strokeCap: 'butt',
  strokeJoin: 'miter',
  strokeDash: [],
  fillRule: 'nonzero',
  fillOpacity: 1,
  strokeOpacity: 1,
}

function inherit(parent: Inherited, raw: RawStyle): Inherited {
  return {
    fill: raw.fill ?? parent.fill,
    stroke: raw.stroke ?? parent.stroke,
    strokeWidth: raw.strokeWidth ?? parent.strokeWidth,
    strokeCap: raw.strokeCap ?? parent.strokeCap,
    strokeJoin: raw.strokeJoin ?? parent.strokeJoin,
    strokeDash: raw.strokeDash ?? parent.strokeDash,
    fillRule: raw.fillRule ?? parent.fillRule,
    fillOpacity: raw.fillOpacity ?? parent.fillOpacity,
    strokeOpacity: raw.strokeOpacity ?? parent.strokeOpacity,
  }
}

// ---------------------------------------------------------------------------
// Gradients
// ---------------------------------------------------------------------------

interface GradientDef {
  type: 'linear' | 'radial'
  stops: GradientStop[]
  /** Axis geometry in the gradient's own coordinate reading. */
  coords: { x1: number; y1: number; x2: number; y2: number; cx: number; cy: number; r: number }
  units: 'objectBoundingBox' | 'userSpaceOnUse'
  gradientTransform: Mat
  href: string | null
}

function num(el: Element, name: string, fallback: number): number {
  const v = el.getAttribute(name)
  if (v === null) return fallback
  const n = parseFloat(v)
  return Number.isNaN(n) ? fallback : n
}

function parseGradientEl(el: Element): GradientDef {
  const type = el.tagName.toLowerCase() === 'radialgradient' ? 'radial' : 'linear'
  const stops: GradientStop[] = []
  for (const stopEl of Array.from(el.children)) {
    if (stopEl.tagName.toLowerCase() !== 'stop') continue
    const rawOffset = stopEl.getAttribute('offset') ?? '0'
    const offset = rawOffset.endsWith('%') ? parseFloat(rawOffset) / 100 : parseFloat(rawOffset)
    const styleProps = styleOf(stopEl)
    const colorStr =
      (styleProps as { fill?: string }).fill === undefined
        ? (stopEl.getAttribute('stop-color') ??
          /stop-color\s*:\s*([^;]+)/.exec(stopEl.getAttribute('style') ?? '')?.[1] ??
          'black')
        : 'black'
    const color = parseColor(colorStr) ?? rgba(0, 0, 0)
    const so =
      stopEl.getAttribute('stop-opacity') ??
      /stop-opacity\s*:\s*([^;]+)/.exec(stopEl.getAttribute('style') ?? '')?.[1]
    if (so !== undefined && so !== null) color.a *= parseFloat(so)
    stops.push({ offset: Number.isNaN(offset) ? 0 : Math.min(1, Math.max(0, offset)), color })
  }
  return {
    type,
    stops,
    coords: {
      x1: num(el, 'x1', 0),
      y1: num(el, 'y1', 0),
      x2: num(el, 'x2', 1),
      y2: num(el, 'y2', 0),
      cx: num(el, 'cx', 0.5),
      cy: num(el, 'cy', 0.5),
      r: num(el, 'r', 0.5),
    },
    units:
      el.getAttribute('gradientUnits') === 'userSpaceOnUse'
        ? 'userSpaceOnUse'
        : 'objectBoundingBox',
    gradientTransform: parseTransformList(el.getAttribute('gradientTransform')),
    href: (el.getAttribute('href') ?? el.getAttribute('xlink:href'))?.replace(/^#/, '') ?? null,
  }
}

/** Resolve a gradient def into OUR unit-space GradientPaint for `node`. */
function gradientPaint(
  def: GradientDef,
  defs: Map<string, GradientDef>,
  localBBox: BBox | null,
): GradientPaint | null {
  // href chains inherit stops (and geometry when absent).
  let stops = def.stops
  let hops = 0
  let cur: GradientDef | undefined = def
  while (stops.length === 0 && cur?.href && hops < 8) {
    cur = defs.get(cur.href)
    if (cur) stops = cur.stops
    hops++
  }
  if (stops.length === 0) return null
  if (stops.length === 1) stops = [stops[0]!, { ...stops[0]!, offset: 1 }]

  const c = def.coords
  // Map gradient coordinates into node-LOCAL space.
  const toLocal = (x: number, y: number): { x: number; y: number } => {
    if (def.units === 'objectBoundingBox' && localBBox) {
      return {
        x: localBBox.minX + x * (localBBox.maxX - localBBox.minX),
        y: localBBox.minY + y * (localBBox.maxY - localBBox.minY),
      }
    }
    return { x, y }
  }
  let axis: Mat
  if (def.type === 'linear') {
    axis = linearAxisTransform(toLocal(c.x1, c.y1), toLocal(c.x2, c.y2))
  } else {
    const center = toLocal(c.cx, c.cy)
    const scale =
      def.units === 'objectBoundingBox' && localBBox
        ? Math.max(localBBox.maxX - localBBox.minX, localBBox.maxY - localBBox.minY)
        : 1
    axis = radialCircleTransform(center, c.r * scale)
  }
  return {
    type: 'gradient',
    gradientType: def.type,
    stops: stops.map((s) => ({ offset: s.offset, color: { ...s.color } })),
    transform: multiply(def.gradientTransform, axis),
  }
}

// ---------------------------------------------------------------------------
// Element -> node
// ---------------------------------------------------------------------------

function buildStyle(
  inh: Inherited,
  defs: Map<string, GradientDef>,
  localBBoxFn: () => BBox | null,
): Style {
  const resolvePaint = (raw: string, opacityMul: number): Paint | null => {
    const s = raw.trim()
    if (s === '' || s === 'none') return null
    const url = /^url\(["']?#([^"')]+)["']?\)/.exec(s)
    if (url) {
      const def = defs.get(url[1]!)
      if (!def) return null
      return gradientPaint(def, defs, localBBoxFn())
    }
    const color = parseColor(s)
    if (!color) return null
    color.a *= opacityMul
    return { type: 'solid', color }
  }
  return {
    fill: resolvePaint(inh.fill, inh.fillOpacity),
    stroke: resolvePaint(inh.stroke, inh.strokeOpacity),
    strokeWidth: inh.strokeWidth,
    strokeCap: inh.strokeCap,
    strokeJoin: inh.strokeJoin,
    strokeDash: [...inh.strokeDash],
    fillRule: inh.fillRule,
  }
}

function pointsToSubPath(raw: string, closed: boolean) {
  const nums = raw
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number)
    .filter((n) => !Number.isNaN(n))
  const anchors = []
  for (let i = 0; i + 1 < nums.length; i += 2) {
    anchors.push(createAnchor({ x: nums[i]!, y: nums[i + 1]! }))
  }
  return anchors.length >= 2 ? createSubPath(anchors, closed) : null
}

/**
 * Parse an SVG string into scene nodes. Throws on unparseable XML; skips
 * unsupported elements. Requires a DOM (DOMParser) — browser or jsdom.
 */
export function importSVG(svgText: string): SvgImportResult {
  const parsed = new DOMParser().parseFromString(svgText, 'image/svg+xml')
  if (parsed.querySelector('parsererror')) throw new Error('import: not valid SVG')
  const svg = parsed.documentElement

  // Collect gradient defs anywhere in the document first.
  const defs = new Map<string, GradientDef>()
  for (const el of Array.from(svg.querySelectorAll('linearGradient, radialGradient'))) {
    const id = el.getAttribute('id')
    if (id) defs.set(id, parseGradientEl(el))
  }

  const all: SceneNode[] = []

  const walk = (el: Element, inh: Inherited): SceneNode | null => {
    const tag = el.tagName.toLowerCase()
    if (tag === 'defs' || tag === 'style' || tag === 'metadata' || tag === 'title' || tag === 'desc') {
      return null
    }
    const raw = styleOf(el)
    if (raw.display === 'none') return null
    const merged = inherit(inh, raw)
    const transform = parseTransformList(el.getAttribute('transform'))
    const opacity = raw.opacity !== undefined ? Math.min(1, Math.max(0, raw.opacity)) : 1
    const overrides = { transform, opacity }
    const named = (node: SceneNode): SceneNode => {
      const idAttr = el.getAttribute('id')
      if (idAttr) node.name = idAttr
      all.push(node)
      return node
    }
    // Style resolution is lazy about the local bbox (objectBoundingBox
    // gradients); shapes provide their geometry after construction.
    const styleFor = (localBBoxFn: () => BBox | null): Style =>
      buildStyle(merged, defs, localBBoxFn)

    switch (tag) {
      case 'svg':
      case 'g': {
        const group = createGroupNode(overrides)
        for (const child of Array.from(el.children)) {
          const node = walk(child, merged)
          if (node) {
            node.parent = group.id
            group.children.push(node.id)
          }
        }
        if (group.children.length === 0) return null
        all.push(group)
        const idAttr = el.getAttribute('id')
        if (idAttr) group.name = idAttr
        return group
      }
      case 'rect': {
        const x = num(el, 'x', 0)
        const y = num(el, 'y', 0)
        const w = num(el, 'width', 0)
        const h = num(el, 'height', 0)
        if (w <= 0 || h <= 0) return null
        const rx = num(el, 'rx', 0)
        const node = createRectNode({ x, y, w, h, rx, ry: num(el, 'ry', rx) }, overrides)
        node.style = styleFor(() => ({ minX: x, minY: y, maxX: x + w, maxY: y + h }))
        return named(node)
      }
      case 'circle': {
        const r = num(el, 'r', 0)
        if (r <= 0) return null
        const cx = num(el, 'cx', 0)
        const cy = num(el, 'cy', 0)
        const node = createEllipseNode({ cx, cy, rx: r, ry: r }, overrides)
        node.style = styleFor(() => ({ minX: cx - r, minY: cy - r, maxX: cx + r, maxY: cy + r }))
        return named(node)
      }
      case 'ellipse': {
        const rx = num(el, 'rx', 0)
        const ry = num(el, 'ry', 0)
        if (rx <= 0 || ry <= 0) return null
        const cx = num(el, 'cx', 0)
        const cy = num(el, 'cy', 0)
        const node = createEllipseNode({ cx, cy, rx, ry }, overrides)
        node.style = styleFor(() => ({ minX: cx - rx, minY: cy - ry, maxX: cx + rx, maxY: cy + ry }))
        return named(node)
      }
      case 'line': {
        const node = createLineNode(
          { x1: num(el, 'x1', 0), y1: num(el, 'y1', 0), x2: num(el, 'x2', 0), y2: num(el, 'y2', 0) },
          overrides,
        )
        node.style = styleFor(() => bboxOfSubPaths(toSubPaths(node)))
        node.style.fill = null // lines have no interior
        return named(node)
      }
      case 'polyline':
      case 'polygon': {
        const sp = pointsToSubPath(el.getAttribute('points') ?? '', tag === 'polygon')
        if (!sp) return null
        const node = createPathNode([sp], overrides)
        node.style = styleFor(() => bboxOfSubPaths(node.subpaths))
        if (tag === 'polyline' && el.getAttribute('fill') === null) node.style.fill = null
        return named(node)
      }
      case 'path': {
        const d = el.getAttribute('d')
        if (!d) return null
        let subpaths
        try {
          subpaths = parsePathData(d)
        } catch {
          return null // skip a malformed path, keep the rest of the file
        }
        if (subpaths.length === 0) return null
        const node = createPathNode(subpaths, overrides)
        node.style = styleFor(() => bboxOfSubPaths(subpaths))
        return named(node)
      }
      case 'text': {
        const content = (el.textContent ?? '').trim()
        if (content === '') return null
        const x = num(el, 'x', 0)
        const y = num(el, 'y', 0)
        const anchor = el.getAttribute('text-anchor')
        const fontSize = parseFloat(
          /font-size\s*:\s*([\d.]+)/.exec(el.getAttribute('style') ?? '')?.[1] ??
            el.getAttribute('font-size') ??
            '16',
        )
        const node = createTextNode(
          {
            text: content,
            fontSize: Number.isNaN(fontSize) ? 16 : fontSize,
            fontFamily: el.getAttribute('font-family')?.split(',')[0]?.replace(/["']/g, '').trim() || 'Inter',
            fontWeight: parseInt(el.getAttribute('font-weight') ?? '400', 10) || 400,
            textAlign: anchor === 'middle' ? 'center' : anchor === 'end' ? 'right' : 'left',
          },
          // Text baseline origin is LOCAL (0,0); x/y move into the transform.
          { transform: multiply(transform, translate(x, y)), opacity },
        )
        node.style = styleFor(() => null)
        if (!node.style.fill && !node.style.stroke) {
          node.style.fill = { type: 'solid', color: rgba(20, 20, 20, 1) }
        }
        return named(node)
      }
      case 'image': {
        const href = el.getAttribute('href') ?? el.getAttribute('xlink:href')
        const w = num(el, 'width', 0)
        const h = num(el, 'height', 0)
        if (!href || w <= 0 || h <= 0) return null
        const x = num(el, 'x', 0)
        const y = num(el, 'y', 0)
        const node = createImageNode(
          { href, w, h },
          { transform: multiply(transform, translate(x, y)), opacity },
        )
        return named(node)
      }
      default:
        return null // unsupported element: skip, don't fail
    }
  }

  const rootInh = inherit(SVG_DEFAULTS, styleOf(svg))
  const roots: string[] = []
  for (const child of Array.from(svg.children)) {
    const node = walk(child, rootInh)
    if (node) {
      node.parent = null
      roots.push(node.id)
    }
  }

  // Source view box (placement hint for the insert command).
  let viewBox: BBox | null = null
  const vb = svg.getAttribute('viewBox')
  if (vb) {
    const [minX, minY, w, h] = vb.split(/[\s,]+/).map(Number)
    if ([minX, minY, w, h].every((v) => v !== undefined && !Number.isNaN(v))) {
      viewBox = { minX: minX!, minY: minY!, maxX: minX! + w!, maxY: minY! + h! }
    }
  } else {
    const w = num(svg, 'width', 0)
    const h = num(svg, 'height', 0)
    if (w > 0 && h > 0) viewBox = { minX: 0, minY: 0, maxX: w, maxY: h }
  }

  return { nodes: all, roots, viewBox }
}
