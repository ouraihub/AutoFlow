import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

// The admin UI is a static SPA under ui/, built to ui/dist and served by the Worker's static assets.
export default defineConfig({
  root: 'ui',
  plugins: [tailwindcss(), svelte({ configFile: fileURLToPath(new URL('./svelte.config.js', import.meta.url)) })],
  resolve: { alias: { $lib: fileURLToPath(new URL('./ui/src/lib', import.meta.url)) } },
  build: { outDir: 'dist', emptyOutDir: true },
  server: { proxy: { '/api': 'http://localhost:8787' } },
})
