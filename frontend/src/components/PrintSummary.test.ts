import { describe, it, expect } from 'vitest'
import { printHeadline } from './PrintSummary'
import { getEligiblePolicies, type EligiblePolicy, type UserProfile } from '@/lib/welfare-engine'
import { sumCashMonthly } from '@/lib/format'
import type { Policy } from '@/data/policies'

// EligiblePolicy 픽스처 — 인쇄 헤더 판정에 쓰이는 필드(id·benefit·priority)만 의미 있게 채운다
const mk = (id: string, benefit: string, priority: 'high' | 'medium' | 'low', name = '테스트 복지'): EligiblePolicy =>
  ({
    id, name, category: '생활지원', target: '', benefit, eligibility: '', required_docs: [],
    application: '복지로 온라인 신청', department: '', renewal: '',
    reason: '', priority, confidence: 0.9,
  } as EligiblePolicy)

describe('printHeadline — 인쇄 헤더는 화면 헤더와 동일한 보수 기준(과장 금지)', () => {
  // 회귀(정직성): 인쇄물이 관련복지(GOV-/LOC-)·중간/낮음 우선순위 현금까지 전부 합산해
  // 화면(핵심 현금지원 = POL- 강력추천 현금성)보다 부풀린 금액·건수를 찍던 결함을 고정한다.
  it('분석 결과 경로: POL- 강력추천(high) 현금성만 합산 — 관련복지·medium/low 제외', () => {
    const eligible = [
      mk('POL-001', '월 30만원 지급', 'high'),           // 포함
      mk('POL-002', '월 50만원 지급', 'medium'),         // 제외(강력추천 아님)
      mk('GOV-WLF00000001', '월 100만원 지급', 'high'),  // 제외(요약형 관련복지)
      mk('LOC-000001', '월 40만원 지급', 'high'),        // 제외(지자체 요약형)
    ]
    const head = printHeadline(eligible, true)
    expect(head.monthlyTotal).toBe(300000)
    expect(head.countLabel).toBe('맞춤 2건 · 관련 2건')
    expect(head.amountLabel).toContain('강력추천 현금성만 보수 합산')
    expect(head.amountLabel).toContain('중복수급 미반영')
  })

  it('관련복지가 없으면 건수는 맞춤만 표기', () => {
    const head = printHeadline([mk('POL-001', '월 30만원 지급', 'high')], true)
    expect(head.countLabel).toBe('맞춤 1건')
  })

  it('비현금(바우처 등)은 강력추천이어도 합산 제외', () => {
    const head = printHeadline([mk('POL-001', '월 30만원 바우처', 'high')], true)
    expect(head.monthlyTotal).toBe(0)
    expect(head.amountLabel).toBe('') // 금액 없으면 문구도 생략
  })

  it('관심목록 폴백: 사용자가 직접 담은 목록은 전체 현금성 합산 유지(현행 동작)', () => {
    const tracked: Policy[] = [
      mk('POL-001', '월 30만원 지급', 'high'),
      mk('GOV-WLF00000001', '월 20만원 지급', 'low'), // 직접 담은 것 — 폴백에선 포함
    ]
    const head = printHeadline(tracked, false)
    expect(head.monthlyTotal).toBe(500000)
    expect(head.countLabel).toBe('수혜 가능 2건')
  })

  it('빈 입력 안전', () => {
    const head = printHeadline([], true)
    expect(head.monthlyTotal).toBe(0)
    expect(head.countLabel).toBe('맞춤 0건')
  })

  // 파리티 회귀(실엔진): 화면 헤더(ResultsView)의 '핵심 현금지원' 공식과 동일한 값이어야 하고,
  // 구버전(전체 eligible 합산)의 부풀린 값보다 작아야 한다(72세·중위30% 실측 재현 프로필).
  it('실엔진 파리티 — 화면 헤더 공식과 일치, 전체 합산(구버전)보다 작다', () => {
    const p: UserProfile = {
      name: '어르신', age: 72, gender: 'female', region: '서울', household_type: '1인가구',
      income_percentile: 30, disability: false, disability_grade: '', employment_status: 'unemployed',
      has_children: false, children_ages: [], is_pregnant: false, life_events: [],
    }
    const eligible = getEligiblePolicies(p)
    const head = printHeadline(eligible, true)
    // 화면 헤더(ResultsView) 공식: primary(POL-) 중 priority high의 현금성 보수 합산
    const screen = sumCashMonthly(eligible.filter((x) => /^POL-/.test(x.id) && x.priority === 'high'))
    expect(head.monthlyTotal).toBe(screen)
    // 구버전 인쇄물은 전체를 합산해 부풀렸다 — 그 값으로 되돌아가면 실패
    expect(head.monthlyTotal).toBeLessThan(sumCashMonthly(eligible))
  })
})
