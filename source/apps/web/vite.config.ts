import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [react(), tailwindcss(), VitePWA({
    registerType: 'prompt',
    injectRegister: 'auto',
    includeAssets: ['icon.svg'],
    manifest: {
      name: 'LabCopilot laboratory workspace', short_name: 'LabCopilot',
      description: 'Synthetic laboratory workflow foundation',
      theme_color: '#0d635f', background_color: '#f5f7fa',
      display: 'standalone', start_url: '/',
      icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
    },
    workbox: {
      globPatterns: ['**/*.{js,css,html,svg,woff2}'],
      navigateFallbackDenylist: [/^\/api(?:\/|$)/],
      runtimeCaching: [],
      cleanupOutdatedCaches: true,
    },
    devOptions: { enabled: false },
  })],
  server: { port: 5173, strictPort: true, proxy: { '/api': 'http://127.0.0.1:3001' } },
  preview: { port: 4173, strictPort: true, proxy: { '/api': 'http://127.0.0.1:3001' } },
  test: {
    environment: 'jsdom', setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'], clearMocks: true,
  },
});
