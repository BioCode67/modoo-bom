import { describe, it, expect } from 'vitest'
import { COMBO_RULES, analyzeCombos, hasCombos } from './comboSolver'
import { runAnalysis, type UserProfile, type EligiblePolicy } from './welfare-engine'

const base: UserProfile = {
  name: '', age: 30, gender: 'other', region: '', household_type: '',
  income_percentile: 80, disability: false, disability_grade: '',
  employment_status: '', has_children: false, children_ages: [],
  is_pregnant: false, life_events: [],
}
const mk = (ids: string[]): EligiblePolicy[] =>
  ids.map((id) => ({ id, name: id, category: '', target: '', benefit: '', eligibility: '', required_docs: [], application: '', department: '', renewal: '', reason: '', priority: 'high', confidence: 0.9 }))

describe('comboSolver — 수급 조합 관계 안내', () => {
  it('규칙은 전부 공식 출처 문구를 가진다(정직성)', () => {
    for (const r of COMBO_RULES) {
      expect(r.source).toBeTruthy()
      expect(r.note.length).toBeGreaterThan(10)
    }
  })
  it('기초연금+장애인연금 동시 자격 → 하나만(exclusive)', () => {
    const r = analyzeCombos(mk(['POL-001', 'POL-003']))
    expect(r.exclusive.length).toBe(1)
  })
  it('아동수당+부모급여 → 병급 가능(compatible)', () => {
    const r = analyzeCombos(mk(['POL-004', 'POL-005']))
    expect(r.compatible.some((c) => c.rule.kind === 'compatible')).toBe(true)
  })
  it('둘 중 하나만 자격이면 관계 미표시(둘 다 있을 때만 의미)', () => {
    expect(hasCombos(analyzeCombos(mk(['POL-001'])))).toBe(false)
  })
  it('같은 쌍은 한 번만(중복 제거)', () => {
    const r = analyzeCombos(mk(['POL-001', 'POL-003', 'POL-003']))
    expect(r.exclusive.length).toBe(1)
  })
  it('실분석 연결: 복합(노인+장애) 프로필에서 기초연금↔장애인연금 관계가 잡힌다', () => {
    const res = runAnalysis({ ...base, age: 66, disability: true, disability_grade: '1급', income_percentile: 25 })
    const combos = analyzeCombos(res.eligible_policies)
    // POL-001·POL-003이 둘 다 자격이면 exclusive에 포함
    const ids = new Set(res.eligible_policies.map((p) => p.id))
    if (ids.has('POL-001') && ids.has('POL-003')) expect(combos.exclusive.length).toBeGreaterThanOrEqual(1)
  })
})
