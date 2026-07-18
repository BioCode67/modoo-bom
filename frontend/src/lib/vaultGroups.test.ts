import { describe, expect, it } from 'vitest'
import { groupVaultDocs } from './vaultGroups'

const doc = (doc_type: string, mtime: number, filename = `${doc_type}_${mtime}.pdf`) => ({ doc_type, mtime, filename })

describe('groupVaultDocs — 서류함 종류별 그룹핑(최신본 대표)', () => {
  it('같은 종류는 한 그룹으로 합치고 최신본이 latest, 나머지는 older(최신순)', () => {
    const g = groupVaultDocs([doc('주민등록등본', 300), doc('주민등록등본', 100), doc('주민등록등본', 200)])
    expect(g).toHaveLength(1)
    expect(g[0].latest.mtime).toBe(300)
    expect(g[0].older.map((d) => d.mtime)).toEqual([200, 100])
  })

  it('그룹 순서는 그룹 최신본 기준 내림차순 — 방금 발급한 종류가 맨 위', () => {
    const g = groupVaultDocs([
      doc('가족관계증명서', 100),
      doc('주민등록등본', 500),
      doc('가족관계증명서', 900), // 가족관계가 더 최근에 재발급됨
    ])
    expect(g.map((x) => x.type)).toEqual(['가족관계증명서', '주민등록등본'])
    expect(g[0].latest.mtime).toBe(900)
    expect(g[0].older).toHaveLength(1)
  })

  it('입력 정렬에 의존하지 않는다(뒤섞인 mtime도 그룹 안·그룹 간 모두 재정렬)', () => {
    const g = groupVaultDocs([doc('A', 1), doc('B', 9), doc('A', 5), doc('B', 3)])
    expect(g.map((x) => [x.type, x.latest.mtime])).toEqual([['B', 9], ['A', 5]])
  })

  it('doc_type이 빈 파일은 파일명 기준 자기 자신이 한 그룹(오분류 병합 금지)', () => {
    const g = groupVaultDocs([doc('', 10, 'x.pdf'), doc('', 20, 'y.pdf')])
    expect(g).toHaveLength(2)
    expect(g.every((x) => x.older.length === 0)).toBe(true)
  })

  it('빈 입력·단건 입력도 안전', () => {
    expect(groupVaultDocs([])).toEqual([])
    const one = groupVaultDocs([doc('등본', 1)])
    expect(one[0].older).toEqual([])
  })
})
