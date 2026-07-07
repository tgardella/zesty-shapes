/**
 * Symbolism adjuster tools — the Symbol Sprayer's siblings, each a brush that
 * reshapes the instances of a symbol set (a group's direct children):
 *   - Shifter  (M): drags instances along the pointer motion.
 *   - Scruncher(J): pulls instances toward the cursor (Alt pushes apart).
 *   - Sizer    (Z): grows instances (Alt shrinks).
 *   - Stainer  (K): tints instances toward the current fill color.
 * The affected set is the selected group(s), else the group under the pointer.
 * One drag = ONE 'Symbolism' undo step (the tool holds the transaction open).
 */

import type { Vec2 } from '../geometry/vec2'
import { sub } from '../geometry/vec2'
import type { NodeId, RGBA } from '../model/types'
import type { SymbolismKind } from '../store/symbolismCommands'
import type { Tool, ToolContext, ToolPointerEvent } from './types'

/** Tint target for the Stainer: the current solid fill, or a neutral gray. */
function currentTint(ctx: ToolContext): RGBA {
  const fill = ctx.style.current().fill
  if (fill && fill.type === 'solid') return { ...fill.color }
  return { r: 120, g: 120, b: 120, a: 1 }
}

abstract class SymbolismTool implements Tool {
  abstract readonly id: string
  abstract readonly name: string
  readonly shortcut: string | null = null
  readonly cursor = 'crosshair'
  protected abstract readonly kind: SymbolismKind

  private active = false
  private targets: NodeId[] = []
  private lastPoint: Vec2 | null = null

  /**
   * The instance nodes to affect: the current selection (a symbol set expands
   * to its members; a plain shape acts as its own instance), or — with nothing
   * selected — whatever is under the pointer. So the brush works on sprayed
   * symbol sets AND on ordinary art.
   */
  private resolveInstances(e: ToolPointerEvent, ctx: ToolContext): NodeId[] {
    const doc = ctx.getDocument()
    const expand = (id: NodeId): NodeId[] => {
      const n = doc.nodes[id]
      if (!n) return []
      if (n.type === 'group' && n.isLayer) return [] // don't stain a whole layer
      if (n.type === 'group') return [...n.children]
      return [id]
    }
    const selected = ctx.getSelection().filter((id) => doc.nodes[id])
    if (selected.length > 0) return selected.flatMap(expand)
    if (e.hitNodeId) return expand(e.hitNodeId)
    return []
  }

  private apply(e: ToolPointerEvent, ctx: ToolContext, delta: Vec2): void {
    const radius = ctx.toolSize.get(this.id) / 2
    ctx.commands.symbolismAdjust(this.targets, {
      kind: this.kind,
      center: e.docPoint,
      radius,
      // Stain builds up per pass; a punchier rate makes a single stroke read.
      strength: this.kind === 'stain' ? 0.6 : 0.3,
      delta,
      color: this.kind === 'stain' ? currentTint(ctx) : undefined,
      alt: e.modifiers.alt,
    })
  }

  onPointerDown(e: ToolPointerEvent, ctx: ToolContext): void {
    this.targets = this.resolveInstances(e, ctx)
    if (this.targets.length === 0) return
    ctx.transaction.begin('Symbolism')
    this.active = true
    this.lastPoint = e.docPoint
    this.apply(e, ctx, { x: 0, y: 0 })
  }

  onPointerMove(e: ToolPointerEvent, ctx: ToolContext): void {
    if (!this.active) return
    const delta = this.lastPoint ? sub(e.docPoint, this.lastPoint) : { x: 0, y: 0 }
    this.lastPoint = e.docPoint
    this.apply(e, ctx, delta)
  }

  onPointerUp(_e: ToolPointerEvent, ctx: ToolContext): void {
    if (!this.active) return
    this.active = false
    this.lastPoint = null
    if (ctx.transaction.active()) ctx.transaction.commit()
  }

  onCancel(ctx: ToolContext): void {
    // The manager rolls back the open transaction (undoing the partial edit).
    this.active = false
    this.lastPoint = null
    void ctx
  }

  onDeactivate(ctx: ToolContext): void {
    this.onCancel(ctx)
  }
}

export class SymbolShifterTool extends SymbolismTool {
  readonly id = 'symbol-shifter'
  readonly name = 'Symbol Shifter'
  protected readonly kind = 'shift' as const
}

export class SymbolScruncherTool extends SymbolismTool {
  readonly id = 'symbol-scruncher'
  readonly name = 'Symbol Scruncher'
  protected readonly kind = 'scrunch' as const
}

export class SymbolSizerTool extends SymbolismTool {
  readonly id = 'symbol-sizer'
  readonly name = 'Symbol Sizer'
  protected readonly kind = 'size' as const
}

export class SymbolStainerTool extends SymbolismTool {
  readonly id = 'symbol-stainer'
  readonly name = 'Symbol Stainer'
  protected readonly kind = 'stain' as const
}
