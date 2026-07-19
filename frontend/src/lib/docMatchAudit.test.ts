/**
 * 서류명 ↔ 자동발급기 매칭 전수 감사 — 오매칭(거짓 양성) 회귀 차단.
 *
 * docIn()이 양방향 부분일치라, 시드 required_docs에 새 표기(예: '통장 사본',
 * '월세 이체확인증(최근 3개월)', '소득·재산 신고서' — 2026-07-19 공식 구비서류 정확화)가
 * 들어올 때 발급 지원 서류로 오인되면 '자동발급' 버튼이 거짓으로 뜬다.
 * 전 시드의 모든 서류명을 실제 매처에 통과시켜 ①본인 준비물은 절대 매칭 금지
 * ②매칭된 서류는 반드시 지원 목록의 의도된 항목과 대응함을 고정한다.
 */
import { describe, expect, it } from 'vitest'
import { WELFARE_POLICIES } from '@/data/policies'
import { PRIVATE_POLICIES } from '@/data/privatePolicies'
import { HOUSING_POLICIES } from '@/data/housingPolicies'
import { GOV_PROGRAMS } from '@/data/govPrograms'
import { FINANCIAL_POLICIES } from '@/data/financialPolicies'
import { LOCAL_RPA_DOCS, isRpaSupported } from '@/lib/officialLinks'

const ALL = [...WELFARE_POLICIES, ...PRIVATE_POLICIES, ...HOUSING_POLICIES, ...GOV_PROGRAMS, ...FINANCIAL_POLICIES]

// 정부가 발급하지 않는 '본인 준비물' — 자동발급 매칭되면 안 되는 대표 군
const NEVER_ISSUABLE = [
  '통장 사본', '통장사본', '임대차계약서', '신분증', '주민등록증', '월세 이체확인증(최근 3개월)',
  '소득·재산 신고서', '금융정보 제공 동의서', '위기 상황 증빙서류', '가족사진', '증명사진',
  '재직증명서', '급여명세서', '자기소개서', '사업계획서',
]

const compact = (s: string) => s.replace(/\s/g, '')

describe('서류명 매칭 전수 감사', () => {
  it('본인 준비물은 자동발급 지원으로 절대 오매칭되지 않는다', () => {
    const falsePositives = NEVER_ISSUABLE.filter((d) => isRpaSupported(d, 'local'))
    expect(falsePositives).toEqual([])
  })

  it('전 시드 서류명 중 local 매칭된 것은 지원 15종의 표기를 실제로 포함한다', () => {
    const bad: string[] = []
    for (const p of ALL) {
      for (const d of p.required_docs || []) {
        if (!isRpaSupported(d, 'local')) continue
        const hit = LOCAL_RPA_DOCS.some(
          (s) => compact(d).includes(compact(s)) || compact(s).includes(compact(d)),
        )
        if (!hit) bad.push(`${p.name}: ${d}`)
      }
    }
    expect(bad).toEqual([])
  })

  it('과잉 일반화 방지 — 한 서류명이 지원 목록의 2종 이상과 동시에 매칭되지 않는다', () => {
    const ambiguous: string[] = []
    const seen = new Set<string>()
    for (const p of ALL) {
      for (const d of p.required_docs || []) {
        const key = compact(d)
        if (seen.has(key)) continue
        seen.add(key)
        const hits = LOCAL_RPA_DOCS.filter(
          (s) => key.includes(compact(s)) || compact(s).includes(key),
        )
        if (hits.length > 1) ambiguous.push(`${d} → ${hits.join(', ')}`)
      }
    }
    expect(ambiguous).toEqual([])
  })
})
