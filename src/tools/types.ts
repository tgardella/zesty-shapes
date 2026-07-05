/**
 * The shared Tool interface and the normalized event/context every tool
 * receives. Tools NEVER touch raw store state — everything goes through the
 * ToolContext command/selection/transaction surface.
 */

import type { Vec2 } from '../geometry/vec2'
import type { Mat } from '../geometry/matrix'
import type { BBox } from '../geometry/bbox'
import type { Document, NodeId, SceneNode } from '../model/types'
import type { ViewportState } from '../store/coords'
import type { AddNodeOptions } from '../store/commands'
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
  /** Topmost hit node, already resolved to a TOP-LEVEL id (child of root). */
  hitNodeId: NodeId | null
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
  }

  overlay: {
    /** Marquee rect in DOC space; null hides it. */
    setMarquee(rect: BBox | null): void
    setGuides(guides: SnapGuide[]): void
  }

  hitTest: {
    /** Resolve a DOM event target to a top-level node id (DOM hit-test). */
    topNodeAt(target: EventTarget | null): NodeId | null
    /** Geometric marquee test; returns top-level ids intersecting the doc rect. */
    nodesInRect(rect: BBox): NodeId[]
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
  /** Return true to consume the key (prevents default handling). */
  onKeyDown?(e: KeyboardEvent, ctx: ToolContext): boolean | void
  /** Esc or forced abort: cancel any in-flight gesture/transaction. */
  onCancel?(ctx: ToolContext): void
  onDeactivate?(ctx: ToolContext): void
}
