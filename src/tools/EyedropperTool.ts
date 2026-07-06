/**
 * Eyedropper (I): click an object to SAMPLE its appearance (fill, stroke,
 * stroke options, opacity, blend mode) and apply it to the current selection
 * in one undo step. The sample also becomes the current style for new
 * objects, so sampling with nothing selected "loads" the eyedropper.
 * Alt+click reverses the flow: it applies the CURRENT style to the clicked
 * object (Illustrator's give-vs-take convention).
 */

import type { Style } from '../model/types'
import { sampleAppearance } from '../store/commands'
import { leafNodeIdFromTarget } from './hitTest'
import type { Tool, ToolContext, ToolPointerEvent } from './types'

export class EyedropperTool implements Tool {
  readonly id = 'eyedropper'
  readonly name = 'Eyedropper'
  readonly shortcut = 'i'
  readonly cursor = 'crosshair'

  onPointerDown(e: ToolPointerEvent, ctx: ToolContext): void {
    const doc = ctx.getDocument()
    const leafId = leafNodeIdFromTarget(doc, e.domTarget)
    if (!leafId) return
    const node = doc.nodes[leafId]
    if (!node || node.type === 'group') return

    if (e.modifiers.alt) {
      // Give: current style -> clicked object.
      const current = JSON.parse(JSON.stringify(ctx.style.current())) as Style
      ctx.commands.setStyle([leafId], 'Eyedropper', (style) => {
        Object.assign(style, JSON.parse(JSON.stringify(current)) as Style)
      })
      return
    }

    // Take: clicked object -> selection (and the current style for new art).
    const appearance = sampleAppearance(node)
    const selection = ctx.getSelection().filter((id) => id !== leafId)
    if (selection.length > 0) {
      ctx.commands.applyAppearance(selection, appearance)
    }
    ctx.style.setCurrent(JSON.parse(JSON.stringify(appearance.style)) as Style)
  }
}
