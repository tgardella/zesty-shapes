/**
 * Illustrator-style menu bar (File / Edit / Object / View / Window). Click a
 * menu to open it; hovering another menu while one is open switches; Esc or a
 * click elsewhere closes. Items dispatch the SAME store commands the
 * shortcuts/tools use — the menu never mutates state directly.
 */

import { useEffect, useRef, useState } from 'react'
import { importFile, pasteFromSystemClipboard } from '../import/importFiles'
import {
  clipboardIsEmpty,
  copySelection,
  cutSelection,
  pasteClipboard,
} from '../store/clipboard'
import {
  cmdConvertToPath,
  cmdDeleteNodes,
  cmdDuplicateNodes,
  cmdGroupNodes,
  cmdUngroupNodes,
} from '../store/commands'
import {
  cmdBlend,
  cmdExpandBlend,
  cmdReleaseBlend,
  cmdReplaceSpine,
  cmdSetBlendSpine,
  liveBlendIds,
} from '../store/blendCommands'
import { cmdConvertToMesh } from '../store/meshCommands'
import {
  canMakeClipMask,
  canReleaseClipMask,
  cmdMakeClipMask,
  cmdReleaseClipMask,
} from '../store/clipCommands'
import { canSelectSame, selectSame } from '../store/selectSame'
import { cmdOffsetPath, cmdOutlineStroke } from '../store/booleanCommands'
import { cmdNewDocument } from '../store/layerCommands'
import { editorStore, useEditor } from '../store/store'
import { isSelectableDeep, selectionRoots } from '../tools/hitTest'
import type { ToolManager } from '../tools/ToolManager'
import { CustomizeToolbarDialog } from './CustomizeToolbarDialog'
import { ExportDialog } from './ExportDialog'

interface MenuItem {
  label: string
  /** Display-only hint (the ToolManager owns the real bindings). */
  shortcut?: string
  disabled?: boolean
  checked?: boolean
  action?: () => unknown
  sep?: boolean
}

interface Menu {
  label: string
  items: MenuItem[]
}

function viewportCenter(): { x: number; y: number } {
  const el = document.querySelector('.viewport')
  if (el) {
    const r = el.getBoundingClientRect()
    return { x: r.width / 2, y: r.height / 2 }
  }
  return { x: window.innerWidth / 2, y: window.innerHeight / 2 }
}

const CONVERTIBLE = new Set(['rect', 'ellipse', 'polygon', 'star', 'line'])
const MESHABLE = new Set(['rect', 'ellipse', 'polygon', 'star', 'path'])

export function MenuBar({ manager }: { manager: ToolManager }) {
  const [open, setOpen] = useState<number | null>(null)
  const [exporting, setExporting] = useState(false)
  const [customizing, setCustomizing] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)

  // Enablement state (re-render on change).
  const selection = useEditor((s) => s.selection)
  const canUndo = useEditor((s) => s.history.undoStack.length > 0)
  const canRedo = useEditor((s) => s.history.redoStack.length > 0)
  const grid = useEditor((s) => s.ui.grid)
  const snapToGrid = useEditor((s) => s.ui.snapToGrid)
  const zoom = useEditor((s) => s.viewport.zoom)
  const canConvert = useEditor((s) =>
    s.selection.some((id) => CONVERTIBLE.has(s.document.nodes[id]?.type ?? '')),
  )
  const canMesh = useEditor((s) =>
    s.selection.some((id) => MESHABLE.has(s.document.nodes[id]?.type ?? '')),
  )
  const hasGroup = useEditor((s) =>
    s.selection.some((id) => {
      const n = s.document.nodes[id]
      return n?.type === 'group' && !n.isLayer
    }),
  )
  const hasLiveBlend = useEditor((s) => liveBlendIds(editorStore, s.selection).length > 0)
  const canClip = useEditor((s) => canMakeClipMask(editorStore, s.selection))
  const canReleaseClip = useEditor((s) => canReleaseClipMask(editorStore, s.selection))
  const canSame = useEditor((s) => canSelectSame(editorStore, s.selection))
  // Replace Spine needs exactly one live blend + one other outline node selected.
  const spineReplaceable = useEditor((s) => {
    if (s.selection.length !== 2) return false
    const blends = liveBlendIds(editorStore, s.selection)
    if (blends.length !== 1) return false
    const other = s.selection.find((id) => id !== blends[0])
    const n = other ? s.document.nodes[other] : undefined
    return !!n && n.type !== 'group' && n.type !== 'text' && n.type !== 'image'
  })

  useEffect(() => {
    if (open === null) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const hasSelection = selection.length > 0
  const store = editorStore
  const zoomBy = (factor: number) => store.getState().zoomAtPoint(viewportCenter(), factor)

  const selectAll = (): void => {
    const state = store.getState()
    const ids = selectionRoots(state.document, state.document.root).filter((id) =>
      isSelectableDeep(state.document.nodes, id),
    )
    state.setSelection(ids)
  }

  const menus: Menu[] = [
    {
      label: 'File',
      items: [
        {
          label: 'New',
          action: () => {
            if (window.confirm('Clear all artwork and start a new document?')) {
              cmdNewDocument(store)
            }
          },
        },
        { label: 'Open…', shortcut: '', action: () => fileRef.current?.click() },
        { sep: true, label: '' },
        { label: 'Export…', action: () => setExporting(true) },
      ],
    },
    {
      label: 'Edit',
      items: [
        { label: 'Undo', shortcut: '⌘Z', disabled: !canUndo, action: () => store.getState().undo() },
        { label: 'Redo', shortcut: '⇧⌘Z', disabled: !canRedo, action: () => store.getState().redo() },
        { sep: true, label: '' },
        { label: 'Cut', shortcut: '⌘X', disabled: !hasSelection, action: () => cutSelection(store) },
        { label: 'Copy', shortcut: '⌘C', disabled: !hasSelection, action: () => copySelection(store) },
        {
          label: 'Paste',
          shortcut: '⌘V',
          action: () =>
            clipboardIsEmpty() ? pasteFromSystemClipboard(store) : pasteClipboard(store),
        },
        {
          label: 'Duplicate',
          shortcut: '⌘D',
          disabled: !hasSelection,
          action: () => cmdDuplicateNodes(store, store.getState().selection, { offset: { x: 10, y: 10 } }),
        },
        {
          label: 'Delete',
          shortcut: '⌫',
          disabled: !hasSelection,
          action: () => cmdDeleteNodes(store, store.getState().selection),
        },
        { sep: true, label: '' },
        { label: 'Select All', action: selectAll },
        { sep: true, label: '' },
        {
          label: 'Select Same Fill Color',
          disabled: !canSame,
          action: () => selectSame(store, 'fill'),
        },
        {
          label: 'Select Same Stroke Color',
          disabled: !canSame,
          action: () => selectSame(store, 'stroke'),
        },
        {
          label: 'Select Same Stroke Weight',
          disabled: !canSame,
          action: () => selectSame(store, 'strokeWidth'),
        },
        {
          label: 'Select Same Opacity',
          disabled: !canSame,
          action: () => selectSame(store, 'opacity'),
        },
      ],
    },
    {
      label: 'Object',
      items: [
        {
          label: 'Group',
          shortcut: '⌘G',
          disabled: selection.length < 2,
          action: () => cmdGroupNodes(store, store.getState().selection),
        },
        {
          label: 'Ungroup',
          shortcut: '⇧⌘G',
          disabled: !hasGroup,
          action: () => cmdUngroupNodes(store, store.getState().selection),
        },
        { sep: true, label: '' },
        {
          label: 'Make Clipping Mask',
          shortcut: '⌘7',
          disabled: !canClip,
          action: () => cmdMakeClipMask(store, store.getState().selection),
        },
        {
          label: 'Release Clipping Mask',
          shortcut: '⌥⌘7',
          disabled: !canReleaseClip,
          action: () => cmdReleaseClipMask(store, store.getState().selection),
        },
        { sep: true, label: '' },
        {
          label: 'Convert to Path',
          disabled: !canConvert,
          action: () => cmdConvertToPath(store, store.getState().selection),
        },
        {
          label: 'Offset Path…',
          disabled: !hasSelection,
          action: () => {
            const input = window.prompt('Offset distance (px). Negative shrinks.', '10')
            if (input === null) return
            const d = parseFloat(input)
            if (!Number.isNaN(d) && d !== 0) cmdOffsetPath(store, store.getState().selection, d)
          },
        },
        {
          label: 'Outline Stroke',
          disabled: !hasSelection,
          action: () => cmdOutlineStroke(store, store.getState().selection),
        },
        {
          label: 'Create Gradient Mesh',
          disabled: !canMesh,
          action: () => {
            for (const id of store.getState().selection) cmdConvertToMesh(store, id)
          },
        },
        {
          label: 'Blend Selected',
          disabled: selection.length !== 2,
          action: () => {
            const [a, b] = store.getState().selection
            if (a && b) cmdBlend(store, a, b)
          },
        },
        {
          label: 'Expand Blend',
          disabled: !hasLiveBlend,
          action: () => cmdExpandBlend(store, store.getState().selection),
        },
        {
          label: 'Release Blend',
          disabled: !hasLiveBlend,
          action: () => cmdReleaseBlend(store, store.getState().selection),
        },
        {
          label: 'Replace Blend Spine',
          disabled: !spineReplaceable,
          action: () => {
            const sel = store.getState().selection
            const [blend] = liveBlendIds(store, sel)
            const other = sel.find((id) => id !== blend)
            if (blend && other) cmdReplaceSpine(store, blend, other)
          },
        },
        {
          label: 'Reset Blend Spine',
          disabled: !hasLiveBlend,
          action: () => cmdSetBlendSpine(store, store.getState().selection, null),
        },
      ],
    },
    {
      label: 'View',
      items: [
        { label: 'Zoom In', shortcut: '+', action: () => zoomBy(1.25) },
        { label: 'Zoom Out', shortcut: '−', action: () => zoomBy(1 / 1.25) },
        { label: 'Actual Size', shortcut: '100%', action: () => zoomBy(1 / zoom) },
        { sep: true, label: '' },
        {
          label: 'Show Grid',
          checked: grid.show,
          action: () => {
            const state = store.getState()
            const next = !state.ui.grid.show
            state.setGrid({ show: next })
            state.setSnapToGrid(next)
          },
        },
        {
          label: 'Snap to Grid',
          checked: snapToGrid,
          action: () => store.getState().setSnapToGrid(!store.getState().ui.snapToGrid),
        },
      ],
    },
    {
      label: 'Window',
      items: [{ label: 'Customize Toolbar…', action: () => setCustomizing(true) }],
    },
  ]

  const run = (item: MenuItem): void => {
    setOpen(null)
    if (item.action) void Promise.resolve(item.action())
  }

  return (
    <div className="menubar">
      {menus.map((menu, i) => (
        <div key={menu.label} className="menubar-menu">
          <button
            type="button"
            className={`menubar-label${open === i ? ' open' : ''}`}
            onClick={() => setOpen(open === i ? null : i)}
            onPointerEnter={() => {
              if (open !== null && open !== i) setOpen(i)
            }}
          >
            {menu.label}
          </button>
          {open === i && (
            <div className="menubar-dropdown">
              {menu.items.map((item, j) =>
                item.sep ? (
                  <div key={j} className="menu-sep" />
                ) : (
                  <button
                    key={j}
                    type="button"
                    disabled={item.disabled}
                    onClick={() => run(item)}
                  >
                    <span className="menu-check">{item.checked ? '✓' : ''}</span>
                    <span className="menu-item-label">{item.label}</span>
                    {item.shortcut && <span className="menu-shortcut">{item.shortcut}</span>}
                  </button>
                ),
              )}
            </div>
          )}
        </div>
      ))}
      {open !== null && <div className="menu-backdrop menubar-backdrop" onPointerDown={() => setOpen(null)} />}

      <input
        ref={fileRef}
        type="file"
        accept=".svg,.png,.jpg,.jpeg,.pdf,image/svg+xml,image/png,image/jpeg,application/pdf"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          for (const f of Array.from(e.target.files ?? [])) void importFile(store, f)
          e.target.value = ''
        }}
      />
      {exporting && <ExportDialog onClose={() => setExporting(false)} />}
      {customizing && (
        <CustomizeToolbarDialog manager={manager} onClose={() => setCustomizing(false)} />
      )}
    </div>
  )
}
