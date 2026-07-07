/**
 * Artboard tool (Shift+O):
 * - drag on empty canvas = create a new artboard
 * - click an artboard = make it active (shown with handles)
 * - drag inside the active artboard = move it; drag a handle = resize
 * - Alt-drag an artboard = duplicate the frame, then move the copy
 * - Delete/Backspace = delete the active artboard (the last one is kept)
 * Every drag gesture is ONE undo step. The active artboard id is UI state
 * (never undoable), like selection.
 */

import type { Vec2 } from '../geometry/vec2'
import type { Artboard } from '../model/types'
import type { Tool, ToolContext, ToolPointerEvent } from './types'
import { HANDLE_GRAB_RADIUS_PX } from './handles'

const DRAG_THRESHOLD_PX = 4

type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

interface HandleSpec {
  id: HandleId
  /** Unit position on the artboard rect (0..1 in each axis). */
  ux: number
  uy: number
}

export const ARTBOARD_HANDLES: HandleSpec[] = [
  { id: 'nw', ux: 0, uy: 0 },
  { id: 'n', ux: 0.5, uy: 0 },
  { id: 'ne', ux: 1, uy: 0 },
  { id: 'e', ux: 1, uy: 0.5 },
  { id: 'se', ux: 1, uy: 1 },
  { id: 's', ux: 0.5, uy: 1 },
  { id: 'sw', ux: 0, uy: 1 },
  { id: 'w', ux: 0, uy: 0.5 },
]

function artboardAt(artboards: Artboard[], p: Vec2): Artboard | null {
  // Topmost (last drawn) first, so overlapping artboards resolve predictably.
  for (let i = artboards.length - 1; i >= 0; i--) {
    const ab = artboards[i]!
    if (p.x >= ab.x && p.x <= ab.x + ab.w && p.y >= ab.y && p.y <= ab.y + ab.h) return ab
  }
  return null
}

export class ArtboardTool implements Tool {
  readonly id = 'artboard'
  readonly name = 'Artboard'
  readonly shortcut = 'shift+o'
  readonly cursor = 'crosshair'

  private mode: 'idle' | 'create' | 'move' | 'resize' = 'idle'
  private downDoc: Vec2 = { x: 0, y: 0 }
  private targetId: string | null = null
  private handle: HandleId | null = null
  private base: Artboard | null = null
  private engaged = false

  onPointerDown(e: ToolPointerEvent, ctx: ToolContext): void {
    this.downDoc = e.snappedPoint
    this.engaged = false
    const artboards = ctx.getDocument().artboards
    const activeId = ctx.artboard.active()
    const active = artboards.find((a) => a.id === activeId) ?? null

    // Resize handles of the active artboard win first (screen-space grab).
    if (active) {
      for (const h of ARTBOARD_HANDLES) {
        const hp = ctx.docToScreen({ x: active.x + h.ux * active.w, y: active.y + h.uy * active.h })
        const d = Math.hypot(hp.x - e.screenPoint.x, hp.y - e.screenPoint.y)
        if (d <= HANDLE_GRAB_RADIUS_PX) {
          this.mode = 'resize'
          this.handle = h.id
          this.targetId = active.id
          this.base = { ...active }
          ctx.transaction.begin('Resize Artboard')
          return
        }
      }
    }

    const hit = artboardAt(artboards, e.docPoint)
    if (hit) {
      ctx.artboard.setActive(hit.id)
      let moveId = hit.id
      let label = 'Move Artboard'
      if (e.modifiers.alt) {
        // Duplicate the frame; the drag then moves the COPY. Whole gesture =
        // one 'Duplicate Artboard' undo step.
        ctx.transaction.begin('Duplicate Artboard')
        const dup = ctx.artboard.duplicate(hit.id)
        if (!dup) {
          ctx.transaction.cancel()
          return
        }
        // Start the copy exactly over the source so the drag feels 1:1.
        ctx.artboard.update(dup, 'Duplicate Artboard', (ab) => {
          ab.x = hit.x
          ab.y = hit.y
        })
        ctx.artboard.setActive(dup)
        moveId = dup
        label = 'Duplicate Artboard'
        this.engaged = true // the duplicate already mutated the doc
      } else {
        ctx.transaction.begin(label)
      }
      this.mode = 'move'
      this.targetId = moveId
      this.base = { ...ctx.getDocument().artboards.find((a) => a.id === moveId)! }
      return
    }

    // Empty canvas: arm creation (becomes real once the drag passes threshold).
    this.mode = 'create'
    this.targetId = null
    ctx.artboard.setActive(null)
  }

  onPointerMove(e: ToolPointerEvent, ctx: ToolContext): void {
    if (this.mode === 'idle') return
    const dx = e.snappedPoint.x - this.downDoc.x
    const dy = e.snappedPoint.y - this.downDoc.y
    const screenDist = Math.hypot(e.screenDeltaFromDown.x, e.screenDeltaFromDown.y)

    if (this.mode === 'create') {
      if (screenDist < DRAG_THRESHOLD_PX && !this.engaged) return
      this.engaged = true
      ctx.overlay.setMarquee({
        minX: Math.min(this.downDoc.x, e.snappedPoint.x),
        minY: Math.min(this.downDoc.y, e.snappedPoint.y),
        maxX: Math.max(this.downDoc.x, e.snappedPoint.x),
        maxY: Math.max(this.downDoc.y, e.snappedPoint.y),
      })
      return
    }

    const id = this.targetId
    const base = this.base
    if (!id || !base) return
    if (!this.engaged && screenDist < DRAG_THRESHOLD_PX) return
    this.engaged = true

    if (this.mode === 'move') {
      ctx.artboard.update(id, 'Move Artboard', (ab) => {
        ab.x = base.x + dx
        ab.y = base.y + dy
      })
      return
    }

    // Resize: each handle pins the opposite edge(s).
    const h = this.handle!
    ctx.artboard.update(id, 'Resize Artboard', (ab) => {
      let x0 = base.x
      let y0 = base.y
      let x1 = base.x + base.w
      let y1 = base.y + base.h
      if (h.includes('w')) x0 = Math.min(base.x + dx, x1 - 1)
      if (h.includes('e')) x1 = Math.max(base.x + base.w + dx, x0 + 1)
      if (h.includes('n')) y0 = Math.min(base.y + dy, y1 - 1)
      if (h.includes('s')) y1 = Math.max(base.y + base.h + dy, y0 + 1)
      ab.x = x0
      ab.y = y0
      ab.w = x1 - x0
      ab.h = y1 - y0
    })
  }

  onPointerUp(e: ToolPointerEvent, ctx: ToolContext): void {
    const mode = this.mode
    const engaged = this.engaged
    this.mode = 'idle'
    this.engaged = false
    ctx.overlay.setMarquee(null)

    if (mode === 'create') {
      if (!engaged) return // plain click on empty canvas just deselects
      const minX = Math.min(this.downDoc.x, e.snappedPoint.x)
      const minY = Math.min(this.downDoc.y, e.snappedPoint.y)
      const w = Math.abs(e.snappedPoint.x - this.downDoc.x)
      const h = Math.abs(e.snappedPoint.y - this.downDoc.y)
      if (w < 8 || h < 8) return
      const id = ctx.artboard.add({ x: minX, y: minY, w, h })
      ctx.artboard.setActive(id)
      return
    }
    if (mode === 'move' || mode === 'resize') {
      // Un-engaged move = plain click on an artboard: selection only, no entry.
      if (engaged) ctx.transaction.commit()
      else ctx.transaction.cancel()
    }
    this.targetId = null
    this.handle = null
    this.base = null
  }

  onKeyDown(e: KeyboardEvent, ctx: ToolContext): boolean | void {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      const id = ctx.artboard.active()
      if (id && ctx.artboard.remove(id)) {
        ctx.artboard.setActive(null)
        return true
      }
    }
    return
  }

  onCancel(ctx: ToolContext): void {
    // ToolManager cancels any open transaction right after this.
    this.mode = 'idle'
    this.engaged = false
    this.targetId = null
    this.handle = null
    this.base = null
    ctx.overlay.setMarquee(null)
  }

  onDeactivate(ctx: ToolContext): void {
    this.onCancel(ctx)
    ctx.artboard.setActive(null)
  }
}
