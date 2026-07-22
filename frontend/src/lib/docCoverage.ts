import type { Policy } from '@/data/policies'
import { isRpaSupported } from '@/lib/officialLinks'
import { issuableCanonical } from '@/lib/docAliases'

/**
 * 서류 자동발급 커버리지 — 이 복지의 필요 서류 중 몇 개를 에이전트가 대신 뗄 수 있는지.
 *
 * "서류 5종 중 4종은 앱이 자동발급, 통장사본만 직접 준비"처럼 신청 부담을 미리 가늠하게 해준다.
 * isRpaSupported(자동발급 지원 목록)로 정식명 해석 후 판정 → 우선순위·서류 플랜과 같은 기준.
 *
 * 정직성: '자동발급 대상'은 에이전트(데스크탑/확장) 연결 시 가능하다는 의미이며, 웹 정적 배포에선
 * 공식 발급 안내로 폴백한다. 여기선 '가능 여부'만 계산하고 실제 발급 가능성은 호출부가 게이팅한다.
 */

export interface DocCoverage {
  total: number
  issuable: number       // 자동발급 대상 서류 수
  manual: number         // 직접 준비 서류 수
  ratio: number          // issuable / total (0~1)
  issuableDocs: string[] // 정식명
  manualDocs: string[]   // 원문
}

export function docCoverage(policy: Pick<Policy, 'required_docs'>): DocCoverage {
  const docs = (policy?.required_docs || []).filter(Boolean)
  const issuableDocs: string[] = []
  const manualDocs: string[] = []
  for (const d of docs) {
    const canon = issuableCanonical(d) || d
    if (isRpaSupported(canon)) issuableDocs.push(canon)
    else manualDocs.push(d)
  }
  const total = docs.length
  return {
    total,
    issuable: issuableDocs.length,
    manual: manualDocs.length,
    ratio: total ? issuableDocs.length / total : 0,
    issuableDocs,
    manualDocs,
  }
}

/** 커버리지 한 줄 요약 */
export function coverageLabel(c: DocCoverage): string {
  if (c.total === 0) return '필요 서류 정보 없음'
  if (c.issuable === 0) return '자동발급 대상 서류 없음'
  if (c.manual === 0) return `필요 서류 ${c.total}종 전부 자동발급 대상`
  return `필요 서류 ${c.total}종 중 ${c.issuable}종 자동발급 대상`
}
