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
        // 온디바이스 AI(transformers.js)의 ONNX WASM 등 대용량 파일은 precache 제외
        // (런타임에 CDN에서 로드) — SW 프리캐시 비대화·빌드 실패 방지.
        globIgnores: ['**/*.wasm', '**/ort-*'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        runtimeCaching: [
          {
            // 재방문 즉시(캐시 먼저) + 백그라운드 갱신 — 3.3MB를 매번 기다리지 않는다
            urlPattern: /policies\.json$/,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'policies', expiration: { maxEntries: 2, maxAgeSeconds: 7 * 86400 } },
          },
          {
            // AI 의미검색 벡터(5MB) — 재방문·오프라인 즉시
            urlPattern: /policy-embeddings\.json$/,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'embeddings', expiration: { maxEntries: 2, maxAgeSeconds: 7 * 86400 } },
          },
          {
            // Pretendard 폰트(CDN) — 장기 캐시로 재방문 렌더 가속
            urlPattern: /^https:\/\/cdn\.jsdelivr\.net\/.*pretendard.*\.(css|woff2?)$/,
            handler: 'CacheFirst',
            options: { cacheName: 'fonts', expiration: { maxEntries: 8, maxAgeSeconds: 30 * 86400 } },
          },
        ],
      },
      manifest: {
        id: '/modoo-bom/',
        name: '모두봄 — 내 복지 혜택 찾기',
        short_name: '모두봄',
        description: 'AI가 찾아주는 맞춤 복지. 나이·상황만 알려주면 받을 수 있는 복지를 한 번에 찾아 신청 방법·서류까지 안내해요.',
        theme_color: '#22c55e',
        background_color: '#fffaf3',
        display: 'standalone',
        lang: 'ko',
        categories: ['government', 'finance', 'lifestyle'],
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
        // 홈 아이콘 길게 누르면 나오는 앱 바로가기(딥링크는 App.tsx ?go= 처리)
        shortcuts: [
          { name: '내 복지 찾기', short_name: '복지찾기', url: './?go=analyze' },
          { name: '정책 탐색', short_name: '탐색', url: './?go=explore' },
          { name: '나의 복지', short_name: '나의복지', url: './?go=my' },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  // transformers.js는 dev 사전번들에서 제외(무거운 ONNX 런타임) — 지연 동적 import로만 로드.
  optimizeDeps: {
    exclude: ['@huggingface/transformers'],
  },
  build: {
    target: 'es2020',
    cssCodeSplit: true,
    rollupOptions: {
      output: {
        // 3D/애니메이션 라이브러리는 별도 청크로 분리 → 초기 로딩 가볍게, 캐시 효율↑
        manualChunks: {
          // ⚠️ three를 여기 넣으면(객체형 manualChunks) 청크가 초기 정적 그래프로 승격돼
          // index.html에 modulepreload되어 첫 로드에 ~973KB가 실린다(레이지 무력화, LH 성능 55의 주범).
          // three는 HeroScene(dynamic import)에서만 쓰므로 명시하지 않으면 자연히 비동기 청크가 된다.
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
