import { describe, it, expect } from 'vitest'
import { quickWins } from './quickWins'
import { getEligiblePolicies, type UserProfile } from './welfare-engine'
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
    }
    // 현금 내림차순
    for (let i = 1; i < wins.length; i++) {
      expect(wins[i].monthly).toBeLessThanOrEqual(wins[i - 1].monthly)
    }
  })
})
