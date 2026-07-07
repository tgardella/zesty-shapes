/**
 * Right-click context menu over the canvas. The browser's native menu can't
 * paste an image onto a non-editable canvas, so we provide our own: Paste
 * reads the SYSTEM clipboard (images/SVG) via the async Clipboard API and
 * falls back to the in-app clipboard. Also exposes Cut/Copy/Duplicate/Delete
 * for the current selection.
 */

import { useEffect, useState } from 'react'
import { copySelection, cutSelection, pasteClipboard } from '../store/clipboard'
import { pasteFromSystemClipboard } from '../import/importFiles'
import { cmdDeleteNodes, cmdDuplicateNodes } from '../store/commands'
import {
  canMakeClipMask,
  canReleaseClipMask,
  cmdMakeClipMask,
  cmdReleaseClipMask,
} from '../store/clipCommands'
import { canSelectSame, selectSame } from '../store/selectSame'
import { editorStore, useEditor } from '../store/store'

interface MenuState {
  x: number
  y: number
}

export function CanvasContextMenu() {
  const [menu, setMenu] = useState<MenuState | null>(null)
  const hasSelection = useEditor((s) => s.selection.length > 0)

  useEffect(() => {
    const viewport = document.querySelector('.viewport')
    if (!viewport) return
    const onContextMenu = (e: Event): void => {
      const me = e as MouseEvent
      // Let inputs / editable surfaces keep their native menu.
      const target = me.target as HTMLElement | null
      if (target && (target.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(target.tagName))) return
      me.preventDefault()
      setMenu({ x: me.clientX, y: me.clientY })
    }
    viewport.addEventListener('contextmenu', onContextMenu)
    return () => viewport.removeEventListener('contextmenu', onContextMenu)
  }, [])

  if (!menu) return null

  const close = () => setMenu(null)
  const run = (fn: () => unknown) => {
    void Promise.resolve(fn())
    close()
  }
  const selection = () => editorStore.getState().selection
  const sel = selection()
  const sameEnabled = canSelectSame(editorStore, sel)
  const clipEnabled = canMakeClipMask(editorStore, sel)
  const releaseClipEnabled = canReleaseClipMask(editorStore, sel)

  // Keep the menu on-screen.
  const x = Math.min(menu.x, window.innerWidth - 180)
  const y = Math.min(menu.y, window.innerHeight - 220)

  return (
    <>
      <div className="menu-backdrop" onPointerDown={close} onContextMenu={(e) => e.preventDefault()} />
      <div className="context-menu" style={{ left: x, top: y }}>
        <button type="button" disabled={!hasSelection} onClick={() => run(() => cutSelection(editorStore))}>
          Cut
        </button>
        <button type="button" disabled={!hasSelection} onClick={() => run(() => copySelection(editorStore))}>
          Copy
        </button>
        <button type="button" onClick={() => run(() => pasteFromSystemClipboard(editorStore))}>
          Paste
        </button>
        <button type="button" onClick={() => run(() => pasteClipboard(editorStore))}>
          Paste in Place
        </button>
        <div className="menu-sep" />
        <button
          type="button"
          disabled={!hasSelection}
          onClick={() => run(() => cmdDuplicateNodes(editorStore, selection(), { offset: { x: 10, y: 10 } }))}
        >
          Duplicate
        </button>
        <button
          type="button"
          disabled={!hasSelection}
          onClick={() => run(() => cmdDeleteNodes(editorStore, selection(), 'Delete'))}
        >
          Delete
        </button>
        <div className="menu-sep" />
        <button
          type="button"
          disabled={!sameEnabled}
          onClick={() => run(() => selectSame(editorStore, 'fill'))}
        >
          Select Same Fill
        </button>
        <button
          type="button"
          disabled={!sameEnabled}
          onClick={() => run(() => selectSame(editorStore, 'stroke'))}
        >
          Select Same Stroke
        </button>
        {releaseClipEnabled ? (
          <button type="button" onClick={() => run(() => cmdReleaseClipMask(editorStore, selection()))}>
            Release Clipping Mask
          </button>
        ) : (
          <button
            type="button"
            disabled={!clipEnabled}
            onClick={() => run(() => cmdMakeClipMask(editorStore, selection()))}
          >
            Make Clipping Mask
          </button>
        )}
      </div>
    </>
  )
}
