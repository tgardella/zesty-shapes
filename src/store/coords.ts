/**
 * The screen <-> document coordinate bridge. ALL conversion between screen
 * pixels and document space goes through these two helpers — never inline the
 * math. (document -> local space goes through worldTransform's inverse.)
 *
 * screen = doc * zoom + pan;  doc = (screen - pan) / zoom
 */

import type { Vec2 } from '../geometry/vec2'

export interface ViewportState {
  /** Pan, in screen pixels. */
  tx: number
  ty: number
  /** Uniform zoom factor. */
  zoom: number
}

export const MIN_ZOOM = 0.05
export const MAX_ZOOM = 32

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
}

export function screenToDoc(v: ViewportState, p: Vec2): Vec2 {
  return { x: (p.x - v.tx) / v.zoom, y: (p.y - v.ty) / v.zoom }
}

export function docToScreen(v: ViewportState, p: Vec2): Vec2 {
  return { x: p.x * v.zoom + v.tx, y: p.y * v.zoom + v.ty }
}

/**
 * New pan for a zoom change that keeps the doc point under `screenPoint`
 * fixed on screen (zoom-toward-cursor).
 */
export function zoomedViewport(v: ViewportState, screenPoint: Vec2, newZoom: number): ViewportState {
  const zoom = clampZoom(newZoom)
  const docP = screenToDoc(v, screenPoint)
  return { zoom, tx: screenPoint.x - docP.x * zoom, ty: screenPoint.y - docP.y * zoom }
}
