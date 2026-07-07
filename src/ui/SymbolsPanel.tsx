/**
 * Symbols panel: the document's named symbol library. "New Symbol" snapshots
 * the selection; clicking a row makes it the ACTIVE symbol (the Symbol
 * Sprayer sprays it); Place drops one instance at the viewport center;
 * double-click renames. Thumbnails render from the model through the same
 * SVG emitter as export.
 */

import { useState } from 'react'
import type { SymbolDef } from '../model/types'
import { documentToSVG } from '../model/serialize'
import { screenToDoc } from '../store/coords'
import {
  cmdCreateSymbol,
  cmdDeleteSymbol,
  cmdRenameSymbol,
  cmdStampSymbol,
  symbolDefBounds,
} from '../store/symbolCommands'
import { editorStore, useEditor } from '../store/store'

/** Model -> data-URL thumbnail via the standard exporter (padded bounds). */
function symbolThumbnail(def: SymbolDef): string | null {
  const bounds = symbolDefBounds(def)
  if (!bounds) return null
  const pad = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) * 0.06 + 1
  const rootId = `sym-root-${def.id}`
  const svg = documentToSVG(
    {
      version: 1,
      id: `sym-${def.id}`,
      name: def.name,
      nodes: {
        ...def.nodes,
        [rootId]: {
          id: rootId,
          type: 'group',
          name: 'root',
          parent: null,
          transform: [1, 0, 0, 1, 0, 0],
          style: {
            fill: null,
            stroke: null,
            strokeWidth: 1,
            strokeCap: 'butt',
            strokeJoin: 'miter',
            strokeDash: [],
            fillRule: 'nonzero',
          },
          opacity: 1,
          blendMode: 'normal',
          locked: false,
          hidden: false,
          children: def.rootIds,
        },
      },
      root: rootId,
      artboards: [
        {
          id: 'sym-ab',
          name: '',
          x: bounds.minX - pad,
          y: bounds.minY - pad,
          w: bounds.maxX - bounds.minX + pad * 2,
          h: bounds.maxY - bounds.minY + pad * 2,
        },
      ],
    },
    {},
  )
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

function viewportCenterDocPoint(): { x: number; y: number } {
  const el = document.querySelector('.viewport')
  const r = el?.getBoundingClientRect()
  const center = r ? { x: r.width / 2, y: r.height / 2 } : { x: 400, y: 300 }
  return screenToDoc(editorStore.getState().viewport, center)
}

// Stable empty default: a fresh [] per selector call would loop useSyncExternalStore.
const NO_SYMBOLS: SymbolDef[] = []

export function SymbolsPanel() {
  const symbols = useEditor((s) => s.document.symbols ?? NO_SYMBOLS)
  const activeId = useEditor((s) => s.ui.activeSymbolId)
  const hasSelection = useEditor((s) => s.selection.length > 0)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  const setActive = (id: string | null): void => editorStore.getState().setActiveSymbol(id)

  const finishRename = (id: string): void => {
    cmdRenameSymbol(editorStore, id, draft)
    setRenamingId(null)
  }

  return (
    <div className="panel symbols-panel">
      <div className="panel-title">
        Symbols
        <button
          type="button"
          className="symbols-new"
          disabled={!hasSelection}
          title="New Symbol from Selection"
          onClick={() => {
            const id = cmdCreateSymbol(editorStore)
            if (id) setActive(id)
          }}
        >
          ＋
        </button>
      </div>
      {symbols.length === 0 ? (
        <div className="panel-hint">Select art, then ＋ to define a symbol.</div>
      ) : (
        <div className="symbols-list">
          {symbols.map((def) => {
            const thumb = symbolThumbnail(def)
            const isActive = def.id === activeId
            return (
              <div
                key={def.id}
                className={`symbol-row${isActive ? ' active' : ''}`}
                onClick={() => setActive(isActive ? null : def.id)}
                onDoubleClick={() => {
                  setRenamingId(def.id)
                  setDraft(def.name)
                }}
              >
                <span className="symbol-thumb">
                  {thumb && <img src={thumb} alt="" draggable={false} />}
                </span>
                {renamingId === def.id ? (
                  <input
                    className="symbol-rename"
                    value={draft}
                    autoFocus
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={() => finishRename(def.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') finishRename(def.id)
                      if (e.key === 'Escape') setRenamingId(null)
                      e.stopPropagation()
                    }}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span className="symbol-name" title={def.name}>
                    {def.name}
                  </span>
                )}
                <button
                  type="button"
                  className="symbol-action"
                  title="Place one instance at the view center"
                  onClick={(e) => {
                    e.stopPropagation()
                    cmdStampSymbol(editorStore, def.id, {
                      docPoint: viewportCenterDocPoint(),
                      rotation: 0,
                      scale: 1,
                    })
                  }}
                >
                  Place
                </button>
                <button
                  type="button"
                  className="symbol-action symbol-delete"
                  title="Delete symbol (instances stay)"
                  onClick={(e) => {
                    e.stopPropagation()
                    if (activeId === def.id) setActive(null)
                    cmdDeleteSymbol(editorStore, def.id)
                  }}
                >
                  ✕
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
