import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { licenses, workerLicenses } from './scripts/licenses/licenses'

// Tauri expects a fixed dev port and must not clear its own output
export default defineConfig({
  plugins: [react(), tailwindcss(), licenses()],
  // ES workers split Shiki's grammars into chunks loaded per language
  worker: { format: 'es', plugins: () => workerLicenses() },
  // The dependency scan does not follow `new Worker(new URL(...))`; without the workers as
  // entries, the first diff view finds Shiki late and the dev server reloads every open page
  optimizeDeps: { entries: ['index.html', 'src/workers/*.worker.ts'] },
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  clearScreen: false,
  server: { port: 1420, strictPort: true, watch: { ignored: ['**/src-tauri/**'] } },
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  build: { target: 'safari16', sourcemap: false },
})
