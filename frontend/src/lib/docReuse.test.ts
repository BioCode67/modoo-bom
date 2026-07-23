import { describe, it, expect } from 'vitest'
import { docReuseMap } from './docReuse'
import type { Policy } from '@/data/policies'

const mk = (id: string, name: string, docs: string[]): Policy =>
  ({ id, name, category: '', target: '', benefit: '', eligibility: '', required_docs: docs, application: '', department: '', renewal: '' } as Policy)

describe('docReuseMap — 공통 서류 집계', () => {
  it('2곳 이상 공유하는 서류만 재사용 목록에 남긴다(재사용 많은 순)', () => {
    const plan = docReuseMap([
      mk('A', '기초연금', ['주민등록등본', '신분증']),
      mk('B', '생계급여', ['주민등록등본', '소득금액증명']),
      mk('C', '주거급여', ['주민등록등본', '임대차계약서']),
    ])
    expect(plan.shared[0].doc).toBe('주민등록등본')
    expect(plan.shared[0].count).toBe(3)
    expect(plan.shared[0].policyNames).toEqual(['기초연금', '생계급여', '주거급여'])
    // 1곳에서만 쓰는 서류(신분증·소득금액증명·임대차계약서)는 제외
    expect(plan.shared.map((d) => d.doc)).toEqual(['주민등록등본'])
  })

  it('savedCount = Σ(count-1) — 공통 서류 한 번 준비로 줄어드는 발급 횟수', () => {
    const plan = docReuseMap([
      mk('A', 'A', ['등본', '가족관계증명서']),
      mk('B', 'B', ['등본', '가족관계증명서']),
      mk('C', 'C', ['등본']),
    ])
    // 등본 3곳(-2), 가족관계증명서 2곳(-1) → saved 3
    expect(plan.savedCount).toBe(3)
    expect(plan.topDoc?.doc).toBe('등본')
    expect(plan.topDoc?.count).toBe(3)
  })

  it('한 정책이 같은 서류를 중복 기재해도 1회로 센다', () => {
    const plan = docReuseMap([
      mk('A', 'A', ['등본', '등본']),
      mk('B', 'B', ['등본']),
    ])
    expect(plan.shared[0].count).toBe(2) // 3이 아니라 2
  })

  it('공동이용 대상 서류는 shareable=true로 표기', () => {
    const plan = docReuseMap([
      mk('A', 'A', ['주민등록등본']),
      mk('B', 'B', ['주민등록등본']),
      mk('C', 'C', ['통장사본']),
      mk('D', 'D', ['통장사본']),
    ])
    const 등본 = plan.shared.find((d) => d.doc === '주민등록등본')!
    const 통장 = plan.shared.find((d) => d.doc === '통장사본')!
    expect(등본.shareable).toBe(true)   // 공동이용 대상
    expect(통장.shareable).toBe(false)  // 본인 제출
  })

  it('공유 서류가 없으면 빈 목록·topDoc null', () => {
    const plan = docReuseMap([mk('A', 'A', ['x']), mk('B', 'B', ['y'])])
    expect(plan.shared).toEqual([])
    expect(plan.topDoc).toBeNull()
    expect(plan.savedCount).toBe(0)
  })

  it('빈 입력·서류 없는 정책도 안전', () => {
    expect(docReuseMap([]).shared).toEqual([])
    expect(() => docReuseMap([mk('A', 'A', [])])).not.toThrow()
  })
})
