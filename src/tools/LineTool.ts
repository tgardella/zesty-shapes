/**
 * Line tool (\): drag from start to end. Shift constrains to 45° steps (via
 * the angle snapper — the tool opts in), Alt extends symmetrically from the
 * origin. Local geometry starts at (0,0); placement lives in the transform.
 */

import { translate } from '../geometry/matrix'
import type { Vec2 } from '../geometry/vec2'
import { distance } from '../geometry/vec2'
import type { SceneNode } from '../model/types'
import { createLineNode } from '../model/nodes'
import { lineDragParams, ShapeTool } from './behaviors/ShapeToolBase'
import type { ToolModifiers } from './types'

const MIN_LENGTH = 0.01

export class LineTool extends ShapeTool {
  readonly id = 'line'
  readonly name = 'Line'
  readonly shortcut = '\\'
  override readonly wantsAngleSnap = true // Shift = constrain to 45°

  protected createNode(origin: Vec2): SceneNode {
    return createLineNode(
      { x1: 0, y1: 0, x2: 0, y2: 0 },
      { transform: translate(origin.x, origin.y) },
    )
  }

  protected applyDrag(node: SceneNode, origin: Vec2, point: Vec2, modifiers: ToolModifiers): void {
    if (node.type !== 'line') return
    const g = lineDragParams(origin, point, modifiers)
    node.x2 = g.end.x
    node.y2 = g.end.y
    node.transform = translate(g.position.x, g.position.y)
  }

  protected override isDegenerate(origin: Vec2, point: Vec2, _modifiers: ToolModifiers): boolean {
    return distance(origin, point) < MIN_LENGTH
  }
}
