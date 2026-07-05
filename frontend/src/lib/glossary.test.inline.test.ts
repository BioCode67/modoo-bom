import { describe, it, expect } from 'vitest'
import { annotateTerms } from './glossary'

describe('annotateTerms — 본문 인라인 용어 하이라이트', () => {
  it('사전 용어를 세그먼트로 분리하고 term을 붙인다', () => {
    const segs = annotateTerms('소득인정액이 기준 중위소득 50% 이하')
    const terms = segs.filter((s) => s.term).map((s) => s.text)
    expect(terms).toContain('소득인정액')
    // '기준 중위소득'이 '중위소득'보다 먼저 매칭(길이 우선)
    expect(terms.some((t) => t === '기준 중위소득')).toBe(true)
  })
  it('같은 용어 반복은 첫 등장만 표시', () => {
    const segs = annotateTerms('차상위계층 지원. 차상위계층 확인.')
    expect(segs.filter((s) => s.term?.term === '차상위계층').length).toBe(1)
  })
  it('과잉매칭 방지 — 단독 흔한 단어는 하이라이트 안 함', () => {
    const segs = annotateTerms('소득이 낮은 가구 지원')
    // '소득' 단독은 별칭에 없음 → term 없음
    expect(segs.every((s) => !s.term)).toBe(true)
  })
  it('사전 용어 없는 문장은 원문 그대로', () => {
    const segs = annotateTerms('월 최대 20만원 지급')
    expect(segs).toHaveLength(1)
    expect(segs[0].term).toBeUndefined()
  })
})
