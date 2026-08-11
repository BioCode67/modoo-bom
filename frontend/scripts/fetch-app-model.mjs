/**
 * 데스크탑앱용 온디바이스 AI 모델 프리페치 — best-effort(실패해도 빌드는 계속).
 *
 * 왜: 시연장·기관망에서 HuggingFace/jsdelivr가 차단·지연되면 다국어 의미검색이 "모델을
 * 불러오지 못했어요"로 죽는다(실측). 데스크탑앱은 local_server가 dist-app을 서빙하므로,
 * 빌드 시 모델을 받아 동봉하면 네트워크와 무관하게 다국어가 동작한다.
 *
 * 동작:
 * - `frontend/app-models/`(gitignore, 빌드 캐시)에 아래를 준비한다.
 *   ① HuggingFace에서 Xenova/multilingual-e5-small 최소 파일(q8 ONNX 포함, 합계 ~130MB)
 *   ② node_modules의 onnxruntime-web WASM 런타임(ort-wasm-simd-threaded.*)
 * - 이미 받아져 있으면 건너뛴다(재빌드 빠름 · 오프라인 재빌드 안전).
 * - 다운로드 실패는 경고만 하고 exit 0 — 이 경우 앱은 오늘처럼 CDN 폴백으로 동작한다
 *   (semanticSearch.ts가 동봉 실재를 HEAD로 확인한 뒤에만 로컬 모드를 켠다).
 *
 * ⚠️ 여기 파일 목록은 semanticSearch.ts(detectBundledModel)·copy-app-models.mjs와 계약이다.
 */
import { createWriteStream, existsSync, mkdirSync, statSync, copyFileSync, readdirSync } from 'node:fs'
import { get } from 'node:https'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url))) // frontend/
const CACHE = join(ROOT, 'app-models')
const MODEL_DIR = join(CACHE, 'models', 'Xenova', 'multilingual-e5-small')
const ORT_DIR = join(CACHE, 'models', 'ort')

const HF = 'https://huggingface.co/Xenova/multilingual-e5-small/resolve/main'
// (경로, 필수 여부) — 필수 파일이 하나라도 없으면 동봉은 미완성으로 간주되어 copy 단계가 생략된다.
const FILES = [
  ['config.json', true],
  ['tokenizer.json', true],
  ['tokenizer_config.json', true],
  ['special_tokens_map.json', false], // 일부 리포엔 없음 — 없어도 동작
  ['onnx/model_quantized.onnx', true], // transformers.js WASM 기본 dtype(q8)
]

function download(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('리다이렉트 과다'))
    get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume()
        // HF는 LFS 파일은 절대 CDN URL, 소형 파일은 '상대 경로' Location 으로 리다이렉트한다
        // (CI 실측: config.json 등이 Invalid URL 로 실패) → 기준 URL 에 대해 해석한다.
        return resolve(download(new URL(res.headers.location, url).toString(), dest, redirects + 1))
      }
      if (res.statusCode !== 200) {
        res.resume()
        return reject(new Error(`HTTP ${res.statusCode}`))
      }
      mkdirSync(dirname(dest), { recursive: true })
      const out = createWriteStream(dest)
      res.pipe(out)
      out.on('finish', () => out.close(() => resolve(undefined)))
      out.on('error', reject)
    }).on('error', reject)
  })
}

async function main() {
  let ok = 0, skip = 0, fail = 0

  // ① HF 모델 파일
  for (const [rel, required] of FILES) {
    const dest = join(MODEL_DIR, rel)
    if (existsSync(dest) && statSync(dest).size > 0) { skip++; continue }
    try {
      process.stdout.write(`[app-model] 다운로드: ${rel} … `)
      await download(`${HF}/${rel}`, dest)
      console.log('완료')
      ok++
    } catch (e) {
      console.log(`실패(${e.message})${required ? '' : ' — 선택 파일, 무시'}`)
      if (required) fail++
    }
  }

  // ② onnxruntime WASM 런타임 — 설치된 버전에서 그대로 복사(버전 불일치 원천 차단)
  try {
    const ortDist = join(ROOT, 'node_modules', 'onnxruntime-web', 'dist')
    mkdirSync(ORT_DIR, { recursive: true })
    let copied = 0
    for (const f of readdirSync(ortDist)) {
      if (f.startsWith('ort-wasm-simd-threaded') && (f.endsWith('.wasm') || f.endsWith('.mjs'))) {
        const dest = join(ORT_DIR, f)
        if (!existsSync(dest) || statSync(dest).size !== statSync(join(ortDist, f)).size) {
          copyFileSync(join(ortDist, f), dest)
          copied++
        }
      }
    }
    console.log(`[app-model] ORT WASM: ${copied}개 복사(이미 최신이면 0)`)
  } catch (e) {
    console.log(`[app-model] ORT WASM 복사 실패(${e.message}) — 런타임은 CDN 폴백`)
  }

  if (fail) {
    console.log(`[app-model] ⚠️ 필수 ${fail}건 실패 — 모델 동봉 없이 빌드를 계속합니다(앱은 CDN 폴백으로 동작).`)
    console.log('[app-model]    인터넷 되는 곳에서 `npm run build:app`을 다시 실행하면 동봉됩니다.')
  } else {
    console.log(`[app-model] 준비 완료 — 신규 ${ok} · 캐시 ${skip}`)
  }
}

main().catch((e) => {
  console.log(`[app-model] 예기치 못한 오류(${e.message}) — 빌드는 계속합니다.`)
})
