// ── Entry point — auto-initialises from <script data-*> attributes ──
import { DelegationWidget } from './widget'
export type { WidgetConfig } from './widget'

declare global {
  interface Window {
    DelegationWidget: {
      init: (cfg?: import('./widget').WidgetConfig) => DelegationWidget
      instance?: DelegationWidget
    }
  }
}

window.DelegationWidget = {
  init(cfg = {}) {
    if (window.DelegationWidget.instance) return window.DelegationWidget.instance
    const inst = new DelegationWidget(cfg)
    window.DelegationWidget.instance = inst
    // expose togglePanel for external callers (e.g. nav button)
    ;(window as unknown as Record<string, unknown>)['__delegationToggle'] = () => inst.open()
    return inst
  },
}

// Auto-init from <script> tag attributes
function autoInit() {
  const scripts = document.querySelectorAll<HTMLScriptElement>(
    'script[src*="delegation-widget"]'
  )
  const tag = scripts[scripts.length - 1]
  if (!tag) return

  const relayerUrl = tag.dataset.relayer ?? tag.getAttribute('data-relayer') ?? undefined
  const position   = (tag.dataset.position ?? 'bottom-right') as 'bottom-right' | 'bottom-left'
  const chainName  = tag.dataset.chain ?? undefined

  window.DelegationWidget.init({ relayerUrl, position, chainName })
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', autoInit)
} else {
  autoInit()
}

export { DelegationWidget }
