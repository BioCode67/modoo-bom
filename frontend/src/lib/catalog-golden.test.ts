import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { searchPolicies } from '@/lib/search'
import type { Policy } from '@/data/policies'
import { WELFARE_POLICIES } from '@/data/policies'
import { PRIVATE_POLICIES } from '@/data/privatePolicies'

/**
 * 통합 카탈로그 검색 골든 — 실서비스와 같은 데이터(시드+민간+공공 5,061)에서
 * '실제 사람이 치는 말'이 올바른 정책에 닿는지 고정한다.
 * 유닛(시드만) 테스트가 못 보는 공공데이터 커버리지를 검증.
 */
function fullCatalog(): Policy[] {
  const ext = JSON.parse(readFileSync(new URL('../../public/policies.json', import.meta.url), 'utf-8'))
  const list: Policy[] = Array.isArray(ext) ? ext : ext.policies
  return [...WELFARE_POLICIES, ...PRIVATE_POLICIES, ...list]
}
const CAT = fullCatalog()
const top5 = (q: string) => searchPolicies(CAT, q).slice(0, 5).map((p) => p.name).join(' | ')

describe('통합 카탈로그(5,000+) 실질 검색 골든', () => {
  it('카탈로그 규모: 5,000건 이상 병합', () => {
    expect(CAT.length).toBeGreaterThan(5000)
  })
  it('버스비 → 대중교통(K-패스 등) 지원 도달', () => {
    expect(top5('버스비')).toMatch(/교통/)
  })
  it('보청기 → 보청기 구입비 지원(지자체 실데이터) 도달', () => {
    expect(top5('보청기')).toMatch(/보청기/)
  })
  it('틀니 → 의료급여 틀니·임플란트 도달', () => {
    expect(top5('틀니')).toMatch(/틀니/)
  })
  it('난임 시술 → 난임 시술비 지원 도달', () => {
    expect(top5('난임 시술')).toMatch(/난임/)
  })
  it('치매 → 치매 검사·치료관리 지원 도달', () => {
    expect(top5('치매')).toMatch(/치매/)
  })
  it('생활어: 애기 병원비 → 아동 의료 계열 도달', () => {
    expect(top5('애기 병원비')).toMatch(/아동|어린이|영유아|소아/)
  })
  it('무관한 검색어(김치냉장고)는 0건 — 억지 매칭 없음(정직)', () => {
    expect(searchPolicies(CAT, '김치냉장고').length).toBe(0)
  })
})
