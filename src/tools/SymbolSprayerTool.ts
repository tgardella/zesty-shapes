/**
 * Symbol Sprayer (Shift+S): sprays copies of a symbol along the drag. The
 * symbol is the Symbols panel's ACTIVE symbol when one is highlighted;
 * otherwise the selection at spray time (remembered, so you can spray again
 * after deselecting). Stamps land in a fresh "Symbol Set" group with random
 * position/rotation/scale jitter inside the spray radius (the Size selector).
 * One drag = ONE 'Spray Symbols' undo step.
 */

import type { Vec2 } from '../geometry/vec2'
import { distance } from '../geometry/vec2'
import type { NodeId } from '../model/types'
import type { Tool, ToolContext, ToolPointerEvent } from './types'

export class SymbolSprayerTool implements Tool {
  readonly id = 'symbol-sprayer'
  readonly name = 'Symbol Sprayer'
  readonly shortcut = 'shift+s'
  readonly cursor = 'crosshair'

  /** Remembered symbol sources (survives deselection between sprays). */
  private symbolIds: NodeId[] = []
  /** Library symbol being sprayed this gesture (null = selection snapshot). */
  private librarySymbolId: string | null = null
  /** Symbol-set groups this tool created (their selection isn't a symbol). */
  private readonly ownSets = new Set<NodeId>()
  private groupId: NodeId | null = null
  private lastStamp: Vec2 | null = null

  private resolveSymbol(ctx: ToolContext): NodeId[] {
    const doc = ctx.getDocument()
    const selection = ctx
      .getSelection()
      .filter((id) => doc.nodes[id] && !this.ownSets.has(id))
    if (selection.length > 0) this.symbolIds = selection
    this.symbolIds = this.symbolIds.filter((id) => doc.nodes[id])
    return this.symbolIds
  }

  private spacing(ctx: ToolContext): number {
    return Math.max(4, ctx.toolSize.get('symbol-sprayer') * 0.45)
  }

  private stamp(ctx: ToolContext, at: Vec2): void {
    if (!this.groupId) return
    const radius = ctx.toolSize.get('symbol-sprayer') / 2
    const angle = Math.random() * Math.PI * 2
    const r = Math.random() * radius * 0.5
    const stamp = {
      docPoint: { x: at.x + Math.cos(angle) * r, y: at.y + Math.sin(angle) * r },
      rotation: (Math.random() - 0.5) * 0.6,
      scale: 0.75 + Math.random() * 0.5,
    }
    if (this.librarySymbolId) {
      ctx.commands.stampSymbol(this.librarySymbolId, stamp, this.groupId)
    } else {
      ctx.commands.sprayStamp(this.symbolIds, stamp, this.groupId)
    }
    this.lastStamp = at
  }

  onPointerDown(e: ToolPointerEvent, ctx: ToolContext): void {
    // The Symbols panel's active symbol wins; else spray the selection.
    this.librarySymbolId = ctx.symbols.activeId()
    if (!this.librarySymbolId && this.resolveSymbol(ctx).length === 0) return
    ctx.transaction.begin('Spray Symbols')
    this.groupId = ctx.commands.createSymbolSet()
    this.ownSets.add(this.groupId)
    this.stamp(ctx, e.docPoint)
  }

  onPointerMove(e: ToolPointerEvent, ctx: ToolContext): void {
    if (!this.groupId || !this.lastStamp) return
    if (distance(e.docPoint, this.lastStamp) < this.spacing(ctx)) return
    this.stamp(ctx, e.docPoint)
  }

  onPointerUp(_e: ToolPointerEvent, ctx: ToolContext): void {
    if (!this.groupId) return
    const groupId = this.groupId
    this.groupId = null
    this.lastStamp = null
    if (ctx.transaction.active()) ctx.transaction.commit()
    ctx.select.set([groupId])
  }

  onCancel(ctx: ToolContext): void {
    // The manager rolls back the open transaction (removing this spray).
    if (this.groupId) this.ownSets.delete(this.groupId)
    this.groupId = null
    this.lastStamp = null
    void ctx
  }

  onDeactivate(ctx: ToolContext): void {
    this.onCancel(ctx)
  }
}
