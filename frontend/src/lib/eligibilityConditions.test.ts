import { describe, it, expect } from 'vitest'
import { parseAgeCondition, parseIncomeCondition, eligibilityConditions, conditionsToText } from './eligibilityConditions'
import type { Policy } from '@/data/policies'

const mk = (over: Partial<Policy>): Policy =>
  ({ id: 'POL-X', name: '', category: '', target: '', benefit: '', eligibility: '', required_docs: [], application: '', department: '', renewal: '', ...over } as Policy)

describe('parseAgeCondition — 범위>이상>미만', () => {
  it('범위 우선', () => expect(parseAgeCondition('만 19~34세 청년')?.label).toBe('19~34세'))
  it('이상', () => expect(parseAgeCondition('만 65세 이상')?.label).toBe('65세 이상'))
  it('미만/이하', () => {
    expect(parseAgeCondition('7세 미만')?.label).toBe('7세 미만')
    expect(parseAgeCondition('18세 이하')?.label).toBe('18세 이하')
  })
  it('없으면 null', () => expect(parseAgeCondition('소득 기준만')).toBeNull())
})

describe('parseIncomeCondition — 원문 숫자·부양의무자 제거', () => {
  it('중위소득 %는 원문 숫자 그대로', () => expect(parseIncomeCondition('중위소득 50% 이하')?.label).toBe('중위소득 50% 이하'))
  it('소득 하위 %', () => expect(parseIncomeCondition('소득 하위 70%')?.label).toBe('소득 하위 70%'))
  it('기초생활/차상위', () => {
    expect(parseIncomeCondition('생계급여 수급자')?.label).toContain('기초생활')
    expect(parseIncomeCondition('차상위계층')?.label).toContain('차상위')
  })
  it('부양의무자 절은 제거해 신청인 기준만', () => {
    expect(parseIncomeCondition('중위소득 40% 이하, 부양의무자 소득 1억 이하')?.label).toBe('중위소득 40% 이하')
  })
  it('소득 언급 없으면 null', () => expect(parseIncomeCondition('만 65세 이상')).toBeNull())
})

describe('eligibilityConditions — 종합', () => {
  it('연령+소득+대상군을 순서대로', () => {
    const conds = eligibilityConditions(mk({ eligibility: '만 65세 이상 중위소득 70% 이하', target: '어르신' }))
    expect(conds[0].type).toBe('age')
    expect(conds.map((c) => c.type)).toContain('income')
    expect(conds.map((c) => c.type)).toContain('target')
  })
  it('LOC- 정책은 지역 칩(시군구 우선)', () => {
    const conds = eligibilityConditions(mk({ id: 'LOC-1', target: '[서울특별시 강남구] 주민' }))
    expect(conds.some((c) => c.type === 'region' && c.label === '강남구')).toBe(true)
  })
  it('뽑을 게 없으면 빈 배열', () => expect(eligibilityConditions(mk({ eligibility: '별도 안내', target: '' }))).toEqual([]))
})

describe('conditionsToText', () => {
  it('· 로 연결', () => {
    expect(conditionsToText([{ type: 'age', label: '65세 이상', emoji: '🎂' }, { type: 'income', label: '중위 70%', emoji: '💰' }])).toBe('65세 이상 · 중위 70%')
  })
  it('빈 배열은 빈 문자열', () => expect(conditionsToText([])).toBe(''))
})
