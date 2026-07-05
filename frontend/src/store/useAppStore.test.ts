import { describe, it, expect } from 'vitest'
import { stripNameFromSummary } from './useAppStore'
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
})
