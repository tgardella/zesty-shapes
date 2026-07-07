/**
 * The document model. THE most load-bearing file in the app.
 *
 * Invariants (see docs/PLAN.md — do not violate):
 * - The document is plain JSON: no class instances, no functions, no Maps.
 *   All behavior lives in pure free functions (src/model/*, src/geometry/*).
 * - Normalized, id-keyed node map `nodes: Record<NodeId, SceneNode>`; tree order via
 *   `children: NodeId[]` on group nodes. `parent` and `children` stay in sync atomically.
 * - Shape params (rect x/y/w/h, ellipse cx/cy/rx/ry, ...) define LOCAL geometry only.
 *   The node `transform` is the SOLE placement/orientation mechanism.
 * - Anchor geometry (points AND handles) is stored in LOCAL space, handles ABSOLUTE.
 */

import type { Vec2 } from '../geometry/vec2'
import type { Mat } from '../geometry/matrix'

/** nanoid string. Stable across JSON round-trips. */
export type NodeId = string
export type SubPathId = string
export type AnchorId = string
export type ArtboardId = string

// ---------------------------------------------------------------------------
// Paint & style
// ---------------------------------------------------------------------------

export interface RGBA {
  /** 0-255 */
  r: number
  /** 0-255 */
  g: number
  /** 0-255 */
  b: number
  /** 0-1 */
  a: number
}

export interface GradientStop {
  /** 0-1 position along the gradient axis. */
  offset: number
  color: RGBA
}

export type GradientType = 'linear' | 'radial'

export interface SolidPaint {
  type: 'solid'
  color: RGBA
}

/**
 * Geometry convention: linear runs (0,0)->(1,0) and radial is the unit circle
 * at (0.5,0.5) in unit space; `transform` maps unit space into the node's
 * LOCAL space (emitted as gradientTransform with gradientUnits=userSpaceOnUse).
 * See model/gradientGeometry.ts for the annotator <-> transform math.
 */
export interface GradientPaint {
  type: 'gradient'
  gradientType: GradientType
  stops: GradientStop[]
  transform: Mat
}

export type Paint = SolidPaint | GradientPaint

export type StrokeCap = 'butt' | 'round' | 'square'
export type StrokeJoin = 'miter' | 'round' | 'bevel'
export type FillRule = 'nonzero' | 'evenodd'

/** Variable-width stroke profile point (Width tool, Shift+W). */
export interface WidthStop {
  /** 0-1 position along the path length. */
  offset: number
  /** Full stroke width at this position, in local units. */
  width: number
}

export interface Style {
  fill: Paint | null
  stroke: Paint | null
  strokeWidth: number
  strokeCap: StrokeCap
  strokeJoin: StrokeJoin
  /** Dash array in local units; empty = solid. */
  strokeDash: number[]
  fillRule: FillRule
  /**
   * Variable-width profile (offsets along TOTAL path length); absent or empty
   * = uniform strokeWidth. Rendered as the chunked stroke-width APPROXIMATION
   * until the offset/boolean engine lands (see model/widthProfile.ts).
   */
  widthProfile?: WidthStop[]
}

// ---------------------------------------------------------------------------
// Path geometry
// ---------------------------------------------------------------------------

export type AnchorType = 'corner' | 'smooth' | 'symmetric'

/**
 * Handles are ABSOLUTE coordinates in the node's LOCAL space (not offsets),
 * stored on the anchor. null = no handle (straight segment on that side).
 */
export interface Anchor {
  id: AnchorId
  point: Vec2
  handleIn: Vec2 | null
  handleOut: Vec2 | null
  type: AnchorType
}

export interface SubPath {
  id: SubPathId
  closed: boolean
  anchors: Anchor[]
}

// ---------------------------------------------------------------------------
// Scene nodes
// ---------------------------------------------------------------------------

export type BlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'

export type NodeType =
  | 'rect'
  | 'ellipse'
  | 'polygon'
  | 'star'
  | 'line'
  | 'path'
  | 'group'
  | 'text'

export interface BaseNode {
  id: NodeId
  type: NodeType
  name: string
  /** null only for the document root group. */
  parent: NodeId | null
  /** SVG 6-tuple; the SOLE placement/orientation mechanism (see POSITIONING RULE). */
  transform: Mat
  style: Style
  /** 0-1, multiplies with children for groups. */
  opacity: number
  blendMode: BlendMode
  locked: boolean
  hidden: boolean
  /** RESERVED: id of a node used as a clip/mask source (later phase). */
  clip?: NodeId
}

/** Local geometry: the rect spans (x, y) to (x+w, y+h). rx/ry = corner radii (0 = square). */
export interface RectNode extends BaseNode {
  type: 'rect'
  x: number
  y: number
  w: number
  h: number
  rx: number
  ry: number
}

export interface EllipseNode extends BaseNode {
  type: 'ellipse'
  cx: number
  cy: number
  rx: number
  ry: number
}

/** Regular polygon: `sides` vertices on a circle of `radius` around (cx, cy). */
export interface PolygonNode extends BaseNode {
  type: 'polygon'
  cx: number
  cy: number
  radius: number
  sides: number
  /** Rotation of the first vertex, radians. 0 = pointing up (-y). */
  angle: number
}

export interface StarNode extends BaseNode {
  type: 'star'
  cx: number
  cy: number
  outerRadius: number
  innerRadius: number
  points: number
  /** Rotation of the first outer point, radians. 0 = pointing up (-y). */
  angle: number
}

export interface LineNode extends BaseNode {
  type: 'line'
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface PathNode extends BaseNode {
  type: 'path'
  subpaths: SubPath[]
}

export interface GroupNode extends BaseNode {
  type: 'group'
  /** z-order: earlier = painted first (bottom). */
  children: NodeId[]
  /** True for top-level layer groups (Layers panel treats these specially). */
  isLayer?: boolean
}

/**
 * Text. LOCAL geometry conventions (the transform is still the sole
 * placement mechanism, per the POSITIONING RULE):
 * - point text: the first line's baseline starts at the local origin
 *   (alignment offsets lines around x=0)
 * - area text: the wrapping box spans (0,0)..(width,height); the first
 *   baseline sits one ascent below the top
 * - path text: glyph baselines follow `textPath` (local-space geometry,
 *   usually copied from a clicked path node)
 * Layout/measurement is a runtime concern (model/textLayout.ts + the
 * registered measurer in model/textMetrics.ts).
 */
export interface TextNode extends BaseNode {
  type: 'text'
  text: string
  fontFamily: string
  fontSize: number
  fontWeight: number
  textAlign: 'left' | 'center' | 'right'
  /** Line height multiplier. */
  leading: number
  /** Point text (default) or area text wrapped inside width x height. */
  kind?: 'point' | 'area'
  /** Area-text box, local units (required when kind === 'area'). */
  width?: number
  height?: number
  /** Tracking in 1/1000 em (Illustrator convention). Default 0. */
  tracking?: number
  /** Pair kerning from the font. Default true. */
  kerning?: boolean
  /** Vertical type: columns top-to-bottom, advancing right-to-left. */
  vertical?: boolean
  /** Type on a path: baseline geometry in LOCAL space. Overrides kind. */
  textPath?: SubPath[]
  /** Arc-length start offset (0-1) along textPath. Default 0. */
  pathStartOffset?: number
}

export type ShapeNode = RectNode | EllipseNode | PolygonNode | StarNode | LineNode

export type SceneNode =
  | RectNode
  | EllipseNode
  | PolygonNode
  | StarNode
  | LineNode
  | PathNode
  | GroupNode
  | TextNode

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

export interface Artboard {
  id: ArtboardId
  name: string
  x: number
  y: number
  w: number
  h: number
}

export interface Document {
  /** Schema version for forward-compatible migration on load. */
  version: 1
  id: string
  name: string
  /** Normalized node map — THE source of truth. */
  nodes: Record<NodeId, SceneNode>
  /** Id of the root GroupNode (parent === null, never rendered with a transform). */
  root: NodeId
  /** Document-root concept from day one; export-by-artboard depends on it. */
  artboards: Artboard[]
}
