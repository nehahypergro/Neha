import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API = process.env.API_URL || 'http://localhost:8787';
export default defineConfig({
  root: 'web',
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': API, '/bundles': API, '/illustrator': API, '/docs': API, '/review': API } },
  build: { outDir: '../dist', emptyOutDir: true },
});
