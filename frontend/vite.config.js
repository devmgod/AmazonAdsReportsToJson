import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0', // Listen on all network interfaces
    port: 5173,
    strictPort: false, // Allow port fallback if 5173 is taken
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        secure: false,
      },
      '/amazon-lwa': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        secure: false,
      },
      '/amazon-ads': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        secure: false,
      },
      '/amazon-sp-api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        secure: false,
      },
      '/db': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        secure: false,
      },
      '/ai': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        secure: false,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Split React and React-DOM into separate chunk
          'react-vendor': ['react', 'react-dom'],
          // Split charting library into separate chunk
          'charts-vendor': ['recharts'],
          // Split HTTP client into separate chunk
          'http-vendor': ['axios'],
        },
      },
    },
    // Increase chunk size warning limit to 1000 KB (optional)
    chunkSizeWarningLimit: 1000,
  },
})
