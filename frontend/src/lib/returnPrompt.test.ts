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

  it("'아직이에요'는 기록을 지우지 않고 dismissed 표시 — 활성 조회에선 빠지고 저장엔 남는다", () => {
    setPendingReturn({ kind: 'doc', doc: '주민등록등본' })
    dismissPendingReturn()
    // 15차 개편: getPendingReturn은 '물어볼 활성 항목'만 — dismissed는 반환하지 않는다(다음 항목으로 진행)
    expect(getPendingReturn()).toBeNull()
    // 저장 자체는 dismissed로 남아 같은 세션 재프롬프트를 막는다
    const raw = JSON.parse(sessionStorage.getItem('modoo:pendingReturn') || '[]') as { dismissed?: boolean; kind?: string }[]
    expect(raw[0]?.dismissed).toBe(true)
    expect(raw[0]?.kind).toBe('doc')
  })

  it('15차: 연속 발급 큐 — 두 서류를 연달아 기록해도 앞 기록이 유실되지 않는다', () => {
    setPendingReturn({ kind: 'doc', doc: '주민등록등본' })
    setPendingReturn({ kind: 'doc', doc: '가족관계증명서' })
    const first = getPendingReturn()
    expect(first && 'doc' in first && first.doc).toBe('주민등록등본') // 먼저 간 것부터 확인
    dismissPendingReturn(first!.at)
    const second = getPendingReturn()
    expect(second && 'doc' in second && second.doc).toBe('가족관계증명서') // 다음 항목이 이어서
  })

  it('15차: 구(단일 객체) 스키마 하위호환 — 배열로 승격해 읽는다', () => {
    sessionStorage.setItem('modoo:pendingReturn', JSON.stringify({ kind: 'doc', doc: '등본', at: 123 }))
    const p = getPendingReturn()
    expect(p?.kind).toBe('doc')
    expect(p?.at).toBe(123)
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
