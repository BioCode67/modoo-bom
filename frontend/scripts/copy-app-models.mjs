/**
 * 동봉 모델을 dist-app으로 복사 — 필수 파일이 전부 준비된 경우에만(반쪽 동봉 금지).
 *
 * fetch-app-model.mjs가 채운 `frontend/app-models/models/…`를 `dist-app/models/…`로 넣는다.
 * 필수 파일이 하나라도 없으면 통째로 생략 — 앱은 오늘과 동일하게 CDN 폴백으로 동작하고,
 * semanticSearch.ts의 HEAD 감지도 자연히 꺼진다(불완전 동봉으로 인한 반쪽 로딩 방지).
 * 어떤 경우에도 exit 0 — 데스크탑 빌드를 절대 막지 않는다.
 */
import { cpSync, existsSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url))) // frontend/
const SRC = join(ROOT, 'app-models', 'models')
const OUT = process.argv[2] || 'dist-app'
const DEST = join(ROOT, OUT, 'models')

// fetch-app-model.mjs의 필수 목록과 계약(semanticSearch.ts detectBundledModel 포함)
const REQUIRED = [
  join(SRC, 'Xenova', 'multilingual-e5-small', 'config.json'),
  join(SRC, 'Xenova', 'multilingual-e5-small', 'tokenizer.json'),
  join(SRC, 'Xenova', 'multilingual-e5-small', 'tokenizer_config.json'),
  join(SRC, 'Xenova', 'multilingual-e5-small', 'onnx', 'model_quantized.onnx'),
]

const ready = REQUIRED.every((p) => {
  try { return existsSync(p) && statSync(p).size > 0 } catch { return false }
})

if (!ready) {
  console.log('[app-model] 동봉 생략 — 모델 캐시가 불완전(온라인에서 build:app 재실행 시 동봉). 앱은 CDN 폴백으로 동작.')
} else {
  try {
    cpSync(SRC, DEST, { recursive: true })
    console.log(`[app-model] ${OUT}/models 동봉 완료 — 오프라인·차단망에서도 다국어 검색·번역 동작`)
  } catch (e) {
    console.log(`[app-model] 복사 실패(${e.message}) — 앱은 CDN 폴백으로 동작.`)
  }
}
