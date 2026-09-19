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
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  clearScreen: false,
  server: { port: 1420, strictPort: true, watch: { ignored: ['**/src-tauri/**'] } },
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  build: { target: 'safari16', sourcemap: false },
})
