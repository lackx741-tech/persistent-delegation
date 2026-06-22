/**
 * Vite config for building a single self-contained script.js
 * that can be embedded in ANY website.
 *
 * Output: dist-embed/script.js
 *
 * Usage:
 *   npm run build:embed
 *   # Copy dist-embed/script.js to your website and add:
 *   <script src="script.js"></script>
 */
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  define: {
    global: 'globalThis',
    'process.env.NODE_ENV': '"production"',
  },
  build: {
    outDir: 'dist-embed',
    emptyOutDir: true,
    lib: {
      entry: resolve(__dirname, 'src/embed.ts'),
      name: 'PersistentDelegation',
      formats: ['iife'],           // Single self-contained IIFE — no module system needed
      fileName: () => 'script.js', // Always named script.js
    },
    rollupOptions: {
      // Bundle everything — no external deps
      external: [],
      output: {
        // Inline all CSS into the JS (no separate .css file needed)
        inlineDynamicImports: true,
        assetFileNames: (assetInfo) => {
          // Rename style.css to be inlined
          if (assetInfo.name === 'style.css') return 'script.css'
          return assetInfo.name ?? 'asset'
        },
      },
    },
    // Optimise for embedded size
    minify: 'esbuild',
    sourcemap: false,
    cssCodeSplit: false,
    target: 'es2020',
  },
})
