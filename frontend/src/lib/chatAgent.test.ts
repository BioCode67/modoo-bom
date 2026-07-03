import { describe, it, expect } from 'vitest'
import { agentReply, greetingReply, matchSaveIntent } from './chatAgent'
import type { UserProfile, AnalysisResult, EligiblePolicy } from './welfare-engine'
import type { Policy } from '@/data/policies'
import type { TrackedItem } from '@/store/useAppStore'

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

const mkT = (policyId: string, status: TrackedItem['status'] = 'idle'): TrackedItem =>
  ({ policyId, name: policyId, category: '', status, savedAt: 1_700_000_000_000, checkedDocs: [] })

describe('greetingReply — 능동적 상태 브리핑', () => {
  it('프로필 없고 담아둔 것 없으면 분석 유도 CTA', () => {
    const g = greetingReply(null, [])
    expect(g.cta?.view).toBe('analyze')
  })
  it('프로필 있고 급한 것 없으면 개인화 인사(이름 포함)', () => {
    const g = greetingReply(profile, [mkT('X1'), mkT('X2')]) // idle → 급하지 않음
    expect(g.text).toContain('김복순')
    expect(g.cta).toBeTruthy()
  })
  it('급한 항목(신청준비 완료 등)이 있으면 그것부터 먼저 브리핑', () => {
    // status tracking + 서류요건 없는(미지) 정책 → "신청 준비 끝" high 알림
    const g = greetingReply(profile, [mkT('X1', 'tracking')])
    expect(g.text).toMatch(/급히 챙길|🔔/)
    expect(g.cta?.view).toBe('my')
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

const mkP = (id: string, name: string): Policy =>
  ({ id, name, category: '', target: '', benefit: '', eligibility: '', application: '', required_docs: [], department: '', renewal: '' } as Policy)
const ctx = [mkP('A', '기초연금'), mkP('B', '아동수당'), mkP('C', '주거급여')]

describe('matchSaveIntent — 대화 맥락 기억(직전 복지를 가리켜 담기)', () => {
  it('맥락 없거나 저장 의도 아니면 null', () => {
    expect(matchSaveIntent('담아줘', [])).toBeNull()
    expect(matchSaveIntent('기초연금이 뭐야', ctx)).toBeNull()
  })
  it('"다 담아줘" → 전체', () => {
    expect(matchSaveIntent('다 담아줘', ctx)).toHaveLength(3)
    expect(matchSaveIntent('전부 저장해줘', ctx)).toHaveLength(3)
  })
  it('서수("첫번째/두번째") → 해당 항목', () => {
    expect(matchSaveIntent('첫번째 담아줘', ctx)?.[0].id).toBe('A')
    expect(matchSaveIntent('두번째 저장', ctx)?.[0].id).toBe('B')
  })
  it('이름 직접 언급 → 해당 정책', () => {
    expect(matchSaveIntent('아동수당 담아줘', ctx)?.[0].id).toBe('B')
  })
  it('"그거 담아줘" → 첫 번째(가장 관련)', () => {
    expect(matchSaveIntent('그거 담아줘', ctx)?.[0].id).toBe('A')
  })
  it('맥락이 하나뿐이면 밋밋한 "담아줘"도 그 항목', () => {
    expect(matchSaveIntent('담아줘', [ctx[0]])?.[0].id).toBe('A')
  })
  it('밋밋한 "담아줘" + 여러 개 → 보여준 것 전부', () => {
    expect(matchSaveIntent('담아줘', ctx)).toHaveLength(3)
  })
})
