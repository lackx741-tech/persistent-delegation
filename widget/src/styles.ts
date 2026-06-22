// ============================================================
//  EIP-7702 Delegation Widget — CDN-embeddable SaaS widget
//  Drop-in: <script src="delegation-widget.js" data-relayer="..."></script>
// ============================================================

export const WIDGET_CSS = `
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;600;700&display=swap');

:host {
  all: initial;
  font-family: 'JetBrains Mono', 'Courier New', monospace;
}

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --g: #39ff85;
  --g2: #00d4a8;
  --b: #7dffef;
  --amber: #ffa826;
  --red: #ff4b5c;
  --bg: #06080a;
  --bg2: #0c1014;
  --bg3: #111820;
  --border: rgba(57,255,133,0.18);
  --border2: rgba(57,255,133,0.08);
  --text: #c8e6d4;
  --text2: #5a8a6a;
  --text3: rgba(57,255,133,0.4);
}

/* ── LAUNCHER BUTTON ── */
.w-launcher {
  position: fixed;
  bottom: 28px;
  right: 28px;
  z-index: 2147483646;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  user-select: none;
  transition: transform 0.2s cubic-bezier(0.34,1.56,0.64,1);
}
.w-launcher:hover { transform: scale(1.08); }
.w-launcher.open { transform: scale(0.9) translateY(4px); }

.w-orb {
  position: relative;
  width: 52px;
  height: 52px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.w-orb-inner {
  width: 52px;
  height: 52px;
  background: linear-gradient(135deg, #0c1f14 0%, #071209 100%);
  border: 1.5px solid var(--g);
  border-radius: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 0 20px rgba(57,255,133,0.3), inset 0 0 12px rgba(57,255,133,0.08);
  position: relative;
  z-index: 2;
  transition: box-shadow 0.3s;
}
.w-orb-inner:hover {
  box-shadow: 0 0 30px rgba(57,255,133,0.5), inset 0 0 20px rgba(57,255,133,0.15);
}

.w-orb-glyph {
  font-size: 20px;
  color: var(--g);
  filter: drop-shadow(0 0 6px var(--g));
  font-weight: 700;
  line-height: 1;
  letter-spacing: -0.03em;
}

.w-pulse-ring {
  position: absolute;
  inset: -4px;
  border-radius: 17px;
  border: 1px solid var(--g);
  opacity: 0;
  animation: pulse-ring 3s ease-out infinite;
}
.w-pulse-ring:nth-child(2) { animation-delay: 1s; }
.w-pulse-ring:nth-child(3) { animation-delay: 2s; }

@keyframes pulse-ring {
  0%   { opacity: 0.6; transform: scale(1); }
  100% { opacity: 0; transform: scale(1.7); }
}

.w-badge {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: var(--g);
  text-shadow: 0 0 8px var(--g);
  opacity: 0.8;
}

/* ── NOTIFICATION DOT ── */
.w-notif {
  position: absolute;
  top: -3px;
  right: -3px;
  width: 10px;
  height: 10px;
  background: var(--amber);
  border-radius: 50%;
  border: 1.5px solid var(--bg);
  box-shadow: 0 0 6px var(--amber);
  animation: notif-pulse 1.5s ease-in-out infinite;
  z-index: 3;
  display: none;
}
.w-notif.visible { display: block; }

@keyframes notif-pulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.3); opacity: 0.7; }
}

/* ── PANEL ── */
.w-panel {
  position: fixed;
  bottom: 96px;
  right: 28px;
  width: 360px;
  max-height: 640px;
  z-index: 2147483645;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 16px;
  overflow: hidden;
  box-shadow:
    0 0 0 1px rgba(57,255,133,0.05),
    0 24px 80px rgba(0,0,0,0.7),
    0 0 60px rgba(57,255,133,0.08);
  transform-origin: bottom right;
  transform: scale(0.88) translateY(12px);
  opacity: 0;
  pointer-events: none;
  transition: transform 0.35s cubic-bezier(0.34,1.2,0.64,1), opacity 0.25s ease;
  display: flex;
  flex-direction: column;
}

.w-panel.visible {
  transform: scale(1) translateY(0);
  opacity: 1;
  pointer-events: all;
}

/* ── PANEL HEADER ── */
.w-header {
  position: relative;
  padding: 18px 20px 16px;
  background: var(--bg2);
  border-bottom: 1px solid var(--border2);
  overflow: hidden;
  flex-shrink: 0;
}

.w-circuit {
  position: absolute;
  inset: 0;
  opacity: 0.06;
  background-image:
    linear-gradient(var(--g) 1px, transparent 1px),
    linear-gradient(90deg, var(--g) 1px, transparent 1px);
  background-size: 24px 24px;
}
.w-circuit::after {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(ellipse at 20% 50%, rgba(57,255,133,0.15), transparent 60%);
}

.w-header-top {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}

.w-logo-wrap { display: flex; flex-direction: column; gap: 2px; }

.w-logo {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 700;
  color: var(--g);
  letter-spacing: 0.06em;
  text-shadow: 0 0 10px rgba(57,255,133,0.5);
}

.w-logo-hex { font-size: 16px; }

.w-tagline {
  font-size: 9px;
  font-weight: 400;
  color: var(--text2);
  letter-spacing: 0.15em;
  text-transform: uppercase;
}

.w-close {
  background: none;
  border: 1px solid var(--border2);
  color: var(--text2);
  width: 28px;
  height: 28px;
  border-radius: 8px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  transition: all 0.15s;
  font-family: inherit;
  flex-shrink: 0;
}
.w-close:hover { border-color: var(--border); color: var(--text); background: rgba(57,255,133,0.06); }

/* chain + wallet status bar */
.w-status-bar {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--border2);
}

.w-chain-pill {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  background: rgba(57,255,133,0.06);
  border: 1px solid var(--border2);
  border-radius: 20px;
  font-size: 9px;
  font-weight: 600;
  color: var(--text2);
  letter-spacing: 0.1em;
}

.w-chain-dot {
  width: 6px;
  height: 6px;
  background: var(--g);
  border-radius: 50%;
  box-shadow: 0 0 5px var(--g);
  flex-shrink: 0;
}

.w-address-bar {
  flex: 1;
  font-size: 10px;
  color: var(--text2);
  letter-spacing: 0.04em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ── PANEL BODY ── */
.w-body {
  overflow-y: auto;
  flex: 1;
  scrollbar-width: thin;
  scrollbar-color: var(--border) transparent;
}

.w-body::-webkit-scrollbar { width: 4px; }
.w-body::-webkit-scrollbar-track { background: transparent; }
.w-body::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }

/* ── SECTION ── */
.w-section {
  padding: 14px 20px;
  border-bottom: 1px solid var(--border2);
  transition: background 0.2s;
}
.w-section:last-of-type { border-bottom: none; }

.w-section-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.2em;
  color: var(--text2);
  text-transform: uppercase;
  margin-bottom: 12px;
}

.w-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text2);
  flex-shrink: 0;
}
.w-dot.on { background: var(--g); box-shadow: 0 0 6px var(--g); }
.w-dot.amber { background: var(--amber); box-shadow: 0 0 6px var(--amber); }
.w-dot.red { background: var(--red); box-shadow: 0 0 6px var(--red); }
.w-dot.pulse { animation: dot-pulse 1.5s ease-in-out infinite; }

@keyframes dot-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}

/* ── WALLET SECTION ── */
.w-wallet-info {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.w-full-address {
  font-size: 10px;
  color: var(--text);
  letter-spacing: 0.05em;
  word-break: break-all;
  line-height: 1.5;
  padding: 8px 10px;
  background: var(--bg2);
  border: 1px solid var(--border2);
  border-radius: 8px;
}

.w-balance-row {
  display: flex;
  gap: 8px;
}

.w-balance-chip {
  flex: 1;
  padding: 6px 10px;
  background: rgba(57,255,133,0.04);
  border: 1px solid var(--border2);
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.w-balance-label { font-size: 8px; color: var(--text2); letter-spacing: 0.12em; }
.w-balance-value { font-size: 12px; font-weight: 600; color: var(--g); }

/* ── DELEGATION STATUS ── */
.w-delegation-status {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background: var(--bg2);
  border: 1px solid var(--border2);
  border-radius: 10px;
  margin-bottom: 10px;
}

.w-delegation-text {
  flex: 1;
  font-size: 10px;
  color: var(--text);
  line-height: 1.4;
}

.w-delegation-sub {
  font-size: 9px;
  color: var(--text2);
  letter-spacing: 0.06em;
  margin-top: 2px;
}

/* ── TOGGLE ── */
.w-toggle-wrap {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.w-toggle-label {
  font-size: 10px;
  color: var(--text);
  letter-spacing: 0.05em;
}

.w-toggle {
  width: 42px;
  height: 22px;
  background: var(--bg3);
  border: 1px solid var(--border);
  border-radius: 11px;
  cursor: pointer;
  position: relative;
  transition: all 0.25s;
}

.w-toggle.on {
  background: rgba(57,255,133,0.15);
  border-color: var(--g);
  box-shadow: 0 0 10px rgba(57,255,133,0.2);
}

.w-toggle-thumb {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 14px;
  height: 14px;
  background: var(--text2);
  border-radius: 50%;
  transition: all 0.25s cubic-bezier(0.34,1.56,0.64,1);
}

.w-toggle.on .w-toggle-thumb {
  transform: translateX(20px);
  background: var(--g);
  box-shadow: 0 0 8px var(--g);
}

.w-sweep-config {
  overflow: hidden;
  max-height: 0;
  transition: max-height 0.3s ease;
}
.w-sweep-config.open { max-height: 200px; }

/* ── INPUTS ── */
.w-input-group {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-bottom: 8px;
}

.w-input-group label {
  font-size: 8px;
  font-weight: 600;
  color: var(--text2);
  letter-spacing: 0.18em;
}

.w-input {
  width: 100%;
  background: var(--bg2);
  border: 1px solid var(--border2);
  border-radius: 8px;
  padding: 8px 12px;
  color: var(--text);
  font-family: 'JetBrains Mono', monospace;
  font-size: 10px;
  letter-spacing: 0.04em;
  outline: none;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.w-input:focus {
  border-color: var(--g);
  box-shadow: 0 0 0 3px rgba(57,255,133,0.08);
}

.w-input::placeholder { color: var(--text2); opacity: 0.5; }

/* ── BUTTONS ── */
.w-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 9px 16px;
  border-radius: 9px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.12em;
  cursor: pointer;
  border: none;
  transition: all 0.18s;
  text-transform: uppercase;
  white-space: nowrap;
  position: relative;
  overflow: hidden;
}

.w-btn::after {
  content: '';
  position: absolute;
  inset: 0;
  background: white;
  opacity: 0;
  transition: opacity 0.15s;
}
.w-btn:active::after { opacity: 0.06; }

.w-btn-primary {
  background: var(--g);
  color: #050d08;
  box-shadow: 0 4px 16px rgba(57,255,133,0.25), 0 0 0 0 rgba(57,255,133,0);
}
.w-btn-primary:hover {
  box-shadow: 0 4px 24px rgba(57,255,133,0.4), 0 0 0 3px rgba(57,255,133,0.15);
  transform: translateY(-1px);
}
.w-btn-primary:disabled { opacity: 0.4; pointer-events: none; }

.w-btn-secondary {
  background: rgba(57,255,133,0.08);
  color: var(--g);
  border: 1px solid var(--border);
}
.w-btn-secondary:hover {
  background: rgba(57,255,133,0.14);
  border-color: var(--g);
  box-shadow: 0 0 12px rgba(57,255,133,0.15);
}

.w-btn-ghost {
  background: transparent;
  color: var(--text2);
  border: 1px solid var(--border2);
  font-size: 9px;
}
.w-btn-ghost:hover { color: var(--text); border-color: var(--border); }

.w-btn-danger {
  background: rgba(255,75,92,0.1);
  color: var(--red);
  border: 1px solid rgba(255,75,92,0.25);
}
.w-btn-danger:hover { background: rgba(255,75,92,0.18); }

.w-btn-full { width: 100%; }

/* ── ACTIONS ROW ── */
.w-actions {
  display: flex;
  gap: 8px;
  padding: 14px 20px;
  border-top: 1px solid var(--border2);
  flex-wrap: wrap;
}

/* ── EXECUTE SECTION ── */
.w-calls-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 10px;
}

.w-call-row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 6px;
  align-items: start;
}

.w-call-inputs {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.w-remove-call {
  background: none;
  border: 1px solid rgba(255,75,92,0.2);
  color: var(--red);
  width: 26px;
  height: 26px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 11px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: 2px;
  transition: all 0.15s;
  font-family: inherit;
}
.w-remove-call:hover { background: rgba(255,75,92,0.1); border-color: var(--red); }

.w-add-call-row {
  display: flex;
  gap: 8px;
  margin-bottom: 10px;
}

/* ── FOOTER ── */
.w-footer {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 10px 20px 14px;
  gap: 8px;
}

.w-footer-text {
  font-size: 8px;
  color: var(--text3);
  letter-spacing: 0.14em;
  text-align: center;
}

.w-footer-dot { color: var(--text3); }

/* ── TOAST ── */
.w-toast-wrap {
  position: fixed;
  bottom: 96px;
  right: 28px;
  z-index: 2147483647;
  display: flex;
  flex-direction: column;
  gap: 8px;
  pointer-events: none;
  max-width: 360px;
}

.w-toast {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 16px;
  background: var(--bg2);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.5), 0 0 20px rgba(57,255,133,0.06);
  pointer-events: all;
  animation: toast-in 0.3s cubic-bezier(0.34,1.2,0.64,1) forwards;
}

.w-toast.error { border-color: rgba(255,75,92,0.35); }
.w-toast.warn  { border-color: rgba(255,168,38,0.35); }

.w-toast-icon { font-size: 14px; flex-shrink: 0; margin-top: 1px; }
.w-toast-body { flex: 1; }
.w-toast-title { font-size: 10px; font-weight: 700; color: var(--text); letter-spacing: 0.06em; margin-bottom: 2px; }
.w-toast-msg   { font-size: 9px; color: var(--text2); letter-spacing: 0.04em; line-height: 1.4; }

@keyframes toast-in {
  from { opacity: 0; transform: translateX(20px); }
  to   { opacity: 1; transform: translateX(0); }
}

/* ── LOADING SPINNER ── */
.w-spinner {
  width: 12px;
  height: 12px;
  border: 1.5px solid rgba(57,255,133,0.2);
  border-top-color: var(--g);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
  display: inline-block;
}

@keyframes spin { to { transform: rotate(360deg); } }

/* ── TX HASH ── */
.w-tx-hash {
  font-size: 9px;
  color: var(--text2);
  word-break: break-all;
  padding: 6px 10px;
  background: var(--bg2);
  border: 1px solid var(--border2);
  border-radius: 6px;
  margin-top: 8px;
  line-height: 1.5;
  letter-spacing: 0.04em;
}

/* ── STATS ROW ── */
.w-stats {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 6px;
  margin-bottom: 12px;
}

.w-stat {
  padding: 8px 10px;
  background: var(--bg2);
  border: 1px solid var(--border2);
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.w-stat-label { font-size: 7.5px; color: var(--text2); letter-spacing: 0.14em; text-transform: uppercase; }
.w-stat-value { font-size: 13px; font-weight: 700; color: var(--g); }

/* ── SCANLINE OVERLAY ── */
.w-scan {
  position: absolute;
  inset: 0;
  background: repeating-linear-gradient(
    0deg,
    transparent,
    transparent 2px,
    rgba(0,0,0,0.03) 2px,
    rgba(0,0,0,0.03) 4px
  );
  pointer-events: none;
  z-index: 0;
}

/* ── RESPONSIVE ── */
@media (max-width: 420px) {
  .w-panel { right: 8px; left: 8px; width: auto; }
  .w-launcher { right: 16px; bottom: 16px; }
  .w-toast-wrap { right: 8px; left: 8px; }
}
`
