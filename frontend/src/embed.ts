/**
 * Embed entry point — mounts the Persistent Delegation widget
 * into any webpage via a single <script src="script.js"> tag.
 *
 * Usage in any HTML page:
 *   <div id="persistent-delegation-root"></div>
 *   <script src="script.js"></script>
 *
 * Or auto-inject with no markup needed:
 *   <script src="script.js" data-relayer="https://your-relayer.com"></script>
 */

import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import './App.css'

function mount() {
  // Allow config via data attributes on the script tag
  const scriptTag = document.currentScript as HTMLScriptElement | null
  const relayerUrl = scriptTag?.dataset.relayer
  if (relayerUrl) {
    // Override relayer URL at runtime (no rebuild needed)
    ;(window as unknown as Record<string, unknown>).__RELAYER_URL__ = relayerUrl
  }

  // Find or create the mount point
  let root = document.getElementById('persistent-delegation-root')
  if (!root) {
    root = document.createElement('div')
    root.id = 'persistent-delegation-root'
    document.body.appendChild(root)
  }

  ReactDOM.createRoot(root).render(
    React.createElement(React.StrictMode, null, React.createElement(App))
  )
}

// Mount immediately if DOM ready, otherwise wait
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount)
} else {
  mount()
}
