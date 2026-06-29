import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// GitHub Pages(project site)는 /modoo-bom/ 하위에 서빙되므로 빌드 시 base를 맞춘다.
// 개발 서버는 루트('/')를 사용.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/modoo-bom/' : '/',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    target: 'es2020',
    cssCodeSplit: true,
    rollupOptions: {
      output: {
        // 3D/애니메이션 라이브러리는 별도 청크로 분리 → 초기 로딩 가볍게, 캐시 효율↑
        manualChunks: {
          three: ['three', '@react-three/fiber', '@react-three/drei'],
          motion: ['framer-motion'],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8000',
      '/ws': { target: 'ws://localhost:8000', ws: true },
    },
  },
}))
