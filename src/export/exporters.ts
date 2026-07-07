/**
 * Multi-format export. Every format starts from the MODEL-EMITTED SVG string
 * (model/serialize documentToSVG) — never the rendered React DOM:
 * - SVG: the string as-is (text stays real <text>)
 * - PNG/JPG: the string rasterized through Image + canvas.drawImage + toBlob
 * - PDF: the string parsed to a detached element and drawn via svg2pdf/jsPDF
 * For raster and PDF, text nodes are first converted to OUTLINE geometry on a
 * cloned document (same glyph pipeline as Convert to Outlines), so text
 * survives without the target having our fonts.
 */

import { jsPDF } from 'jspdf'
import 'svg2pdf.js' // side-effect: registers jsPDF.prototype.svg()
import type { BBox } from '../geometry/bbox'
import type { Document, NodeId, PathNode, TextNode } from '../model/types'
import {
  artboardsBounds,
  documentToSVG,
  nodesBounds,
  type SvgExportOptions,
} from '../model/serialize'
import { ensureFontsLoaded, textToOutlineSubPaths } from '../rendering/fontKit'

export type ExportFormat = 'svg' | 'png' | 'jpg' | 'pdf'
export type ExportScope = 'document' | 'artboard' | 'all-artboards' | 'selection'

export interface ExportRequest {
  format: ExportFormat
  scope: ExportScope
  /** Raster scale factor (1x/2x/3x...); ignored for SVG/PDF. */
  scale: number
  /** Required when scope === 'artboard'. */
  artboardId?: string
  /** Required when scope === 'selection'. */
  selection?: NodeId[]
}

export interface ExportAsset {
  filename: string
  blob: Blob
}

// ---------------------------------------------------------------------------
// Text -> outlines on a cloned document (raster/PDF fidelity)
// ---------------------------------------------------------------------------

/**
 * Clone the document with every visible TextNode replaced by its outline
 * PathNode (same id/transform/z). Fonts must be loaded first.
 */
export function outlineTextInDocument(doc: Document): Document {
  const clone = JSON.parse(JSON.stringify(doc)) as Document
  for (const node of Object.values(clone.nodes)) {
    if (node.type !== 'text') continue
    const text = node as TextNode
    const subpaths = textToOutlineSubPaths(text)
    if (!subpaths) continue
    const outlined: PathNode = {
      id: text.id,
      type: 'path',
      name: text.name,
      parent: text.parent,
      transform: text.transform,
      style: { ...text.style, fillRule: 'nonzero' },
      opacity: text.opacity,
      blendMode: text.blendMode,
      locked: text.locked,
      hidden: text.hidden,
      subpaths,
    }
    clone.nodes[text.id] = outlined
  }
  return clone
}

// ---------------------------------------------------------------------------
// Format renderers
// ---------------------------------------------------------------------------

function svgBlob(svg: string): Blob {
  return new Blob([svg], { type: 'image/svg+xml' })
}

/** Rasterize an SVG string (width/height attrs = doc units) to PNG/JPG. */
export async function rasterizeSvg(
  svg: string,
  widthDoc: number,
  heightDoc: number,
  scale: number,
  mime: 'image/png' | 'image/jpeg',
): Promise<Blob> {
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  const img = new Image()
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('export: SVG failed to rasterize'))
    img.src = url
  })
  const w = Math.max(1, Math.round(widthDoc * scale))
  const h = Math.max(1, Math.round(heightDoc * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('export: no 2d canvas context')
  ctx.drawImage(img, 0, 0, w, h)
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, mime, mime === 'image/jpeg' ? 0.92 : undefined),
  )
  if (!blob) throw new Error('export: canvas.toBlob returned null')
  return blob
}

/** Render an SVG string to a single-page PDF (page = the SVG's doc-unit size). */
export async function svgToPdfBlob(svg: string, widthDoc: number, heightDoc: number): Promise<Blob> {
  const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml')
  const el = parsed.documentElement
  if (parsed.querySelector('parsererror')) throw new Error('export: invalid SVG for PDF')
  const pdf = new jsPDF({
    orientation: widthDoc >= heightDoc ? 'landscape' : 'portrait',
    unit: 'px',
    format: [widthDoc, heightDoc],
    hotfixes: ['px_scaling'],
  })
  await pdf.svg(el as unknown as Element, { x: 0, y: 0, width: widthDoc, height: heightDoc })
  return pdf.output('blob')
}

// ---------------------------------------------------------------------------
// Request -> assets
// ---------------------------------------------------------------------------

function safeName(s: string): string {
  return s.replace(/[^\w.-]+/g, '_') || 'export'
}

interface Job {
  suffix: string
  opts: SvgExportOptions
  bounds: BBox
}

function jobsFor(doc: Document, req: ExportRequest): Job[] {
  if (req.scope === 'selection') {
    const ids = req.selection ?? []
    const bounds = nodesBounds(doc, ids)
    if (!bounds || ids.length === 0) return []
    return [{ suffix: 'selection', opts: { ids, bounds }, bounds }]
  }
  if (req.scope === 'artboard' || req.scope === 'all-artboards') {
    const boards =
      req.scope === 'artboard'
        ? doc.artboards.filter((ab) => ab.id === req.artboardId)
        : doc.artboards
    return boards.map((ab) => {
      const bounds = { minX: ab.x, minY: ab.y, maxX: ab.x + ab.w, maxY: ab.y + ab.h }
      return { suffix: ab.name, opts: { bounds }, bounds }
    })
  }
  const bounds = artboardsBounds(doc) ?? { minX: 0, minY: 0, maxX: 100, maxY: 100 }
  return [{ suffix: '', opts: {}, bounds }]
}

/**
 * Build one downloadable asset per job — one per artboard for
 * 'all-artboards', otherwise a single file.
 */
export async function buildExportAssets(
  doc: Document,
  req: ExportRequest,
): Promise<ExportAsset[]> {
  const jobs = jobsFor(doc, req)
  if (jobs.length === 0) return []

  // Raster/PDF fidelity: outline text once, shared by every job.
  let exportDoc = doc
  if (req.format !== 'svg') {
    await ensureFontsLoaded()
    exportDoc = outlineTextInDocument(doc)
  }

  const assets: ExportAsset[] = []
  for (const job of jobs) {
    const w = job.bounds.maxX - job.bounds.minX
    const h = job.bounds.maxY - job.bounds.minY
    const base = safeName([doc.name || 'zesty-shapes', job.suffix].filter(Boolean).join('-'))
    const opts: SvgExportOptions = { ...job.opts }
    if (req.format === 'jpg') opts.background = '#ffffff' // JPEG has no alpha
    const svg = documentToSVG(exportDoc, opts)
    switch (req.format) {
      case 'svg':
        assets.push({ filename: `${base}.svg`, blob: svgBlob(documentToSVG(doc, job.opts)) })
        break
      case 'png':
        assets.push({
          filename: `${base}.png`,
          blob: await rasterizeSvg(svg, w, h, req.scale, 'image/png'),
        })
        break
      case 'jpg':
        assets.push({
          filename: `${base}.jpg`,
          blob: await rasterizeSvg(svg, w, h, req.scale, 'image/jpeg'),
        })
        break
      case 'pdf':
        assets.push({ filename: `${base}.pdf`, blob: await svgToPdfBlob(svg, w, h) })
        break
    }
  }
  return assets
}

export function downloadAsset(asset: ExportAsset): void {
  const url = URL.createObjectURL(asset.blob)
  const a = document.createElement('a')
  a.href = url
  a.download = asset.filename
  a.click()
  // Give the click a tick before revoking (Safari races otherwise).
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
