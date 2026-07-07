/**
 * Artboard commands: undoable mutations of document.artboards (the Shift+O
 * tool and the export dialog build on these). Artboards live in the document
 * slice, so patch-based undo/redo and transaction coalescing apply exactly
 * like node commands — one artboard drag is ONE undo step.
 */

import { nanoid } from 'nanoid'
import type { Artboard, ArtboardId } from '../model/types'
import type { EditorStoreApi } from './store'

/** Smallest artboard the tool will create/resize to (doc units). */
export const MIN_ARTBOARD_SIZE = 16

function nextArtboardName(artboards: Artboard[]): string {
  let n = artboards.length + 1
  const names = new Set(artboards.map((ab) => ab.name))
  while (names.has(`Artboard ${n}`)) n++
  return `Artboard ${n}`
}

export function cmdAddArtboard(
  store: EditorStoreApi,
  rect: { x: number; y: number; w: number; h: number },
): ArtboardId {
  const id = nanoid()
  store.getState().applyCommand('Add Artboard', (doc) => {
    doc.artboards.push({
      id,
      name: nextArtboardName(doc.artboards),
      x: rect.x,
      y: rect.y,
      w: Math.max(MIN_ARTBOARD_SIZE, rect.w),
      h: Math.max(MIN_ARTBOARD_SIZE, rect.h),
    })
  })
  return id
}

/** Move/resize/rename; used inside a transaction during drags. */
export function cmdUpdateArtboard(
  store: EditorStoreApi,
  id: ArtboardId,
  label: string,
  mutate: (ab: Artboard) => void,
): void {
  store.getState().applyCommand(label, (doc) => {
    const ab = doc.artboards.find((a) => a.id === id)
    if (!ab) return
    mutate(ab)
    ab.w = Math.max(MIN_ARTBOARD_SIZE, ab.w)
    ab.h = Math.max(MIN_ARTBOARD_SIZE, ab.h)
  })
}

/** Duplicate the artboard frame, offset just right of the source. */
export function cmdDuplicateArtboard(store: EditorStoreApi, id: ArtboardId): ArtboardId | null {
  const src = store.getState().document.artboards.find((a) => a.id === id)
  if (!src) return null
  const newId = nanoid()
  store.getState().applyCommand('Duplicate Artboard', (doc) => {
    const from = doc.artboards.find((a) => a.id === id)
    if (!from) return
    doc.artboards.push({
      id: newId,
      name: nextArtboardName(doc.artboards),
      x: from.x + from.w + 20,
      y: from.y,
      w: from.w,
      h: from.h,
    })
  })
  return newId
}

/** Delete an artboard. The LAST artboard is kept (the document requires one). */
export function cmdDeleteArtboard(store: EditorStoreApi, id: ArtboardId): boolean {
  const { artboards } = store.getState().document
  if (artboards.length <= 1 || !artboards.some((a) => a.id === id)) return false
  store.getState().applyCommand('Delete Artboard', (doc) => {
    doc.artboards = doc.artboards.filter((a) => a.id !== id)
  })
  return true
}
