import { describe, it, expect } from 'vitest'
import { agentReply, greetingReply, matchSaveIntent, docsReply, isLocalIntent } from './chatAgent'
import type { UserProfile, AnalysisResult, EligiblePolicy } from './welfare-engine'
import type { Policy } from '@/data/policies'
import type { TrackedItem } from '@/store/useAppStore'
import { getPolicyMap } from '@/data/catalog'

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
  it('급한 항목(신청준비 완료)이 있으면 그것부터 먼저 브리핑', () => {
    // 서류요건을 '아는' 정책이 tracking + 필요서류 전부 준비됨 → high "신청 준비 끝" 알림.
    // (서류요건이 미상인 정책을 '준비 끝'으로 단정하지 않는 정직성 수정 반영)
    const pid = 'POL-001'
    const docs = getPolicyMap()[pid]?.required_docs ?? []
    const t: TrackedItem = { policyId: pid, name: pid, category: '', status: 'tracking', savedAt: 1_700_000_000_000, checkedDocs: docs }
    const g = greetingReply(profile, [t])
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
  it('특정 정책 지식질문("기초연금 자격이 뭐야")은 개인화가 아니라 검색으로 — 프로필 요구로 새지 않음(감사 #12)', () => {
    const r = agentReply('기초연금 자격이 뭐야', { profile: null, result: null })
    expect((r.policies ?? []).length).toBeGreaterThan(0) // 검색 결과(기초연금) 반환 = eligibility 유도(0건) 아님
  })
  it('"복지 추천해줘"는 개인화 추천으로 라우팅(프로필 있으면 자격 정책 반환)', () => {
    const r = agentReply('복지 추천해줘', { profile, result })
    expect(r.policies?.[0]?.name).toBe('기초연금')
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
  it('감사 회귀: 조회 문장("보여줘/알려줘/뭐야")은 저장으로 오인하지 않음', () => {
    expect(matchSaveIntent('관심목록 보여줘', ctx)).toBeNull()
    expect(matchSaveIntent('찜 목록 알려줘', ctx)).toBeNull()
    expect(matchSaveIntent('저장된 거 뭐야', ctx)).toBeNull()
  })
  it('감사 회귀: 폴백 컨텍스트(explicitOnly)는 명시적 지시만 저장 — 밋밋한 "담아줘"로 전체 무단저장 방지', () => {
    expect(matchSaveIntent('담아줘', ctx, true)).toBeNull() // 밋밋 → 저장 안 함
    expect(matchSaveIntent('다 담아줘', ctx, true)).toHaveLength(3) // 전체 지시어 → 저장
    expect(matchSaveIntent('아동수당 담아줘', ctx, true)?.[0].id).toBe('B') // 이름 명시 → 저장
  })
})


describe('docsReply — 서류 의도(행동형)', () => {
  it('담은 게 없으면 분석 유도', () => {
    expect(docsReply([]).cta?.view).toBe('analyze')
  })
  it('담은 복지의 필요 서류를 빈도순 요약 + 서류센터 CTA', () => {
    const r = docsReply([mkT('POL-001'), mkT('POL-002')]) // 기초연금·생계급여 — 둘 다 등본 필요
    expect(r.text).toContain('주민등록등본')
    expect(r.text).toContain('2곳에서 필요')
    expect(r.cta?.view).toBe('my')
  })
  it('agentReply가 서류 질문을 서류 의도로 라우팅', () => {
    const r = agentReply('서류 뭐 필요해?', { profile: null, result: null, tracked: [mkT('POL-001')] })
    expect(r.text).toContain('서류')
    expect(r.cta?.view).toBe('my')
  })
  it('"서류 어떻게 발급해?"(발급 방법)도 로컬 서류 의도로 즉답 — 느린 클라우드로 안 감', () => {
    expect(isLocalIntent('서류 어떻게 발급해?')).toBe(true)
    const r = agentReply('서류 어떻게 발급해?', { profile: null, result: null, tracked: [mkT('POL-001')] })
    expect(r.cta?.view).toBe('my') // 서류 도우미로 안내
  })
  it('"신청 어떻게 해?"는 신청 의도로 즉답(applyReply) — 클라우드 12초 대기 없음', () => {
    expect(isLocalIntent('신청 어떻게 해?')).toBe(true)
    expect(isLocalIntent('어디서 신청하나요')).toBe(true)
    const r = agentReply('신청 어떻게 해?', { profile: null, result: null, tracked: [mkT('POL-001')] })
    expect(r.text).toMatch(/신청/)
    expect(r.cta?.view).toBe('my')
  })
  it('발급/신청 안내가 무설치 전자문서지갑(전자제출) 경로를 대화로 연결', () => {
    const d = agentReply('서류 어떻게 발급해?', { profile: null, result: null, tracked: [mkT('POL-001')] })
    expect(d.text).toContain('전자문서지갑')
    const a = agentReply('신청 어떻게 해?', { profile: null, result: null, tracked: [mkT('POL-001')] })
    expect(a.text).toContain('전자문서지갑')
  })
})


describe('isLocalIntent — 하이브리드 라우팅(행동=로컬, 지식=LLM)', () => {
  it('행동·개인화 의도는 로컬', () => {
    expect(isLocalIntent('안녕하세요')).toBe(true)
    expect(isLocalIntent('내가 받을 수 있는 거 알려줘')).toBe(true)
    expect(isLocalIntent('서류 뭐 필요해?')).toBe(true)
  })
  it('일반 지식 질문은 LLM 대상(로컬 아님)', () => {
    expect(isLocalIntent('기초연금이 뭐예요?')).toBe(false)
    expect(isLocalIntent('부모급여랑 아동수당 차이가 궁금해요')).toBe(false)
  })
})
