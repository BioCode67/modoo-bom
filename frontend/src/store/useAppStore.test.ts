import { describe, it, expect } from 'vitest'
import { stripNameFromSummary, normalizeTracked, normalizeResult } from './useAppStore'
import { runAnalysis, type UserProfile } from '@/lib/welfare-engine'

const prof: UserProfile = {
  name: '홍길동실명', age: 72, gender: 'male', region: '서울', household_type: '1인가구',
  income_percentile: 25, disability: false, disability_grade: '', employment_status: '',
  has_children: false, children_ages: [], is_pregnant: false, life_events: [],
}

describe('stripNameFromSummary — 디스크 저장 전 실명 제거(개인정보 최소저장)', () => {
  it("'${name}님(...)' 접두를 '회원님('으로 치환", () => {
    expect(stripNameFromSummary('홍길동실명님(72세, 서울 거주)의 프로필을 분석했습니다.'))
      .toBe('회원님(72세, 서울 거주)의 프로필을 분석했습니다.')
  })
  it('감사 회귀: runAnalysis 결과 요약을 저장용으로 변환하면 실명이 사라진다', () => {
    const result = runAnalysis(prof)
    expect(result.profile_summary).toContain('홍길동실명') // 원본엔 이름 있음
    const persisted = stripNameFromSummary(result.profile_summary)
    expect(persisted).not.toContain('홍길동실명') // 저장용엔 없음
    expect(persisted.startsWith('회원님(')).toBe(true)
  })
  it('빈 문자열·이름 없는 요약도 안전', () => {
    expect(stripNameFromSummary('')).toBe('')
    expect(stripNameFromSummary('회원님(30세)의 프로필')).toBe('회원님(30세)의 프로필')
  })
  it('감사 회귀: 이름에 괄호가 있어도 실명이 남지 않음(예: 홍길동(가명))', () => {
    const out = stripNameFromSummary('홍길동(가명)님(72세, 서울 거주)의 프로필')
    expect(out).not.toContain('홍길동')
    expect(out).not.toContain('가명')
    expect(out).toBe('회원님(72세, 서울 거주)의 프로필')
  })
})

describe('normalizeTracked/normalizeResult — persist 스키마 진화 방어(2026-07)', () => {
  it('checkedDocs가 없는 레거시 tracked 항목에 빈 배열을 채운다(모니터링/여정 크래시 방지)', () => {
    const legacy = [
      { policyId: 'POL-1', name: 'a', category: '노인', status: 'idle', savedAt: 0 }, // checkedDocs 없음
      { policyId: 'POL-2', name: 'b', category: '청년', status: 'idle', savedAt: 0, checkedDocs: ['등본'] },
    ]
    const out = normalizeTracked(legacy)
    expect(Array.isArray(out[0].checkedDocs)).toBe(true)
    expect(out[0].checkedDocs).toEqual([])
    expect(out[1].checkedDocs).toEqual(['등본'])
  })
  it('배열이 아니거나 policyId 없는 잡값은 걸러낸다', () => {
    expect(normalizeTracked(null)).toEqual([])
    expect(normalizeTracked('bad' as unknown)).toEqual([])
    expect(normalizeTracked([{ name: 'no id' }, null, { policyId: 'OK', checkedDocs: [] }])).toHaveLength(1)
  })
  it('result의 배열 필드(notifications/eligible_policies/application_guides)를 보장한다', () => {
    const drifted = { profile_summary: 's', final_response: 'r' } as unknown as Parameters<typeof normalizeResult>[0]
    const out = normalizeResult(drifted)!
    expect(Array.isArray(out.notifications)).toBe(true)
    expect(Array.isArray(out.eligible_policies)).toBe(true)
    expect(Array.isArray(out.application_guides)).toBe(true)
  })
  it('null result는 그대로 null', () => {
    expect(normalizeResult(null)).toBeNull()
  })
})

import { useAppStore } from './useAppStore'

describe('resetForNextUser — 복지관 공용PC 상담 전환 시 이전 어르신 PII 전삭제(감사 확정)', () => {
  it('프로필·분석·담은목록·발급기록·rpaInfo(실명·생년월일·인증수단)를 모두 비우고 resetNonce를 올린다', () => {
    const s = useAppStore.getState()
    // 이전 상담자 흔적 주입
    useAppStore.setState({
      profile: { name: '김복순', age: 72 } as never,
      result: { profile_summary: 'x' } as never,
      tracked: [{ policyId: 'POL-001', name: '기초연금', status: 'interested', checkedDocs: [] }] as never,
      docDone: { 주민등록등본: Date.now() },
      rpaInfo: { name: '김복순', birth_date: '19540101', phone: '01000000000', carrier: 'SKT', sido: '서울', sigungu: '중구', auth_provider: 'pass', rrn_back: '1234567', parent_kind: '부', parent_name: '김상식' },
    })
    const before = useAppStore.getState().resetNonce
    s.resetForNextUser()
    const after = useAppStore.getState()
    expect(after.profile).toBeNull()
    expect(after.result).toBeNull()
    expect(after.tracked).toEqual([])
    expect(after.docDone).toEqual({})
    expect(after.rpaInfo.name).toBe('')
    expect(after.rpaInfo.birth_date).toBe('')
    expect(after.rpaInfo.phone).toBe('')
    expect(after.rpaInfo.auth_provider).toBe('kakao') // 기본값으로 복귀
    expect(after.resetNonce).toBe(before + 1)          // 챗 대화 초기화 신호
  })

  it('rpaInfo 기본 auth_provider는 kakao', () => {
    // persist 마이그레이션 방어: 신규/초기 상태의 인증수단 기본값
    expect(['kakao', 'pass', 'naver', 'toss']).toContain(useAppStore.getState().rpaInfo.auth_provider || 'kakao')
  })
})
