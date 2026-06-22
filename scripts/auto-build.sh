#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# auto-build.sh — Auto-compile everything and generate script.js
#
# Usage:
#   ./scripts/auto-build.sh           # full build
#   ./scripts/auto-build.sh --watch   # watch mode (rebuilds on file changes)
#   ./scripts/auto-build.sh --test    # build + run e2e test
#
# Outputs:
#   frontend/dist/           — Standard SPA build (serve with any static host)
#   frontend/dist-embed/script.js  — Single embeddable script for any website
# ─────────────────────────────────────────────────────────────────────────────

set -e
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# ── Colours ───────────────────────────────────────────────────────────────────
G='\033[0;32m' R='\033[0;31m' Y='\033[1;33m' C='\033[0;36m' B='\033[1m' W='\033[0m'
ok()  { echo -e "${G}  ✅ $1${W}"; }
err() { echo -e "${R}  ❌ $1${W}"; exit 1; }
inf() { echo -e "${C}  ℹ  $1${W}"; }
hdr() { echo -e "\n${B}${Y}══ $1 ══${W}"; }

echo -e "\n${B}${Y}
╔═══════════════════════════════════════════════════════╗
║   Persistent Delegation — Auto Build System           ║
╚═══════════════════════════════════════════════════════╝${W}"

# ── Parse flags ───────────────────────────────────────────────────────────────
WATCH=false; RUN_TEST=false
for arg in "$@"; do
  [[ "$arg" == "--watch" ]] && WATCH=true
  [[ "$arg" == "--test"  ]] && RUN_TEST=true
done

# ── Step 1: Type-check relayer ────────────────────────────────────────────────
hdr "Step 1: Type-check Relayer"
cd "$ROOT/relayer"
npx tsc --noEmit && ok "Relayer TypeScript OK" || err "Relayer TypeScript errors"

# ── Step 2: Type-check frontend ───────────────────────────────────────────────
hdr "Step 2: Type-check Frontend"
cd "$ROOT/frontend"
npx tsc --noEmit && ok "Frontend TypeScript OK" || err "Frontend TypeScript errors"

# ── Step 3: Build SPA ─────────────────────────────────────────────────────────
hdr "Step 3: Build SPA (dist/)"
cd "$ROOT/frontend"
npx vite build
ok "SPA built → frontend/dist/"

# ── Step 4: Build embeddable script.js ───────────────────────────────────────
hdr "Step 4: Build Embeddable script.js (dist-embed/)"
cd "$ROOT/frontend"
npx vite build --config vite.embed.config.ts
ok "Embeddable script built → frontend/dist-embed/script.js"

# ── Step 5: Show output sizes ─────────────────────────────────────────────────
hdr "Build Output"
echo ""
echo "  SPA (dist/):"
du -sh "$ROOT/frontend/dist" 2>/dev/null | awk '{print "    Total: " $1}'
ls -lh "$ROOT/frontend/dist/assets/"*.js 2>/dev/null | awk '{print "    " $NF ": " $5}' | head -6

echo ""
echo "  Embed (dist-embed/):"
ls -lh "$ROOT/frontend/dist-embed/"*.js 2>/dev/null | awk '{print "    " $NF ": " $5}'
ls -lh "$ROOT/frontend/dist-embed/"*.css 2>/dev/null | awk '{print "    " $NF ": " $5}'

# ── Step 6: Copy script.js to project root for easy access ───────────────────
hdr "Step 6: Publish script.js"
cp "$ROOT/frontend/dist-embed/script.js" "$ROOT/script.js" 2>/dev/null && \
  ok "script.js copied to project root" || inf "No script.js generated (check embed config)"

# ── Step 7: Generate embed snippet ───────────────────────────────────────────
hdr "Step 7: Embed Snippet"
SCRIPT_SIZE=$(du -sh "$ROOT/script.js" 2>/dev/null | cut -f1 || echo "?")
echo ""
echo -e "  ${B}Add to any HTML page:${W}"
echo ""
echo -e "  ${C}<!-- Option A: with a container div -->"
echo -e "  <div id=\"persistent-delegation-root\"></div>"
echo -e "  <script src=\"./script.js\"></script>${W}"
echo ""
echo -e "  ${C}<!-- Option B: auto-inject, custom relayer -->"
echo -e "  <script src=\"./script.js\" data-relayer=\"https://your-relayer.com\"></script>${W}"
echo ""
ok "script.js is ${SCRIPT_SIZE} (embeddable in any site)"

# ── Optional: Run E2E tests ───────────────────────────────────────────────────
if $RUN_TEST; then
  hdr "Step 8: E2E Test Flow"
  cd "$ROOT/relayer"
  npm run test:flow
fi

# ── Watch mode ────────────────────────────────────────────────────────────────
if $WATCH; then
  hdr "Watch Mode — Rebuilding on changes"
  inf "Watching frontend/src/** for changes..."
  cd "$ROOT/frontend"
  # Run SPA watch in background
  npx vite build --watch &
  SPA_PID=$!
  # Run embed watch
  npx vite build --config vite.embed.config.ts --watch &
  EMBED_PID=$!
  trap "kill $SPA_PID $EMBED_PID 2>/dev/null" EXIT
  wait
fi

echo -e "\n${B}${G}Build complete!${W}"
echo -e "  SPA:    ${C}cd frontend && npm run preview${W}"
echo -e "  Embed:  ${C}cp script.js /your/website/${W}"
echo ""
