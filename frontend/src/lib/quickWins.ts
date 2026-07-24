import type { Policy } from '@/data/policies'
import type { EligiblePolicy } from '@/lib/welfare-engine'
import { classifyDoc } from '@/lib/sharedDocInfo'
import { docLink } from '@/lib/officialLinks'
import { isBokjiroApplyable } from '@/lib/quickApply'
import { parseMonthly, isCashBenefit } from '@/lib/format'

/**
 * 지금 바로 되는 복지 — '앉은 자리에서 온라인으로 완결 가능한' 복지만 골라낸다.
 * 조건: ① 복지로 온라인 신청 딥링크가 있고(isBokjiroApplyable), ② 필요 서류가 전부 '방문 없이'
 * 준비 가능(공동이용 생략 or 전자증명서 온라인 발급)일 때. 방문·기관발급 서류가 하나라도 있으면 제외.
 *
 * 순수 판정(구조 정보만). 신청 마찰이 가장 낮은 복지를 먼저 처리하도록 돕는다(자격 재판정 없음).
 */

export interface QuickWin {
  policy: Policy | EligiblePolicy
  monthly: number   // 현금성 월 최대(정렬·표시용, 0이면 비현금)
  noDocs: boolean    // 필요 서류가 아예 없는가(더 빠름)
}

/** 이 서류가 '방문 없이' 준비 가능한가 — 공동이용 생략(yes) 또는 전자증명서 온라인 발급. */
function noVisitDoc(doc: string): boolean {
  if (classifyDoc(doc) === 'yes') return true            // 신청서 공동이용 동의로 생략
  return !!docLink(doc).issue                             // 'wallet'|'online' = 온라인 발급 가능
}

/**
 * 지금 바로 온라인 완결 가능한 복지 목록.
 * 흐름:
 *  ① 복지로 온라인 신청 딥링크가 있는 복지만(방문형 제외) 후보.
 *  ② 후보의 필요 서류가 전부 방문 없이 준비 가능한지 검사(하나라도 방문/기관발급이면 제외).
 *  ③ 현금성 월 최대 큰 순으로 정렬(같으면 서류 없는 것 우선).
 */
export function quickWins(policies: (Policy | EligiblePolicy)[]): QuickWin[] {
  const list = Array.isArray(policies) ? policies : []
  const out: QuickWin[] = []
  for (const p of list) {
    if (!isBokjiroApplyable(p.application, p.name, p.id)) continue
    const docs = p.required_docs || []
    if (!docs.every(noVisitDoc)) continue
    const monthly = isCashBenefit(p.benefit, `${p.name} ${p.category}`) ? parseMonthly(p.benefit) : 0
    out.push({ policy: p, monthly, noDocs: docs.length === 0 })
  }
  return out.sort((a, b) => b.monthly - a.monthly || Number(b.noDocs) - Number(a.noDocs))
}
