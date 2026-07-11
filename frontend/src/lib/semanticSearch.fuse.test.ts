/** RRF 융합(fuseRrf) — 의미·키워드 랭킹 결합의 순수 로직 검증 */
import { describe, it, expect } from 'vitest'
import { fuseRrf, type SemanticHit } from './semanticSearch'
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
