/**
 * Rectangle tool (M): click-drag to create a RectNode. Shift = square,
 * Alt = draw from center. Rect params stay at the local origin; the node
 * transform carries placement (POSITIONING RULE).
 *
 * RoundedRectangleTool (toolbar-selected) draws the SAME RectNode with a
 * non-zero corner radius — not a separate node type. The radius is then
 * live-editable via the corner-radius handle (SelectionTool + Overlay).
 */

import { translate } from '../geometry/matrix'
import type { Vec2 } from '../geometry/vec2'
import type { SceneNode } from '../model/types'
import { createRectNode } from '../model/nodes'
import { dragRectGeometry, ShapeTool } from './behaviors/ShapeToolBase'
import type { ToolModifiers } from './types'

const MIN_SIZE = 0.01

export class RectangleTool extends ShapeTool {
  readonly id: string = 'rectangle'
  readonly name: string = 'Rectangle'
  readonly shortcut: string | null = 'm'

  /** Corner radius applied at creation; 0 for the plain rectangle tool. */
  protected initialRadius = 0

  protected createNode(origin: Vec2): SceneNode {
    return createRectNode(
      { x: 0, y: 0, w: 0, h: 0, rx: this.initialRadius, ry: this.initialRadius },
      { transform: translate(origin.x, origin.y) },
    )
  }

  protected applyDrag(node: SceneNode, origin: Vec2, point: Vec2, modifiers: ToolModifiers): void {
    if (node.type !== 'rect') return
    const g = dragRectGeometry(origin, point, modifiers)
    node.w = g.w
    node.h = g.h
    node.transform = translate(g.x, g.y)
  }

  protected override isDegenerate(origin: Vec2, point: Vec2, modifiers: ToolModifiers): boolean {
    const g = dragRectGeometry(origin, point, modifiers)
    return g.w < MIN_SIZE || g.h < MIN_SIZE
  }
}

export class RoundedRectangleTool extends RectangleTool {
  override readonly id = 'rounded-rect'
  override readonly name = 'Rounded Rectangle'
  override readonly shortcut = null // toolbar-selected per the shortcut map

  constructor() {
    super()
    this.initialRadius = 12
  }
}
