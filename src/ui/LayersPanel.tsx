/**
 * Layers panel: mirrors the node tree (top-most first — the reverse of the
 * children array, which is painted bottom -> top). Selection is two-way
 * synced with the canvas. Rows support rename (double-click), hide/lock
 * toggles (inherited by children via deep hit-test checks), expand/collapse
 * for groups, and drag-reorder: drop above/below a row, or onto a group row
 * to nest into it (reparent preserves world position).
 */

import { Fragment, useState } from 'react'
import type { DragEvent, ReactNode } from 'react'
import type { GroupNode, NodeId, SceneNode } from '../model/types'
import {
  cmdPlaceNode,
  cmdRenameNode,
  cmdSetNodeHidden,
  cmdSetNodeLocked,
} from '../store/commands'
import { editorStore, useEditor } from '../store/store'

type DropZone = 'above' | 'below' | 'inside'

interface DndState {
  dragId: NodeId
  overId: NodeId | null
  zone: DropZone
}

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

export function LayersPanel() {
  const doc = useEditor((s) => s.document)
  const selection = useEditor((s) => s.selection)
  const [collapsed, setCollapsed] = useState<ReadonlySet<NodeId>>(new Set())
  const [renamingId, setRenamingId] = useState<NodeId | null>(null)
  const [dnd, setDnd] = useState<DndState | null>(null)

  const root = doc.nodes[doc.root]
  if (!root || root.type !== 'group') return null
  const selected = new Set(selection)

  const toggleCollapsed = (id: NodeId) => {
    const next = new Set(collapsed)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setCollapsed(next)
  }

  const onRowClick = (id: NodeId, shiftOrMeta: boolean) => {
    const state = editorStore.getState()
    if (shiftOrMeta) {
      if (state.selection.includes(id)) state.removeFromSelection([id])
      else state.addToSelection([id])
    } else {
      state.setSelection([id])
    }
  }

  const dropZoneFor = (e: DragEvent, isGroup: boolean): DropZone => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const t = (e.clientY - rect.top) / rect.height
    if (isGroup) return t < 0.28 ? 'above' : t > 0.72 ? 'below' : 'inside'
    return t < 0.5 ? 'above' : 'below'
  }

  const renderRow = (id: NodeId, depth: number): ReactNode => {
    const node = doc.nodes[id]
    if (!node) return null
    const isGroup = node.type === 'group'
    const isCollapsed = collapsed.has(id)
    const isSelected = selected.has(id)
    const hint = dnd && dnd.overId === id ? dnd.zone : null

    return (
      <Fragment key={id}>
        <div
          className={
            'layer-row' +
            (isSelected ? ' selected' : '') +
            (hint === 'inside' ? ' drop-inside' : '') +
            (hint === 'above' ? ' drop-above' : '') +
            (hint === 'below' ? ' drop-below' : '')
          }
          style={{ paddingLeft: 8 + depth * 14 }}
          draggable={renamingId !== id}
          onClick={(e) => onRowClick(id, e.shiftKey || e.metaKey || e.ctrlKey)}
          onDragStart={(e) => {
            e.dataTransfer.setData('text/plain', id)
            e.dataTransfer.effectAllowed = 'move'
            setDnd({ dragId: id, overId: null, zone: 'above' })
          }}
          onDragOver={(e) => {
            // The drag payload itself is unreadable during dragover; accept
            // any of our drags (text/plain) and use React state for visuals.
            if (!e.dataTransfer.types.includes('text/plain')) return
            e.preventDefault()
            if (!dnd || dnd.dragId === id) return
            const zone = dropZoneFor(e, isGroup)
            if (dnd.overId !== id || dnd.zone !== zone) setDnd({ ...dnd, overId: id, zone })
          }}
          onDrop={(e) => {
            e.preventDefault()
            // dataTransfer is the source of truth (state can lag a tick).
            const dragId = e.dataTransfer.getData('text/plain')
            if (dragId && dragId !== id) cmdPlaceNode(editorStore, dragId, id, dropZoneFor(e, isGroup))
            setDnd(null)
          }}
          onDragEnd={() => setDnd(null)}
        >
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
          <svg className="layer-type" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            {TYPE_ICONS[node.type]}
          </svg>
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
              className="layer-name"
              onDoubleClick={(e) => {
                e.stopPropagation()
                setRenamingId(id)
              }}
            >
              {node.name}
            </span>
          )}
          <button
            type="button"
            className={'layer-flag' + (node.hidden ? ' on' : '')}
            title={node.hidden ? 'Show' : 'Hide'}
            onClick={(e) => {
              e.stopPropagation()
              cmdSetNodeHidden(editorStore, id, !node.hidden)
            }}
          >
            {node.hidden ? '−' : '●'}
          </button>
          <button
            type="button"
            className={'layer-flag' + (node.locked ? ' on' : '')}
            title={node.locked ? 'Unlock' : 'Lock'}
            onClick={(e) => {
              e.stopPropagation()
              cmdSetNodeLocked(editorStore, id, !node.locked)
            }}
          >
            {node.locked ? '🔒' : '○'}
          </button>
        </div>
        {isGroup &&
          !isCollapsed &&
          [...(node as GroupNode).children]
            .reverse() // panel shows top-most first
            .map((childId) => renderRow(childId, depth + 1))}
      </Fragment>
    )
  }

  return (
    <div className="panel panel-grow">
      <div className="panel-title">Layers</div>
      <div className="layers-list">
        {[...root.children].reverse().map((id) => renderRow(id, 0))}
        {root.children.length === 0 && <div className="layers-empty">No objects yet</div>}
      </div>
    </div>
  )
}
