// apps/web/vite.config.ts
// [F-ID: FE-VITE-CONFIG-01]
// @version 1.0.0
// @changelog 1.0.0 — Base Vite + React config. host: true so the dev
//   server is reachable from other devices on the same network.

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
  },
});
