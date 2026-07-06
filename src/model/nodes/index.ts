/**
 * Node factories and shape -> path derivations. Factories allocate ids and fill
 * defaults; all returned nodes are plain JSON (no methods — behavior lives in
 * free functions like toSubPaths / convertToPath).
 */

import { nanoid } from 'nanoid'
import { IDENTITY } from '../../geometry/matrix'
import type { Mat } from '../../geometry/matrix'
import {
  ellipseToPath,
  lineToPath,
  polygonToPath,
  rectToPath,
  starToPath,
} from '../../geometry/shapes'
import type {
  BaseNode,
  EllipseNode,
  GroupNode,
  LineNode,
  PathNode,
  PolygonNode,
  RectNode,
  RGBA,
  SceneNode,
  ShapeNode,
  StarNode,
  Style,
  SubPath,
  TextNode,
} from '../types'

export function rgba(r: number, g: number, b: number, a = 1): RGBA {
  return { r, g, b, a }
}

/** Deep copy — paints/profiles are never shared between nodes or UI state. */
export function cloneStyle(style: Style): Style {
  return JSON.parse(JSON.stringify(style)) as Style
}

export function defaultStyle(): Style {
  return {
    fill: { type: 'solid', color: rgba(200, 200, 200, 1) },
    stroke: { type: 'solid', color: rgba(30, 30, 30, 1) },
    strokeWidth: 1,
    strokeCap: 'butt',
    strokeJoin: 'miter',
    strokeDash: [],
    fillRule: 'nonzero',
  }
}

/** Overridable BaseNode fields shared by every factory. */
export interface BaseOverrides {
  id?: string
  name?: string
  transform?: Mat
  style?: Style
  opacity?: number
  locked?: boolean
  hidden?: boolean
}

function base(type: SceneNode['type'], defaultName: string, o: BaseOverrides): BaseNode {
  return {
    id: o.id ?? nanoid(),
    type,
    name: o.name ?? defaultName,
    parent: null,
    transform: o.transform ? ([...o.transform] as Mat) : ([...IDENTITY] as Mat),
    style: o.style ?? defaultStyle(),
    opacity: o.opacity ?? 1,
    blendMode: 'normal',
    locked: o.locked ?? false,
    hidden: o.hidden ?? false,
  }
}

export function createRectNode(
  params: { x: number; y: number; w: number; h: number; rx?: number; ry?: number },
  overrides: BaseOverrides = {},
): RectNode {
  return {
    ...base('rect', 'Rectangle', overrides),
    type: 'rect',
    x: params.x,
    y: params.y,
    w: params.w,
    h: params.h,
    rx: params.rx ?? 0,
    ry: params.ry ?? params.rx ?? 0,
  }
}

export function createEllipseNode(
  params: { cx: number; cy: number; rx: number; ry: number },
  overrides: BaseOverrides = {},
): EllipseNode {
  return { ...base('ellipse', 'Ellipse', overrides), type: 'ellipse', ...params }
}

export function createPolygonNode(
  params: { cx: number; cy: number; radius: number; sides: number; angle?: number },
  overrides: BaseOverrides = {},
): PolygonNode {
  return {
    ...base('polygon', 'Polygon', overrides),
    type: 'polygon',
    cx: params.cx,
    cy: params.cy,
    radius: params.radius,
    sides: params.sides,
    angle: params.angle ?? 0,
  }
}

export function createStarNode(
  params: {
    cx: number
    cy: number
    outerRadius: number
    innerRadius: number
    points: number
    angle?: number
  },
  overrides: BaseOverrides = {},
): StarNode {
  return {
    ...base('star', 'Star', overrides),
    type: 'star',
    cx: params.cx,
    cy: params.cy,
    outerRadius: params.outerRadius,
    innerRadius: params.innerRadius,
    points: params.points,
    angle: params.angle ?? 0,
  }
}

export function createLineNode(
  params: { x1: number; y1: number; x2: number; y2: number },
  overrides: BaseOverrides = {},
): LineNode {
  const node = { ...base('line', 'Line', overrides), type: 'line' as const, ...params }
  // Lines have no interior; default to stroke-only unless a style was supplied.
  if (!overrides.style) node.style.fill = null
  return node
}

export function createPathNode(subpaths: SubPath[], overrides: BaseOverrides = {}): PathNode {
  return { ...base('path', 'Path', overrides), type: 'path', subpaths }
}

export function createGroupNode(
  overrides: BaseOverrides & { isLayer?: boolean } = {},
): GroupNode {
  const node: GroupNode = {
    ...base('group', overrides.isLayer ? 'Layer' : 'Group', overrides),
    type: 'group',
    children: [],
  }
  if (overrides.isLayer) node.isLayer = true
  // Groups paint nothing themselves (unless a style was explicitly supplied).
  if (!overrides.style) {
    node.style.fill = null
    node.style.stroke = null
  }
  return node
}

export interface TextParams {
  text: string
  fontFamily?: string
  fontSize?: number
  fontWeight?: number
  textAlign?: TextNode['textAlign']
  leading?: number
  kind?: 'point' | 'area'
  width?: number
  height?: number
  tracking?: number
  kerning?: boolean
  vertical?: boolean
  textPath?: SubPath[]
  pathStartOffset?: number
}

export function createTextNode(params: TextParams, overrides: BaseOverrides = {}): TextNode {
  const node: TextNode = {
    ...base('text', 'Text', overrides),
    type: 'text',
    text: params.text,
    fontFamily: params.fontFamily ?? 'Inter',
    fontSize: params.fontSize ?? 24,
    fontWeight: params.fontWeight ?? 400,
    textAlign: params.textAlign ?? 'left',
    leading: params.leading ?? 1.2,
  }
  if (params.kind) node.kind = params.kind
  if (params.width !== undefined) node.width = params.width
  if (params.height !== undefined) node.height = params.height
  if (params.tracking !== undefined) node.tracking = params.tracking
  if (params.kerning !== undefined) node.kerning = params.kerning
  if (params.vertical) node.vertical = true
  if (params.textPath) node.textPath = params.textPath
  if (params.pathStartOffset !== undefined) node.pathStartOffset = params.pathStartOffset
  // Text defaults to a solid dark fill, no stroke (unless a style was given).
  if (!overrides.style) {
    node.style.fill = { type: 'solid', color: rgba(20, 20, 20, 1) }
    node.style.stroke = null
  }
  return node
}

/**
 * LOCAL-space subpaths for any drawable (non-group, non-text) node.
 * Parametric shapes derive fresh subpaths from their params; PathNodes return
 * their stored subpaths as-is (same references — copy before mutating).
 */
export function toSubPaths(node: ShapeNode | PathNode): SubPath[] {
  switch (node.type) {
    case 'rect':
      return rectToPath(node.x, node.y, node.w, node.h, node.rx, node.ry)
    case 'ellipse':
      return ellipseToPath(node.cx, node.cy, node.rx, node.ry)
    case 'polygon':
      return polygonToPath(node.cx, node.cy, node.radius, node.sides, node.angle)
    case 'star':
      return starToPath(node.cx, node.cy, node.outerRadius, node.innerRadius, node.points, node.angle)
    case 'line':
      return lineToPath(node.x1, node.y1, node.x2, node.y2)
    case 'path':
      return node.subpaths
  }
}

/**
 * "Convert to Path": bake shape params into local-space anchors, PRESERVING
 * the node's id, transform, style, and tree fields. The document swap
 * (replacing the node in `nodes`) is the caller's job (a store command in a
 * later phase).
 */
export function convertToPath(node: ShapeNode | PathNode): PathNode {
  if (node.type === 'path') return node
  const { id, name, parent, transform, style, opacity, blendMode, locked, hidden, clip } = node
  const pathNode: PathNode = {
    id,
    type: 'path',
    name,
    parent,
    transform,
    style,
    opacity,
    blendMode,
    locked,
    hidden,
    subpaths: toSubPaths(node),
  }
  if (clip !== undefined) pathNode.clip = clip
  return pathNode
}
