/**
 * Export dialog: scope (whole document / one artboard / every artboard /
 * selection) x format (SVG / PNG / JPG / PDF) x raster scale. 'All artboards'
 * downloads one asset per artboard. All formats start from the model-emitted
 * SVG string; raster/PDF outline text first (see export/exporters).
 */

import { useState } from 'react'
import {
  buildExportAssets,
  downloadAsset,
  type ExportFormat,
  type ExportScope,
} from '../export/exporters'
import { editorStore, useEditor } from '../store/store'

const FORMATS: ExportFormat[] = ['svg', 'png', 'jpg', 'pdf']
const SCALES = [1, 2, 3, 4]

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const artboards = useEditor((s) => s.document.artboards)
  const hasSelection = useEditor((s) => s.selection.length > 0)
  const [scope, setScope] = useState<ExportScope>('document')
  const [artboardId, setArtboardId] = useState(artboards[0]?.id ?? '')
  const [format, setFormat] = useState<ExportFormat>('svg')
  const [scale, setScale] = useState(1)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const state = editorStore.getState()
      const assets = await buildExportAssets(state.document, {
        format,
        scope,
        scale,
        artboardId,
        selection: state.selection,
      })
      if (assets.length === 0) {
        setError('Nothing to export for this scope.')
        return
      }
      for (const asset of assets) downloadAsset(asset)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="dialog-backdrop" onPointerDown={onClose}>
      <div className="dialog" onPointerDown={(e) => e.stopPropagation()}>
        <div className="dialog-title">Export</div>

        <label className="dialog-row">
          <span>Scope</span>
          <select value={scope} onChange={(e) => setScope(e.target.value as ExportScope)}>
            <option value="document">Whole document</option>
            <option value="artboard">One artboard</option>
            <option value="all-artboards">All artboards ({artboards.length} files)</option>
            <option value="selection" disabled={!hasSelection}>
              Selection{hasSelection ? '' : ' (nothing selected)'}
            </option>
          </select>
        </label>

        {scope === 'artboard' && (
          <label className="dialog-row">
            <span>Artboard</span>
            <select value={artboardId} onChange={(e) => setArtboardId(e.target.value)}>
              {artboards.map((ab) => (
                <option key={ab.id} value={ab.id}>
                  {ab.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="dialog-row">
          <span>Format</span>
          <select value={format} onChange={(e) => setFormat(e.target.value as ExportFormat)}>
            {FORMATS.map((f) => (
              <option key={f} value={f}>
                {f.toUpperCase()}
              </option>
            ))}
          </select>
        </label>

        {(format === 'png' || format === 'jpg') && (
          <label className="dialog-row">
            <span>Scale</span>
            <select value={scale} onChange={(e) => setScale(Number(e.target.value))}>
              {SCALES.map((s) => (
                <option key={s} value={s}>
                  {s}x
                </option>
              ))}
            </select>
          </label>
        )}

        {error && <div className="dialog-error">{error}</div>}

        <div className="dialog-actions">
          <button type="button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="primary" onClick={() => void run()} disabled={busy}>
            {busy ? 'Exporting…' : 'Export'}
          </button>
        </div>
      </div>
    </div>
  )
}
