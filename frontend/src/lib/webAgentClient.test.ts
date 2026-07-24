import { describe, it, expect } from 'vitest'
import { normalizeWebAgentResult, runWebAgentRemote } from './webAgentClient'

describe('normalizeWebAgentResult — snake_case → 프론트 타입(방어적)', () => {
  it('백엔드 결과를 정규화(fallback_url·needs_human 매핑)', () => {
    const r = normalizeWebAgentResult({
      goal: '주민등록등본 발급', success: false, status: 'route', engine: 'deterministic',
      steps: 0, extracted: { resolved_doc: '주민등록등본' }, message: '검증된 빠른 경로',
      fallback_url: 'https://www.gov.kr', needs_human: null, error: null,
    }, '등본')
    expect(r.status).toBe('route')
    expect(r.engine).toBe('deterministic')
    expect(r.fallbackUrl).toBe('https://www.gov.kr')
    expect(r.extracted.resolved_doc).toBe('주민등록등본')
    expect(r.needsHuman).toBeNull()
  })

  it('깨진/누락 입력도 안전한 기본값', () => {
    const r = normalizeWebAgentResult(null, '목표')
    expect(r.goal).toBe('목표')
    expect(r.success).toBe(false)
    expect(r.status).toBe('error')
    expect(r.engine).toBe('none')
    expect(r.extracted).toEqual({})
  })

  it('needs_human 문자열은 그대로', () => {
    expect(normalizeWebAgentResult({ needs_human: 'auth' }, 'g').needsHuman).toBe('auth')
  })
})

// 주입 fetch — 실제 네트워크 없이 클라이언트 경로 검증
const mkFetch = (body: unknown, ok = true): typeof fetch =>
  (async () => ({ ok, json: async () => body })) as unknown as typeof fetch

describe('runWebAgentRemote — 실행 경로(주입 fetch)', () => {
  it('성공 응답 → 정규화 결과', async () => {
    const r = await runWebAgentRemote('주민등록등본 발급', {
      baseUrl: 'http://localhost:8000',
      fetchImpl: mkFetch({ goal: '주민등록등본 발급', status: 'route', engine: 'deterministic', success: false }),
    })
    expect(r?.status).toBe('route')
  })

  it('base 없으면 null(정적 배포 — 폴백)', async () => {
    expect(await runWebAgentRemote('등본', { baseUrl: '', fetchImpl: mkFetch({}) })).toBeNull()
  })

  it('빈 목표는 null', async () => {
    expect(await runWebAgentRemote('   ', { baseUrl: 'http://x', fetchImpl: mkFetch({}) })).toBeNull()
  })

  it('non-2xx 응답은 null', async () => {
    expect(await runWebAgentRemote('등본', { baseUrl: 'http://x', fetchImpl: mkFetch({}, false) })).toBeNull()
  })

  it('네트워크 예외는 null(무너지지 않음)', async () => {
    const boom = (async () => { throw new Error('network') }) as unknown as typeof fetch
    expect(await runWebAgentRemote('등본', { baseUrl: 'http://x', fetchImpl: boom })).toBeNull()
  })

  it('base 끝 슬래시가 있어도 경로가 겹치지 않는다', async () => {
    let calledUrl = ''
    const spy = (async (url: string) => { calledUrl = url; return { ok: true, json: async () => ({ status: 'fallback' }) } }) as unknown as typeof fetch
    await runWebAgentRemote('등본', { baseUrl: 'http://x/', fetchImpl: spy })
    expect(calledUrl).toBe('http://x/api/webagent/run')
  })
})
