/**
 * Minimal ambient declaration for bezier-js@6 (the package ships no types).
 * Only the surface consumed by src/geometry/bezier.ts is declared — bezier-js
 * types must NOT leak outside that wrapper.
 */
declare module 'bezier-js' {
  export interface BezierXY {
    x: number
    y: number
  }

  export interface BezierProjection extends BezierXY {
    t: number
    /** Distance from the queried point. */
    d: number
  }

  export interface BezierMinMax {
    min: number
    max: number
    mid: number
    size: number
  }

  export class Bezier {
    constructor(coords: BezierXY[])
    points: BezierXY[]
    get(t: number): BezierXY
    split(t: number): { left: Bezier; right: Bezier }
    bbox(): { x: BezierMinMax; y: BezierMinMax }
    length(): number
    project(point: BezierXY): BezierProjection
  }
}
