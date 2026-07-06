/**
 * 배포 전 정리 — 미사용 ONNX WASM 제거.
 *
 * transformers.js를 번들하면 Vite가 대용량 ONNX 런타임 WASM(수십 MB)을 dist/assets에
 * 방출하지만, 런타임에는 이 파일을 HuggingFace/jsdelivr CDN에서 로드한다(브라우저 검증으로
 * LOCAL=0 확인). 따라서 dist의 로컬 WASM은 데드웨이트 → gh-pages 배포 용량을 위해 제거한다.
 */
import { readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

// 대상 산출물 폴더: 인자로 지정(예: `node scripts/clean-wasm.mjs dist-app`), 기본은 dist.
const outDir = process.argv[2] || 'dist'
const dir = new URL(`../${outDir}/assets/`, import.meta.url)
let removed = 0
let bytes = 0
try {
  for (const f of readdirSync(dir)) {
    if (f.endsWith('.wasm')) {
      const p = join(dir.pathname.replace(/^\//, ''), f)
      try {
        bytes += statSync(new URL(f, dir)).size
      } catch { /* noop */ }
      rmSync(new URL(f, dir))
      removed++
      console.log(`[clean-wasm] 제거: assets/${f}`)
    }
  }
  console.log(`[clean-wasm] 완료 — ${removed}개 파일, ${(bytes / 1024 / 1024).toFixed(1)}MB 절감`)
} catch (e) {
  console.log('[clean-wasm] 스킵:', e.message)
}
