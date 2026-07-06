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
import {
  cmdAddNode,
  cmdApplyAppearance,
  cmdConvertToPath,
  cmdDeleteAnchors,
  cmdDeleteNodes,
  cmdDuplicateNodes,
  cmdGroupNodes,
  cmdMoveNodesBy,
  cmdSetStyle,
  cmdSetTransforms,
  cmdUngroupNodes,
  cmdUpdateNode,
} from '../store/commands'
import { cmdErase, cmdKnife, cmdShapeBuilder } from '../store/booleanCommands'
import { copySelection, cutSelection, pasteClipboard } from '../store/clipboard'
import { effectiveScopeId, type EditorStoreApi } from '../store/store'
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

  /** Double-click (browser-detected); no down/up bookkeeping of its own. */
  doubleClick(raw: MouseEvent, screenPoint: Vec2): void {
    const e = this.buildEvent(raw, screenPoint)
    this.activeTool.onDoubleClick?.(e, this.ctx)
  }

  /** Esc / tool switch / focus loss: abort any in-flight gesture cleanly. */
  cancelGesture(): void {
    this.activeTool.onCancel?.(this.ctx)
    const state = this.store.getState()
    if (state.inTransaction()) state.cancelTransaction()
    state.setMarquee(null)
    state.setSnapGuides([])
    state.setPenPreview(null)
    state.setFacePreview(null)
    state.setCutTrail(null)
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
    // The active tool gets first crack at editing keys (Delete of selected
    // anchors, Enter to finish a pen path, mid-drag arrow keys, nudge...).
    if (this.activeTool.onKeyDown?.(e, this.ctx) === true) return true
    if ((e.key === 'Delete' || e.key === 'Backspace') && !meta) {
      if (state.selection.length > 0) cmdDeleteNodes(this.store, state.selection)
      return true
    }
    // Structural / clipboard commands. Never mid-gesture — they would be
    // swallowed into the open drag transaction's undo step.
    if (meta && !state.inTransaction()) {
      if (key === 'g') {
        if (e.shiftKey) cmdUngroupNodes(this.store, state.selection)
        else cmdGroupNodes(this.store, state.selection)
        return true
      }
      if (key === 'c') {
        copySelection(this.store)
        return true
      }
      if (key === 'x') {
        cutSelection(this.store)
        return true
      }
      if (key === 'v') {
        pasteClipboard(this.store)
        return true
      }
      if (key === 'd') {
        cmdDuplicateNodes(this.store, state.selection, { offset: { x: 10, y: 10 } })
        return true
      }
    }
    if (!meta && !e.altKey && this.down === null) {
      const shortcut = (e.shiftKey ? 'shift+' : '') + key
      const toolId = this.byShortcut.get(shortcut)
      if (toolId) {
        this.setActiveTool(toolId)
        return true
      }
    }
    return false
  }

  keyUp(e: KeyboardEvent): void {
    if (e.code === 'Space') this.store.getState().setSpaceHeld(false)
  }

  // -- event normalization ----------------------------------------------------

  private buildEvent(raw: PointerEvent | MouseEvent, screenPoint: Vec2): ToolPointerEvent {
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
      hitNodeId: topNodeIdFromTarget(state.document, raw.target, effectiveScopeId(state)),
      domTarget: raw.target,
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
      scope: {
        current: () => effectiveScopeId(g()),
        set: (id) => g().setScope(id),
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
        moveNodesBy: (ids, docDelta, label) => cmdMoveNodesBy(store, ids, docDelta, label),
        duplicateNodes: (ids, opts) => cmdDuplicateNodes(store, ids, opts),
        convertToPath: (ids) => cmdConvertToPath(store, ids),
        deleteAnchors: (nodeId, anchorIds) => cmdDeleteAnchors(store, nodeId, anchorIds),
        setStyle: (ids, label, mutate) => cmdSetStyle(store, ids, label, mutate),
        applyAppearance: (ids, appearance, label) =>
          cmdApplyAppearance(store, ids, appearance, label),
        shapeBuilder: (sourceIds, faces, picked, mode) =>
          cmdShapeBuilder(store, sourceIds, faces, picked, mode),
        knife: (trail, ids) => cmdKnife(store, trail, ids),
        erase: (trail, radius, ids) => cmdErase(store, trail, radius, ids),
      },
      style: {
        target: () => g().ui.styleTarget,
        setTarget: (target) => g().setStyleTarget(target),
        current: () => g().ui.currentStyle,
        setCurrent: (style) => g().setCurrentStyle(style),
      },
      widthEdit: {
        get: () => g().ui.widthEdit,
        set: (id) => g().setWidthEdit(id),
      },
      pathEdit: {
        get: () => g().ui.pathEdit,
        set: (pe) => g().setPathEdit(pe),
      },
      overlay: {
        setMarquee: (rect) => g().setMarquee(rect),
        setGuides: (guides) => g().setSnapGuides(guides),
        setPenPreview: (preview) => g().setPenPreview(preview),
        setFacePreview: (region) => g().setFacePreview(region),
        setCutTrail: (trail) => g().setCutTrail(trail),
      },
      hitTest: {
        topNodeAt: (target) =>
          topNodeIdFromTarget(g().document, target, effectiveScopeId(g())),
        nodesInRect: (rect, mode) =>
          nodesInDocRect(g().document, rect, { scopeId: effectiveScopeId(g()), mode }),
      },
    }
  }
}
