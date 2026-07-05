import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { WELFARE_POLICIES } from '@/data/policies'
import { PRIVATE_POLICIES } from '@/data/privatePolicies'
import { HOUSING_POLICIES } from '@/data/housingPolicies'
import { GOV_PROGRAMS } from '@/data/govPrograms'
import { FINANCIAL_POLICIES } from '@/data/financialPolicies'

/**
 * AI 의미검색 임베딩 커버리지 회귀 가드 — "5천 건 전체 AI 검색"이 시드 정책에서 거짓이 되지 않게.
 * 시드(POL/PRV/HOU/SUP/FIN)는 100% 임베딩돼 있어야 한다(외부 policies.json은 배포 산출물이라 여기선 시드만 검증).
 * 새 시드를 추가하고 `npm run embed`(또는 embed-append)를 안 돌리면 이 테스트가 실패한다.
 */
describe('임베딩 커버리지 — 시드 정책은 전부 AI 의미검색 대상', () => {
  const seeds = [...WELFARE_POLICIES, ...PRIVATE_POLICIES, ...HOUSING_POLICIES, ...GOV_PROGRAMS, ...FINANCIAL_POLICIES]
  const emb = JSON.parse(readFileSync(new URL('../../public/policy-embeddings.json', import.meta.url), 'utf-8')) as { ids: string[] }
  const have = new Set(emb.ids)

  it('임베딩 파일이 로드되고 id가 채워져 있다', () => {
    expect(have.size).toBeGreaterThan(5000)
  })

  it('모든 시드 id가 임베딩에 존재(누락 0)', () => {
    const missing = seeds.filter((p) => !have.has(p.id)).map((p) => p.id)
    expect(missing).toEqual([])
  })
})
