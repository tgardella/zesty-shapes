/**
 * File/paste/drop import front door. Routes by type:
 * - SVG: parsed into real editable scene nodes (svgImport)
 * - PNG/JPG: placed as an ImageNode (data: URL, natural size)
 * - PDF: pages rasterized via pdfjs-dist (lazy-loaded) -> one ImageNode per
 *   page. TRUE vector PDF import is out of scope — stated, not stubbed.
 * Everything lands as ONE 'Import' undo step, centered on the viewport (or
 * the active artboard when the Artboard tool has one).
 */

import type { Vec2 } from '../geometry/vec2'
import { createImageNode } from '../model/nodes'
import type { SceneNode } from '../model/types'
import { pasteClipboard } from '../store/clipboard'
import { screenToDoc } from '../store/coords'
import { cmdInsertImportedNodes } from '../store/importCommands'
import type { EditorStoreApi } from '../store/store'
import { importSVG } from './svgImport'

function looksLikeSvg(text: string): boolean {
  return text.trimStart().startsWith('<') && text.includes('<svg')
}

/** Doc-space point imports center on: viewport center (artboards pan there). */
function importCenter(store: EditorStoreApi): Vec2 {
  const state = store.getState()
  const el = document.querySelector('.viewport')
  const r = el?.getBoundingClientRect()
  return screenToDoc(state.viewport, {
    x: (r?.width ?? window.innerWidth) / 2,
    y: (r?.height ?? window.innerHeight) / 2,
  })
}

function readAsDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('import: file read failed'))
    reader.readAsDataURL(blob)
  })
}

function readAsText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('import: file read failed'))
    reader.readAsText(blob)
  })
}

function imageSize(dataUrl: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight })
    img.onerror = () => reject(new Error('import: image failed to decode'))
    img.src = dataUrl
  })
}

export function importSvgText(store: EditorStoreApi, svgText: string, name = 'SVG'): boolean {
  const result = importSVG(svgText)
  if (result.roots.length === 0) return false
  cmdInsertImportedNodes(store, result.nodes, result.roots, {
    centerOn: importCenter(store),
    label: 'Import SVG',
    groupName: name,
  })
  return true
}

export async function importImageBlob(
  store: EditorStoreApi,
  blob: Blob,
  name = 'Image',
): Promise<boolean> {
  const href = await readAsDataURL(blob)
  const { w, h } = await imageSize(href)
  if (w === 0 || h === 0) return false
  const node = createImageNode({ href, w, h }, { name })
  cmdInsertImportedNodes(store, [node], [node.id], {
    centerOn: importCenter(store),
    label: 'Import Image',
  })
  return true
}

/**
 * Rasterize every PDF page (2x for crispness) into ImageNodes stacked
 * vertically. pdfjs-dist loads lazily so the editor bundle stays lean.
 */
export async function importPdfBlob(
  store: EditorStoreApi,
  blob: Blob,
  name = 'PDF',
): Promise<boolean> {
  const pdfjs = await import('pdfjs-dist')
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

  const data = await blob.arrayBuffer()
  const pdf = await pdfjs.getDocument({ data }).promise
  const RASTER_SCALE = 2
  const nodes: SceneNode[] = []
  let yOffset = 0
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p)
    const viewport = page.getViewport({ scale: RASTER_SCALE })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) continue
    await page.render({ canvas, canvasContext: ctx, viewport }).promise
    const node = createImageNode(
      {
        href: canvas.toDataURL('image/png'),
        w: viewport.width / RASTER_SCALE,
        h: viewport.height / RASTER_SCALE,
      },
      { name: pdf.numPages > 1 ? `${name} p${p}` : name },
    )
    node.transform = [1, 0, 0, 1, 0, yOffset]
    yOffset += viewport.height / RASTER_SCALE + 20
    nodes.push(node)
  }
  if (nodes.length === 0) return false
  cmdInsertImportedNodes(store, nodes, nodes.map((n) => n.id), {
    centerOn: importCenter(store),
    label: 'Import PDF',
    groupName: name,
  })
  return true
}

/** Route one file by its type/extension. Returns whether anything imported. */
export async function importFile(store: EditorStoreApi, file: File): Promise<boolean> {
  const name = file.name.replace(/\.[^.]+$/, '')
  const ext = file.name.toLowerCase().split('.').pop() ?? ''
  if (file.type === 'image/svg+xml' || ext === 'svg') {
    return importSvgText(store, await readAsText(file), name)
  }
  if (file.type.startsWith('image/')) {
    return importImageBlob(store, file, name)
  }
  if (file.type === 'application/pdf' || ext === 'pdf') {
    return importPdfBlob(store, file, name)
  }
  return false
}

/**
 * Paste from the SYSTEM clipboard on demand (used by the canvas context menu's
 * "Paste", where there's no ClipboardEvent to read). Reads images/SVG via the
 * async Clipboard API; falls back to the in-app clipboard when the system
 * clipboard has no importable content or permission is denied.
 */
export async function pasteFromSystemClipboard(store: EditorStoreApi): Promise<boolean> {
  try {
    if (navigator.clipboard?.read) {
      const items = await navigator.clipboard.read()
      for (const item of items) {
        const imgType = item.types.find((t) => t.startsWith('image/'))
        if (imgType) {
          const blob = await item.getType(imgType)
          if (await importImageBlob(store, blob, 'Pasted Image')) return true
        }
        if (item.types.includes('text/plain')) {
          const text = await (await item.getType('text/plain')).text()
          if (looksLikeSvg(text) && importSvgText(store, text, 'Pasted SVG')) return true
        }
      }
    }
  } catch {
    // Permission denied / unsupported — fall back to the in-app clipboard.
  }
  return pasteClipboard(store).length > 0
}

/**
 * Wire paste (SVG text, image blobs, files) and drag-drop onto the window.
 * Returns an unsubscribe function.
 */
export function registerImportHandlers(store: EditorStoreApi): () => void {
  const onPaste = (e: ClipboardEvent): void => {
    const target = e.target as HTMLElement | null
    // Never hijack typing surfaces (text editor, panel inputs).
    if (target && (target.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(target.tagName))) return
    const dt = e.clipboardData
    if (!dt) return

    // Files first: covers "copy image" and copying a file in the OS. Some
    // browsers expose pasted images only through items, so scan both.
    const files = new Map<string, File>()
    for (const f of Array.from(dt.files)) files.set(`${f.name}:${f.size}`, f)
    for (const item of Array.from(dt.items)) {
      if (item.kind === 'file') {
        const f = item.getAsFile()
        if (f) files.set(`${f.name}:${f.size}`, f)
      }
    }
    if (files.size > 0) {
      e.preventDefault()
      for (const f of files.values()) void importFile(store, f)
      return
    }

    // SVG source text (copied from a code/design tool).
    const text = dt.getData('text/plain')
    if (looksLikeSvg(text)) {
      e.preventDefault()
      importSvgText(store, text, 'Pasted SVG')
      return
    }

    // No external content on the clipboard: fall back to the in-app clipboard
    // (covers right-click → Paste of copied nodes).
    pasteClipboard(store)
  }
  const onDragOver = (e: DragEvent): void => {
    if (e.dataTransfer?.types.includes('Files')) e.preventDefault()
  }
  const onDrop = (e: DragEvent): void => {
    const files = Array.from(e.dataTransfer?.files ?? [])
    if (files.length === 0) return
    e.preventDefault()
    for (const f of files) void importFile(store, f)
  }
  window.addEventListener('paste', onPaste)
  window.addEventListener('dragover', onDragOver)
  window.addEventListener('drop', onDrop)
  return () => {
    window.removeEventListener('paste', onPaste)
    window.removeEventListener('dragover', onDragOver)
    window.removeEventListener('drop', onDrop)
  }
}
