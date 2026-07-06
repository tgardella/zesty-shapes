/**
 * Type tool (T) — and its toolbar-selected Vertical variant:
 * - click empty canvas = new POINT text at the click (baseline at the click)
 * - drag on empty canvas = new AREA text wrapped inside the dragged box
 * - click existing text = edit it in place
 * - click a shape/path = TYPE ON A PATH: the leaf's geometry (local space)
 *   is copied into the text node's textPath and the text node takes the
 *   leaf's world placement — text then flows along the curve
 * Editing happens in an HTML overlay (ui/TextEditorOverlay) inside ONE open
 * transaction ('Add Text' / 'Edit Text'); Escape/blur/tool-switch COMMITS
 * (Illustrator semantics), and an emptied session rolls back entirely.
 */

import type { Vec2 } from '../geometry/vec2'
import { applyToPoint, invert, translate, type Mat } from '../geometry/matrix'
import { worldTransform } from '../store/worldTransform'
import type { SubPath } from '../model/types'
import { cloneStyle, createTextNode, toSubPaths } from '../model/nodes'
import { nearestOffsetOnPath, samplePath } from '../model/widthProfile'
import { leafNodeAtPoint, leafNodeIdFromTarget } from './hitTest'
import type { Tool, ToolContext, ToolPointerEvent } from './types'

const AREA_DRAG_THRESHOLD_PX = 8
/** Screen-px slop for clicking a path's edge / a text block. */
const HIT_TOLERANCE_PX = 6

export class TypeTool implements Tool {
  readonly id: string = 'type'
  readonly name: string = 'Type'
  readonly shortcut: string | null = 't'
  readonly cursor = 'text'
  /** Vertical variant flips this. */
  protected readonly vertical: boolean = false

  private down: Vec2 | null = null
  private dragging = false
  /** Leaf pressed on pointer-down; the edit session opens on pointer-UP. */
  private pendingLeaf: { id: string; docPoint: Vec2 } | null = null

  /**
   * NOTE: every path that opens the text editor runs on pointer-UP. The
   * browser's native mousedown default action (moving focus to the clicked
   * element) fires AFTER pointerdown — opening the editor on pointerdown gets
   * its textarea blurred (and the empty session evaporated) before the first
   * paint. After pointerup only mouseup/click follow, which never move focus.
   */
  onPointerDown(e: ToolPointerEvent, ctx: ToolContext): void {
    // A click while editing commits the session first (Illustrator).
    if (ctx.textEdit.get()) ctx.commands.finishTextEdit()

    const doc = ctx.getDocument()
    // DOM hit first (painted pixels), then a geometric pass with tolerance so
    // clicking a shape's edge (even unfilled) or between glyphs still lands.
    const leafId =
      leafNodeIdFromTarget(doc, e.domTarget) ??
      leafNodeAtPoint(doc, e.docPoint, HIT_TOLERANCE_PX / ctx.getViewport().zoom)
    this.pendingLeaf = null
    this.down = null
    this.dragging = false
    if (leafId && doc.nodes[leafId]!.type !== 'group') {
      this.pendingLeaf = { id: leafId, docPoint: e.docPoint }
      return
    }
    // Empty canvas: arm point-vs-area decision for pointer up.
    this.down = e.snappedPoint
  }

  onPointerMove(e: ToolPointerEvent, ctx: ToolContext): void {
    if (!this.down) return
    const d = Math.hypot(e.screenDeltaFromDown.x, e.screenDeltaFromDown.y)
    if (d >= AREA_DRAG_THRESHOLD_PX) this.dragging = true
    if (this.dragging) {
      ctx.overlay.setMarquee({
        minX: Math.min(this.down.x, e.snappedPoint.x),
        minY: Math.min(this.down.y, e.snappedPoint.y),
        maxX: Math.max(this.down.x, e.snappedPoint.x),
        maxY: Math.max(this.down.y, e.snappedPoint.y),
      })
    }
  }

  onPointerUp(e: ToolPointerEvent, ctx: ToolContext): void {
    const down = this.down
    const wasDragging = this.dragging
    const pending = this.pendingLeaf
    this.down = null
    this.dragging = false
    this.pendingLeaf = null
    ctx.overlay.setMarquee(null)

    if (pending) {
      const leaf = ctx.getDocument().nodes[pending.id]
      if (!leaf) return
      if (leaf.type === 'text') this.startEditing(pending.id, 'Edit Text', ctx)
      else if (leaf.type !== 'group') this.createOnPath(pending.id, pending.docPoint, ctx)
      return
    }
    if (!down) return

    if (wasDragging) {
      const minX = Math.min(down.x, e.snappedPoint.x)
      const minY = Math.min(down.y, e.snappedPoint.y)
      const w = Math.abs(e.snappedPoint.x - down.x)
      const h = Math.abs(e.snappedPoint.y - down.y)
      if (w < 4 || h < 4) return
      this.createText(ctx, { kind: 'area', width: w, height: h }, translate(minX, minY))
    } else {
      this.createText(ctx, {}, translate(down.x, down.y))
    }
  }

  /** New text node inside the edit transaction (empty session evaporates). */
  private createText(
    ctx: ToolContext,
    extra: {
      kind?: 'area'
      width?: number
      height?: number
      textPath?: SubPath[]
      pathStartOffset?: number
    },
    transform: Mat,
  ): void {
    const style = cloneStyle(ctx.style.current())
    style.stroke = null
    if (!style.fill) style.fill = { type: 'solid', color: { r: 20, g: 20, b: 20, a: 1 } }
    const node = createTextNode(
      { text: '', vertical: this.vertical || undefined, ...extra },
      { transform, style },
    )
    ctx.transaction.begin('Add Text')
    ctx.commands.addNode(node, { select: true })
    ctx.textEdit.set({ nodeId: node.id })
  }

  /**
   * Type on a path: copy the leaf's local geometry + world placement, and
   * START THE TEXT WHERE THE CLICK LANDED (Illustrator) — pathStartOffset is
   * the click's arc-length position on the path.
   */
  private createOnPath(leafId: string, docPoint: Vec2, ctx: ToolContext): void {
    const doc = ctx.getDocument()
    const leaf = doc.nodes[leafId]!
    if (leaf.type === 'group' || leaf.type === 'text') return
    const textPath = JSON.parse(JSON.stringify(toSubPaths(leaf))) as SubPath[]
    const world = worldTransform(doc.nodes, leafId)
    const sampled = samplePath(textPath)
    const localClick = applyToPoint(invert(world), docPoint)
    const pathStartOffset = sampled ? nearestOffsetOnPath(sampled, localClick).u : 0
    this.createText(ctx, { textPath, pathStartOffset }, [...world] as Mat)
  }

  private startEditing(nodeId: string, label: string, ctx: ToolContext): void {
    const node = ctx.getDocument().nodes[nodeId]
    if (!node || node.type !== 'text') return
    ctx.select.set([nodeId])
    ctx.transaction.begin(label)
    ctx.textEdit.set({ nodeId })
  }

  onCancel(ctx: ToolContext): void {
    // Esc COMMITS a text session (the manager's follow-up cancelTransaction
    // finds nothing open). A pending click just disarms.
    if (ctx.textEdit.get()) ctx.commands.finishTextEdit()
    this.down = null
    this.dragging = false
    this.pendingLeaf = null
  }

  onDeactivate(ctx: ToolContext): void {
    this.onCancel(ctx)
  }
}

/** Toolbar-selected vertical variant (per the shortcut map, no key). */
export class VerticalTypeTool extends TypeTool {
  override readonly id = 'type-vertical'
  override readonly name = 'Vertical Type'
  override readonly shortcut = null
  protected override readonly vertical = true
}
