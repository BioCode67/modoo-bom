import { describe, it, expect } from 'vitest'
import { buildDocPlan, docPlanToText, docKey, type TrackedRef } from './docPlan'
import type { Policy } from '@/data/policies'

const DAY = 86400000
const NOW = 1_800_000_000_000
const issued = (daysAgo: number) => NOW - daysAgo * DAY

/** 최소 Policy 목 — required_docs 만 의미, 나머지는 형태만 채운다 */
const P = (id: string, name: string, docs: string[]): Policy =>
  ({ id, name, category: '기타', target: '', eligibility: '', benefit: '', summary: '',
     how: '', link: '', deadline: '', agency: '', required_docs: docs } as unknown as Policy)

function mapOf(...ps: Policy[]): Record<string, Policy> {
  return Object.fromEntries(ps.map((p) => [p.id, p]))
}
function track(...ids: string[]): TrackedRef[] {
  return ids.map((policyId) => ({ policyId }))
}

describe('docKey — 정식명 정규화 키', () => {
  it('표기 변형을 같은 키로 묶는다(자녀 주민등록등본 = 주민등록등본)', () => {
    expect(docKey('자녀 주민등록등본')).toBe(docKey('주민등록등본'))
    expect(docKey('통장 사본')).toBe(docKey('통장사본'))
  })
})

describe('buildDocPlan — 서류 통합/재사용', () => {
  const A = P('POL-1', '기초연금', ['주민등록등본', '통장 사본', '소득·재산 신고서'])
  const B = P('POL-2', '장애수당', ['주민등록등본', '장애인증명서', '통장 사본'])
  const C = P('POL-3', '한부모지원', ['주민등록등본', '한부모가족 증명서'])

  it('여러 정책의 같은 서류를 하나로 합치고 재사용 정책을 모은다', () => {
    const plan = buildDocPlan(track('POL-1', 'POL-2', 'POL-3'), mapOf(A, B, C), {}, NOW)
    const deungbon = plan.needs.find((n) => n.name === '주민등록등본')!
    expect(deungbon.policies.map((p) => p.id).sort()).toEqual(['POL-1', 'POL-2', 'POL-3'])
    // 고유 서류: 등본, 통장사본, 소득재산신고서, 장애인증명서, 한부모가족증명서 = 5종
    expect(plan.uniqueDocs).toBe(5)
    expect(plan.totalPolicies).toBe(3)
    // 재사용 1위 = 등본(3개 신청 공용)
    expect(plan.topReuse?.name).toBe('주민등록등본')
    expect(plan.topReuse?.policies.length).toBe(3)
  })

  it('rawDocs 는 합치기 전 총 언급 수(8건)', () => {
    const plan = buildDocPlan(track('POL-1', 'POL-2', 'POL-3'), mapOf(A, B, C), {}, NOW)
    expect(plan.rawDocs).toBe(3 + 3 + 2)
  })

  it('한 정책이 같은 서류를 두 번 적어도 그 정책은 한 번만 카운트', () => {
    const dup = P('POL-D', '중복서류정책', ['주민등록등본', '자녀 주민등록등본'])
    const plan = buildDocPlan(track('POL-D'), mapOf(dup), {}, NOW)
    const need = plan.needs.find((n) => n.name === '주민등록등본')!
    expect(need.policies.length).toBe(1)
  })

  it('required_docs 가 없는 정책은 totalPolicies 에서 제외', () => {
    const empty = P('POL-E', '서류없음', [])
    const plan = buildDocPlan(track('POL-1', 'POL-E'), mapOf(A, empty), {}, NOW)
    expect(plan.totalPolicies).toBe(1)
  })

  it('정책맵에 없는 추적 id 는 건너뛴다(크래시 없음)', () => {
    const plan = buildDocPlan(track('POL-1', 'GHOST'), mapOf(A), {}, NOW)
    expect(plan.totalPolicies).toBe(1)
    expect(plan.uniqueDocs).toBe(3)
  })

  it('추적이 비면 빈 플랜 + 안내 요약', () => {
    const plan = buildDocPlan([], mapOf(A), {}, NOW)
    expect(plan.uniqueDocs).toBe(0)
    expect(plan.topReuse).toBeNull()
    expect(plan.summary).toMatch(/아직 없어요/)
  })
})

describe('buildDocPlan — 발급/유효기간 반영', () => {
  const A = P('POL-1', '기초연금', ['주민등록등본', '소득금액증명', '신분증'])

  it('발급 안 한 서류는 missing', () => {
    const plan = buildDocPlan(track('POL-1'), mapOf(A), {}, NOW)
    expect(plan.needs.every((n) => n.status === 'missing')).toBe(true)
    expect(plan.missingCount).toBe(3)
  })

  it('갓 발급한 등본은 ready + 유효기간 채워짐', () => {
    const plan = buildDocPlan(track('POL-1'), mapOf(A), { 주민등록등본: issued(0) }, NOW)
    const d = plan.needs.find((n) => n.name === '주민등록등본')!
    expect(d.status).toBe('ready')
    expect(d.validity?.daysLeft).toBe(90)
  })

  it('80일 지난 등본은 expiring, 100일 지난 것은 expired', () => {
    const plan1 = buildDocPlan(track('POL-1'), mapOf(A), { 주민등록등본: issued(80) }, NOW)
    expect(plan1.needs.find((n) => n.name === '주민등록등본')!.status).toBe('expiring')
    expect(plan1.expiringCount).toBe(1)
    const plan2 = buildDocPlan(track('POL-1'), mapOf(A), { 주민등록등본: issued(100) }, NOW)
    expect(plan2.needs.find((n) => n.name === '주민등록등본')!.status).toBe('expired')
    expect(plan2.expiredCount).toBe(1)
  })

  it('비발급 서류(신분증)를 발급표시해도 만료 없이 ready(거짓 만료 안 함)', () => {
    const plan = buildDocPlan(track('POL-1'), mapOf(A), { 신분증: issued(400) }, NOW)
    const idc = plan.needs.find((n) => n.name === '신분증')!
    expect(idc.status).toBe('ready')
    expect(idc.validity?.freshness).toBe('permanent')
  })

  it('변형 표기로 발급해도 정식명 서류의 발급으로 인정', () => {
    // docDone 키가 변형('자녀주민등록등본')이어도 등본 need 에 매칭
    const plan = buildDocPlan(track('POL-1'), mapOf(A), { 자녀주민등록등본: issued(0) }, NOW)
    expect(plan.needs.find((n) => n.name === '주민등록등본')!.status).toBe('ready')
  })

  it('자동발급 대상 여부(issuable) 표시 — 등본 O, 임의 서류 X', () => {
    const misc = P('POL-M', '기타정책', ['주민등록등본', '재직증명서'])
    const plan = buildDocPlan(track('POL-M'), mapOf(misc), {}, NOW)
    expect(plan.needs.find((n) => n.name === '주민등록등본')!.issuable).toBe(true)
    expect(plan.needs.find((n) => n.name === '재직증명서')!.issuable).toBe(false)
    expect(plan.issuableMissing).toBe(1) // 등본만 자동발급 가능한 미발급
  })
})

describe('buildDocPlan — 우선순위 정렬', () => {
  it('만료 > 임박 > 미발급 > 완료 순, 동급이면 재사용 많은 순', () => {
    const A = P('POL-1', 'A정책', ['만료서류', '임박서류', '미발급공용', '완료서류'])
    const B = P('POL-2', 'B정책', ['미발급공용']) // 미발급공용을 2개 정책이 공유
    // 모두 자동발급 밖 이름이라 만료 없음이지만, docDone 시각으로 상태를 강제로 만든다:
    // → 실제 만료판정은 발급형만 되므로, 여기선 발급형 서류로 시나리오를 만든다.
    const S = P('POL-S', '정렬시나리오', ['주민등록등본', '소득금액증명', '가족관계증명서', '건강보험 자격득실확인서'])
    const T = P('POL-T', '공용정책', ['건강보험 자격득실확인서'])
    const plan = buildDocPlan(track('POL-S', 'POL-T'), mapOf(S, T), {
      주민등록등본: issued(100),     // expired
      소득금액증명: issued(85),      // expiring(5일 남음)
      가족관계증명서: issued(0),     // ready
      // 건강보험 자격득실확인서: 미발급(missing), 2개 정책 공용
    }, NOW)
    const order = plan.needs.map((n) => n.name)
    expect(order[0]).toBe('주민등록등본')       // expired 최우선
    expect(order[1]).toBe('소득금액증명')        // expiring
    expect(order[2]).toBe('건강보험 자격득실확인서') // missing(공용)
    expect(order[3]).toBe('가족관계증명서')       // ready 마지막
    void A; void B
  })
})

describe('docPlanToText — 사람이 읽는 요약', () => {
  it('상태 마크·재사용·유효기간·정직성 문구 포함', () => {
    const A = P('POL-1', '기초연금', ['주민등록등본'])
    const B = P('POL-2', '장애수당', ['주민등록등본'])
    const txt = docPlanToText(buildDocPlan(track('POL-1', 'POL-2'), mapOf(A, B), { 주민등록등본: issued(0) }, NOW))
    expect(txt).toMatch(/필요 서류 정리/)
    expect(txt).toMatch(/주민등록등본/)
    expect(txt).toMatch(/2개 신청 공용/)
    expect(txt).toMatch(/접수 기관 요구가 우선/)
  })
  it('빈 플랜은 안내 한 줄', () => {
    expect(docPlanToText(buildDocPlan([], {}, {}, NOW))).toMatch(/서류 정보가 없습니다/)
  })
})
