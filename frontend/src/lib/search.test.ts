import { describe, it, expect } from 'vitest'
import { expandQuery, relevance, searchPolicies } from './search'
import type { Policy } from '@/data/policies'

const P = (id: string, name: string, category: string, target = '', eligibility = '', benefit = ''): Policy =>
  ({ id, name, category, target, eligibility, benefit, summary: '', how: '', link: '', deadline: '', agency: '' } as unknown as Policy)

const CATALOG: Policy[] = [
  P('POL-1', '노인일자리 및 사회활동 지원', '노인', '만 65세 이상', '소득 하위 70%', '월 29만원'),
  P('POL-2', '기초연금', '노인', '만 65세 이상', '소득 하위 70%', '월 최대 34만원'),
  P('POL-3', '청년월세 특별지원', '주거', '만 19~34세 청년', '무주택', '월 20만원'),
  P('POL-4', '아동수당', '아동', '8세 미만 아동', '', '월 10만원'),
  P('POL-5', '국민기초생활보장 생계급여', '저소득', '중위소득 32% 이하', '', '가구별 차등'),
]

describe('expandQuery', () => {
  it('빈 질의 → 빈 배열', () => {
    expect(expandQuery('')).toEqual([])
  })
  it('생활어를 행정용어로 확장(어르신 → 노인 포함)', () => {
    const t = expandQuery('어르신')
    expect(t).toContain('노인')
    expect(t).toContain('어르신')
  })
  it('다단어는 단어로도 분해(노인 일자리 → 노인, 일자리)', () => {
    const t = expandQuery('노인 일자리')
    expect(t).toContain('노인')
    expect(t).toContain('일자리')
  })
})

describe('relevance', () => {
  it('이름 매칭이 분류·대상 매칭보다 높은 점수', () => {
    const nameHit = relevance(CATALOG[0], [['노인일자리']])
    const catOnly = relevance(CATALOG[1], [['노인']]) // 기초연금: 분류만 노인
    expect(nameHit).toBeGreaterThan(catOnly)
  })
  it('비매칭은 0점', () => {
    expect(relevance(CATALOG[3], [['주거']])).toBe(0)
  })
  it('두 개념을 모두 충족하면 한 개념만 충족보다 높음(다개념 가산)', () => {
    const both = relevance(CATALOG[0], [['노인'], ['일자리']]) // 노인일자리: 둘 다 이름에 포함
    const one = relevance(CATALOG[0], [['노인']])
    expect(both).toBeGreaterThan(one)
  })
})

describe('searchPolicies', () => {
  it('"노인 일자리"(띄어쓰기)도 노인일자리 정책을 찾음 — 기존 substring 버그 해결', () => {
    const r = searchPolicies(CATALOG, '노인 일자리')
    expect(r.length).toBeGreaterThan(0)
    expect(r[0].id).toBe('POL-1') // 노인 AND 일자리 모두 충족 → 다개념 우대로 최상위
  })
  it('생활어 "전세" → 주거 정책 매칭', () => {
    const r = searchPolicies(CATALOG, '전세')
    expect(r.some((p) => p.id === 'POL-3')).toBe(true)
  })
  it('"애기" → 아동수당 매칭', () => {
    const r = searchPolicies(CATALOG, '애기')
    expect(r.some((p) => p.id === 'POL-4')).toBe(true)
  })
  it('관련도순 정렬: 이름 직격이 상위', () => {
    const r = searchPolicies(CATALOG, '기초연금')
    expect(r[0].id).toBe('POL-2')
  })
  it('빈 질의는 원본 그대로', () => {
    expect(searchPolicies(CATALOG, '').length).toBe(CATALOG.length)
  })
  it('정확한 정책명 검색은 그 정책이 1위 (동의어 희석 방지)', () => {
    // '청년월세 특별지원'은 동의어(청년→여러 청년정책)로 확장되지만, 원문이 이름인 POL-3가 최상위
    const r = searchPolicies(CATALOG, '청년월세 특별지원')
    expect(r[0].id).toBe('POL-3')
  })
})
