/**
 * Polygon tool (toolbar-selected): drag from the center outward; the first
 * vertex follows the cursor (Shift = upright). ArrowUp/ArrowDown adjust the
 * side count LIVE during the drag (remembered for the next polygon).
 */

import { translate } from '../geometry/matrix'
import type { Vec2 } from '../geometry/vec2'
import type { SceneNode } from '../model/types'
import { createPolygonNode } from '../model/nodes'
import { radialDragParams, ShapeTool } from './behaviors/ShapeToolBase'
import type { ToolContext, ToolModifiers } from './types'

export const MIN_POLYGON_SIDES = 3
export const MAX_POLYGON_SIDES = 24

export class PolygonTool extends ShapeTool {
  readonly id = 'polygon'
  readonly name = 'Polygon'
  readonly shortcut = null // toolbar-selected per the shortcut map

  private sides = 6

  protected createNode(origin: Vec2): SceneNode {
    return createPolygonNode(
      { cx: 0, cy: 0, radius: 0, sides: this.sides },
      { transform: translate(origin.x, origin.y) },
    )
  }

  protected applyDrag(node: SceneNode, origin: Vec2, point: Vec2, modifiers: ToolModifiers): void {
    if (node.type !== 'polygon') return
    const g = radialDragParams(origin, point, modifiers)
    node.radius = g.radius
    node.angle = g.angle
    node.sides = this.sides
  }

  onKeyDown(e: KeyboardEvent, ctx: ToolContext): boolean | void {
    if (!this.isDrawing) return
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
    const delta = e.key === 'ArrowUp' ? 1 : -1
    this.sides = Math.min(MAX_POLYGON_SIDES, Math.max(MIN_POLYGON_SIDES, this.sides + delta))
    this.updateDraft(ctx, (node) => {
      if (node.type === 'polygon') node.sides = this.sides
    })
    return true
  }
}
