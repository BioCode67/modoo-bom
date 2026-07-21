import { describe, it, expect, vi, afterEach } from 'vitest'
import { buildFlowRecord } from './diag'

// 🎬 흐름 기록 복사 — 서버 응답별로 붙여넣기용 텍스트가 올바른지(있음/없음/실패) 검증.
//   실제 값(PII)은 서버가 애초에 안 담으므로(백엔드 계약), 여기선 프론트의 '문구 분기'만 확인한다.
describe('buildFlowRecord', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('기록이 있으면 구조 JSON을 붙여넣기 텍스트로 만든다', async () => {
    const body = { available: true, file: 'flow_20260721.jsonl', count: 2, steps: [{ step: 1 }, { step: 2 }] }
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => body })))
    const txt = await buildFlowRecord()
    expect(txt).toContain('모두봄 흐름 기록')
    expect(txt).toContain('flow_20260721.jsonl')
    expect(txt).toContain('"count": 2')
  })

  it('기록이 없으면 진행 안내로 폴백한다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ available: false }) })))
    const txt = await buildFlowRecord()
    expect(txt).toContain('아직 지나간 화면이 없어요')
    expect(txt).toContain('진행하면')
  })

  it('연결 실패면 조회 실패 안내를 돌려준다(던지지 않음)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('connurefused') }))
    const txt = await buildFlowRecord()
    expect(txt).toContain('조회 실패')
  })
})
