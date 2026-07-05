/**
 * Central tool dispatch:
 * - registry: tool id + normalized shortcut -> Tool (per the authoritative map)
 * - builds the ONE normalized ToolPointerEvent (screen/doc/snapped point,
 *   modifiers, top-hit node, delta-from-down) from raw DOM events
 * - global modifiers: Space = temp pan (handled by Viewport via tool.spaceHeld),
 *   Esc = cancel gesture, Cmd/Ctrl+Z / Shift+Cmd+Z = undo/redo,
 *   Delete/Backspace = delete selection
 * - runs the snap engine and publishes guides to the overlay during gestures.
 */

import type { Vec2 } from '../geometry/vec2'
import { sub } from '../geometry/vec2'
import { docToScreen, screenToDoc } from '../store/coords'
import { cmdAddNode, cmdDeleteNodes, cmdSetTransforms, cmdUpdateNode } from '../store/commands'
import type { EditorStoreApi } from '../store/store'
import { worldTransform } from '../store/worldTransform'
import { createDefaultSnapEngine, type SnapEngine } from '../snapping/engine'
import { nodesInDocRect, topNodeIdFromTarget } from './hitTest'
import type { Tool, ToolContext, ToolPointerEvent } from './types'

const ZERO: Vec2 = { x: 0, y: 0 }

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.isContentEditable ||
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT'
  )
}

export class ToolManager {
  private readonly tools: Tool[] = []
  private readonly byId = new Map<string, Tool>()
  private readonly byShortcut = new Map<string, string>()
  private readonly ctx: ToolContext
  private readonly snapEngine: SnapEngine = createDefaultSnapEngine()
  /** Active pointer gesture (down -> up); null while hovering. */
  private down: { docPoint: Vec2; screenPoint: Vec2 } | null = null

  constructor(private readonly store: EditorStoreApi) {
    this.ctx = this.createContext()
  }

  register(tool: Tool): void {
    if (this.byId.has(tool.id)) throw new Error(`ToolManager: duplicate tool '${tool.id}'`)
    this.tools.push(tool)
    this.byId.set(tool.id, tool)
    if (tool.shortcut) {
      const key = tool.shortcut.toLowerCase()
      if (this.byShortcut.has(key)) {
        throw new Error(`ToolManager: shortcut collision on '${key}'`)
      }
      this.byShortcut.set(key, tool.id)
    }
  }

  getTools(): readonly Tool[] {
    return this.tools
  }

  getTool(id: string): Tool | undefined {
    return this.byId.get(id)
  }

  get activeTool(): Tool {
    const id = this.store.getState().tool.activeToolId
    const tool = this.byId.get(id)
    if (!tool) throw new Error(`ToolManager: unknown active tool '${id}'`)
    return tool
  }

  setActiveTool(id: string): void {
    const state = this.store.getState()
    if (!this.byId.has(id) || state.tool.activeToolId === id) return
    this.cancelGesture()
    this.activeTool.onDeactivate?.(this.ctx)
    state.setActiveTool(id)
  }

  // -- pointer pipeline -----------------------------------------------------

  pointerDown(raw: PointerEvent, screenPoint: Vec2): void {
    const docPoint = screenToDoc(this.store.getState().viewport, screenPoint)
    this.down = { docPoint, screenPoint }
    const e = this.buildEvent(raw, screenPoint)
    this.activeTool.onPointerDown?.(e, this.ctx)
  }

  pointerMove(raw: PointerEvent, screenPoint: Vec2): void {
    const e = this.buildEvent(raw, screenPoint)
    this.activeTool.onPointerMove?.(e, this.ctx)
  }

  pointerUp(raw: PointerEvent, screenPoint: Vec2): void {
    const e = this.buildEvent(raw, screenPoint)
    this.activeTool.onPointerUp?.(e, this.ctx)
    this.down = null
    this.store.getState().setSnapGuides([])
  }

  pointerCancel(): void {
    this.cancelGesture()
  }

  /** Esc / tool switch / focus loss: abort any in-flight gesture cleanly. */
  cancelGesture(): void {
    this.activeTool.onCancel?.(this.ctx)
    const state = this.store.getState()
    if (state.inTransaction()) state.cancelTransaction()
    state.setMarquee(null)
    state.setSnapGuides([])
    this.down = null
  }

  // -- keyboard -------------------------------------------------------------

  /** Returns true when the key was consumed (caller should preventDefault). */
  keyDown(e: KeyboardEvent): boolean {
    if (isTypingTarget(e.target)) return false
    const state = this.store.getState()
    const meta = e.metaKey || e.ctrlKey
    const key = e.key.toLowerCase()

    if (meta && key === 'z') {
      if (e.shiftKey) state.redo()
      else state.undo()
      return true
    }
    if (meta && key === 'y') {
      state.redo()
      return true
    }
    if (e.key === 'Escape') {
      this.cancelGesture()
      return true
    }
    if (e.code === 'Space') {
      state.setSpaceHeld(true)
      return true
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && !meta) {
      if (state.selection.length > 0) cmdDeleteNodes(this.store, state.selection)
      return true
    }
    if (!meta && !e.altKey && this.down === null) {
      const shortcut = (e.shiftKey ? 'shift+' : '') + key
      const toolId = this.byShortcut.get(shortcut)
      if (toolId) {
        this.setActiveTool(toolId)
        return true
      }
    }
    return this.activeTool.onKeyDown?.(e, this.ctx) === true
  }

  keyUp(e: KeyboardEvent): void {
    if (e.code === 'Space') this.store.getState().setSpaceHeld(false)
  }

  // -- event normalization ----------------------------------------------------

  private buildEvent(raw: PointerEvent, screenPoint: Vec2): ToolPointerEvent {
    const state = this.store.getState()
    const viewport = state.viewport
    const docPoint = screenToDoc(viewport, screenPoint)
    const modifiers = {
      shift: raw.shiftKey,
      alt: raw.altKey,
      meta: raw.metaKey,
      ctrl: raw.ctrlKey,
    }
    const anchor = this.down?.docPoint ?? null
    const snap = this.snapEngine.snap(
      docPoint,
      {
        zoom: viewport.zoom,
        anchor,
        constrainAngle: modifiers.shift && (this.activeTool.wantsAngleSnap ?? false) && anchor !== null,
      },
      state.ui,
    )
    if (this.down) state.setSnapGuides(snap.guides)
    return {
      screenPoint,
      docPoint,
      snappedPoint: snap.point,
      deltaFromDown: anchor ? sub(docPoint, anchor) : ZERO,
      screenDeltaFromDown: this.down ? sub(screenPoint, this.down.screenPoint) : ZERO,
      modifiers,
      hitNodeId: topNodeIdFromTarget(state.document, raw.target),
      buttons: raw.buttons,
    }
  }

  // -- tool context -----------------------------------------------------------

  private createContext(): ToolContext {
    const store = this.store
    const g = () => store.getState()
    return {
      getDocument: () => g().document,
      getSelection: () => g().selection,
      getViewport: () => g().viewport,
      worldTransform: (id) => worldTransform(g().document.nodes, id),
      screenToDoc: (p) => screenToDoc(g().viewport, p),
      docToScreen: (p) => docToScreen(g().viewport, p),
      select: {
        set: (ids) => g().setSelection(ids),
        add: (ids) => g().addToSelection(ids),
        remove: (ids) => g().removeFromSelection(ids),
        clear: () => g().clearSelection(),
      },
      transaction: {
        begin: (label) => g().beginTransaction(label),
        commit: () => g().commitTransaction(),
        cancel: () => g().cancelTransaction(),
        active: () => g().inTransaction(),
      },
      history: {
        undo: () => g().undo(),
        redo: () => g().redo(),
      },
      commands: {
        addNode: (node, opts) => cmdAddNode(store, node, opts),
        deleteNodes: (ids) => cmdDeleteNodes(store, ids),
        updateNode: (id, label, mutate) => cmdUpdateNode(store, id, label, mutate),
        setTransforms: (entries, label) => cmdSetTransforms(store, entries, label),
      },
      overlay: {
        setMarquee: (rect) => g().setMarquee(rect),
        setGuides: (guides) => g().setSnapGuides(guides),
      },
      hitTest: {
        topNodeAt: (target) => topNodeIdFromTarget(g().document, target),
        nodesInRect: (rect) => nodesInDocRect(g().document, rect),
      },
    }
  }
}
