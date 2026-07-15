import { describe, it, expect, vi, afterEach } from 'vitest'

/**
 * 온디바이스 번역(브라우저 내장 Translator API) 검증.
 * 실제 Chrome Translator는 노드 테스트에 없으므로 전역 Translator를 목킹해
 * ①지원 브라우저 번역 ②미지원/불가 시 원문(한국어) 폴백 ③캐시 ④BCP-47 매핑을 고정한다.
 */
type Mod = typeof import('./onDeviceTranslate')

function makeMock(opts: { availability?: string; translate?: (t: string) => string; createThrows?: boolean } = {}) {
  const translate = vi.fn(async (t: string) => (opts.translate ? opts.translate(t) : `VI:${t}`))
  const create = vi.fn(async () => {
    if (opts.createThrows) throw new Error('needs user activation')
    return { translate }
  })
  const availability = vi.fn(async (_o: { sourceLanguage: string; targetLanguage: string }) => opts.availability ?? 'available')
  return { Translator: { availability, create }, translate, create, availability }
}

// 모듈 레벨 캐시(번역기·번역결과)가 테스트 간 오염되지 않도록 매 테스트 새 모듈 인스턴스로.
async function load(): Promise<Mod> {
  vi.resetModules()
  return import('./onDeviceTranslate')
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('onDeviceTranslate — 미지원 브라우저 폴백', () => {
  it('Translator 없으면 supports=false, 번역은 원문 폴백(null / 빈 객체)', async () => {
    const m = await load()
    expect(m.supportsOnDeviceTranslation()).toBe(false)
    expect(await m.translateText('기초연금', 'vi')).toBeNull()
    expect(await m.translateFields({ name: '기초연금', category: '노인' }, 'vi')).toEqual({})
  })
})

describe('onDeviceTranslate — 온디바이스 번역', () => {
  it('지원 브라우저: 한국어 → 질의 언어로 번역', async () => {
    vi.stubGlobal('Translator', makeMock({ translate: (t) => `VI:${t}` }).Translator)
    const m = await load()
    expect(m.supportsOnDeviceTranslation()).toBe(true)
    expect(await m.translateText('기초연금', 'vi')).toBe('VI:기초연금')
  })

  it('translateFields: 여러 필드 번역 + 빈 값 skip, 동일언어(ko)는 빈 객체', async () => {
    vi.stubGlobal('Translator', makeMock().Translator)
    const m = await load()
    const out = await m.translateFields({ name: '기초연금', target: '만 65세 이상', empty: '' }, 'vi')
    expect(out).toEqual({ name: 'VI:기초연금', target: 'VI:만 65세 이상' })
    expect(await m.translateFields({ name: '기초연금' }, 'ko')).toEqual({})
  })

  it('캐시: 같은 텍스트를 반복 번역해도 translate는 1회만 호출', async () => {
    const mk = makeMock()
    vi.stubGlobal('Translator', mk.Translator)
    const m = await load()
    await m.translateText('기초연금', 'vi')
    await m.translateText('기초연금', 'vi')
    expect(mk.translate).toHaveBeenCalledTimes(1)
  })

  it('언어쌍 미지원(availability=unavailable)이면 원문 폴백(null), create 미호출', async () => {
    const mk = makeMock({ availability: 'unavailable' })
    vi.stubGlobal('Translator', mk.Translator)
    const m = await load()
    expect(await m.translateText('기초연금', 'vi')).toBeNull()
    expect(mk.create).not.toHaveBeenCalled()
  })

  it('create 실패(모델 다운로드·제스처 필요 등)면 원문 폴백(null)', async () => {
    vi.stubGlobal('Translator', makeMock({ createThrows: true }).Translator)
    const m = await load()
    expect(await m.translateText('기초연금', 'vi')).toBeNull()
  })

  it('중국어는 BCP-47 zh-Hans로 조회', async () => {
    const mk = makeMock()
    vi.stubGlobal('Translator', mk.Translator)
    const m = await load()
    await m.translateText('기초연금', 'zh')
    expect(mk.availability).toHaveBeenCalledWith({ sourceLanguage: 'ko', targetLanguage: 'zh-Hans' })
  })
})
