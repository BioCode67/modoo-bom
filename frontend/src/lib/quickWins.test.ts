import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { quickWins } from './quickWins'
import { getEligiblePolicies, type UserProfile } from './welfare-engine'
import { isBokjiroApplyable } from '@/lib/quickApply'
import type { Policy } from '@/data/policies'

const BOKJIRO = 'https://www.bokjiro.go.kr/ssis-teu/twataa/wlfareInfo/moveTWAT52011M.do?wlfareInfoId=WLF00000999'

const mk = (id: string, name: string, application: string, docs: string[], benefit = '월 20만원'): Policy =>
  ({ id, name, category: '주거', target: '', benefit, eligibility: '', required_docs: docs, application, department: '', renewal: '' } as Policy)

describe('quickWins — 지금 바로 온라인 완결 가능', () => {
  it('복지로 온라인 신청 + 방문 없는 서류만 → 포함', () => {
    const wins = quickWins([
      mk('A', '무서류 온라인', BOKJIRO, []),                       // 서류 없음 → 포함
      mk('B', '공동이용 서류', BOKJIRO, ['주민등록등본']),          // 등본=전자발급/공동이용 → 포함
    ])
    const ids = wins.map((w) => w.policy.id)
    expect(ids).toContain('A')
    expect(ids).toContain('B')
  })

  it('방문·기관발급 서류가 있으면 제외', () => {
    const wins = quickWins([mk('C', '계약서 필요', BOKJIRO, ['임대차계약서'])])
    expect(wins.map((w) => w.policy.id)).not.toContain('C')
  })

  it('복지로 온라인 신청이 아니면 제외(방문형)', () => {
    const wins = quickWins([mk('D', '방문 신청', '주민센터 방문 신청', [])])
    expect(wins.map((w) => w.policy.id)).not.toContain('D')
  })

  it('현금 많은 순 정렬 + noDocs 플래그', () => {
    const wins = quickWins([
      mk('LOW', '적음', BOKJIRO, [], '월 10만원'),
      mk('HIGH', '많음', BOKJIRO, [], '월 50만원'),
    ])
    expect(wins[0].policy.id).toBe('HIGH')
    expect(wins.every((w) => w.noDocs)).toBe(true)
  })

  it('빈 입력 안전', () => {
    expect(quickWins([])).toEqual([])
  })

  // 회귀(정직성): 공공데이터 요약형은 required_docs가 원천 부재(전건 빈 배열) —
  // 빈 배열을 '서류 없이 바로'로 단정하면 기관 운영지원 사업(개인 온라인신청 불가)까지
  // '지금 바로'로 오보하던 결함을 고정한다.
  it('요약형 공공데이터(GOV-/LOC-)는 서류 정보가 없으면(빈 배열) 제외 — 정보 부재 ≠ 서류 없음', () => {
    const DETAIL = 'https://www.bokjiro.go.kr/ssis-tbu/twataa/wlfareInfo/moveTWAT52011M.do?wlfareInfoId=WLF00001084'
    const wins = quickWins([
      mk('GOV-WLF00001084', '여성긴급전화 1366센터 운영 지원', DETAIL, []), // 기관 운영지원 — 개인 신청 대상 아님
      mk('LOC-000001', '지자체 요약형 정책', DETAIL, []),
    ])
    expect(wins).toEqual([])
  })

  it('검증 시드(POL-)의 빈 서류는 실측 정보 — 계속 포함', () => {
    const wins = quickWins([mk('POL-001', '시드 무서류 복지', BOKJIRO, [])])
    expect(wins.map((w) => w.policy.id)).toContain('POL-001')
    expect(wins[0].noDocs).toBe(true)
  })

  it('요약형이라도 서류 정보가 실제로 있으면 기존 판정 유지', () => {
    const wins = quickWins([mk('GOV-X', '서류 명시 요약형', BOKJIRO, ['주민등록등본'])])
    expect(wins.map((w) => w.policy.id)).toContain('GOV-X')
    expect(wins[0].noDocs).toBe(false)
  })

  it('실카탈로그 통합 — 결과는 전부 복지로 신청형이고 구조가 유효', () => {
    const p: UserProfile = {
      name: '청년', age: 26, gender: 'male', region: '서울', household_type: '1인가구',
      income_percentile: 45, disability: false, disability_grade: '', employment_status: 'employed',
      has_children: false, children_ages: [], is_pregnant: false, life_events: [],
    }
    const wins = quickWins(getEligiblePolicies(p))
    for (const w of wins) {
      expect(w.monthly).toBeGreaterThanOrEqual(0)
      expect(typeof w.noDocs).toBe('boolean')
      // 요약형(GOV-/LOC-)이 결과에 있다면 반드시 서류 정보가 실재해야 한다(빈 배열 통과 금지)
      if (/^(GOV|LOC)-/.test(w.policy.id)) expect(w.policy.required_docs.length).toBeGreaterThan(0)
    }
    // 현금 내림차순
    for (let i = 1; i < wins.length; i++) {
      expect(wins[i].monthly).toBeLessThanOrEqual(wins[i - 1].monthly)
    }
  })
})

// ⚠️ 이 블록은 카탈로그 싱글톤에 실데이터를 병합하므로 파일 맨 끝에 둔다(앞 테스트는 시드만 사용).
describe('실카탈로그(공공데이터 5,000+ 병합) 재현 — 요약형 빈서류 오보 회귀', () => {
  it('가정폭력 상담 프로필: 복지로 딥링크+빈 서류의 요약형이 실재해도 quickWins는 전부 제외', async () => {
    // 브라우저 병합과 동일 경로로 실데이터(policies.json) 주입 — catalog-golden.test.ts 선례
    const catalog = await import('@/data/catalog')
    const ext = JSON.parse(readFileSync(new URL('../../public/policies.json', import.meta.url), 'utf-8'))
    const g = globalThis as { fetch?: unknown }
    const orig = g.fetch
    g.fetch = (async () => ({ ok: true, json: async () => ext })) as unknown as typeof fetch
    try {
      await catalog.loadExternalCatalog()
      const p: UserProfile = {
        name: '', age: 35, gender: 'female', region: '서울', household_type: '1인가구',
        income_percentile: 50, disability: false, disability_grade: '', employment_status: 'employed',
        has_children: false, children_ages: [], is_pregnant: false, life_events: ['가정폭력'],
      }
      const eligible = getEligiblePolicies(p)
      // 결함 전제가 실재함을 먼저 고정 — 요약형(GOV-/LOC-)이 복지로 딥링크+빈 서류로 eligible에 올라온다.
      //   (기관 운영지원 사업도 복지로 상세페이지는 있으므로 딥링크 존재 ≠ 개인 온라인신청 가능)
      const trap = eligible.filter((x) =>
        /^(GOV|LOC)-/.test(x.id)
        && (x.required_docs || []).length === 0
        && isBokjiroApplyable(x.application, x.name, x.id))
      expect(trap.length).toBeGreaterThan(0)
      // 수정 후: 구버전이 '서류 없이 바로'로 오보하던 대상이 quickWins에 하나도 오르지 않는다
      const wins = quickWins(eligible)
      const winIds = new Set(wins.map((w) => w.policy.id))
      for (const t of trap) expect(winIds.has(t.id)).toBe(false)
      // 요약형이 결과에 있다면 반드시 서류 정보가 실재해야 한다(빈 배열 통과 금지)
      for (const w of wins) {
        if (/^(GOV|LOC)-/.test(w.policy.id)) expect((w.policy.required_docs || []).length).toBeGreaterThan(0)
      }
    } finally {
      g.fetch = orig
    }
  })
})
