/**
 * The Zustand store: sliced state (document / selection / viewport / tool / ui).
 *
 * - documentSlice is the ONLY undoable slice; every document mutation goes
 *   through applyCommand -> produceWithPatches.
 * - Bare selection changes never create history entries, but every command
 *   entry records selectionBefore/After so undo/redo restores selection.
 * - Viewport is never undoable.
 * - Transactions (one drag = ONE undo step): between beginTransaction and
 *   commitTransaction, commands update the live document (preview) while
 *   their patches accumulate; commit pushes one squashed history entry,
 *   cancel rolls the document back.
 *
 * Tools NEVER call set() directly — they go through this action surface
 * (usually via the ToolContext command wrappers).
 */

import { createStore, type StoreApi } from 'zustand/vanilla'
import { useStore } from 'zustand'
import { applyPatches, produceWithPatches, type Draft } from 'immer'
import type { Document, NodeId, Style } from '../model/types'
import { createDocument } from '../model/document'
import { createInitialDocument, isLayerNode, nearestLayer, normalizeLayers, topLevelLayers } from '../model/layers'
import { defaultStyle } from '../model/nodes'
import { loadDocumentFromStorage } from '../model/serialize'
import type { Vec2 } from '../geometry/vec2'
import type { BBox } from '../geometry/bbox'
import type { SnapGuide } from '../snapping/types'
import { clampZoom, zoomedViewport, type ViewportState } from './coords'
import {
  emptyHistory,
  pushEntry,
  squashPatches,
  type HistoryState,
  type TransactionState,
} from './history'

export type { ViewportState }

export interface ToolState {
  activeToolId: string
  /** Space held = temporary pan mode; tools receive no pointer events. */
  spaceHeld: boolean
}

/** Path-editing target: which PathNode's anchors are shown/selected. */
export interface PathEditState {
  nodeId: NodeId
  /** Selected anchor ids (bare changes are NOT undoable, like selection). */
  anchorIds: string[]
}

/** Pen rubber-band: the exact would-be segment from the last anchor (DOC space). */
export interface PenPreview {
  from: Vec2
  /** Outgoing control of the last anchor (null = straight start). */
  fromHandle: Vec2 | null
  to: Vec2
}

/** Which paint slot the Appearance panel / Gradient tool edits. */
export type StyleTarget = 'fill' | 'stroke'

export interface UiState {
  /** Marquee rectangle in DOCUMENT space (overlay converts to screen). */
  marquee: BBox | null
  /** Active snap guides in DOCUMENT space. */
  snapGuides: SnapGuide[]
  snapToGrid: boolean
  gridSize: number
  /** Non-null while a path's anchors are being edited (A/P/N/...). */
  pathEdit: PathEditState | null
  penPreview: PenPreview | null
  /** Active paint slot for the Appearance panel / Gradient annotator. */
  styleTarget: StyleTarget
  /** Appearance for NEW objects; edited by the panel when nothing is selected. */
  currentStyle: Style
  /** Node whose width profile the Width tool (Shift+W) is editing. */
  widthEdit: NodeId | null
  /** Mesh point the Gradient Mesh tool (U) has selected (overlay highlight). */
  meshEdit: { nodeId: NodeId; pointIndex: number } | null
  /** Shape Builder hover/gesture highlight: one region (DOC-space rings). */
  facePreview: Vec2[][] | null
  /** Knife/Eraser freehand trail (DOC space) while dragging. */
  cutTrail: Vec2[] | null
  /** Text node being edited in place (HTML overlay); never undoable. */
  textEdit: { nodeId: NodeId } | null
  /** Lasso (Q) freehand trail (DOC space) while dragging. */
  lasso: Vec2[] | null
  /** Artboard tool target (like selection: never undoable). */
  activeArtboardId: string | null
  /** Display grid + units. Snapping reads `gridSize` (doc units = CSS px). */
  grid: GridSettings
  /** Per-tool size (doc units): eraser diameter, pencil stroke width, ... */
  toolSizes: Record<string, number>
  /** Pointer position in DOC space while over the canvas (size cursor). */
  pointer: Vec2 | null
  /** Active layer new objects/imports land in (null = topmost layer). */
  activeLayerId: NodeId | null
  /** Items targeted for the Appearance panel (Layers panel target column). */
  targetedIds: NodeId[]
  /** Named selections saved from the Layers panel ("Save Selection"). */
  savedSelections: { name: string; ids: NodeId[] }[]
  /** Symbol the Symbols panel highlighted (the sprayer sprays it). */
  activeSymbolId: string | null
  /** Paintbrush (B) stroke shape preset. */
  brushPreset: BrushPreset
}

/** Paintbrush stroke shapes: tapered ends, uniform, or angled-nib calligraphy. */
export type BrushPreset = 'taper' | 'uniform' | 'calligraphic'

export interface GridSettings {
  /** Draw the grid (lines or dots) under the scene. */
  show: boolean
  style: 'lines' | 'dots'
  /** Preset spacing: 1in = 96, 1cm ≈ 37.795; 'custom' uses `gridSize` as-is. */
  unit: 'inch' | 'cm' | 'custom'
}

export interface EditorState {
  document: Document
  selection: NodeId[]
  /**
   * Group isolation scope ("enter group" via double-click). null = document
   * root. Hit-testing and marquee resolve against the scope's children.
   * Validated lazily via effectiveScopeId — a deleted scope falls back to root.
   */
  scopeId: NodeId | null
  viewport: ViewportState
  tool: ToolState
  ui: UiState
  history: HistoryState
}

/** The scope to hit-test against: the stored scope if it still is a live group, else root. */
export function effectiveScopeId(state: Pick<EditorState, 'document' | 'scopeId'>): NodeId {
  const { scopeId, document } = state
  if (scopeId !== null && scopeId !== document.root && document.nodes[scopeId]?.type === 'group') {
    return scopeId
  }
  return document.root
}

/**
 * Where new art lands: the isolation scope when inside a group; otherwise the
 * active layer (or the topmost layer). Falls back to the root for bare
 * layer-free documents (tests) so the pure model contract is preserved.
 */
export function resolveInsertionParent(
  state: Pick<EditorState, 'document' | 'scopeId' | 'ui'>,
): NodeId {
  const scope = effectiveScopeId(state)
  if (scope !== state.document.root) return scope
  const layers = topLevelLayers(state.document)
  if (layers.length === 0) return state.document.root
  // The active layer may be a top-level layer OR a sublayer — any layer group
  // in the document is a valid insertion target.
  const active = state.ui.activeLayerId
  if (active && isLayerNode(state.document.nodes[active])) return active
  return layers[layers.length - 1]!.id // topmost layer
}

/**
 * When the selection becomes non-empty, make the primary object's NEAREST
 * layer the active layer (Illustrator: selecting art targets its layer — new
 * art and pastes then land there). Clearing the selection LEAVES the active
 * layer intact, so clicking empty canvas never loses your working layer.
 */
function syncActiveLayerToSelection(
  get: () => EditorState & EditorActions,
  set: (partial: Partial<EditorState>) => void,
  selection: NodeId[],
): void {
  if (selection.length === 0) return
  const state = get()
  const layer = nearestLayer(state.document, selection[0]!)
  if (layer && state.ui.activeLayerId !== layer.id) {
    set({ ui: { ...state.ui, activeLayerId: layer.id } })
  }
}

export interface CommandOptions {
  /** Selection to apply with the command and restore on redo. */
  selectAfter?: NodeId[]
}

export interface EditorActions {
  /** Run a document mutation as an undoable command (or into the open transaction). */
  applyCommand(label: string, recipe: (doc: Document) => void, opts?: CommandOptions): void
  beginTransaction(label: string): void
  commitTransaction(): void
  cancelTransaction(): void
  inTransaction(): boolean
  undo(): void
  redo(): void

  setSelection(ids: NodeId[]): void
  addToSelection(ids: NodeId[]): void
  removeFromSelection(ids: NodeId[]): void
  clearSelection(): void

  /** Enter (a group id) / exit (null) isolation scope. Never undoable. */
  setScope(id: NodeId | null): void

  setViewport(v: Partial<ViewportState>): void
  panBy(dx: number, dy: number): void
  /** Zoom by `factor`, keeping the doc point under `screenPoint` fixed. */
  zoomAtPoint(screenPoint: Vec2, factor: number): void

  setActiveTool(toolId: string): void
  setSpaceHeld(held: boolean): void

  setMarquee(rect: BBox | null): void
  setSnapGuides(guides: SnapGuide[]): void
  setSnapToGrid(on: boolean): void

  /** Set/clear the path-edit target; never undoable (like selection). */
  setPathEdit(pe: PathEditState | null): void
  setPenPreview(preview: PenPreview | null): void

  /** Appearance UI state; never undoable. */
  setStyleTarget(target: StyleTarget): void
  setCurrentStyle(style: Style): void
  setWidthEdit(id: NodeId | null): void
  setMeshEdit(edit: { nodeId: NodeId; pointIndex: number } | null): void
  setActiveSymbol(id: string | null): void
  setBrushPreset(preset: BrushPreset): void

  /** Boolean-tool previews (Shape Builder face, Knife/Eraser trail); never undoable. */
  setFacePreview(region: Vec2[][] | null): void
  setCutTrail(trail: Vec2[] | null): void

  /** In-place text editing target + lasso trail; never undoable. */
  setTextEdit(edit: { nodeId: NodeId } | null): void
  setLasso(trail: Vec2[] | null): void

  /** Artboard tool target; never undoable. */
  setActiveArtboard(id: string | null): void
  /** Grid settings (display + spacing); never undoable. */
  setGrid(grid: Partial<GridSettings>): void
  setGridSize(size: number): void
  /** Per-tool size (doc units); never undoable. */
  setToolSize(toolId: string, size: number): void
  /** Pointer doc position for the size cursor; null when off-canvas. */
  setPointer(p: Vec2 | null): void

  /** Active layer for new art; never undoable. */
  setActiveLayer(id: NodeId | null): void
  /** Appearance target items (Layers panel); never undoable. */
  setTargeted(ids: NodeId[]): void
  /** Persist a named selection; never undoable. */
  saveSelection(name: string, ids: NodeId[]): void
}

export type EditorStore = EditorState & EditorActions
export type EditorStoreApi = StoreApi<EditorStore>

export function createEditorStore(initialDocument?: Document): EditorStoreApi {
  /** Open transaction, deliberately NON-reactive (patch churn during drags). */
  let txn: TransactionState | null = null

  return createStore<EditorStore>()((set, get) => {
    const sanitizeSelection = (ids: NodeId[], doc: Document): NodeId[] => {
      const seen = new Set<NodeId>()
      const out: NodeId[] = []
      for (const id of ids) {
        if (id !== doc.root && doc.nodes[id] && !seen.has(id)) {
          seen.add(id)
          out.push(id)
        }
      }
      return out
    }

    return {
      document: initialDocument ?? createDocument(),
      selection: [],
      scopeId: null,
      viewport: { tx: 60, ty: 60, zoom: 1 },
      tool: { activeToolId: 'selection', spaceHeld: false },
      ui: {
        marquee: null,
        snapGuides: [],
        snapToGrid: false,
        gridSize: 10,
        pathEdit: null,
        penPreview: null,
        styleTarget: 'fill',
        currentStyle: defaultStyle(),
        widthEdit: null,
        meshEdit: null,
        facePreview: null,
        cutTrail: null,
        textEdit: null,
        lasso: null,
        activeArtboardId: null,
        grid: { show: false, style: 'lines', unit: 'custom' },
        toolSizes: {},
        pointer: null,
        activeLayerId: null,
        targetedIds: [],
        savedSelections: [],
        activeSymbolId: null,
        brushPreset: 'taper',
      },
      history: emptyHistory(),

      applyCommand(label, recipe, opts) {
        const state = get()
        const [nextDoc, patches, inversePatches] = produceWithPatches(
          state.document,
          (draft: Draft<Document>) => {
            recipe(draft as Document)
          },
        )
        if (patches.length === 0) return
        if (txn) {
          txn.patches.push(...patches)
          txn.inversePatches.unshift(...inversePatches)
          if (opts?.selectAfter) {
            set({ document: nextDoc, selection: sanitizeSelection(opts.selectAfter, nextDoc) })
          } else {
            set({ document: nextDoc })
          }
          return
        }
        const selectionAfter = sanitizeSelection(opts?.selectAfter ?? state.selection, nextDoc)
        set({
          document: nextDoc,
          selection: selectionAfter,
          history: pushEntry(state.history, {
            label,
            patches,
            inversePatches,
            selectionBefore: state.selection,
            selectionAfter,
          }),
        })
      },

      beginTransaction(label) {
        if (txn) {
          // A stray nested begin means a gesture didn't clean up; fail safe.
          get().commitTransaction()
        }
        txn = { label, patches: [], inversePatches: [], selectionBefore: get().selection }
      },

      commitTransaction() {
        if (!txn) return
        const t = txn
        txn = null
        if (t.patches.length === 0) return
        const state = get()
        const squashed = squashPatches(t.patches, t.inversePatches)
        set({
          history: pushEntry(state.history, {
            label: t.label,
            patches: squashed.patches,
            inversePatches: squashed.inversePatches,
            selectionBefore: t.selectionBefore,
            selectionAfter: state.selection,
          }),
        })
      },

      cancelTransaction() {
        if (!txn) return
        const t = txn
        txn = null
        if (t.patches.length > 0) {
          const doc = applyPatches(get().document, t.inversePatches)
          set({ document: doc, selection: sanitizeSelection(t.selectionBefore, doc) })
        } else {
          set({ selection: sanitizeSelection(t.selectionBefore, get().document) })
        }
      },

      inTransaction: () => txn !== null,

      undo() {
        if (txn) return // never undo mid-gesture
        const { history, document } = get()
        const entry = history.undoStack[history.undoStack.length - 1]
        if (!entry) return
        const doc = applyPatches(document, entry.inversePatches)
        set({
          document: doc,
          selection: sanitizeSelection(entry.selectionBefore, doc),
          history: {
            undoStack: history.undoStack.slice(0, -1),
            redoStack: [...history.redoStack, entry],
          },
        })
      },

      redo() {
        if (txn) return
        const { history, document } = get()
        const entry = history.redoStack[history.redoStack.length - 1]
        if (!entry) return
        const doc = applyPatches(document, entry.patches)
        set({
          document: doc,
          selection: sanitizeSelection(entry.selectionAfter, doc),
          history: {
            undoStack: [...history.undoStack, entry],
            redoStack: history.redoStack.slice(0, -1),
          },
        })
      },

      setSelection(ids) {
        const clean = sanitizeSelection(ids, get().document)
        set({ selection: clean })
        syncActiveLayerToSelection(get, set, clean)
      },
      addToSelection(ids) {
        const { selection, document } = get()
        const clean = sanitizeSelection([...selection, ...ids], document)
        set({ selection: clean })
        syncActiveLayerToSelection(get, set, clean)
      },
      removeFromSelection(ids) {
        const drop = new Set(ids)
        set({ selection: get().selection.filter((id) => !drop.has(id)) })
      },
      clearSelection() {
        if (get().selection.length > 0) set({ selection: [] })
      },

      setScope(id) {
        const state = get()
        const next =
          id !== null && id !== state.document.root && state.document.nodes[id]?.type === 'group'
            ? id
            : null
        if (state.scopeId !== next) set({ scopeId: next })
      },

      setViewport(v) {
        const cur = get().viewport
        set({ viewport: { ...cur, ...v, zoom: clampZoom(v.zoom ?? cur.zoom) } })
      },
      panBy(dx, dy) {
        const v = get().viewport
        set({ viewport: { ...v, tx: v.tx + dx, ty: v.ty + dy } })
      },
      zoomAtPoint(screenPoint, factor) {
        const v = get().viewport
        const next = zoomedViewport(v, screenPoint, v.zoom * factor)
        if (next.zoom !== v.zoom) set({ viewport: next })
      },

      setActiveTool(toolId) {
        const tool = get().tool
        if (tool.activeToolId !== toolId) set({ tool: { ...tool, activeToolId: toolId } })
      },
      setSpaceHeld(held) {
        const tool = get().tool
        if (tool.spaceHeld !== held) set({ tool: { ...tool, spaceHeld: held } })
      },

      setMarquee(rect) {
        const ui = get().ui
        if (ui.marquee === rect || (ui.marquee === null && rect === null)) return
        set({ ui: { ...ui, marquee: rect } })
      },
      setSnapGuides(guides) {
        const ui = get().ui
        if (ui.snapGuides === guides || (ui.snapGuides.length === 0 && guides.length === 0)) return
        set({ ui: { ...ui, snapGuides: guides } })
      },
      setPathEdit(pe) {
        const ui = get().ui
        if (ui.pathEdit === pe) return
        set({ ui: { ...ui, pathEdit: pe } })
      },

      setPenPreview(preview) {
        const ui = get().ui
        if (ui.penPreview === preview || (ui.penPreview === null && preview === null)) return
        set({ ui: { ...ui, penPreview: preview } })
      },

      setSnapToGrid(on) {
        const ui = get().ui
        if (ui.snapToGrid !== on) set({ ui: { ...ui, snapToGrid: on } })
      },

      setStyleTarget(target) {
        const ui = get().ui
        if (ui.styleTarget !== target) set({ ui: { ...ui, styleTarget: target } })
      },
      setCurrentStyle(style) {
        set({ ui: { ...get().ui, currentStyle: style } })
      },
      setWidthEdit(id) {
        const ui = get().ui
        if (ui.widthEdit !== id) set({ ui: { ...ui, widthEdit: id } })
      },
      setMeshEdit(edit) {
        const ui = get().ui
        if (ui.meshEdit === edit || (ui.meshEdit === null && edit === null)) return
        set({ ui: { ...ui, meshEdit: edit } })
      },
      setActiveSymbol(id) {
        const ui = get().ui
        if (ui.activeSymbolId !== id) set({ ui: { ...ui, activeSymbolId: id } })
      },
      setBrushPreset(preset) {
        const ui = get().ui
        if (ui.brushPreset !== preset) set({ ui: { ...ui, brushPreset: preset } })
      },
      setFacePreview(region) {
        const ui = get().ui
        if (ui.facePreview === region || (ui.facePreview === null && region === null)) return
        set({ ui: { ...ui, facePreview: region } })
      },
      setCutTrail(trail) {
        const ui = get().ui
        if (ui.cutTrail === trail || (ui.cutTrail === null && trail === null)) return
        set({ ui: { ...ui, cutTrail: trail } })
      },
      setTextEdit(edit) {
        const ui = get().ui
        if (ui.textEdit === edit || (ui.textEdit === null && edit === null)) return
        set({ ui: { ...ui, textEdit: edit } })
      },
      setLasso(trail) {
        const ui = get().ui
        if (ui.lasso === trail || (ui.lasso === null && trail === null)) return
        set({ ui: { ...ui, lasso: trail } })
      },
      setActiveArtboard(id) {
        const ui = get().ui
        if (ui.activeArtboardId !== id) set({ ui: { ...ui, activeArtboardId: id } })
      },
      setGrid(grid) {
        const ui = get().ui
        set({ ui: { ...ui, grid: { ...ui.grid, ...grid } } })
      },
      setGridSize(size) {
        const ui = get().ui
        if (size > 0 && ui.gridSize !== size) set({ ui: { ...ui, gridSize: size } })
      },
      setToolSize(toolId, size) {
        const ui = get().ui
        if (size > 0 && ui.toolSizes[toolId] !== size) {
          set({ ui: { ...ui, toolSizes: { ...ui.toolSizes, [toolId]: size } } })
        }
      },
      setPointer(p) {
        const ui = get().ui
        if (ui.pointer === p || (ui.pointer === null && p === null)) return
        set({ ui: { ...ui, pointer: p } })
      },
      setActiveLayer(id) {
        const ui = get().ui
        if (ui.activeLayerId !== id) set({ ui: { ...ui, activeLayerId: id } })
      },
      setTargeted(ids) {
        set({ ui: { ...get().ui, targetedIds: ids } })
      },
      saveSelection(name, ids) {
        const ui = get().ui
        const rest = ui.savedSelections.filter((s) => s.name !== name)
        set({ ui: { ...ui, savedSelections: [...rest, { name, ids: [...ids] }] } })
      },
    }
  })
}

/**
 * The app-wide store. Boots from localStorage when available (autosave's
 * counterpart) and normalizes into LAYERS — loaded documents predating the
 * layer tier get wrapped into a default "Layer 1"; a fresh document starts
 * with an empty Layer 1. Bare test stores (createEditorStore() with no
 * argument) stay layer-free so the pure model contract is untouched.
 */
export const editorStore: EditorStoreApi = createEditorStore(
  typeof window !== 'undefined'
    ? normalizeLayers(loadDocumentFromStorage() ?? createInitialDocument())
    : undefined,
)

/** React binding for the app-wide store. */
export function useEditor<T>(selector: (s: EditorStore) => T): T {
  return useStore(editorStore, selector)
}

declare global {
  interface Window {
    /** Dev-only handle for debugging and QA scripting. */
    __editorStore?: EditorStoreApi
  }
}
if (typeof window !== 'undefined' && import.meta.env.DEV) {
  window.__editorStore = editorStore
}
