import { describe, it, expect } from 'vitest'
import { matchMyths, pickEvidence, MYTH_RULES, type MythSeverity } from './misconceptions'
import type { EligiblePolicy, UserProfile } from './welfare-engine'

// ── 픽스처 ── (matchMyths는 eligible를 인자로 받으므로 순수 함수로 결정적 검증 가능)
const base: UserProfile = {
  name: '', age: 30, gender: 'other', region: '', household_type: '', income_percentile: 50,
  disability: false, disability_grade: '', employment_status: '', has_children: false,
  children_ages: [], is_pregnant: false, life_events: [],
}
const EP = (over: Partial<EligiblePolicy>): EligiblePolicy => ({
  id: 'POL-X', name: '정책', category: '', target: '', benefit: '', eligibility: '',
  required_docs: [], application: '', department: '', renewal: '',
  reason: '', priority: 'high', confidence: 0.9, ...over,
})

// 생계급여: '소득인정액'(재산 근거) + '부양의무자 … 폐지'(부양의무자 근거)를 원문에 담음
const 생계 = EP({
  id: 'POL-002', name: '생계급여', category: '저소득',
  eligibility: '소득인정액이 기준 중위소득 32% 이하 (2026년), 부양의무자 기준 대부분 폐지(고소득·고재산 예외만)',
  target: '기준 중위소득 32% 이하 가구',
})
// 장애수당: '등록 장애인'(경증 근거) — 중증장애인 하드조건이 아님
const 장애수당 = EP({
  id: 'POL-020', name: '장애수당', category: '장애인',
  eligibility: '만 18세 이상 등록 장애인 중 차상위 이하 (재산·소득 심사)',
  target: '등록 장애인',
})
// 장애인연금: '중증장애인' 하드조건 → 경증 근거로 쓰이면 안 됨(오인용 방지 검증용)
const 장애인연금 = EP({
  id: 'POL-003', name: '장애인연금', category: '장애인',
  eligibility: '만 18세 이상 등록 중증장애인 중 소득 하위 70%',
  target: '중증장애인',
})
// 다문화: '결혼이민자·다문화가족'(외국인 근거)
const 다문화 = EP({
  id: 'POL-050', name: '다문화가족 지원', category: '가족',
  eligibility: '결혼이민자 또는 귀화자를 포함한 다문화가족',
  target: '다문화가족',
})
// 청년월세: 어떤 통념 근거 키워드도 없음(work·reapply의 basis 폴백 검증용)
const 청년월세 = EP({
  id: 'POL-070', name: '청년 월세 지원', category: '청년',
  eligibility: '만 19~34세 무주택 청년', target: '청년',
})

const ids = (ms: { id: string }[]) => ms.map((m) => m.id)

describe('matchMyths — 재산(asset) 통념', () => {
  it('저소득 + 소득인정액 적격 정책이면 걸리고, 근거로 원문을 인용한다', () => {
    const ms = matchMyths({ ...base, income_percentile: 30, employment_status: 'employed' }, [생계])
    const asset = ms.find((m) => m.id === 'asset')
    expect(asset).toBeTruthy()
    expect(asset!.severity).toBe('blocks')
    expect(asset!.evidencePolicyIds).toContain('POL-002')
    expect(asset!.evidenceText).toContain('소득인정액')
    // 정직성 라벨: 반박 끝에 '심사에서 확정' 취지
    expect(asset!.truth).toContain('심사')
    expect(asset!.appliesWhy.length).toBeGreaterThan(0)
  })

  it('고소득(중위 95%)이면 재산 통념을 억지로 붙이지 않는다', () => {
    const ms = matchMyths({ ...base, income_percentile: 95 }, [생계])
    expect(ids(ms)).not.toContain('asset')
  })
})

describe('matchMyths — 부양의무자(dependant) 통념', () => {
  it('저소득 + 자녀 + 부양의무자 원문이면 걸리고 해당 절을 인용', () => {
    const ms = matchMyths({ ...base, income_percentile: 30, has_children: true, children_ages: [10] }, [생계])
    const dep = ms.find((m) => m.id === 'dependant')
    expect(dep).toBeTruthy()
    expect(dep!.evidencePolicyIds).toContain('POL-002')
    expect(dep!.evidenceText).toContain('부양의무자')
    expect(dep!.severity).toBe('blocks')
  })

  it('자녀도 없고 60세 미만이면 부양의무자 통념 미발동', () => {
    const ms = matchMyths({ ...base, age: 30, income_percentile: 30, has_children: false }, [생계])
    expect(ids(ms)).not.toContain('dependant')
  })
})

describe('matchMyths — 근로소득(work) 통념: basis 폴백', () => {
  it('재직 + 저소득이면 걸리되, 근거 원문이 없으면 규칙 기본 근거(빈 ids)로 폴백', () => {
    const ms = matchMyths({ ...base, income_percentile: 40, employment_status: 'employed' }, [청년월세])
    const work = ms.find((m) => m.id === 'work')
    expect(work).toBeTruthy()
    expect(work!.severity).toBe('reduces')
    expect(work!.evidencePolicyIds).toHaveLength(0) // 근로소득·차상위 원문 없음 → 폴백
    expect(work!.evidenceText).toContain('근로소득공제') // 규칙 기본 근거
  })

  it('무직(unemployed)에게는 근로소득 통념을 붙이지 않는다', () => {
    const ms = matchMyths({ ...base, income_percentile: 40, employment_status: 'unemployed' }, [청년월세])
    expect(ids(ms)).not.toContain('work')
  })
})

describe('matchMyths — 재신청(reapply) 통념', () => {
  it('최근 생애 변화(실직 등)가 있으면 재신청 통념 발동(근거 없으면 basis)', () => {
    const ms = matchMyths({ ...base, income_percentile: 45, life_events: ['실직'] }, [생계])
    const re = ms.find((m) => m.id === 'reapply')
    expect(re).toBeTruthy()
    expect(re!.severity).toBe('blocks')
    expect(re!.appliesWhy).toContain('실직')
    expect(re!.truth).toContain('심사')
  })

  it('생애 변화 신호가 없으면 재신청 통념 미발동(억측 금지)', () => {
    const ms = matchMyths({ ...base, income_percentile: 45, life_events: [] }, [생계])
    expect(ids(ms)).not.toContain('reapply')
  })
})

describe('matchMyths — 경증 장애(disability-mild) 통념', () => {
  it('경증(5급) 등록 장애인 + 경증 대상 정책이면 발동·인용', () => {
    const ms = matchMyths({ ...base, disability: true, disability_grade: '5급' }, [장애수당])
    const d = ms.find((m) => m.id === 'disability-mild')
    expect(d).toBeTruthy()
    expect(d!.evidencePolicyIds).toContain('POL-020')
    expect(d!.evidenceText).toContain('등록 장애인')
  })

  it('중증(1급)에게는 발동하지 않고, 중증전용 정책은 경증 근거로 오인용하지 않는다', () => {
    const 중증 = matchMyths({ ...base, disability: true, disability_grade: '1급' }, [장애인연금])
    expect(ids(중증)).not.toContain('disability-mild')
    // 경증 프로필이라도 evidenceMatch는 중증전용 정책을 근거로 채택하지 않아야
    const rule = MYTH_RULES.find((r) => r.id === 'disability-mild')!
    expect(rule.evidenceMatch(장애인연금)).toBe(false)
    expect(rule.evidenceMatch(장애수당)).toBe(true)
  })
})

describe('matchMyths — 외국인·다문화(foreigner) 통념', () => {
  it('다문화가족이면 발동하고 결혼이민 원문을 인용(info 등급)', () => {
    const ms = matchMyths({ ...base, household_type: '다문화가족' }, [다문화])
    const f = ms.find((m) => m.id === 'foreigner')
    expect(f).toBeTruthy()
    expect(f!.severity).toBe('info')
    expect(f!.evidencePolicyIds).toContain('POL-050')
    expect(f!.evidenceText).toContain('결혼이민')
  })
})

describe('matchMyths — 정렬·경계', () => {
  it('severity 순(blocks>reduces>info)으로 정렬한다', () => {
    // asset(blocks)·work(reduces)·foreigner(info)이 동시 발동하도록 구성
    const p: UserProfile = { ...base, income_percentile: 30, employment_status: 'employed', household_type: '다문화가족' }
    const ms = matchMyths(p, [생계, 다문화])
    const order = ms.map((m) => m.severity) as MythSeverity[]
    const rank: Record<MythSeverity, number> = { blocks: 0, reduces: 1, info: 2 }
    for (let i = 1; i < order.length; i++) expect(rank[order[i]]).toBeGreaterThanOrEqual(rank[order[i - 1]])
    expect(ids(ms)).toEqual(['asset', 'work', 'foreigner'])
  })

  it('같은 심각도면 임팩트(근거 적격 정책 수) 큰 통념을 먼저 둔다', () => {
    // asset·dependant 둘 다 blocks. 재산 근거는 생계·장애수당 2건(impact 2),
    // 부양의무자 근거는 생계 1건(impact 1) → 2차 정렬로 asset이 dependant보다 앞.
    const p: UserProfile = { ...base, income_percentile: 30, has_children: true, children_ages: [10] }
    const ms = matchMyths(p, [생계, 장애수당])
    const order = ids(ms)
    expect(order).toContain('asset')
    expect(order).toContain('dependant')
    expect(ms.find((m) => m.id === 'asset')!.severity).toBe('blocks')
    expect(ms.find((m) => m.id === 'dependant')!.severity).toBe('blocks')
    expect(order.indexOf('asset')).toBeLessThan(order.indexOf('dependant'))
  })

  it('적격 정책이 없으면(빈 배열) 어떤 통념도 만들지 않는다(억지로 겁주지 않음)', () => {
    const ms = matchMyths({ ...base, income_percentile: 20, employment_status: 'employed', life_events: ['실직'] }, [])
    expect(ms).toHaveLength(0)
  })

  it('스키마가 빠진 부분 프로필/undefined 인자에도 크래시하지 않는다', () => {
    const partial = {
      ...base, life_events: undefined, children_ages: undefined, household_type: undefined,
      employment_status: undefined, disability_grade: undefined,
    } as unknown as UserProfile
    expect(() => matchMyths(partial, undefined as unknown as EligiblePolicy[])).not.toThrow()
    const out = matchMyths(partial, undefined as unknown as EligiblePolicy[])
    expect(Array.isArray(out)).toBe(true)
  })
})

describe('pickEvidence — 근거 인용/폴백', () => {
  it('근거가 있으면 적격 정책 id·원문을 반환', () => {
    const rule = MYTH_RULES.find((r) => r.id === 'asset')!
    const { ids: eids, text } = pickEvidence(rule, [생계])
    expect(eids).toEqual(['POL-002'])
    expect(text).toContain('생계급여')
    expect(text).toContain('소득인정액')
  })

  it('근거가 없으면 빈 ids + 규칙 기본 근거(basis)로 폴백', () => {
    const rule = MYTH_RULES.find((r) => r.id === 'asset')!
    const { ids: eids, text } = pickEvidence(rule, [])
    expect(eids).toHaveLength(0)
    expect(text).toBe(rule.basis)
  })
})

describe('MYTH_RULES — 규칙셋 형태·정직성', () => {
  it('핵심 통념 6종이 고유 id로 존재하고, 각 규칙이 온전한 형태다', () => {
    const need = ['asset', 'dependant', 'work', 'reapply', 'disability-mild', 'foreigner']
    for (const id of need) expect(MYTH_RULES.some((r) => r.id === id)).toBe(true)
    expect(new Set(MYTH_RULES.map((r) => r.id)).size).toBe(MYTH_RULES.length) // id 중복 없음
    for (const r of MYTH_RULES) {
      expect(typeof r.trigger).toBe('function')
      expect(typeof r.evidenceMatch).toBe('function')
      expect(typeof r.appliesWhy).toBe('function')
      expect(typeof r.basis).toBe('string')
      expect(r.evidenceRe.global).toBe(false) // 전역 플래그 금지(.test 상태 오염 방지)
      expect(r.truth).toContain('심사') // 정직성 라벨이 모든 반박에 포함
    }
  })
})

describe('태도 장벽 규칙 — 대화 전용(카드 자동노출 안 함)', () => {
  it('complex·healthy 규칙이 존재하고 trigger는 항상 false', async () => {
    const { MYTH_RULES } = await import('./misconceptions')
    for (const id of ['complex', 'healthy']) {
      const rule = MYTH_RULES.find((r) => r.id === id)
      expect(rule).toBeTruthy()
      expect(rule!.trigger({} as never, [])).toBe(false)
      expect(rule!.truth).toMatch(/최종 자격|심사/) // 정직성 라벨
    }
  })
})

describe('자동 트리거 오해 — 1인가구·중산층', () => {
  const base = {
    name: '테스트', age: 40, gender: 'male' as const, region: '서울', household_type: '3인가구',
    income_percentile: 30, disability: false, disability_grade: '', employment_status: 'employed',
    has_children: false, children_ages: [] as number[], is_pregnant: false, life_events: [] as string[],
  }
  const elig = [{ id: 'POL-X', name: '주거급여', category: '주거', target: '저소득', benefit: '월 20만원',
    eligibility: '1인 가구 포함 주거 지원', required_docs: [], application: '복지로', department: '', renewal: '',
    reason: '', priority: 'medium' as const, confidence: 0.8 }]

  it('1인 가구 + 적격 → single 오해가 카드에 뜬다', () => {
    const myths = matchMyths({ ...base, household_type: '1인가구' }, elig)
    expect(myths.some((m) => m.id === 'single')).toBe(true)
  })
  it('중위 50~95% 소득 + 적격 → middle-income 오해가 카드에 뜬다', () => {
    const myths = matchMyths({ ...base, income_percentile: 60 }, elig)
    expect(myths.some((m) => m.id === 'middle-income')).toBe(true)
  })
  it('저소득(중위 30%)엔 middle-income 오해가 안 뜬다(오발동 방지)', () => {
    const myths = matchMyths({ ...base, income_percentile: 30 }, elig)
    expect(myths.some((m) => m.id === 'middle-income')).toBe(false)
  })
})
