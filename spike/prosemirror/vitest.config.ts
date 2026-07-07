import { defineConfig } from 'vite'

// Separate from vite.config.ts to keep the app build config minimal.
// This spike's real work happens in headless vitest tests (jsdom env),
// not in the React app itself.
export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: false,
    include: ['tests/**/*.test.ts'],
  },
})
