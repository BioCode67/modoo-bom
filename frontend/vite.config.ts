import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'

// GitHub Pages(project site)는 /modoo-bom/ 하위에 서빙되므로 빌드 시 base를 맞춘다.
// 개발 서버는 루트('/')를 사용.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/modoo-bom/' : '/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // og.png는 소셜 크롤러가 절대 URL로 직접 가져가므로 오프라인 precache에서 제외(설치 용량 절감).
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      // 해시 자산만 precache(안전), 새 배포 시 자동 갱신. policies.json은 항상 네트워크 우선.
      workbox: {
        cleanupOutdatedCaches: true,
        navigateFallbackDenylist: [/policies\.json$/],
        runtimeCaching: [
          {
            urlPattern: /policies\.json$/,
            handler: 'NetworkFirst',
            options: { cacheName: 'policies', expiration: { maxEntries: 2, maxAgeSeconds: 86400 } },
          },
        ],
      },
      manifest: {
        name: '모두봄 — 내 복지 혜택 찾기',
        short_name: '모두봄',
        description: 'AI가 찾아주는 맞춤 복지. 확인부터 신청·관리까지.',
        theme_color: '#22c55e',
        background_color: '#fffaf3',
        display: 'standalone',
        lang: 'ko',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
    }),
  ],
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
