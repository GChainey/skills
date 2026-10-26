import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The studio builds to dist/ (committed), so running it needs no install: node server.mjs.
// `npm run dev` serves the app with hot reload and sends API and asset requests to the server.
const API = `http://localhost:${process.env.STUDIO_PORT || 4747}`
export default defineConfig({
  root: 'app',
  base: '/',
  plugins: [react()],
  build: { outDir: '../dist', emptyOutDir: true, assetsDir: 'studio-assets' },
  server: { port: 4748, fs: { allow: ['..', '../../tools'] }, proxy: { '/api': API, '^/(?!src/|@|node_modules/).*/assets/.*': API } },
})
