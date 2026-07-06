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
import { chunkPathData, hasWidthProfile, widthChunks } from './widthProfile'
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
  if (node.type === 'group') {
    const inner = node.children.map((childId) => nodeToSVG(doc, childId, reg)).join('')
    return `<g id="${escapeXml(node.id)}"${commonAttrs(node)}>${inner}</g>`
  }
  if (node.type === 'text') {
    // RESERVED: real text layout ships with the Type tool; emit a best-effort element.
    return (
      `<text id="${escapeXml(node.id)}"${commonAttrs(node)}${styleAttrs(node, reg)}` +
      ` font-family="${escapeXml(node.fontFamily)}" font-size="${node.fontSize}">` +
      `${escapeXml(node.text)}</text>`
    )
  }
  if (hasWidthProfile(node.style)) return variableWidthToSVG(node, reg)
  const d = subpathsToPathData(toSubPaths(node))
  if (d === '') return ''
  return `<path id="${escapeXml(node.id)}" d="${d}"${commonAttrs(node)}${styleAttrs(node, reg)}/>`
}

/**
 * Variable-width stroke APPROXIMATION (mirrors NodeView): the fill as one
 * path + short stroke chunks at interpolated widths, round caps/joins hiding
 * the joints. The true filled-outline export lands with the offset/boolean
 * engine (post Prompt 5).
 */
function variableWidthToSVG(
  node: Exclude<SceneNode, { type: 'group' | 'text' }>,
  reg: DefsRegistry,
): string {
  const subpaths = toSubPaths(node)
  const chunks = widthChunks(subpaths, node.style)
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
  if (chunks && chunks.length > 0) {
    const strokeAttrs = paintAttrs('stroke', style, reg, node.id)
    const paths = chunks
      .map((c) => `<path d="${chunkPathData(c)}" stroke-width="${c.width}"/>`)
      .join('')
    inner += `<g fill="none"${strokeAttrs} stroke-linecap="round" stroke-linejoin="round">${paths}</g>`
  }
  if (inner === '') return ''
  return `<g id="${escapeXml(node.id)}"${commonAttrs(node)}>${inner}</g>`
}

/**
 * Emit the whole document as a standalone SVG string. The viewBox is the
 * union of all artboards (per-artboard export arrives in a later phase).
 */
export function documentToSVG(doc: Document): string {
  let view: BBox | null = null
  for (const ab of doc.artboards) {
    view = unionBBox(view, { minX: ab.x, minY: ab.y, maxX: ab.x + ab.w, maxY: ab.y + ab.h })
  }
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
  const content =
    root && root.type === 'group'
      ? root.children.map((id) => nodeToSVG(doc, id, reg)).join('')
      : ''
  const defs = defsToSVG(reg) // after content walk so all paints are acquired

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" ` +
    `viewBox="${view.minX} ${view.minY} ${w} ${h}">` +
    defs +
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
