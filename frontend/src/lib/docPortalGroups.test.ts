import { describe, it, expect } from 'vitest'
import { docPortalGroups, batchableGroups } from './docPortalGroups'

describe('docPortalGroups — 발급처별 묶음', () => {
  it('정부24에서 뗄 수 있는 서류를 한 묶음으로', () => {
    const groups = docPortalGroups(['주민등록등본', '장애인증명서', '한부모가족 증명서'])
    const gov = groups.find((g) => g.portal === '정부24')!
    expect(gov).toBeTruthy()
    expect(gov.docs).toContain('주민등록등본')
    expect(gov.docs).toContain('장애인증명서')
    expect(gov.url).toMatch(/gov\.kr/)
  })

  it('서로 다른 발급처는 다른 묶음(등본=정부24 / 소득금액증명=홈택스)', () => {
    const groups = docPortalGroups(['주민등록등본', '소득금액증명'])
    const portals = groups.map((g) => g.portal)
    expect(portals).toContain('정부24')
    expect(portals).toContain('홈택스')
  })

  it('서류 많은 발급처를 먼저 정렬(로그인 1회 효과 큰 순)', () => {
    const groups = docPortalGroups(['주민등록등본', '장애인증명서', '소득금액증명'])
    // 정부24 2종(등본·장애인) > 홈택스 1종(소득금액증명)
    expect(groups[0].portal).toBe('정부24')
    expect(groups[0].docs.length).toBe(2)
  })

  it('온라인 배치가 안 되는 서류(통장사본·신분증·계약서)는 제외', () => {
    const groups = docPortalGroups(['통장 사본', '신분증', '임대차계약서'])
    // 신분증(방문)·계약서(본인보관)는 제외, 통장사본은 은행 앱(app)이라 포함될 수 있음
    expect(groups.every((g) => g.portal !== '주민센터')).toBe(true)
    expect(groups.some((g) => g.docs.includes('신분증'))).toBe(false)
  })

  it('중복 서류는 한 번만', () => {
    const groups = docPortalGroups(['주민등록등본', '자녀 주민등록등본'])
    const gov = groups.find((g) => g.portal === '정부24')!
    expect(gov.docs.filter((d) => d === '주민등록등본').length).toBe(1)
  })

  it('알 수 없는 서류·빈 입력은 안전', () => {
    expect(docPortalGroups([])).toEqual([])
    expect(docPortalGroups(['무슨무슨 서류'])).toEqual([])
  })
})

describe('batchableGroups — 2종 이상만', () => {
  it('한 발급처에서 2종 이상 뗄 수 있는 묶음만 반환', () => {
    const b = batchableGroups(['주민등록등본', '장애인증명서', '소득금액증명'])
    // 정부24 2종만 batchable, 홈택스 1종 제외
    expect(b.length).toBe(1)
    expect(b[0].portal).toBe('정부24')
  })
  it('묶을 게 없으면 빈 배열', () => {
    expect(batchableGroups(['소득금액증명'])).toEqual([])
  })
})
