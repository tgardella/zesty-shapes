/**
 * The shared Tool interface and the normalized event/context every tool
 * receives. Tools NEVER touch raw store state — everything goes through the
 * ToolContext command/selection/transaction surface.
 */

import type { Vec2 } from '../geometry/vec2'
import type { Mat } from '../geometry/matrix'
import type { BBox } from '../geometry/bbox'
import type { Document, NodeId, SceneNode, Style } from '../model/types'
import type { ViewportState } from '../store/coords'
import type { AddNodeOptions, Appearance } from '../store/commands'
import type { Face } from '../model/booleanOps'
import type { PathEditState, PenPreview, StyleTarget } from '../store/store'
import type { SnapGuide } from '../snapping/types'

export interface ToolModifiers {
  shift: boolean
  alt: boolean
  meta: boolean
  ctrl: boolean
}

/**
 * Normalized pointer event, built ONCE by the ToolManager from the raw DOM
 * event. Tools never do their own coordinate math on raw events.
 */
export interface ToolPointerEvent {
  /** Pixels, relative to the viewport container. */
  screenPoint: Vec2
  /** Document space (screenToDoc applied). */
  docPoint: Vec2
  /** docPoint after the enabled snappers (grid, Shift-constrain). */
  snappedPoint: Vec2
  /** Doc-space delta since pointer-down; zero when no gesture is active. */
  deltaFromDown: Vec2
  /** Screen-space delta since pointer-down (for drag thresholds). */
  screenDeltaFromDown: Vec2
  modifiers: ToolModifiers
  /** Topmost hit node, resolved to a top-level id within the CURRENT SCOPE. */
  hitNodeId: NodeId | null
  /** Raw DOM event target, for re-resolving hits after a scope change. */
  domTarget: EventTarget | null
  buttons: number
}

export interface ToolContext {
  getDocument(): Document
  getSelection(): NodeId[]
  getViewport(): ViewportState

  /** Memoized EFFECTIVE transform (all ancestors × own). */
  worldTransform(id: NodeId): Mat
  screenToDoc(p: Vec2): Vec2
  docToScreen(p: Vec2): Vec2

  select: {
    set(ids: NodeId[]): void
    add(ids: NodeId[]): void
    remove(ids: NodeId[]): void
    clear(): void
  }

  /** Group isolation scope (double-click to enter). */
  scope: {
    /** Effective scope id — the document root when not isolated. */
    current(): NodeId
    /** Enter a group (id) or exit isolation (null). */
    set(id: NodeId | null): void
  }

  /** One gesture = one transaction = ONE undo step. */
  transaction: {
    begin(label: string): void
    commit(): void
    cancel(): void
    active(): boolean
  }

  history: {
    undo(): void
    redo(): void
  }

  commands: {
    addNode(node: SceneNode, opts?: AddNodeOptions): void
    deleteNodes(ids: NodeId[]): void
    updateNode(id: NodeId, label: string, mutate: (node: SceneNode) => void): void
    setTransforms(entries: ReadonlyArray<{ id: NodeId; transform: Mat }>, label?: string): void
    /** Translate by a DOC-space delta, mapped into each node's parent space. */
    moveNodesBy(ids: NodeId[], docDelta: Vec2, label?: string): void
    /** Duplicate subtrees in place (above their sources); returns the new root ids. */
    duplicateNodes(ids: NodeId[], opts?: { offset?: Vec2; label?: string }): NodeId[]
    /** Shape -> PathNode in place (id/transform preserved); returns converted ids. */
    convertToPath(ids: NodeId[]): NodeId[]
    /** Delete anchors (drops degenerate subpaths / empty nodes). */
    deleteAnchors(nodeId: NodeId, anchorIds: string[]): void
    /** Mutate styles of the stylable leaves under `ids` (groups recurse). */
    setStyle(ids: NodeId[], label: string, mutate: (style: Style, node: SceneNode) => void): void
    /** Apply a sampled appearance (Eyedropper) to the leaves under `ids`. */
    applyAppearance(ids: NodeId[], appearance: Appearance, label?: string): void
    /** Shape Builder apply: merge (or Alt-delete) picked faces; consumes sources. */
    shapeBuilder(
      sourceIds: NodeId[],
      faces: Face[],
      picked: number[],
      mode: 'merge' | 'delete',
    ): NodeId[]
    /** Freehand knife cut: split intersected targets into separate pieces. */
    knife(trail: Vec2[], ids?: NodeId[]): NodeId[]
    /** Freehand eraser: subtract a blob of `radius` from targets. */
    erase(trail: Vec2[], radius: number, ids?: NodeId[]): NodeId[]
  }

  /** Appearance UI state shared with the panel (never undoable). */
  style: {
    /** Which paint slot (fill/stroke) appearance edits target. */
    target(): StyleTarget
    setTarget(target: StyleTarget): void
    /** Style for NEW objects; tools clone it at creation time. */
    current(): Style
    setCurrent(style: Style): void
  }

  /** Width tool target (overlay shows its width handles). */
  widthEdit: {
    get(): NodeId | null
    set(id: NodeId | null): void
  }

  /** Path-edit target shown by the overlay (anchors + handles). */
  pathEdit: {
    get(): PathEditState | null
    set(pe: PathEditState | null): void
  }

  overlay: {
    /** Marquee rect in DOC space; null hides it. */
    setMarquee(rect: BBox | null): void
    setGuides(guides: SnapGuide[]): void
    /** Pen rubber-band segment (DOC space); null hides it. */
    setPenPreview(preview: PenPreview | null): void
    /** Shape Builder face highlight: one region's rings (DOC space). */
    setFacePreview(region: Vec2[][] | null): void
    /** Knife/Eraser freehand trail (DOC space). */
    setCutTrail(trail: Vec2[] | null): void
  }

  hitTest: {
    /** Resolve a DOM event target to a top-level node id within the current scope. */
    topNodeAt(target: EventTarget | null): NodeId | null
    /** Geometric marquee test against the current scope's children. */
    nodesInRect(rect: BBox, mode?: 'intersect' | 'contain'): NodeId[]
  }
}

export interface Tool {
  readonly id: string
  readonly name: string
  /** Normalized shortcut ('v', 'm', 'shift+m', '\\'); null = toolbar-only. */
  readonly shortcut: string | null
  readonly cursor: string
  /** Opt in to Shift = constrain-to-45° on the snapped point (moves, lines). */
  readonly wantsAngleSnap?: boolean

  onPointerDown?(e: ToolPointerEvent, ctx: ToolContext): void
  onPointerMove?(e: ToolPointerEvent, ctx: ToolContext): void
  onPointerUp?(e: ToolPointerEvent, ctx: ToolContext): void
  onDoubleClick?(e: ToolPointerEvent, ctx: ToolContext): void
  /** Return true to consume the key (prevents default handling). */
  onKeyDown?(e: KeyboardEvent, ctx: ToolContext): boolean | void
  /** Esc or forced abort: cancel any in-flight gesture/transaction. */
  onCancel?(ctx: ToolContext): void
  onDeactivate?(ctx: ToolContext): void
}
