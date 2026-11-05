import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const target = process.env.STUDIO_API_TARGET || 'http://127.0.0.1:3100';
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': target, '/health': target, '/openapi.json': target } },
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        canvasLab: fileURLToPath(new URL('./canvas-lab.html', import.meta.url)),
      },
    },
  },
});
