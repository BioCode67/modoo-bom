import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 데스크탑앱 모델 동봉 — 소스 계약 테스트.
 *
 * 시연장·기관망에서 CDN이 차단되면 다국어 의미검색이 죽는 것을 막기 위해, 앱 빌드는
 * 모델을 동봉하고(semanticSearch가 로컬 우선) 웹 빌드는 기존 CDN 경로를 유지한다.
 * 이 구조는 세 파일(semanticSearch.ts · fetch-app-model.mjs · copy-app-models.mjs)에
 * 걸친 '경로·파일명 계약'이라, 어긋나면 조용히 CDN 폴백으로만 돌게 된다(기능 저하가
 * 무증상) → 소스 파싱으로 계약을 고정한다.
 */
const ROOT = join(__dirname, '..', '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf-8')

describe('앱 모델 동봉 — 3파일 경로 계약', () => {
  const search = read('src/lib/semanticSearch.ts')
  const fetcher = read('scripts/fetch-app-model.mjs')
  const copier = read('scripts/copy-app-models.mjs')

  it('semanticSearch: 앱 모드에서만 로컬 우선(웹 경로 불변)', () => {
    // 게이트는 반드시 MODE === 'app' — 웹/테스트 빌드에 로컬 모드가 새지 않게
    expect(search).toContain("import.meta.env.MODE === 'app'")
    // 기본은 오늘과 동일한 CDN 경로
    expect(search).toContain('env.allowLocalModels = false')
    // 동봉 사용 시에도 CDN 폴백 안전밸브 유지
    expect(search).toContain('env.allowRemoteModels = true')
    // SPA 폴백(index.html 200) 오검출 방지 — content-type 검사
    expect(search).toContain("text/html")
  })

  it('감지 경로와 동봉 경로가 일치(모델 config)', () => {
    const probe = 'models/Xenova/multilingual-e5-small/config.json'
    expect(search).toContain(probe)
    expect(fetcher).toContain("'config.json'")
    expect(copier.replace(/\\/g, '/')).toContain("'Xenova', 'multilingual-e5-small', 'config.json'")
  })

  it('감지 경로와 동봉 경로가 일치(ORT WASM)', () => {
    expect(search).toContain('models/ort/ort-wasm-simd-threaded.wasm')
    expect(fetcher).toContain('ort-wasm-simd-threaded')
  })

  it('q8 ONNX 파일명 계약(transformers.js WASM 기본 dtype)', () => {
    expect(fetcher).toContain('onnx/model_quantized.onnx')
    expect(copier).toContain('model_quantized.onnx')
  })

  it('복사기는 필수 파일이 전부 있어야만 동봉(반쪽 동봉 금지)', () => {
    expect(copier).toContain('REQUIRED')
    expect(copier).toContain('every')
  })

  it('빌드 파이프라인: postbuild:app이 fetch→copy를 순서대로 수행', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> }
    const post = pkg.scripts['postbuild:app'] || ''
    expect(post).toContain('fetch-app-model.mjs')
    expect(post).toContain('copy-app-models.mjs')
    expect(post.indexOf('fetch-app-model')).toBeLessThan(post.indexOf('copy-app-models'))
    // 웹 빌드(postbuild)는 동봉 단계가 없어야 한다 — gh-pages 용량·경로 불변
    expect(pkg.scripts['postbuild'] || '').not.toContain('app-model')
  })

  it('모델 캐시는 커밋되지 않는다(app-models gitignore)', () => {
    expect(read('.gitignore')).toContain('app-models/')
  })

  it('스크립트는 실재한다', () => {
    expect(existsSync(join(ROOT, 'scripts/fetch-app-model.mjs'))).toBe(true)
    expect(existsSync(join(ROOT, 'scripts/copy-app-models.mjs'))).toBe(true)
  })
})

describe('언어팩 워밍업 — 사용자 제스처 시점(ForeignerWelcome)', () => {
  it('언어 CTA 클릭 핸들러에서 getTranslator를 예열한다', () => {
    const fw = read('src/components/ForeignerWelcome.tsx')
    expect(fw).toContain('getTranslator')
    // 각 언어 항목에 번역기 언어 코드가 있다
    for (const code of ["code: 'vi'", "code: 'en'", "code: 'zh'", "code: 'ja'"]) {
      expect(fw).toContain(code)
    }
  })
})
