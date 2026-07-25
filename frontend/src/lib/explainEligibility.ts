import type { Policy } from '@/data/policies'
import {
  checkPolicy, demographicMismatch, incomeCeiling, isClosedForNew, matchFacts,
  type UserProfile,
} from '@/lib/welfare-engine'

/**
 * 자격 판정 '설명기' — 엔진의 결론(checkPolicy)을 그대로 존중하되, 그 판정에 이르는
 * 조건들(신규 접수·대상 요건·소득 요건·종합)을 통과/탈락으로 풀어 보여준다.
 *
 * 왜 새로운가: checkPolicy 는 최종 결과(eligible)와 한 줄 이유만 준다. 사용자는 "왜 안 되는지",
 * "무엇만 바꾸면 되는지"를 모른다. 이 모듈은 엔진이 쓰는 같은 원시함수(demographicMismatch·
 * incomeCeiling·checkPolicy)를 조합해 '판정 근거 체크리스트'를 만든다 → 설명 가능성(신뢰).
 *
 * 정직성: 최종 판정은 언제나 checkPolicy(단일 진실원). 여기선 근거만 덧붙인다(엔진 재구현 아님).
 * 공공데이터 요약형(GOV/LOC)·심사선발형(PRV/FIN)은 정밀 룰이 아니라 '상황 신호'로 추천되므로
 * 하드 판정 대신 '부합하는 상황'만 보여주고 상세 확인을 안내한다(카드 표기와 모순 방지).
 */

export type GateStatus = 'pass' | 'fail' | 'info'

export interface Gate {
  key: 'intake' | 'demographic' | 'income' | 'verdict'
  label: string
  status: GateStatus
  detail: string
}

export interface Explanation {
  mode: 'precise' | 'summary'          // 정밀 룰 정책 vs 요약/심사형
  eligible: boolean
  priority: 'high' | 'medium' | 'low'
  confidence: number
  verdict: string                      // checkPolicy 이유(요약형은 안내 문구)
  gates: Gate[]                        // precise 모드에서만 채움
  matchedFacts: string[]               // 프로필이 부합하는 조건(matchFacts)
  ceiling: number | null               // 소득 상한(하위 %)
  incomeOver: number | null            // 내 소득% − 상한(>0 초과)
  fixableByIncome: boolean             // 소득만 낮추면 대상이 되는가(near-miss)
  blocker: 'intake' | 'demographic' | 'income' | 'other' | null // 부적격의 주 사유
}

/** 요약/심사형(정밀 자격판정 미적용) 정책인가 — 카드가 '관련 복지'(저신뢰)로 표기하는 부류 */
export function isSummaryLike(id: string): boolean {
  return /^(GOV|LOC|PRV|FIN)-/.test(id)
}

export function explainEligibility(policy: Policy, p: UserProfile): Explanation {
  const doc = `${policy.eligibility} ${policy.target} ${policy.name}`
  const ceil = incomeCeiling(doc)
  const incomeOver = ceil !== null ? p.income_percentile - ceil : null
  const facts = matchFacts(policy, p)
  const result = checkPolicy(policy, p)

  // 요약/심사형: 하드 판정 대신 상황 신호만(카드 표기와 일치)
  if (isSummaryLike(policy.id)) {
    return {
      mode: 'summary',
      eligible: result.eligible,
      priority: result.priority,
      confidence: result.confidence,
      verdict: '요약 정보라 정밀 자격판정 대신 상황 신호로 추천됐어요. 정확한 자격은 상세·공식 페이지에서 확인하세요.',
      gates: [],
      matchedFacts: facts,
      ceiling: ceil,
      incomeOver,
      fixableByIncome: false,
      blocker: null,
    }
  }

  const closed = isClosedForNew(policy)
  const demoFail = demographicMismatch(policy.name, doc, p)
  const incomeFail = ceil !== null && p.income_percentile > ceil

  const gates: Gate[] = [
    closed
      ? { key: 'intake', label: '신규 접수', status: 'fail', detail: '지금은 신규 신청을 받지 않는 정책이에요.' }
      : { key: 'intake', label: '신규 접수', status: 'pass', detail: '신규 신청을 받고 있어요.' },
    demoFail
      ? { key: 'demographic', label: '대상 요건', status: 'fail', detail: '연령·성별·장애 등 대상 요건이 프로필과 달라요.' }
      : { key: 'demographic', label: '대상 요건', status: 'pass', detail: '연령·성별·장애 등 대상 제한에 걸리지 않아요.' },
    ceil === null
      ? { key: 'income', label: '소득 요건', status: 'info', detail: '명시된 소득 상한이 없어요(상세에서 확인).' }
      : incomeFail
        ? { key: 'income', label: '소득 요건', status: 'fail', detail: `소득 하위 ${p.income_percentile}%로 상한(하위 ${ceil}%)을 넘어요.` }
        : { key: 'income', label: '소득 요건', status: 'pass', detail: `소득 하위 ${p.income_percentile}% ≤ 상한 하위 ${ceil}% — 충족해요.` },
    {
      key: 'verdict', label: '종합 판정',
      status: result.eligible ? 'pass' : 'fail',
      detail: result.reason || (result.eligible ? '대상 요건을 충족해요.' : '대상 요건을 충족하지 않아요.'),
    },
  ]

  let blocker: Explanation['blocker'] = null
  if (!result.eligible) blocker = closed ? 'intake' : demoFail ? 'demographic' : incomeFail ? 'income' : 'other'

  // 소득만 상한까지 낮추면 실제로 대상이 되는지 엔진으로 재확인(near-miss와 동일 방식)
  const fixableByIncome = !result.eligible && !closed && !demoFail && ceil !== null && p.income_percentile > ceil
    && checkPolicy(policy, { ...p, income_percentile: ceil }).eligible

  return {
    mode: 'precise',
    eligible: result.eligible,
    priority: result.priority,
    confidence: result.confidence,
    verdict: result.reason,
    gates,
    matchedFacts: facts,
    ceiling: ceil,
    incomeOver,
    fixableByIncome,
    blocker,
  }
}

/** 부적격 주 사유를 한 문장 행동 안내로 */
export function blockerHint(ex: Explanation): string | null {
  if (ex.eligible || ex.blocker === null) return null
  switch (ex.blocker) {
    case 'intake': return '지금은 신규 접수가 없어요. 재개 공고를 기다리거나 비슷한 복지를 찾아보세요.'
    case 'demographic': return '이 복지의 대상(연령·성별·장애 등)과 프로필이 달라요.'
    case 'income':
      return ex.fixableByIncome
        ? `소득 조건만 아깝게 벗어났어요(상한 하위 ${ex.ceiling}%). 소득이 줄면 대상이 될 수 있어요.`
        : `소득이 상한(하위 ${ex.ceiling}%)을 넘어요.`
    default: return '세부 조건이 맞지 않아요. 상세에서 자격 요건을 확인하세요.'
  }
}
