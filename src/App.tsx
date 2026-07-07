/**
 * App shell: toolbar | (topbar / viewport). Wires window keyboard events into
 * the ToolManager and starts autosave persistence.
 */

import { useEffect, useRef } from 'react'
import { Viewport } from './rendering/Viewport'
import { editorStore } from './store/store'
import { initPersistence } from './store/persistence'
import { createToolManager, type ToolManager } from './tools'
import { AlignPanel } from './ui/AlignPanel'
import { AppearancePanel } from './ui/AppearancePanel'
import { CanvasContextMenu } from './ui/CanvasContextMenu'
import { PathfinderPanel } from './ui/PathfinderPanel'
import { TextPanel } from './ui/TextPanel'
import { LayersPanel } from './ui/LayersPanel'
import { Toolbar } from './ui/Toolbar'
import { TopBar } from './ui/TopBar'

export function App() {
  const managerRef = useRef<ToolManager | null>(null)
  managerRef.current ??= createToolManager(editorStore)
  const manager = managerRef.current

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (manager.keyDown(e)) e.preventDefault()
    }
    const onKeyUp = (e: KeyboardEvent) => manager.keyUp(e)
    const onBlur = () => {
      editorStore.getState().setSpaceHeld(false)
      manager.cancelGesture()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    const stopPersistence = initPersistence(editorStore)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      stopPersistence()
    }
  }, [manager])

  return (
    <div className="app">
      <Toolbar manager={manager} />
      <div className="main">
        <TopBar />
        <Viewport manager={manager} />
      </div>
      <div className="sidebar">
        {/* Contextual panels (appear only when applicable) scroll in the space
            above the Layers panel, which the user resizes to taste. */}
        <div className="sidebar-panels">
          <AppearancePanel />
          <TextPanel />
          <AlignPanel />
          <PathfinderPanel />
        </div>
        <LayersPanel />
      </div>
      <CanvasContextMenu />
    </div>
  )
}
