import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { ensureFontsLoaded } from './rendering/fontKit' // side effect: registers the canvas text measurer
import { registerImportHandlers } from './import/importFiles'
import { editorStore } from './store/store'
import './index.css'

void ensureFontsLoaded() // bundled Inter for rendering + outline conversion
registerImportHandlers(editorStore) // paste / drag-drop of SVG, images, PDFs

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('missing #root element')

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
