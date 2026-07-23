import { describe, it, expect } from 'vitest'
import type { UserProfile } from './welfare-engine'
import { getEligiblePolicies } from './welfare-engine'
import { matchMyths } from './misconceptions'
import { scanProfileGaps } from './profileGaps'
import { applyTiming } from './applyTiming'
import { docReuseMap } from './docReuse'

/**
 * 신규 기능 종단 통합 — 대표 페르소나를 실제 엔진(getEligiblePolicies)+실데이터로 통과시켜
 * 오해진단·숨은자격·신청타이밍·서류재사용이 크래시 없이 '정직한 구조'로 동작하는지 고정한다.
 * (단위 테스트는 합성 입력, 이건 실카탈로그 통합 — 필드 누락·경계에서 조용히 깨지는 걸 잡는다.)
 */

const PERSONAS: Record<string, UserProfile> = {
  노인저소득: {
    name: '김노인', age: 72, gender: 'female', region: '서울', household_type: '1인가구',
    income_percentile: 20, disability: false, disability_grade: '', employment_status: 'retired',
    has_children: true, children_ages: [45], is_pregnant: false, life_events: [],
  },
  청년: {
    name: '이청년', age: 26, gender: 'male', region: '경기', household_type: '1인가구',
    income_percentile: 45, disability: false, disability_grade: '', employment_status: 'employed',
    has_children: false, children_ages: [], is_pregnant: false, life_events: ['독립'],
  },
  신생아부모: {
    name: '박부모', age: 32, gender: 'female', region: '부산', household_type: '3인가구',
    income_percentile: 50, disability: false, disability_grade: '', employment_status: 'employed',
    has_children: true, children_ages: [0], is_pregnant: false, life_events: ['출산'],
  },
  장애인경증: {
    name: '최장애', age: 45, gender: 'male', region: '대구', household_type: '2인가구',
    income_percentile: 40, disability: true, disability_grade: '5급', employment_status: 'unemployed',
    has_children: false, children_ages: [], is_pregnant: false, life_events: [],
  },
  실직자: {
    name: '정실직', age: 40, gender: 'male', region: '인천', household_type: '4인가구',
    income_percentile: 55, disability: false, disability_grade: '', employment_status: 'unemployed',
    has_children: true, children_ages: [8, 12], is_pregnant: false, life_events: ['실직'],
  },
  예순넷: {
    name: '한은퇴', age: 64, gender: 'male', region: '광주', household_type: '2인가구',
    income_percentile: 35, disability: false, disability_grade: '', employment_status: 'retired',
    has_children: true, children_ages: [30], is_pregnant: false, life_events: [],
  },
}

describe.each(Object.entries(PERSONAS))('페르소나 종단 통합 — %s', (_name, profile) => {
  const eligible = getEligiblePolicies(profile)

  it('오해 진단(matchMyths)이 정직한 구조로 동작', () => {
    const myths = matchMyths(profile, eligible)
    expect(Array.isArray(myths)).toBe(true)
    for (const m of myths) {
      expect(m.truth).toMatch(/최종 자격|심사/)          // HONESTY 라벨
      expect(['blocks', 'reduces', 'info']).toContain(m.severity)
      expect(m.belief.length).toBeGreaterThan(0)
      // 태도 장벽(complex/healthy)은 카드로 자동노출되지 않아야(trigger:false)
      expect(['complex', 'healthy']).not.toContain(m.id)
    }
  })

  it('숨은 자격(scanProfileGaps)이 delta 0/채워진 차원을 제외', () => {
    const gaps = scanProfileGaps(profile, { limit: 3 })
    expect(gaps.length).toBeLessThanOrEqual(3)
    for (const g of gaps) {
      expect(g.newCount).toBeGreaterThan(0)              // 새로 열리는 게 없으면 제외
      expect(g.monthlyDelta).toBeGreaterThanOrEqual(0)
      expect(g.note).toMatch(/추정|해당/)                 // 정직 라벨
    }
  })

  it('신청 골든타임(applyTiming)이 구조적으로 유효', () => {
    const alerts = applyTiming(profile, eligible)
    for (const a of alerts) {
      expect(['retroactive', 'preapply', 'deadline']).toContain(a.kind)
      expect(['high', 'medium']).toContain(a.urgency)
      expect(a.detail.length).toBeGreaterThan(0)
      // 소급·사전신청은 '주민센터 확인' 하지(정직); 기한은 정책명+기한라벨(사실)이라 별도
      if (a.kind !== 'deadline') expect(a.detail).toMatch(/확인|서두|미리/)
      expect(a.lossRisk.length).toBeGreaterThan(0)
    }
    // high가 medium보다 앞선다(정렬 계약)
    const urg = alerts.map((a) => a.urgency)
    const firstMed = urg.indexOf('medium')
    if (firstMed >= 0) expect(urg.slice(firstMed).every((u) => u === 'medium')).toBe(true)
  })

  it('서류 재사용(docReuseMap)이 공유 서류를 바르게 집계', () => {
    const plan = docReuseMap(eligible)
    expect(plan.totalPolicies).toBe(eligible.length)
    for (const d of plan.shared) {
      expect(d.count).toBeGreaterThanOrEqual(2)          // 공유(2곳+)만
      expect(d.policyNames.length).toBe(d.count)
    }
    expect(plan.savedCount).toBeGreaterThanOrEqual(0)
  })

})

// ── 페르소나별 '기대 동작' 고정(결정적 트리거) ──
describe('페르소나별 기대 동작', () => {
  it('신생아 부모는 출생 관련 복지가 적격이면 소급(retroactive) 알림', () => {
    const p = PERSONAS.신생아부모
    const eligible = getEligiblePolicies(p)
    const hasRetroPolicy = eligible.some((e) => /아동수당|부모급여|첫만남|영아수당|양육수당/.test(e.name))
    const alerts = applyTiming(p, eligible)
    const retro = alerts.find((a) => a.kind === 'retroactive')
    if (hasRetroPolicy) {
      expect(retro).toBeTruthy()
      expect(retro!.urgency).toBe('high')
    }
  })

  it('만 64세는 기초연금 사전신청(preapply) 안내(적격 무관·나이 신호)', () => {
    const alerts = applyTiming(PERSONAS.예순넷, getEligiblePolicies(PERSONAS.예순넷))
    expect(alerts.some((a) => a.kind === 'preapply')).toBe(true)
  })

  it('경증 장애인은 대화에서 경증 오해를 바로잡을 수 있다(카드 아님·규칙 존재)', async () => {
    // 카드 자동노출(matchMyths)엔 disability-mild가 트리거될 수도/아닐 수도 있으나,
    // 규칙 자체는 항상 존재해 대화 인텐트가 참조할 수 있어야 한다.
    const { MYTH_RULES } = await import('./misconceptions')
    expect(MYTH_RULES.some((r) => r.id === 'disability-mild')).toBe(true)
  })
})
