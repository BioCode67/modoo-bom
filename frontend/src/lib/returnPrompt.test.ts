import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setPendingReturn, getPendingReturn, clearPendingReturn, dismissPendingReturn } from './returnPrompt'

function mockSession() {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v) },
    removeItem: (k: string) => { m.delete(k) },
  }
}

describe('returnPrompt — 복귀 확인 대기 기록', () => {
  beforeEach(() => vi.stubGlobal('sessionStorage', mockSession()))

  it('신청 대기 기록 → 조회 → 완료 시 삭제', () => {
    setPendingReturn({ kind: 'apply', policyId: 'POL-001', name: '기초연금' })
    const p = getPendingReturn()
    expect(p?.kind).toBe('apply')
    expect(p && 'policyId' in p && p.policyId).toBe('POL-001')
    expect(typeof p?.at).toBe('number')
    clearPendingReturn()
    expect(getPendingReturn()).toBeNull()
  })

  it("'아직이에요'는 기록을 지우지 않고 dismissed 표시(세션당 1회 재프롬프트 억제)", () => {
    setPendingReturn({ kind: 'doc', doc: '주민등록등본' })
    dismissPendingReturn()
    const p = getPendingReturn()
    expect(p?.dismissed).toBe(true)
    expect(p?.kind).toBe('doc')
  })

  it('손상된 저장값은 null(예외 없이)', () => {
    sessionStorage.setItem('modoo:pendingReturn', '{broken json')
    expect(getPendingReturn()).toBeNull()
  })

  it('sessionStorage 부재 환경에서도 예외 없이 동작', () => {
    vi.unstubAllGlobals()
    expect(() => setPendingReturn({ kind: 'doc', doc: 'x' })).not.toThrow()
    expect(getPendingReturn()).toBeNull()
  })
})
