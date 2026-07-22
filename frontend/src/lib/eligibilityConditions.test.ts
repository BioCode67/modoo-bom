import { describe, it, expect } from 'vitest'
import { eligibilityConditions, parseAgeCondition, conditionsToText } from './eligibilityConditions'
import type { Policy } from '@/data/policies'

const P = (over: Partial<Policy>): Policy => ({
  id: 'POL-T', name: '테스트', category: '기타', target: '', benefit: '', eligibility: '',
  required_docs: [], application: '', department: '', renewal: '', ...over,
})

describe('parseAgeCondition — 연령 파싱', () => {
  it('범위: 만 19~34세', () => {
    expect(parseAgeCondition('만 19~34세 청년')).toBe('만 19~34세')
    expect(parseAgeCondition('만 0~1세 영아')).toBe('만 0~1세')
  })
  it('이상: 만 65세 이상', () => {
    expect(parseAgeCondition('만 65세 이상 소득 하위 70%')).toBe('만 65세 이상')
  })
  it('미만/이하: 8세 미만', () => {
    expect(parseAgeCondition('8세 미만 아동')).toBe('8세 미만')
    expect(parseAgeCondition('18세 이하')).toBe('18세 이하')
  })
  it('연령 언급 없으면 null', () => {
    expect(parseAgeCondition('무주택 세대주')).toBeNull()
  })
  it('범위가 이상보다 우선(만 19~34세 이상 문구)', () => {
    expect(parseAgeCondition('만 19~34세')).toBe('만 19~34세')
  })
})

describe('eligibilityConditions — 조건 칩 추출', () => {
  it('연령·소득·대상군을 각각 칩으로', () => {
    const c = eligibilityConditions(P({ name: '기초연금', category: '노인', target: '만 65세 이상 노인', eligibility: '소득 하위 70%' }))
    const byType = (t: string) => c.filter((x) => x.type === t).map((x) => x.label)
    expect(byType('age')).toEqual(['만 65세 이상'])
    expect(byType('income')).toEqual(['소득 하위 70% 이하'])
    expect(byType('target')).toContain('노인')
  })

  it('중위/하위 표기를 원문대로 라벨', () => {
    const mid = eligibilityConditions(P({ eligibility: '기준 중위소득 60% 이하' }))
    expect(mid.find((c) => c.type === 'income')?.label).toBe('중위소득 60% 이하')
    const low = eligibilityConditions(P({ eligibility: '소득 하위 50%' }))
    expect(low.find((c) => c.type === 'income')?.label).toBe('소득 하위 50% 이하')
  })

  it('부모/부양의무자 소득은 본인 상한으로 오인하지 않음(엔진 incomeCeiling 재사용)', () => {
    const c = eligibilityConditions(P({ eligibility: '중위소득 60% 이하, 부모 소득 중위 100% 이하' }))
    expect(c.find((x) => x.type === 'income')?.label).toBe('중위소득 60% 이하') // 100 아님
  })

  it('지자체(LOC) target 접두에서 지역 칩', () => {
    const c = eligibilityConditions(P({ id: 'LOC-1', target: '[경기 성남시] 청년 월세', eligibility: '만 19~34세' }))
    expect(c.find((x) => x.type === 'region')?.label).toBe('성남시')
    expect(c.find((x) => x.type === 'region')?.emoji).toBe('📍')
  })

  it('여러 대상군 키워드를 모두 칩으로(중복 제거)', () => {
    const c = eligibilityConditions(P({ name: '한부모 장애아동 지원', target: '한부모가족 장애아동', eligibility: '저소득' }))
    const targets = c.filter((x) => x.type === 'target').map((x) => x.label)
    expect(targets).toContain('한부모·조손')
    expect(targets).toContain('장애인')
    expect(targets).toContain('저소득')
  })

  it('조건이 없으면 빈 배열', () => {
    expect(eligibilityConditions(P({ name: '무슨 서비스', target: '누구나', eligibility: '' }))).toEqual([])
  })

  it('null 필드도 크래시 없이(외부 데이터 방어)', () => {
    expect(() => eligibilityConditions({ id: 'X', name: '결측' } as unknown as Policy)).not.toThrow()
  })
})

describe('conditionsToText', () => {
  it('칩을 · 로 이어붙인다', () => {
    const c = eligibilityConditions(P({ target: '만 65세 이상 노인', eligibility: '소득 하위 70%' }))
    const t = conditionsToText(c)
    expect(t).toMatch(/만 65세 이상/)
    expect(t).toContain('·')
  })
})
