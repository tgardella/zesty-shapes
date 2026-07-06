/**
 * Star tool (toolbar-selected): drag from the center outward; the first point
 * follows the cursor (Shift = upright). During the drag: ArrowUp/ArrowDown
 * adjust the point count, ArrowLeft/ArrowRight adjust the inner-radius ratio.
 * Both stick for the next star.
 */

import { translate } from '../geometry/matrix'
import type { Vec2 } from '../geometry/vec2'
import type { SceneNode } from '../model/types'
import { createStarNode } from '../model/nodes'
import { radialDragParams, ShapeTool } from './behaviors/ShapeToolBase'
import type { ToolContext, ToolModifiers } from './types'

export const MIN_STAR_POINTS = 3
export const MAX_STAR_POINTS = 24
export const MIN_INNER_RATIO = 0.1
export const MAX_INNER_RATIO = 0.9
const RATIO_STEP = 0.05

export class StarTool extends ShapeTool {
  readonly id = 'star'
  readonly name = 'Star'
  readonly shortcut = null // toolbar-selected per the shortcut map

  private points = 5
  private innerRatio = 0.5

  protected createNode(origin: Vec2): SceneNode {
    return createStarNode(
      { cx: 0, cy: 0, outerRadius: 0, innerRadius: 0, points: this.points },
      { transform: translate(origin.x, origin.y) },
    )
  }

  protected applyDrag(node: SceneNode, origin: Vec2, point: Vec2, modifiers: ToolModifiers): void {
    if (node.type !== 'star') return
    const g = radialDragParams(origin, point, modifiers)
    node.outerRadius = g.radius
    node.innerRadius = g.radius * this.innerRatio
    node.angle = g.angle
    node.points = this.points
  }

  onKeyDown(e: KeyboardEvent, ctx: ToolContext): boolean | void {
    if (!this.isDrawing) return
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const delta = e.key === 'ArrowUp' ? 1 : -1
      this.points = Math.min(MAX_STAR_POINTS, Math.max(MIN_STAR_POINTS, this.points + delta))
      this.updateDraft(ctx, (node) => {
        if (node.type === 'star') node.points = this.points
      })
      return true
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const delta = e.key === 'ArrowRight' ? RATIO_STEP : -RATIO_STEP
      this.innerRatio = Math.min(MAX_INNER_RATIO, Math.max(MIN_INNER_RATIO, this.innerRatio + delta))
      this.updateDraft(ctx, (node) => {
        if (node.type === 'star') node.innerRadius = node.outerRadius * this.innerRatio
      })
      return true
    }
    return
  }
}
