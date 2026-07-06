/**
 * Ellipse tool (L): click-drag creates an EllipseNode. Shift = circle,
 * Alt = draw from center. Local geometry spans (0,0)-(w,h) with the center
 * at (rx, ry); placement lives in the transform.
 */

import { translate } from '../geometry/matrix'
import type { Vec2 } from '../geometry/vec2'
import type { SceneNode } from '../model/types'
import { createEllipseNode } from '../model/nodes'
import { dragRectGeometry, ShapeTool } from './behaviors/ShapeToolBase'
import type { ToolModifiers } from './types'

const MIN_SIZE = 0.01

export class EllipseTool extends ShapeTool {
  readonly id = 'ellipse'
  readonly name = 'Ellipse'
  readonly shortcut = 'l'

  protected createNode(origin: Vec2): SceneNode {
    return createEllipseNode(
      { cx: 0, cy: 0, rx: 0, ry: 0 },
      { transform: translate(origin.x, origin.y) },
    )
  }

  protected applyDrag(node: SceneNode, origin: Vec2, point: Vec2, modifiers: ToolModifiers): void {
    if (node.type !== 'ellipse') return
    const g = dragRectGeometry(origin, point, modifiers)
    node.rx = g.w / 2
    node.ry = g.h / 2
    node.cx = g.w / 2
    node.cy = g.h / 2
    node.transform = translate(g.x, g.y)
  }

  protected override isDegenerate(origin: Vec2, point: Vec2, modifiers: ToolModifiers): boolean {
    const g = dragRectGeometry(origin, point, modifiers)
    return g.w < MIN_SIZE || g.h < MIN_SIZE
  }
}
