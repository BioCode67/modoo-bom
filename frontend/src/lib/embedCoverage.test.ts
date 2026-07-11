import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { WELFARE_POLICIES } from '@/data/policies'
import { PRIVATE_POLICIES } from '@/data/privatePolicies'
import { HOUSING_POLICIES } from '@/data/housingPolicies'
import { GOV_PROGRAMS } from '@/data/govPrograms'
import { FINANCIAL_POLICIES } from '@/data/financialPolicies'

/**
 * AI 의미검색 임베딩 커버리지 회귀 가드 — "5천 건 전체 AI 검색"이 시드 정책에서 거짓이 되지 않게.
 * 임베딩은 catalog.ts 병합 규칙(이름 디듑, LOC- 유지)을 그대로 따르므로, 커버리지도 'id'가 아니라
 * '이름(nameKey)' 기준으로 본다 — 시드 동명 중복은 대표 1건만 임베딩되고(의도), 그 이름으로 검색되면 충분.
 * 새 시드(새 이름)를 추가하고 `npm run embed`를 안 돌리면 이 테스트가 실패한다.
 */
const nameKey = (name: string): string => (name || '').replace(/[\s()（）]/g, '')

describe('임베딩 커버리지 — 시드 정책은 전부 AI 의미검색 대상', () => {
  const seeds = [...WELFARE_POLICIES, ...PRIVATE_POLICIES, ...HOUSING_POLICIES, ...GOV_PROGRAMS, ...FINANCIAL_POLICIES]
  const emb = JSON.parse(readFileSync(new URL('../../public/policy-embeddings.json', import.meta.url), 'utf-8')) as { ids: string[] }
  const have = new Set(emb.ids)
  // 임베딩에 실제로 실린 id → 이름키 집합(외부 병합 결과라 시드 id 그대로는 아닐 수 있으나 이름은 커버돼야 함)

  it('임베딩 파일이 로드되고 id가 채워져 있다', () => {
    expect(have.size).toBeGreaterThan(5000)
  })

  it('모든 시드 이름이 임베딩에 존재(이름 기준 누락 0)', async () => {
    // 임베딩 id → 이름키. 시드는 id가 안정적이라 시드 id로 직접 이름키를 만든다.
    const seedById = new Map(seeds.map((p) => [p.id, p] as const))
    const haveNames = new Set<string>()
    for (const id of emb.ids) {
      const p = seedById.get(id)
      if (p) haveNames.add(nameKey(p.name))
    }
    const missing = seeds.filter((p) => !haveNames.has(nameKey(p.name))).map((p) => p.name)
    expect(missing).toEqual([])
  })
})
