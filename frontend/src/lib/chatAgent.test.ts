import { describe, it, expect } from 'vitest'
import { agentReply, greetingReply, matchSaveIntent, matchIssueIntent, matchIssueAllIntent, matchAutopilotIntent, issueReply, docsReply, isLocalIntent } from './chatAgent'
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
  it('개수("N개/N가지") → 앞에서 N건(서수와 구분, 감사)', () => {
    expect(matchSaveIntent('3개 담아줘', ctx)).toHaveLength(3)   // 3번째 하나가 아니라 3건
    expect(matchSaveIntent('2개 저장해줘', ctx)?.map((p) => p.id)).toEqual(['A', 'B'])
    expect(matchSaveIntent('2가지 담아줘', ctx)).toHaveLength(2)
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
  it('데스크탑 에이전트 연결(agentOn) 시 서류·신청 답변이 자동화 경로를 안내(웹은 전자증명서 경로 유지)', () => {
    const web = agentReply('서류 뭐 필요해?', { profile: null, result: null, tracked: [mkT('POL-001')] })
    expect(web.text).toContain('전자증명서')
    const app = agentReply('서류 뭐 필요해?', { profile: null, result: null, tracked: [mkT('POL-001')], agentOn: true })
    expect(app.text).toContain('전부 자동발급')
    const apply = agentReply('신청 어떻게 해?', { profile: null, result: null, tracked: [mkT('POL-001')], agentOn: true })
    expect(apply.text).toContain('자동 첨부')
    expect(apply.text).toContain('최종 제출')  // 정직한 경계는 항상 함께
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

describe('searchReply 정직성 — 비현금(재가급여 한도)을 월 현금으로 표기하지 않음(감사 F1)', () => {
  it('"재가급여" 검색 줄에 서비스 한도(월 251만원)를 "(월 …까지)" 현금처럼 적지 않는다', () => {
    const r = agentReply('재가급여', { profile: null, result: null })
    const line = (r.text.split('\n').find((l) => l.includes('재가급여')) || '')
    expect(line).toContain('재가급여')                 // POL-057이 결과에 노출됨
    expect(/\(월 .*까지\)/.test(line)).toBe(false)     // 한도액을 월 현금처럼 표기 금지
    expect(r.text).not.toMatch(/251만원까지|2,510,000/) // 서비스 한도 금액을 현금으로 오표기 금지
  })
})

describe('matchIssueIntent — 💬→🖨 "등본 발급해줘" 실행 의도(데스크탑 다리)', () => {
  const DOCS = ['주민등록등본', '주민등록초본', '가족관계증명서', '소득금액증명']
  it('정식 발급명 + 발급 동사 → 그 서류', () => {
    expect(matchIssueIntent('주민등록등본 발급해줘', DOCS)).toBe('주민등록등본')
    expect(matchIssueIntent('가족관계증명서 떼줘', DOCS)).toBe('가족관계증명서')
  })
  it('생활어 축약(등본·초본·소득증명)도 정식명으로 해석', () => {
    expect(matchIssueIntent('등본 좀 떼줘', DOCS)).toBe('주민등록등본')
    expect(matchIssueIntent('초본 발급해주세요', DOCS)).toBe('주민등록초본')
    expect(matchIssueIntent('소득증명 뽑아줘', DOCS)).toBe('소득금액증명')
  })
  it('방법 질문·서류 미지목·미지원 서류는 null(오발동 방지)', () => {
    expect(matchIssueIntent('서류 발급 어떻게 해?', DOCS)).toBeNull()
    expect(matchIssueIntent('등본이 뭐예요?', DOCS)).toBeNull()
    expect(matchIssueIntent('운전면허증 발급해줘', DOCS)).toBeNull()
    expect(matchIssueIntent('한부모증명 떼줘', DOCS)).toBeNull() // 축약이지만 지원 목록 밖이면 안내하지 않음
  })
  it('issueReply — CTA가 나의 복지 + issueDoc(실행 지시)을 함께 담는다', () => {
    const r = issueReply('주민등록등본')
    expect(r.cta?.view).toBe('my')
    expect(r.issueDoc).toBe('주민등록등본')
    expect(r.text).toContain('인증 승인')  // 본인인증은 직접(정직성 문구)
  })
})

describe('matchIssueAllIntent — 💬→🚀 "전부 발급해줘" 연쇄 실행 의도', () => {
  it('전부/다/모두/몽땅 + 발급 요청 동사', () => {
    expect(matchIssueAllIntent('서류 전부 발급해줘')).toBe(true)
    expect(matchIssueAllIntent('다 발급해줘')).toBe(true)
    expect(matchIssueAllIntent('전부 자동발급 해줘')).toBe(true)
    expect(matchIssueAllIntent('몽땅 떼줘')).toBe(true)
  })
  it('상태 질문·단건 지목·방법 질문은 아님(오발동 방지)', () => {
    expect(matchIssueAllIntent('발급 다 됐어?')).toBe(false)
    expect(matchIssueAllIntent('등본 발급해줘')).toBe(false)
    expect(matchIssueAllIntent('서류 발급 어떻게 해?')).toBe(false)
  })
})

describe('matchAutopilotIntent — 🚀 "알아서 다 해줘" 오토파일럿 위임 의도', () => {
  it('위임 표현 + 실행 요청', () => {
    expect(matchAutopilotIntent('알아서 다 해줘')).toBe(true)
    expect(matchAutopilotIntent('끝까지 해줘')).toBe(true)
    expect(matchAutopilotIntent('신청까지 해주나요?')).toBe(true) // 질문이어도 오토파일럿 안내가 정답
    expect(matchAutopilotIntent('오토파일럿 시작')).toBe(true)
    expect(matchAutopilotIntent('전부 알아서 진행해')).toBe(true)
  })
  it('발급 지목·일반 질문은 아님(연쇄/지식 경로와 분리)', () => {
    expect(matchAutopilotIntent('서류 전부 발급해줘')).toBe(false) // 연쇄(issueAll) 경로
    expect(matchAutopilotIntent('등본 발급해줘')).toBe(false)
    expect(matchAutopilotIntent('기초연금 알려줘')).toBe(false)
  })
  it('agentReply: 결과 있으면 run CTA, 없으면 분석 안내(analyze)', () => {
    const withResult = agentReply('알아서 다 해줘', {
      profile, result, tracked: [], agentOn: true,
    })
    expect(withResult.autopilot).toBe('run')
    expect(withResult.cta?.view).toBe('my')
    const noResult = agentReply('알아서 다 해줘', { profile: null, result: null, tracked: [], agentOn: true })
    expect(noResult.autopilot).toBe('analyze')
    expect(noResult.cta?.view).toBe('analyze')
    // 웹(에이전트 미연결)에선 오토파일럿 약속을 하지 않는다(정직성)
    const web = agentReply('알아서 다 해줘', { profile: null, result: null, tracked: [], agentOn: false })
    expect(web.autopilot).toBeUndefined()
  })
})
