/**
 * The canvas surface. Captures raw pointer/wheel events ONCE and hands the
 * ToolManager normalized events; owns Space-drag / middle-drag panning and
 * wheel zoom-toward-cursor (both touch ONLY the viewport slice — scene nodes
 * never re-render on pan/zoom).
 */

import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { Vec2 } from '../geometry/vec2'
import { editorStore, useEditor } from '../store/store'
import type { ToolManager } from '../tools/ToolManager'
import { DocumentSvg } from './DocumentSvg'
import { Overlay } from './Overlay'

interface PanGesture {
  pointerId: number
  startScreen: Vec2
  startPan: { tx: number; ty: number }
}

export function Viewport({ manager }: { manager: ToolManager }) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const panRef = useRef<PanGesture | null>(null)
  const [isPanning, setIsPanning] = useState(false)
  const spaceHeld = useEditor((s) => s.tool.spaceHeld)
  const activeToolId = useEditor((s) => s.tool.activeToolId)

  const toScreen = (e: { clientX: number; clientY: number }): Vec2 => {
    const rect = containerRef.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    try {
      containerRef.current?.setPointerCapture(e.pointerId)
    } catch {
      // Inactive/synthetic pointer ids (tests, some pens) can't be captured.
    }
    const screenPoint = toScreen(e)
    // Read fresh state, not the subscribed value: Space may have gone down in
    // this same tick, before React re-rendered this component.
    if (e.button === 1 || editorStore.getState().tool.spaceHeld) {
      e.preventDefault()
      const { tx, ty } = editorStore.getState().viewport
      panRef.current = { pointerId: e.pointerId, startScreen: screenPoint, startPan: { tx, ty } }
      setIsPanning(true)
      return
    }
    if (e.button !== 0) return
    manager.pointerDown(e.nativeEvent, screenPoint)
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const screenPoint = toScreen(e)
    const pan = panRef.current
    if (pan && e.pointerId === pan.pointerId) {
      editorStore.getState().setViewport({
        tx: pan.startPan.tx + (screenPoint.x - pan.startScreen.x),
        ty: pan.startPan.ty + (screenPoint.y - pan.startScreen.y),
      })
      return
    }
    manager.pointerMove(e.nativeEvent, screenPoint)
  }

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (panRef.current && e.pointerId === panRef.current.pointerId) {
      panRef.current = null
      setIsPanning(false)
      return
    }
    if (e.button !== 0) return
    manager.pointerUp(e.nativeEvent, toScreen(e))
  }

  const onPointerCancel = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (panRef.current && e.pointerId === panRef.current.pointerId) {
      panRef.current = null
      setIsPanning(false)
      return
    }
    manager.pointerCancel()
  }

  // Wheel needs a non-passive listener to preventDefault (browser zoom/scroll).
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (we: WheelEvent) => {
      we.preventDefault()
      const rect = el.getBoundingClientRect()
      const screenPoint = { x: we.clientX - rect.left, y: we.clientY - rect.top }
      const factor = Math.exp(-we.deltaY * (we.ctrlKey ? 0.01 : 0.0015))
      editorStore.getState().zoomAtPoint(screenPoint, factor)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const cursor = isPanning
    ? 'grabbing'
    : spaceHeld
      ? 'grab'
      : (manager.getTool(activeToolId)?.cursor ?? 'default')

  return (
    <div
      ref={containerRef}
      className="viewport"
      style={{ cursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onDoubleClick={(e) => {
        if (e.button === 0) manager.doubleClick(e.nativeEvent, toScreen(e))
      }}
      onMouseDown={(e) => {
        if (e.button === 1) e.preventDefault() // block middle-click autoscroll
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <DocumentSvg />
      <Overlay />
    </div>
  )
}
