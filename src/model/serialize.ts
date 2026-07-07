/**
 * Serialization:
 * - Document <-> JSON: round-trips with node/subpath/anchor ids preserved EXACTLY.
 * - Document -> SVG string: emitted DIRECTLY from the model (pathData + defs
 *   registry) — never via XMLSerializer on the rendered React DOM. This is the
 *   single source of truth for export.
 * - localStorage save/load with an autosave-ready API (0b wires the trigger).
 */

import type { Document, NodeId, SceneNode, Style } from './types'
import { getWorldTransform } from './document'
import {
  acquireDef,
  createDefsRegistry,
  cssColor,
  defsToSVG,
  paintNeedsDef,
  type DefsRegistry,
} from './defs'
import { subpathsToPathData } from '../geometry/pathData'
import { isIdentity, toSvgTransform } from '../geometry/matrix'
import { toSubPaths } from './nodes'
import { layoutText } from './textLayout'
import { hasWidthProfile } from './widthProfile'
import { blendStepGeometry } from './blend'
import { meshQuads, meshSeamWidth } from './mesh'
import { outlineStroke } from './strokeOutline'
import { regionsToSubPaths } from './booleanOps'
import { localBBoxOfNode, transformBBox, unionBBox, type BBox } from '../geometry/bbox'

// ---------------------------------------------------------------------------
// JSON round-trip
// ---------------------------------------------------------------------------

export function documentToJSON(doc: Document): string {
  return JSON.stringify(doc)
}

/**
 * Parse and structurally validate a document. Throws with a descriptive
 * message on malformed input; never returns a half-valid document.
 */
export function documentFromJSON(json: string): Document {
  const raw: unknown = JSON.parse(json)
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('serialize: document JSON is not an object')
  }
  const doc = raw as Partial<Document>
  if (doc.version !== 1) {
    throw new Error(`serialize: unsupported document version ${String(doc.version)}`)
  }
  if (typeof doc.id !== 'string' || typeof doc.root !== 'string') {
    throw new Error('serialize: document missing id/root')
  }
  if (typeof doc.nodes !== 'object' || doc.nodes === null) {
    throw new Error('serialize: document missing nodes map')
  }
  if (!Array.isArray(doc.artboards) || doc.artboards.length === 0) {
    throw new Error('serialize: document missing artboards')
  }
  const nodes = doc.nodes as Record<NodeId, SceneNode>
  const root = nodes[doc.root]
  if (!root || root.type !== 'group' || root.parent !== null) {
    throw new Error('serialize: root must be a parentless group node')
  }
  // Referential integrity: every child list entry exists and points back.
  for (const [id, node] of Object.entries(nodes)) {
    if (node.id !== id) throw new Error(`serialize: node key '${id}' != node.id '${node.id}'`)
    if (node.type === 'group') {
      for (const childId of node.children) {
        const child = nodes[childId]
        if (!child) throw new Error(`serialize: missing child '${childId}' of '${id}'`)
        if (child.parent !== id) {
          throw new Error(`serialize: child '${childId}' parent out of sync with '${id}'`)
        }
      }
    }
  }
  return doc as Document
}

// ---------------------------------------------------------------------------
// Model -> SVG
// ---------------------------------------------------------------------------

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function paintAttrs(
  kind: 'fill' | 'stroke',
  style: Style,
  reg: DefsRegistry,
  userId: string,
): string {
  const paint = style[kind]
  if (paint === null) return ` ${kind}="none"`
  if (paintNeedsDef(paint)) {
    const defId = acquireDef(reg, paint, userId)
    return ` ${kind}="url(#${defId})"`
  }
  let out = ` ${kind}="${cssColor(paint.color)}"`
  if (paint.color.a < 1) out += ` ${kind}-opacity="${paint.color.a}"`
  return out
}

function styleAttrs(node: SceneNode, reg: DefsRegistry): string {
  const { style } = node
  let out = paintAttrs('fill', style, reg, node.id)
  if (style.fill !== null && style.fillRule === 'evenodd') out += ` fill-rule="evenodd"`
  out += paintAttrs('stroke', style, reg, node.id)
  if (style.stroke !== null) {
    out += ` stroke-width="${style.strokeWidth}"`
    if (style.strokeCap !== 'butt') out += ` stroke-linecap="${style.strokeCap}"`
    if (style.strokeJoin !== 'miter') out += ` stroke-linejoin="${style.strokeJoin}"`
    if (style.strokeDash.length > 0) out += ` stroke-dasharray="${style.strokeDash.join(' ')}"`
  }
  return out
}

function commonAttrs(node: SceneNode): string {
  let out = ''
  if (!isIdentity(node.transform)) out += ` transform="${toSvgTransform(node.transform)}"`
  if (node.opacity < 1) out += ` opacity="${node.opacity}"`
  if (node.blendMode !== 'normal') out += ` style="mix-blend-mode:${node.blendMode}"`
  return out
}

function nodeToSVG(doc: Document, id: NodeId, reg: DefsRegistry): string {
  const node = doc.nodes[id]
  if (!node || node.hidden) return ''
  // Template layers are tracing aids — never printed/exported (Illustrator).
  if (node.type === 'group' && node.template) return ''
  if (node.type === 'group') {
    // Clipping mask: the `clip` child's outline clips the other children.
    // Mirrors NodeView — a <clipPath> from the mask's silhouette wraps the
    // remaining children; the mask itself is not painted as visible art.
    if (node.clip) {
      const clipChild = doc.nodes[node.clip]
      if (clipChild && clipChild.type !== 'group' && clipChild.type !== 'text') {
        const clipD = subpathsToPathData(toSubPaths(clipChild))
        const clipT = isIdentity(clipChild.transform)
          ? ''
          : ` transform="${toSvgTransform(clipChild.transform)}"`
        const clipId = `clip-${escapeXml(node.id)}`
        const inner = node.children
          .filter((childId) => childId !== node.clip)
          .map((childId) => nodeToSVG(doc, childId, reg))
          .join('')
        return (
          `<g id="${escapeXml(node.id)}"${commonAttrs(node)}>` +
          `<clipPath id="${clipId}"><path d="${clipD}"${clipT}/></clipPath>` +
          `<g clip-path="url(#${clipId})">${inner}</g></g>`
        )
      }
    }
    // LIVE blend: endpoints + derived steps (same geometry the canvas draws).
    if (node.blend && node.children.length === 2) {
      const steps = blendStepGeometry(doc.nodes, node.id)
        .map((step, i) => {
          const d = subpathsToPathData(regionsToSubPaths(step.regions))
          if (d === '') return ''
          const stepNode = { ...node, id: `${node.id}-step-${i + 1}`, style: step.style }
          return `<path d="${d}" fill-rule="evenodd"${styleAttrs(stepNode, reg)}/>`
        })
        .join('')
      const a = nodeToSVG(doc, node.children[0]!, reg)
      const b = nodeToSVG(doc, node.children[1]!, reg)
      return `<g id="${escapeXml(node.id)}"${commonAttrs(node)}>${a}${steps}${b}</g>`
    }
    const inner = node.children.map((childId) => nodeToSVG(doc, childId, reg)).join('')
    return `<g id="${escapeXml(node.id)}"${commonAttrs(node)}>${inner}</g>`
  }
  // Leaf nodes: build the element, then wrap in a live drop-shadow filter if
  // the style carries one (mirrors NodeView).
  const leaf = leafToSVG(node, reg)
  if (leaf !== '' && node.style.dropShadow) return wrapDropShadow(node, leaf)
  return leaf
}

/** feDropShadow wrapper (mirrors NodeView.DropShadowFilter). */
function wrapDropShadow(node: SceneNode, inner: string): string {
  const s = node.style.dropShadow!
  const flood = s.color.a < 1 ? ` flood-opacity="${s.color.a}"` : ''
  const id = `shadow-${escapeXml(node.id)}`
  return (
    `<g><filter id="${id}" x="-50%" y="-50%" width="200%" height="200%">` +
    `<feDropShadow dx="${s.offsetX}" dy="${s.offsetY}" stdDeviation="${s.blur}"` +
    ` flood-color="${cssColor(s.color)}"${flood}/></filter>` +
    `<g filter="url(#${id})">${inner}</g></g>`
  )
}

/** One leaf node's SVG element (no drop-shadow wrapping). */
function leafToSVG(node: SceneNode, reg: DefsRegistry): string {
  if (node.type === 'text') return textToSVG(node, reg)
  if (node.type === 'image') {
    return (
      `<image id="${escapeXml(node.id)}"${commonAttrs(node)} width="${node.w}" ` +
      `height="${node.h}" preserveAspectRatio="none" href="${escapeXml(node.href)}"/>`
    )
  }
  if (node.type === 'mesh') return meshToSVG(node)
  if (node.type === 'group') return ''
  if (hasWidthProfile(node.style)) return variableWidthToSVG(node, reg)
  const d = subpathsToPathData(toSubPaths(node))
  if (d === '') return ''
  return `<path id="${escapeXml(node.id)}" d="${d}"${commonAttrs(node)}${styleAttrs(node, reg)}/>`
}

/**
 * Gradient mesh export mirrors MeshView: the SAME bilinear sub-quads
 * (model/mesh.ts), clipped to the mesh outline. Self-contained — the clipPath
 * lives inside the node's group, no defs registry involvement.
 */
function meshToSVG(node: Extract<SceneNode, { type: 'mesh' }>): string {
  const quads = meshQuads(node)
  const seam = meshSeamWidth(node)
  const round = (v: number): number => Math.round(v * 1000) / 1000
  let inner = ''
  for (const q of quads) {
    const c = q.color
    const fill = `rgb(${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)})`
    const alpha = c.a < 1 ? ` fill-opacity="${c.a}" stroke-opacity="${c.a}"` : ''
    inner +=
      `<polygon points="${q.pts.map((p) => `${round(p.x)},${round(p.y)}`).join(' ')}"` +
      ` fill="${fill}" stroke="${fill}" stroke-width="${round(seam)}"${alpha}/>`
  }
  const outlineD = node.outline ? subpathsToPathData(node.outline) : ''
  if (outlineD !== '') {
    const clipId = `mesh-clip-${escapeXml(node.id)}`
    inner =
      `<clipPath id="${clipId}"><path d="${outlineD}"/></clipPath>` +
      `<g clip-path="url(#${clipId})">${inner}</g>`
  }
  return `<g id="${escapeXml(node.id)}"${commonAttrs(node)}>${inner}</g>`
}

/**
 * Text export mirrors TextView: the SAME layout (model/textLayout via the
 * registered measurer) emitted as tspans — per-line x-lists for point/area
 * text, per-glyph tspans (with rotate) for path text and vertical type.
 */
function textToSVG(node: Extract<SceneNode, { type: 'text' }>, reg: DefsRegistry): string {
  const layout = layoutText(node)
  const round = (v: number): number => Math.round(v * 100) / 100
  let spans = ''
  if (layout.mode === 'lines') {
    for (const line of layout.lines) {
      spans +=
        `<tspan x="${line.xs.map(round).join(' ')}" y="${round(line.y)}">` +
        `${escapeXml(line.text)}</tspan>`
    }
  } else {
    for (const g of layout.glyphs) {
      const rotate = g.rotate !== undefined ? ` rotate="${Math.round(g.rotate * 10) / 10}"` : ''
      spans += `<tspan x="${round(g.x)}" y="${round(g.y)}"${rotate}>${escapeXml(g.char)}</tspan>`
    }
  }
  return (
    `<text id="${escapeXml(node.id)}"${commonAttrs(node)}${styleAttrs(node, reg)}` +
    ` font-family="${escapeXml(node.fontFamily)}" font-size="${node.fontSize}"` +
    ` font-weight="${node.fontWeight}" xml:space="preserve">${spans}</text>`
  )
}

/**
 * Variable-width strokes export as REAL geometry (mirrors NodeView): the
 * stroke's filled outline (model/strokeOutline via the boolean engine)
 * painted with the stroke paint under even-odd, plus the fill as a normal
 * path underneath.
 */
function variableWidthToSVG(
  node: Exclude<SceneNode, { type: 'group' | 'text' }>,
  reg: DefsRegistry,
): string {
  const subpaths = toSubPaths(node)
  const { style } = node
  let inner = ''
  if (style.fill !== null) {
    const d = subpathsToPathData(subpaths)
    if (d !== '') {
      let attrs = paintAttrs('fill', style, reg, node.id)
      if (style.fillRule === 'evenodd') attrs += ` fill-rule="evenodd"`
      inner += `<path d="${d}"${attrs} stroke="none"/>`
    }
  }
  const outline = outlineStroke(subpaths, style)
  if (outline) {
    const d = subpathsToPathData(regionsToSubPaths(outline))
    if (d !== '') {
      // The outline is FILLED with the stroke's paint.
      const paint = style.stroke!
      let fillAttr: string
      if (paintNeedsDef(paint)) {
        fillAttr = ` fill="url(#${acquireDef(reg, paint, node.id)})"`
      } else {
        fillAttr = ` fill="${cssColor(paint.color)}"`
        if (paint.color.a < 1) fillAttr += ` fill-opacity="${paint.color.a}"`
      }
      inner += `<path d="${d}"${fillAttr} fill-rule="evenodd" stroke="none"/>`
    }
  }
  if (inner === '') return ''
  return `<g id="${escapeXml(node.id)}"${commonAttrs(node)}>${inner}</g>`
}

export interface SvgExportOptions {
  /** Doc-space viewBox override (an artboard's rect, a selection's bounds). */
  bounds?: BBox
  /**
   * Export only these nodes (any nesting depth). Each is emitted at its WORLD
   * placement so nested selections land exactly where they render. Default:
   * the whole scene.
   */
  ids?: NodeId[]
  /** Solid background rect under the content (JPG export needs one). */
  background?: string
}

/** Union of the document's artboard rects (the default whole-document view). */
export function artboardsBounds(doc: Document): BBox | null {
  let view: BBox | null = null
  for (const ab of doc.artboards) {
    view = unionBBox(view, { minX: ab.x, minY: ab.y, maxX: ab.x + ab.w, maxY: ab.y + ab.h })
  }
  return view
}

/** World-space bounds of a set of nodes (selection export). */
export function nodesBounds(doc: Document, ids: NodeId[]): BBox | null {
  let out: BBox | null = null
  for (const id of ids) {
    const node = doc.nodes[id]
    if (!node) continue
    const local = localBBoxOfNode(node, doc.nodes)
    if (!local) continue
    out = unionBBox(out, transformBBox(getWorldTransform(doc.nodes, id), local))
  }
  return out
}

/**
 * Emit the document (or a subset/region of it) as a standalone SVG string.
 * The default viewBox is the union of all artboards.
 */
export function documentToSVG(doc: Document, opts: SvgExportOptions = {}): string {
  let view: BBox | null = opts.bounds ?? null
  if (!view && opts.ids) view = nodesBounds(doc, opts.ids)
  if (!view) view = artboardsBounds(doc)
  // Fall back to content bounds if there are somehow no artboards.
  if (!view) {
    const rootNode = doc.nodes[doc.root]
    view =
      (rootNode &&
        localBBoxOfNode(rootNode, doc.nodes) &&
        transformBBox(getWorldTransform(doc.nodes, doc.root), localBBoxOfNode(rootNode, doc.nodes)!)) ||
      { minX: 0, minY: 0, maxX: 100, maxY: 100 }
  }
  const w = view.maxX - view.minX
  const h = view.maxY - view.minY

  const reg = createDefsRegistry()
  const root = doc.nodes[doc.root]
  let content = ''
  if (opts.ids) {
    // Subset export: each node at its WORLD placement — wrap in the parent's
    // world transform so the node's own transform composes exactly as on
    // canvas, regardless of nesting.
    for (const id of opts.ids) {
      const node = doc.nodes[id]
      if (!node || !node.parent) continue
      const parentWorld = getWorldTransform(doc.nodes, node.parent)
      const inner = nodeToSVG(doc, id, reg)
      if (inner === '') continue
      content += isIdentity(parentWorld)
        ? inner
        : `<g transform="${toSvgTransform(parentWorld)}">${inner}</g>`
    }
  } else if (root && root.type === 'group') {
    content = root.children.map((id) => nodeToSVG(doc, id, reg)).join('')
  }
  const defs = defsToSVG(reg) // after content walk so all paints are acquired
  const bg = opts.background
    ? `<rect x="${view.minX}" y="${view.minY}" width="${w}" height="${h}" fill="${opts.background}"/>`
    : ''

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" ` +
    `viewBox="${view.minX} ${view.minY} ${w} ${h}">` +
    defs +
    bg +
    content +
    `</svg>`
  )
}

// ---------------------------------------------------------------------------
// localStorage persistence (autosave-ready; 0b wires the trigger)
// ---------------------------------------------------------------------------

export const STORAGE_KEY = 'zesty-shapes.document'

function storageAvailable(): boolean {
  return typeof localStorage !== 'undefined'
}

/** Returns false when storage is unavailable or full (never throws). */
export function saveDocumentToStorage(doc: Document, key: string = STORAGE_KEY): boolean {
  if (!storageAvailable()) return false
  try {
    localStorage.setItem(key, documentToJSON(doc))
    return true
  } catch {
    return false
  }
}

/** Returns null when absent, unavailable, or corrupt (corrupt data is not destroyed). */
export function loadDocumentFromStorage(key: string = STORAGE_KEY): Document | null {
  if (!storageAvailable()) return null
  const json = localStorage.getItem(key)
  if (json === null) return null
  try {
    return documentFromJSON(json)
  } catch {
    return null
  }
}

export interface Autosaver {
  /** Debounced: call on every document change. */
  schedule: () => void
  /** Write immediately (e.g. beforeunload) and cancel any pending write. */
  flush: () => void
  cancel: () => void
}

/**
 * Autosave-ready API: the 0b store subscribes its document slice to
 * `schedule`. Pure timer logic — no store knowledge here.
 */
export function createAutosaver(
  getDocument: () => Document,
  options: { delayMs?: number; key?: string } = {},
): Autosaver {
  const delay = options.delayMs ?? 800
  const key = options.key ?? STORAGE_KEY
  let timer: ReturnType<typeof setTimeout> | null = null
  const cancel = (): void => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }
  return {
    schedule: () => {
      cancel()
      timer = setTimeout(() => {
        timer = null
        saveDocumentToStorage(getDocument(), key)
      }, delay)
    },
    flush: () => {
      cancel()
      saveDocumentToStorage(getDocument(), key)
    },
    cancel,
  }
}
