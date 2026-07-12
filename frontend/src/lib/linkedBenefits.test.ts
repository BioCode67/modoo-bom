import { describe, it, expect } from 'vitest'
import { getLinkedDiscounts } from '@/lib/linkedBenefits'
import type { UserProfile } from '@/lib/welfare-engine'

const P = (o: Partial<UserProfile>): UserProfile => ({
  name: '', age: 40, gender: 'female', region: '', household_type: '', income_percentile: 50,
  disability: false, disability_grade: '', employment_status: '', has_children: false,
  children_ages: [], is_pregnant: false, life_events: [], ...o,
})

describe('연계 감면(요금감면 일괄신청) 규칙', () => {
  it('수급 수준(중위 30%)엔 통신·전기·가스·TV수신료 면제 묶음', () => {
    const g = getLinkedDiscounts(P({ income_percentile: 30 }))
    const recipient = g.find((x) => x.id === 'recipient')
    expect(recipient).toBeTruthy()
    expect(recipient!.items.some((i) => /TV\s*수신료\s*면제/.test(i.name))).toBe(true)
  })
  it('차상위(중위 48%)엔 차상위 묶음(수급 묶음 아님)', () => {
    const g = getLinkedDiscounts(P({ income_percentile: 48 }))
    expect(g.some((x) => x.id === 'near-poor')).toBe(true)
    expect(g.some((x) => x.id === 'recipient')).toBe(false)
  })
  it('중산층(중위 80%)엔 저소득 감면 묶음 없음(과장 방지)', () => {
    const g = getLinkedDiscounts(P({ income_percentile: 80 }))
    expect(g.some((x) => x.id === 'recipient' || x.id === 'near-poor')).toBe(false)
  })
  it('장애인은 소득과 별개로 장애 감면 묶음', () => {
    const g = getLinkedDiscounts(P({ income_percentile: 80, disability: true }))
    expect(g.some((x) => x.id === 'disability')).toBe(true)
  })
  it('다자녀(미성년 2명↑)엔 다자녀 묶음', () => {
    const g = getLinkedDiscounts(P({ income_percentile: 70, has_children: true, children_ages: [5, 9] }))
    expect(g.some((x) => x.id === 'multichild')).toBe(true)
  })
  it('한부모 저소득엔 한부모 묶음, 고소득 한부모엔 없음', () => {
    expect(getLinkedDiscounts(P({ income_percentile: 45, household_type: '한부모가족' })).some((x) => x.id === 'single-parent')).toBe(true)
    expect(getLinkedDiscounts(P({ income_percentile: 90, household_type: '한부모가족' })).some((x) => x.id === 'single-parent')).toBe(false)
  })
  it('모든 신청 링크는 https 공식 도메인(gov.kr/bokjiro)', () => {
    const all = [P({ income_percentile: 25 }), P({ disability: true }), P({ has_children: true, children_ages: [3, 6] })]
      .flatMap((p) => getLinkedDiscounts(p))
    for (const g of all) expect(/^https:\/\/(www\.)?(gov\.kr|bokjiro\.go\.kr)/.test(g.apply.url)).toBe(true)
  })
})
