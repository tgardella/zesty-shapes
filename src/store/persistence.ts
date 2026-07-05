/**
 * Wires the 0a localStorage API into the live store: debounced autosave on
 * document changes + flush on unload. (Load-on-boot happens in store.ts when
 * the singleton is created.)
 */

import { createAutosaver } from '../model/serialize'
import type { EditorStoreApi } from './store'

export function initPersistence(store: EditorStoreApi): () => void {
  const autosaver = createAutosaver(() => store.getState().document, { delayMs: 800 })
  const unsubscribe = store.subscribe((state, prev) => {
    if (state.document !== prev.document) autosaver.schedule()
  })
  const onBeforeUnload = (): void => autosaver.flush()
  window.addEventListener('beforeunload', onBeforeUnload)
  return () => {
    autosaver.flush()
    unsubscribe()
    window.removeEventListener('beforeunload', onBeforeUnload)
  }
}
