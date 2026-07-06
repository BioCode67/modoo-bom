import { describe, it, expect } from 'vitest'
import { interestDigest } from './interest'

const P = (id: string, name: string, category: string) => ({ id, name, category })

describe('interestDigest', () => {
  const pols = [
    P('POL-1', '기초연금', '노인'),
    P('POL-2', '노인일자리', '노인'),
    P('POL-3', '청년월세', '청년'),
    P('POL-4', '부모급여', '아동·영유아'),
  ]

  it('구독 분야별로 추천 복지를 집계하고, 담은 건 untracked에서 뺀다', () => {
    const tracked = new Set(['POL-1'])
    const d = interestDigest(['노인', '청년'], pols, tracked)
    const 노인 = d.find((x) => x.category === '노인')!
    expect(노인.total).toBe(2)
    expect(노인.untracked).toBe(1)            // 기초연금은 담음 → 노인일자리만
    expect(노인.examples[0].name).toBe('노인일자리')
    const 청년 = d.find((x) => x.category === '청년')!
    expect(청년.total).toBe(1)
  })

  it('추천 복지가 없는 분야는 결과에서 제외', () => {
    const d = interestDigest(['장애인'], pols, new Set())
    expect(d).toHaveLength(0)
  })

  it('카테고리 표기 변형을 부분일치로 흡수', () => {
    const d = interestDigest(['아동'], [P('X', '아이돌봄', '아동·영유아')], new Set())
    expect(d[0].total).toBe(1)
  })

  it('구독이 없으면 빈 결과', () => {
    expect(interestDigest([], pols, new Set())).toHaveLength(0)
  })

  it('빈 카테고리 정책은 어느 분야에도 오매칭되지 않음(sub.includes("") 함정 방지)', () => {
    const withBlank = [...pols, P('BLANK', '분류없는복지', '')]
    const d = interestDigest(['노인', '청년'], withBlank, new Set())
    const 노인 = d.find((x) => x.category === '노인')!
    const 청년 = d.find((x) => x.category === '청년')!
    expect(노인.total).toBe(2)  // 기초연금·노인일자리만 — 빈 카테고리 정책 미포함
    expect(청년.total).toBe(1)  // 청년월세만
    expect(노인.examples.some((e) => e.id === 'BLANK')).toBe(false)
  })
})
