/** RRF 융합(fuseRrf)·키워드 레인(keywordLane) — 하이브리드 검색 순수 로직 검증 */
import { describe, it, expect } from 'vitest'
import { fuseRrf, keywordLane, type SemanticHit } from './semanticSearch'
import type { Policy } from '@/data/policies'

const P = (id: string, name = id): Policy => ({ id, name }) as unknown as Policy
const H = (id: string, score: number): SemanticHit => ({ policy: P(id), score })

describe('fuseRrf', () => {
  it('양쪽 랭킹에 모두 있는 정책이 한쪽에만 있는 정책보다 위로 온다', () => {
    // 의미 2위+키워드 1위(B) > 의미 1위 단독(A): 1/62+1/61 > 1/61
    const sem = [H('A', 0.95), H('B', 0.9), H('C', 0.85)]
    const kw = [P('B'), P('D')]
    const out = fuseRrf(sem, kw, 4)
    expect(out[0].policy.id).toBe('B')
    expect(out[1].policy.id).toBe('A')
  })

  it('키워드 랭킹이 비면(외국어 질의) 의미 랭킹이 그대로 유지된다', () => {
    const sem = [H('A', 0.9), H('B', 0.8)]
    const out = fuseRrf(sem, [], 2)
    expect(out.map((h) => h.policy.id)).toEqual(['A', 'B'])
    expect(out[0].score).toBe(0.9) // 의미 유사도 보존(신뢰도 날조 없음)
  })

  it('키워드에만 있던 정책은 의미 풀 최하위 유사도로 보수적으로 표기된다', () => {
    const sem = [H('A', 0.9), H('B', 0.7)]
    const out = fuseRrf(sem, [P('C')], 3)
    const c = out.find((h) => h.policy.id === 'C')!
    expect(c.score).toBe(0.7) // sem 최하위 score — 0.9로 과장하지 않음
  })

  it('topK로 자르고 중복 id는 한 번만 나온다', () => {
    const sem = [H('A', 0.9), H('B', 0.8), H('C', 0.7)]
    const kw = [P('A'), P('B'), P('C')]
    const out = fuseRrf(sem, kw, 2)
    expect(out).toHaveLength(2)
    expect(new Set(out.map((h) => h.policy.id)).size).toBe(2)
  })
})

describe('keywordLane', () => {
  it('영어 문장 질의엔 키워드 레인이 꺼진다 — 관사 a/I가 정책명 라틴문자(AI·MRI)에 오매칭되는 잡음 차단', () => {
    expect(keywordLane('I am a single mother raising a child alone', 60)).toEqual([])
    expect(keywordLane('tiền hỗ trợ sinh con', 60)).toEqual([])
  })

  it('한글 질의(정확명)엔 해당 정책이 키워드 레인 최상위로 온다', () => {
    const out = keywordLane('기초연금', 60)
    expect(out.length).toBeGreaterThan(0)
    expect(out[0].name.replace(/\s/g, '')).toContain('기초연금')
  })
})

describe('영어 문장 → 일반 검색 잡음 차단(fieldScore 1글자 한글 한정)', () => {
  it('영어 관사·대명사(a/I)가 라틴 표기 정책명(AI·MRI 등)에 오탐되지 않는다', async () => {
    const { searchPolicies } = await import('./search')
    const { getCatalog } = await import('@/data/catalog')
    const out = searchPolicies(getCatalog(), 'I am a single mother raising a child alone').slice(0, 6)
    const noise = out.filter((p) => /MRI|BIG3|AI·디지털|AI 안부/.test(p.name))
    expect(noise).toEqual([])
  })

  it('한글 1글자 사용자어("암")는 여전히 허용된다', async () => {
    const { searchPolicies } = await import('./search')
    const { getCatalog } = await import('@/data/catalog')
    const out = searchPolicies(getCatalog(), '암')
    expect(out.some((p) => p.name.includes('암'))).toBe(true)
  })
})

describe('fieldScore department 스캔 — 기관명 검색(SH·LH 등)', () => {
  it('이름엔 없고 담당부처에만 있는 검색어도 결과가 나온다', async () => {
    const { relevance, queryConcepts } = await import('./search')
    // 가짜 정책: 이름·본문엔 SH 없음, department에만 SH공사
    const p: Policy = { id: 'X-1', name: '전세임대주택 지원', category: '주거',
                target: '무주택 저소득', benefit: '전세보증금 지원', eligibility: '무주택',
                required_docs: [], application: '', renewal: '',
                department: 'SH서울주택도시공사' }
    const score = relevance(p, queryConcepts('SH'), 'SH')
    expect(score).toBeGreaterThan(0)
  })
})
