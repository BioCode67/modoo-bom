import { describe, it, expect } from 'vitest'
import { agentReply, greetingReply } from './chatAgent'
import type { UserProfile, AnalysisResult, EligiblePolicy } from './welfare-engine'

const profile: UserProfile = {
  name: '김복순', age: 72, gender: 'female', region: '서울', household_type: '1인가구',
  income_percentile: 25, disability: false, disability_grade: '', employment_status: 'retired',
  has_children: false, children_ages: [], is_pregnant: false, life_events: [],
}

const eligible: EligiblePolicy = {
  id: 'POL-001', name: '기초연금', category: '노인', target: '만 65세', benefit: '월 34만원',
  eligibility: '만 65세 이상', required_docs: ['신분증'], application: '복지로', department: '보건복지부',
  renewal: '매년', reason: '만 65세 이상·소득 하위 70% 조건 충족', priority: 'high', confidence: 0.95,
}
const result = { eligible_policies: [eligible] } as unknown as AnalysisResult

describe('greetingReply — 능동적 상태 브리핑', () => {
  it('프로필 없으면 분석 유도 CTA', () => {
    const g = greetingReply(null, 0)
    expect(g.cta?.view).toBe('analyze')
  })
  it('프로필 있으면 이름 개인화 + CTA', () => {
    const g = greetingReply(profile, 2)
    expect(g.text).toContain('김복순')
    expect(g.cta).toBeTruthy()
  })
})

describe('agentReply — 개인화·행동형 응답', () => {
  it('인사는 인사로 응답', () => {
    expect(agentReply('안녕하세요', { profile: null, result: null }).text).toMatch(/안녕|반가|복지 도우미/)
  })
  it('"내가 받을 수 있는 거" + 프로필 없음 → 분석 유도(정책 없음)', () => {
    const r = agentReply('내가 받을 수 있는 거 알려줘', { profile: null, result: null })
    expect(r.cta?.view).toBe('analyze')
    expect(r.policies ?? []).toHaveLength(0)
  })
  it('"내가 받을 수 있는 거" + 프로필/결과 → 실제 자격 정책을 이유와 함께 반환', () => {
    const r = agentReply('내가 받을 수 있는 게 뭐야', { profile, result })
    expect(r.policies?.[0]?.name).toBe('기초연금')
    expect(r.text).toContain('조건 충족') // reason 노출
  })
  it('키워드 검색은 정책 목록을 행동 대상으로 반환', () => {
    const r = agentReply('기초연금', { profile: null, result: null })
    expect((r.policies ?? []).length).toBeGreaterThan(0)
  })
  it('프로필이 있으면 검색 결과에 개인화 자격 코멘트를 붙임', () => {
    const r = agentReply('노인 일자리', { profile, result: null })
    expect(r.policies).toBeTruthy()
    // 프로필 기반이면 ✅ 또는 조건 확인 코멘트가 붙는다
    expect(r.text).toMatch(/✅|조건 확인/)
  })
})
