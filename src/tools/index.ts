/**
 * Tool registration. The registry is keyed by the authoritative shortcut map;
 * later phases register more tools here without touching the manager.
 */

import type { EditorStoreApi } from '../store/store'
import { CurvatureTool } from './CurvatureTool'
import { DirectSelectionTool } from './DirectSelectionTool'
import { EllipseTool } from './EllipseTool'
import { EyedropperTool } from './EyedropperTool'
import { GradientTool } from './GradientTool'
import { LineTool } from './LineTool'
import { PenTool } from './PenTool'
import { PencilTool } from './PencilTool'
import { PolygonTool } from './PolygonTool'
import { RectangleTool, RoundedRectangleTool } from './RectangleTool'
import { RotateTool } from './RotateTool'
import { ScaleTool } from './ScaleTool'
import { ScissorsTool } from './ScissorsTool'
import { SelectionTool } from './SelectionTool'
import { StarTool } from './StarTool'
import { ToolManager } from './ToolManager'
import { WidthTool } from './WidthTool'

export function createToolManager(store: EditorStoreApi): ToolManager {
  const manager = new ToolManager(store)
  manager.register(new SelectionTool()) //         V
  manager.register(new DirectSelectionTool()) //   A
  manager.register(new PenTool()) //               P
  manager.register(new CurvatureTool()) //         toolbar-selected
  manager.register(new PencilTool()) //            N
  manager.register(new RectangleTool()) //         M
  manager.register(new RoundedRectangleTool()) //  toolbar-selected
  manager.register(new EllipseTool()) //           L
  manager.register(new PolygonTool()) //           toolbar-selected
  manager.register(new StarTool()) //              toolbar-selected
  manager.register(new LineTool()) //              \
  manager.register(new ScaleTool()) //             S
  manager.register(new RotateTool()) //            R
  manager.register(new ScissorsTool()) //          toolbar-selected
  manager.register(new EyedropperTool()) //        I
  manager.register(new GradientTool()) //          G
  manager.register(new WidthTool()) //             Shift+W
  return manager
}

export { ToolManager }
