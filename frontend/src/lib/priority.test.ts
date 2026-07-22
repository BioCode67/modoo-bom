import { describe, it, expect } from 'vitest'
import { scorePolicy, applyDifficulty, rankPolicies, DIFFICULTY_LABEL, type ScoreInput } from './priority'
import type { Policy } from '@/data/policies'
import type { EligiblePolicy } from '@/lib/welfare-engine'

const S = (o: Partial<ScoreInput> = {}): ScoreInput => ({ monthly: 0, urgent: null, confidence: 0.5, difficulty: 'medium', ...o })

const P = (o: Partial<Policy>): Policy => ({
  id: 'POL-T', name: '테스트', category: '기타', target: '', benefit: '', eligibility: '',
  required_docs: [], application: '', department: '', renewal: '', ...o,
})

describe('applyDifficulty — 채널·서류 수로 난이도', () => {
  it('온라인+서류 2건 이하 = 쉬움', () => {
    expect(applyDifficulty('online', 0)).toBe('easy')
    expect(applyDifficulty('online', 2)).toBe('easy')
  })
  it('온라인이어도 서류 많으면 보통', () => {
    expect(applyDifficulty('online', 3)).toBe('medium')
  })
  it('방문형 또는 서류 6건 이상 = 어려움', () => {
    expect(applyDifficulty('visit', 1)).toBe('hard')
    expect(applyDifficulty('mixed', 6)).toBe('hard')
  })
})

describe('scorePolicy — 투명 점수(0~100)', () => {
  it('만점 조합: 금액 만점·마감임박·확실 100%·쉬움 = 100', () => {
    const r = scorePolicy(S({ monthly: 300000, urgent: true, confidence: 1, difficulty: 'easy' }))
    expect(r.score).toBe(100)
    expect(r.factors.reduce((a, f) => a + f.score, 0)).toBe(100) // 항목 합 = 총점
  })
  it('최저 조합: 금액 0·상시·확실 0·어려움', () => {
    const r = scorePolicy(S({ monthly: 0, urgent: null, confidence: 0, difficulty: 'hard' }))
    expect(r.score).toBe(0 + 6 + 0 + 3) // 9
  })
  it('중간 조합 계산', () => {
    const r = scorePolicy(S({ monthly: 150000, urgent: false, confidence: 0.9, difficulty: 'medium' }))
    // 금액 20 + 시급성 14 + 확실성 18 + 편의 8 = 60
    expect(r.score).toBe(60)
  })
  it('금액·확실성은 상한에서 클램프(초과 입력 방지)', () => {
    const r = scorePolicy(S({ monthly: 999999, confidence: 5 }))
    expect(r.factors[0].score).toBe(40) // 금액 만점
    expect(r.factors[2].score).toBe(20) // 확실성 만점
  })
  it('음수 금액도 0으로 안전', () => {
    expect(scorePolicy(S({ monthly: -100 })).factors[0].score).toBe(0)
  })
  it('factors에 항목별 만점(max)과 근거(note)를 담는다', () => {
    const r = scorePolicy(S({ monthly: 300000, urgent: true, difficulty: 'easy' }))
    expect(r.factors.map((f) => f.max)).toEqual([40, 25, 20, 15])
    expect(r.factors[0].note).toMatch(/월/)
    expect(r.factors[3].note).toBe(DIFFICULTY_LABEL.easy)
  })
})

describe('rankPolicies — 정렬 + 근거', () => {
  it('고액·온라인·마감임박 정책이 저액·방문 정책보다 위', () => {
    const good = P({ id: 'A', name: '기초연금', category: '노인', benefit: '월 최대 30만원', application: '복지로 온라인 신청', required_docs: ['주민등록등본'] })
    const weak = P({ id: 'B', name: '방문상담 서비스', category: '기타', benefit: '상담 제공', application: '주민센터 방문', required_docs: ['가', '나', '다', '라', '마', '바'] })
    const r = rankPolicies([weak, good])
    expect(r[0].policy.id).toBe('A')
    expect(r[0].monthly).toBeGreaterThan(0)
    expect(r[0].difficulty).toBe('easy')
  })

  it('EligiblePolicy의 confidence를 반영(없으면 0.5 기본)', () => {
    const hi = { ...P({ id: 'H', benefit: '월 20만원', application: '온라인' }), confidence: 0.95, priority: 'high', reason: '' } as EligiblePolicy
    const lo = { ...P({ id: 'L', benefit: '월 20만원', application: '온라인' }), confidence: 0.3, priority: 'low', reason: '' } as EligiblePolicy
    const r = rankPolicies([lo, hi])
    expect(r[0].policy.id).toBe('H') // 확실성 높은 쪽이 위
  })

  it('빈 배열·falsy 항목 안전', () => {
    expect(rankPolicies([])).toEqual([])
    expect(rankPolicies([null as unknown as Policy])).toEqual([])
  })
})
