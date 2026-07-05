/**
 * Tool registration. The registry is keyed by the authoritative shortcut map;
 * later phases register more tools here without touching the manager.
 */

import type { EditorStoreApi } from '../store/store'
import { RectangleTool } from './RectangleTool'
import { SelectionTool } from './SelectionTool'
import { ToolManager } from './ToolManager'

export function createToolManager(store: EditorStoreApi): ToolManager {
  const manager = new ToolManager(store)
  manager.register(new SelectionTool()) // V
  manager.register(new RectangleTool()) // M
  return manager
}

export { ToolManager }
