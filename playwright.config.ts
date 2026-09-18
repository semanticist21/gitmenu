// End-to-end checks against the mocked UI (no Rust backend): menus and shortcuts must match
// the command registry. Uses the installed Google Chrome.
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  use: {
    baseURL: 'http://127.0.0.1:1421',
    launchOptions: { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' },
    viewport: { width: 360, height: 800 },
  },
  webServer: { command: 'VITE_MOCK=1 bunx vite --host 127.0.0.1 --port 1421 --strictPort', url: 'http://127.0.0.1:1421', reuseExistingServer: false },
})
