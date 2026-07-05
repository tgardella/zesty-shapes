/**
 * SnapEngine: runs every registered provider's snappers in order, threading
 * the point through each and collecting guides. Providers are the growth
 * seam — future smart-guide snapping registers a provider; nothing else
 * changes (see SnapProvider in types.ts).
 */

import type { Vec2 } from '../geometry/vec2'
import type { SnapGuide, SnapProvider, SnapQuery, SnapResult, SnapSettings } from './types'
import { angleSnapper, gridSnapper } from './snappers'

export class SnapEngine {
  private providers: SnapProvider[] = []

  registerProvider(provider: SnapProvider): void {
    this.providers.push(provider)
  }

  unregisterProvider(id: string): void {
    this.providers = this.providers.filter((p) => p.id !== id)
  }

  snap(point: Vec2, query: SnapQuery, settings: SnapSettings): SnapResult {
    let current = point
    const guides: SnapGuide[] = []
    for (const provider of this.providers) {
      for (const snapper of provider.getSnappers()) {
        const result = snapper.snap(current, query, settings)
        if (result) {
          current = result.point
          guides.push(...result.guides)
        }
      }
    }
    return { point: current, guides }
  }
}

/** Grid first, angle last — the Shift constraint must win over grid pull. */
export function createDefaultSnapEngine(): SnapEngine {
  const engine = new SnapEngine()
  engine.registerProvider({
    id: 'core',
    getSnappers: () => [gridSnapper, angleSnapper],
  })
  return engine
}
