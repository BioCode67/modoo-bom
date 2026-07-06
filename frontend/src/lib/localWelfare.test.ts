import { describe, it, expect } from 'vitest'
import { regionStats } from './localWelfare'
import type { Policy } from '@/data/policies'

const P = (id: string, target: string, name: string): Policy => ({
  id, name, category: '', target, benefit: '', eligibility: '',
  required_docs: [], application: '', department: '', renewal: '',
})

describe('regionStats', () => {
  it('LOC 정책을 시·도별로 집계하고 예시를 모은다', () => {
    const cat = [
      P('LOC-1', '[서울특별시 강남구] 청년 월세', '서울 청년월세'),
      P('LOC-2', '[서울특별시 서초구] 어르신 교통', '서울 어르신교통'),
      P('LOC-3', '[부산광역시] 출산 지원', '부산 출산지원'),
      P('POL-1', '전국 만 65세', '기초연금'),   // LOC 아님 → 제외
      P('GOV-1', '중앙부처', '아동수당'),         // 제외
    ]
    const { counts, total, examples } = regionStats(cat, 3)
    expect(counts['서울']).toBe(2)
    expect(counts['부산']).toBe(1)
    expect(total).toBe(3)
    expect(examples['서울']).toContain('서울 청년월세')
    expect(examples['서울'].length).toBeLessThanOrEqual(3)
  })

  it('시·도를 못 찾는 LOC(지역 미상)는 제외', () => {
    const { total } = regionStats([P('LOC-x', '지역 정보 없음', '무명 정책')], 3)
    expect(total).toBe(0)
  })

  it('exampleN 상한을 지킨다', () => {
    const cat = Array.from({ length: 10 }, (_, i) => P(`LOC-${i}`, '[대구광역시] 지원', `대구정책${i}`))
    const { examples, counts } = regionStats(cat, 2)
    expect(counts['대구']).toBe(10)
    expect(examples['대구'].length).toBe(2)
  })
})
