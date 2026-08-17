import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// Backend target for /api and /socket.io proxying. Defaults to the dev client's
// server port (3456); run.bat sets TIANSHU_SERVER_PORT to its own isolated port
// so both stacks can proxy to their own server.
const serverPort = process.env.TIANSHU_SERVER_PORT || '3456'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': `http://127.0.0.1:${serverPort}`,
      '/socket.io': {
        target: `http://127.0.0.1:${serverPort}`,
        ws: true,
      },
    },
  },
})
