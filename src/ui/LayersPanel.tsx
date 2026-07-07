/**
 * Layers panel (Illustrator-style). The document root holds LAYERS; objects
 * and sublayers nest inside them. Features:
 * - hierarchical tree (top-most first), two-way selection sync, DnD reorder /
 *   reparent (world position preserved), inline rename (objects)
 * - per-row columns: visibility, lock, disclosure, color swatch / type icon,
 *   name, TARGET (double-ring when targeted for the Appearance panel), and
 *   SELECTION (a color box — full when all art on the layer is selected, a
 *   small box when only some is)
 * - active-layer indicator (new art lands there)
 * - toolbar + panel menu: New Layer / Sublayer, Delete, Duplicate, Merge,
 *   Flatten, Locate Object, Save Selection
 * - Search + type Filter
 * - Layer Options dialog (double-click a layer): name, color, show, lock,
 *   template, dim images
 */

import { Fragment, useCallback, useMemo, useRef, useState } from 'react'
import type { DragEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import type { GroupNode, NodeId, SceneNode } from '../model/types'
import { LAYER_COLORS, isLayerNode, nearestLayer, topLevelLayers } from '../model/layers'
import {
  cmdPlaceNode,
  cmdRenameNode,
  cmdSetNodeHidden,
  cmdSetNodeLocked,
} from '../store/commands'
import {
  cmdCreateLayer,
  cmdCreateSublayer,
  cmdDeleteLayer,
  cmdDuplicateLayer,
  cmdFlattenArtwork,
  cmdMergeLayers,
  cmdSetLayerOptions,
} from '../store/layerCommands'
import { editorStore, useEditor } from '../store/store'

type DropZone = 'above' | 'below' | 'inside'
type TypeFilter = 'all' | 'text' | 'image' | 'path'

interface DndState {
  dragId: NodeId
  overId: NodeId | null
  zone: DropZone
}

const PATH_TYPES = new Set(['path', 'rect', 'ellipse', 'polygon', 'star', 'line'])

const TYPE_ICONS: Record<SceneNode['type'], ReactNode> = {
  group: <path d="M2 5h5l1.5 2H14v6H2z" fill="none" stroke="currentColor" strokeWidth="1.3" />,
  rect: <rect x="3" y="4.5" width="10" height="7" fill="none" stroke="currentColor" strokeWidth="1.3" />,
  ellipse: <ellipse cx="8" cy="8" rx="5" ry="3.8" fill="none" stroke="currentColor" strokeWidth="1.3" />,
  polygon: <path d="M8 3 L13 7 L11 13 L5 13 L3 7 Z" fill="none" stroke="currentColor" strokeWidth="1.3" />,
  star: <path d="M8 2.5 L9.5 6 L13 6.3 L10.4 8.7 L11.2 12.4 L8 10.4 L4.8 12.4 L5.6 8.7 L3 6.3 L6.5 6 Z" fill="none" stroke="currentColor" strokeWidth="1.1" />,
  line: <line x1="3.5" y1="12.5" x2="12.5" y2="3.5" stroke="currentColor" strokeWidth="1.4" />,
  path: <path d="M3 12 C5 4 11 12 13 4" fill="none" stroke="currentColor" strokeWidth="1.3" />,
  text: <text x="8" y="12" textAnchor="middle" fontSize="11" fill="currentColor">T</text>,
  image: (
    <g fill="none" stroke="currentColor" strokeWidth="1.2">
      <rect x="3" y="4" width="10" height="8" />
      <path d="M4 10.5 L7 7.5 L9 9.5 L10.5 8 L12 9.5" />
      <circle cx="6" cy="6.3" r="0.8" fill="currentColor" stroke="none" />
    </g>
  ),
}

function leafDescendants(nodes: Record<NodeId, SceneNode>, id: NodeId): NodeId[] {
  const out: NodeId[] = []
  const visit = (nid: NodeId): void => {
    const n = nodes[nid]
    if (!n) return
    if (n.type === 'group') n.children.forEach(visit)
    else out.push(nid)
  }
  visit(id)
  return out
}

/** How much of a node's art is selected: none / some / all. */
function coverage(
  nodes: Record<NodeId, SceneNode>,
  id: NodeId,
  selected: ReadonlySet<NodeId>,
): 'none' | 'partial' | 'all' {
  const node = nodes[id]
  if (!node) return 'none'
  if (node.type !== 'group') return selected.has(id) ? 'all' : 'none'
  if (selected.has(id)) return 'all'
  const leaves = leafDescendants(nodes, id)
  if (leaves.length === 0) return 'none'
  const n = leaves.filter((l) => selected.has(l)).length
  return n === 0 ? 'none' : n === leaves.length ? 'all' : 'partial'
}

export function LayersPanel() {
  const doc = useEditor((s) => s.document)
  const selection = useEditor((s) => s.selection)
  const activeLayerId = useEditor((s) => s.ui.activeLayerId)
  const targeted = useEditor((s) => s.ui.targetedIds)
  const pathEditId = useEditor((s) => s.ui.pathEdit?.nodeId ?? null)
  const [collapsed, setCollapsed] = useState<ReadonlySet<NodeId>>(new Set())
  const [renamingId, setRenamingId] = useState<NodeId | null>(null)
  const [dnd, setDnd] = useState<DndState | null>(null)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<TypeFilter>('all')
  const [menuOpen, setMenuOpen] = useState(false)
  const [optionsFor, setOptionsFor] = useState<NodeId | null>(null)
  // User-controlled panel height (persisted). Drag the top edge to resize.
  const [height, setHeight] = useState<number>(() => {
    const saved = typeof localStorage !== 'undefined' ? Number(localStorage.getItem('layersPanelHeight')) : NaN
    return Number.isFinite(saved) && saved > 0 ? saved : 300
  })
  const resizeRef = useRef<{ startY: number; startH: number } | null>(null)
  const onResizeDown = useCallback(
    (e: ReactPointerEvent) => {
      e.preventDefault()
      resizeRef.current = { startY: e.clientY, startH: height }
      ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    },
    [height],
  )
  const onResizeMove = useCallback((e: ReactPointerEvent) => {
    const drag = resizeRef.current
    if (!drag) return
    // Panel sits at the bottom of the sidebar: dragging UP makes it taller.
    const max = typeof window !== 'undefined' ? window.innerHeight - 160 : 900
    const next = Math.max(140, Math.min(max, drag.startH + (drag.startY - e.clientY)))
    setHeight(next)
  }, [])
  const onResizeUp = useCallback((e: ReactPointerEvent) => {
    if (!resizeRef.current) return
    resizeRef.current = null
    ;(e.currentTarget as Element).releasePointerCapture?.(e.pointerId)
    if (typeof localStorage !== 'undefined') localStorage.setItem('layersPanelHeight', String(height))
  }, [height])

  const root = doc.nodes[doc.root]
  const selected = useMemo(() => new Set(selection), [selection])
  const targetedSet = useMemo(() => new Set(targeted), [targeted])
  // The effective active layer — any layer/sublayer, falling back to the
  // topmost top-level layer when unset or stale.
  const layers = topLevelLayers(doc)
  const effectiveActive =
    activeLayerId && isLayerNode(doc.nodes[activeLayerId])
      ? activeLayerId
      : layers.at(-1)?.id ?? null

  if (!root || root.type !== 'group') return null

  const nodeMatchesFilter = (node: SceneNode): boolean => {
    if (search && !node.name.toLowerCase().includes(search.toLowerCase())) return false
    if (filter === 'all') return true
    if (filter === 'image') return node.type === 'image'
    if (filter === 'text') return node.type === 'text'
    if (filter === 'path') return PATH_TYPES.has(node.type)
    return true
  }
  const subtreeVisible = (id: NodeId): boolean => {
    const node = doc.nodes[id]
    if (!node) return false
    if (node.type === 'group') {
      const nameHit = !search || node.name.toLowerCase().includes(search.toLowerCase())
      const childHit = node.children.some((c) => subtreeVisible(c))
      return childHit || (nameHit && filter === 'all')
    }
    return nodeMatchesFilter(node)
  }
  const searching = search !== '' || filter !== 'all'

  const toggleCollapsed = (id: NodeId) => {
    const next = new Set(collapsed)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setCollapsed(next)
  }

  const syncActiveLayer = (id: NodeId) => {
    // The active insertion layer is the clicked layer itself, or the object's
    // NEAREST container layer/sublayer (so pasting lands where you're working).
    const layer = isLayerNode(doc.nodes[id]) ? id : nearestLayer(doc, id)?.id
    if (layer) editorStore.getState().setActiveLayer(layer)
  }

  const onRowClick = (id: NodeId, additive: boolean) => {
    const state = editorStore.getState()
    if (additive) {
      if (state.selection.includes(id)) state.removeFromSelection([id])
      else state.addToSelection([id])
    } else {
      state.setSelection([id])
    }
    syncActiveLayer(id)
  }

  const onTargetClick = (id: NodeId) => {
    const state = editorStore.getState()
    // Targeting selects the item's art (drives the Appearance panel) and marks
    // the item targeted (double-ring). Clicking an already-targeted item clears.
    if (state.ui.targetedIds.includes(id)) {
      state.setTargeted([])
      return
    }
    const node = doc.nodes[id]
    if (node && node.type === 'group') state.setSelection(leafDescendants(doc.nodes, id))
    else state.setSelection([id])
    state.setTargeted([id])
    syncActiveLayer(id)
  }

  const dropZoneFor = (e: DragEvent, isGroup: boolean): DropZone => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const t = (e.clientY - rect.top) / rect.height
    if (isGroup) return t < 0.28 ? 'above' : t > 0.72 ? 'below' : 'inside'
    return t < 0.5 ? 'above' : 'below'
  }

  const renderRow = (
    id: NodeId,
    depth: number,
    inherited: { hidden: boolean; locked: boolean } = { hidden: false, locked: false },
  ): ReactNode => {
    const node = doc.nodes[id]
    if (!node) return null
    if (searching && !subtreeVisible(id)) return null
    const isGroup = node.type === 'group'
    const isLayer = isLayerNode(node)
    // Effective state: hidden/locked INHERIT from ancestor layers/groups, so a
    // child of a hidden or locked parent reads as hidden/locked in the panel
    // even though its own flag is false (matches the canvas).
    const effectiveHidden = inherited.hidden || node.hidden === true
    const effectiveLocked = inherited.locked || node.locked === true
    const childInherited = { hidden: effectiveHidden, locked: effectiveLocked }
    const isCollapsed = collapsed.has(id) && !searching
    const isSelected = selected.has(id)
    const isActiveLayer = isLayer && id === effectiveActive
    let cover = coverage(doc.nodes, id, selected)
    // A path being anchor-edited (Direct Selection) reads as at-least-partial
    // even if the whole node isn't in the object selection.
    if (cover === 'none' && pathEditId && (id === pathEditId || leafDescendants(doc.nodes, id).includes(pathEditId)))
      cover = 'partial'
    // Objects inherit their NEAREST layer's color; a layer uses its own.
    const swatchColor =
      (isLayer ? node.layerColor : nearestLayer(doc, id)?.layerColor) ?? '#8b92a5'
    const hint = dnd && dnd.overId === id ? dnd.zone : null

    return (
      <Fragment key={id}>
        <div
          className={
            'layer-row' +
            (isSelected ? ' selected' : '') +
            (isActiveLayer ? ' active-layer' : '') +
            (isLayer ? ' is-layer' : '') +
            (effectiveHidden ? ' row-hidden' : '') +
            (effectiveLocked ? ' row-locked' : '') +
            (hint === 'inside' ? ' drop-inside' : '') +
            (hint === 'above' ? ' drop-above' : '') +
            (hint === 'below' ? ' drop-below' : '')
          }
          draggable={renamingId !== id}
          onClick={(e) => onRowClick(id, e.shiftKey || e.metaKey || e.ctrlKey)}
          onDragStart={(e) => {
            e.dataTransfer.setData('text/plain', id)
            e.dataTransfer.effectAllowed = 'move'
            setDnd({ dragId: id, overId: null, zone: 'above' })
          }}
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes('text/plain')) return
            e.preventDefault()
            if (!dnd || dnd.dragId === id) return
            const zone = dropZoneFor(e, isGroup)
            if (dnd.overId !== id || dnd.zone !== zone) setDnd({ ...dnd, overId: id, zone })
          }}
          onDrop={(e) => {
            e.preventDefault()
            const dragId = e.dataTransfer.getData('text/plain')
            if (dragId && dragId !== id) cmdPlaceNode(editorStore, dragId, id, dropZoneFor(e, isGroup))
            setDnd(null)
          }}
          onDragEnd={() => setDnd(null)}
        >
          {/* Visibility (reflects inherited state; disabled when an ancestor
              hides this row — you can't un-hide it independently). */}
          <button
            type="button"
            className={
              'layer-col-icon' + (effectiveHidden ? ' off' : '') + (inherited.hidden ? ' inherited' : '')
            }
            title={inherited.hidden ? 'Hidden by parent' : node.hidden ? 'Show' : 'Hide'}
            disabled={inherited.hidden}
            onClick={(e) => {
              e.stopPropagation()
              if (!inherited.hidden) cmdSetNodeHidden(editorStore, id, !node.hidden)
            }}
          >
            {effectiveHidden ? (
              <svg width="15" height="15" viewBox="0 0 16 16"><path d="M2 8s2.5-4 6-4 6 4 6 4-2.5 4-6 4-6-4-6-4z" fill="none" stroke="currentColor" strokeWidth="1.1" opacity="0.35" /><line x1="3" y1="13" x2="13" y2="3" stroke="currentColor" strokeWidth="1.2" /></svg>
            ) : (
              <svg width="15" height="15" viewBox="0 0 16 16"><path d="M2 8s2.5-4 6-4 6 4 6 4-2.5 4-6 4-6-4-6-4z" fill="none" stroke="currentColor" strokeWidth="1.1" /><circle cx="8" cy="8" r="1.7" fill="currentColor" /></svg>
            )}
          </button>
          {/* Lock (reflects inherited state; disabled when an ancestor locks it). */}
          <button
            type="button"
            className={
              'layer-col-icon' +
              (effectiveLocked ? ' on' : ' faint') +
              (inherited.locked ? ' inherited' : '')
            }
            title={inherited.locked ? 'Locked by parent' : node.locked ? 'Unlock' : 'Lock'}
            disabled={inherited.locked}
            onClick={(e) => {
              e.stopPropagation()
              if (!inherited.locked) cmdSetNodeLocked(editorStore, id, !node.locked)
            }}
          >
            {effectiveLocked ? (
              <svg width="13" height="13" viewBox="0 0 16 16"><rect x="3.5" y="7" width="9" height="6.5" rx="1" fill="currentColor" /><path d="M5 7V5.2a3 3 0 0 1 6 0V7" fill="none" stroke="currentColor" strokeWidth="1.3" /></svg>
            ) : (
              <svg width="13" height="13" viewBox="0 0 16 16"><rect x="3.5" y="7" width="9" height="6.5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.2" /><path d="M5 7V5.2a3 3 0 0 1 5.6-1.3" fill="none" stroke="currentColor" strokeWidth="1.2" /></svg>
            )}
          </button>

          <div className="layer-main" style={{ paddingLeft: depth * 13 }}>
            {isGroup ? (
              <button
                type="button"
                className={'layer-caret' + (isCollapsed ? '' : ' open')}
                onClick={(e) => {
                  e.stopPropagation()
                  toggleCollapsed(id)
                }}
                aria-label={isCollapsed ? 'Expand' : 'Collapse'}
              >
                ▸
              </button>
            ) : (
              <span className="layer-caret-spacer" />
            )}
            {isLayer ? (
              <button
                type="button"
                className="layer-swatch"
                style={{ background: swatchColor }}
                title="Layer color / options"
                onClick={(e) => {
                  e.stopPropagation()
                  setOptionsFor(id)
                }}
              />
            ) : (
              <svg className="layer-type" width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
                {TYPE_ICONS[node.type]}
              </svg>
            )}
            {renamingId === id ? (
              <input
                className="layer-rename"
                defaultValue={node.name}
                autoFocus
                onFocus={(e) => e.currentTarget.select()}
                onBlur={(e) => {
                  cmdRenameNode(editorStore, id, e.currentTarget.value)
                  setRenamingId(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur()
                  if (e.key === 'Escape') setRenamingId(null)
                }}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span
                className={'layer-name' + (isLayer ? ' layer-name-bold' : '')}
                onDoubleClick={(e) => {
                  e.stopPropagation()
                  if (isLayer) setOptionsFor(id)
                  else setRenamingId(id)
                }}
              >
                {node.name}
                {isLayer && (node as GroupNode).template ? (
                  <span className="layer-tag">template</span>
                ) : null}
              </span>
            )}
          </div>

          {/* Target column: double-ring when targeted for the Appearance panel. */}
          <button
            type="button"
            className={'layer-target' + (targetedSet.has(id) ? ' on' : '')}
            title="Target for appearance"
            onClick={(e) => {
              e.stopPropagation()
              onTargetClick(id)
            }}
          >
            <svg width="14" height="14" viewBox="0 0 16 16">
              <circle cx="8" cy="8" r="5" fill="none" stroke="currentColor" strokeWidth="1.3" />
              {targetedSet.has(id) && <circle cx="8" cy="8" r="2.4" fill="none" stroke="currentColor" strokeWidth="1.3" />}
            </svg>
          </button>

          {/* Selection column: color box (full when all art selected, small when partial). */}
          <span className="layer-selbox" aria-hidden="true">
            {cover !== 'none' && (
              <span
                className={'selbox' + (cover === 'partial' ? ' partial' : '')}
                style={{ background: swatchColor }}
              />
            )}
          </span>
        </div>
        {isGroup &&
          !isCollapsed &&
          [...(node as GroupNode).children]
            .reverse()
            .map((childId) => renderRow(childId, depth + 1, childInherited))}
      </Fragment>
    )
  }

  const doMenu = (fn: () => void) => {
    fn()
    setMenuOpen(false)
  }

  return (
    <div className="panel layers-panel" style={{ height }}>
      <div
        className="layers-resize"
        title="Drag to resize"
        onPointerDown={onResizeDown}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeUp}
      />
      <div className="layers-header">
        <span className="panel-title">Layers</span>
        <div className="layers-menu-wrap">
          <button
            type="button"
            className="layers-menu-btn"
            title="Panel menu"
            onClick={() => setMenuOpen((v) => !v)}
          >
            ⋯
          </button>
          {menuOpen && (
            <>
              <div className="menu-backdrop" onClick={() => setMenuOpen(false)} />
              <div className="layers-menu">
                <button type="button" onClick={() => doMenu(() => cmdCreateLayer(editorStore))}>New Layer</button>
                <button type="button" onClick={() => doMenu(() => cmdCreateSublayer(editorStore))}>New Sublayer</button>
                <button
                  type="button"
                  disabled={selection.length === 0}
                  onClick={() => doMenu(() => cmdDuplicateLayer(editorStore, selection))}
                >
                  Duplicate Selection
                </button>
                <div className="menu-sep" />
                <button
                  type="button"
                  disabled={selection.filter((id) => layers.some((l) => l.id === id)).length < 2}
                  onClick={() => doMenu(() => cmdMergeLayers(editorStore, selection))}
                >
                  Merge Selected
                </button>
                <button type="button" onClick={() => doMenu(() => cmdFlattenArtwork(editorStore))}>Flatten Artwork</button>
                <div className="menu-sep" />
                <button
                  type="button"
                  disabled={selection.length === 0}
                  onClick={() =>
                    doMenu(() => {
                      // Locate: expand ancestors of the first selected object.
                      const first = selection[0]
                      if (!first) return
                      const next = new Set(collapsed)
                      let cur = doc.nodes[first]?.parent ?? null
                      while (cur) {
                        next.delete(cur)
                        cur = doc.nodes[cur]?.parent ?? null
                      }
                      setCollapsed(next)
                    })
                  }
                >
                  Locate Object
                </button>
                <button
                  type="button"
                  disabled={selection.length === 0}
                  onClick={() =>
                    doMenu(() => {
                      const name = window.prompt('Save selection as:', `Selection ${editorStore.getState().ui.savedSelections.length + 1}`)
                      if (name) editorStore.getState().saveSelection(name, selection)
                    })
                  }
                >
                  Save Selection
                </button>
                {editorStore.getState().ui.savedSelections.length > 0 && <div className="menu-sep" />}
                {editorStore.getState().ui.savedSelections.map((s) => (
                  <button
                    key={s.name}
                    type="button"
                    className="menu-saved"
                    onClick={() => doMenu(() => editorStore.getState().setSelection(s.ids))}
                  >
                    ⤷ {s.name}
                  </button>
                ))}
                <div className="menu-sep" />
                <button type="button" className="menu-disabled" disabled title="Deferred">Make Clipping Mask</button>
                <button type="button" className="menu-disabled" disabled title="Deferred">Collect for Export</button>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="layers-tools">
        <input
          className="layers-search"
          type="search"
          placeholder="Search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="layers-filter"
          value={filter}
          onChange={(e) => setFilter(e.target.value as TypeFilter)}
          title="Filter by type"
        >
          <option value="all">All</option>
          <option value="path">Paths</option>
          <option value="text">Text</option>
          <option value="image">Images</option>
        </select>
      </div>

      <div className="layers-list">
        {[...root.children].reverse().map((id) => renderRow(id, 0))}
        {root.children.length === 0 && <div className="layers-empty">No layers</div>}
      </div>

      <div className="layers-footer">
        <button type="button" title="New Layer" onClick={() => cmdCreateLayer(editorStore)}>
          <svg width="15" height="15" viewBox="0 0 16 16"><rect x="2.5" y="2.5" width="11" height="11" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.2" /><line x1="8" y1="5" x2="8" y2="11" stroke="currentColor" strokeWidth="1.3" /><line x1="5" y1="8" x2="11" y2="8" stroke="currentColor" strokeWidth="1.3" /></svg>
        </button>
        <button type="button" title="New Sublayer" onClick={() => cmdCreateSublayer(editorStore)}>
          <svg width="15" height="15" viewBox="0 0 16 16"><path d="M4 4h8M4 8h6M4 12h4" stroke="currentColor" strokeWidth="1.3" fill="none" /><line x1="12" y1="10" x2="12" y2="14" stroke="currentColor" strokeWidth="1.3" /><line x1="10" y1="12" x2="14" y2="12" stroke="currentColor" strokeWidth="1.3" /></svg>
        </button>
        <div className="layers-footer-spacer" />
        <button
          type="button"
          title="Delete"
          disabled={selection.length === 0}
          onClick={() => cmdDeleteLayer(editorStore, selection)}
        >
          <svg width="15" height="15" viewBox="0 0 16 16"><path d="M4 5h8l-.7 8.5a1 1 0 0 1-1 .9H5.7a1 1 0 0 1-1-.9L4 5z" fill="none" stroke="currentColor" strokeWidth="1.2" /><path d="M2.6 5h10.8M6.3 5V3.6h3.4V5" fill="none" stroke="currentColor" strokeWidth="1.2" /></svg>
        </button>
      </div>

      {optionsFor && doc.nodes[optionsFor] && (
        <LayerOptionsDialog layerId={optionsFor} onClose={() => setOptionsFor(null)} />
      )}
    </div>
  )
}

function LayerOptionsDialog({ layerId, onClose }: { layerId: NodeId; onClose: () => void }) {
  const layer = useEditor((s) => s.document.nodes[layerId]) as GroupNode | undefined
  const [name, setName] = useState(layer?.name ?? '')
  const [color, setColor] = useState(layer?.layerColor ?? LAYER_COLORS[0]!)
  const [show, setShow] = useState(!(layer?.hidden ?? false))
  const [locked, setLocked] = useState(layer?.locked ?? false)
  const [template, setTemplate] = useState(layer?.template ?? false)
  const [dimOn, setDimOn] = useState(typeof layer?.dimImages === 'number')
  const [dimPct, setDimPct] = useState(layer?.dimImages ?? 50)
  if (!layer) return null

  const apply = () => {
    cmdSetLayerOptions(editorStore, layerId, {
      name,
      layerColor: color,
      hidden: !show,
      locked,
      template,
      dimImages: dimOn ? Math.max(1, Math.min(100, dimPct)) : null,
    })
    onClose()
  }

  return (
    <div className="dialog-backdrop" onPointerDown={onClose}>
      <div className="dialog" onPointerDown={(e) => e.stopPropagation()}>
        <div className="dialog-title">Layer Options</div>
        <label className="dialog-row">
          <span>Name</span>
          <input value={name} autoFocus onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="dialog-row">
          <span>Color</span>
          <span className="layer-color-swatches">
            {LAYER_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={'color-dot' + (c === color ? ' sel' : '')}
                style={{ background: c }}
                onClick={() => setColor(c)}
              />
            ))}
          </span>
        </label>
        <label className="dialog-check">
          <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> Show
        </label>
        <label className="dialog-check">
          <input type="checkbox" checked={locked} onChange={(e) => setLocked(e.target.checked)} /> Lock
        </label>
        <label className="dialog-check">
          <input type="checkbox" checked={template} onChange={(e) => setTemplate(e.target.checked)} /> Template
        </label>
        <label className="dialog-check">
          <input type="checkbox" checked={dimOn} onChange={(e) => setDimOn(e.target.checked)} /> Dim Images to
          <input
            className="dim-pct"
            type="number"
            min={1}
            max={100}
            value={dimPct}
            disabled={!dimOn}
            onChange={(e) => setDimPct(parseInt(e.target.value, 10) || 0)}
          />
          %
        </label>
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="button" className="primary" onClick={apply}>OK</button>
        </div>
      </div>
    </div>
  )
}
