import { useMemo } from 'react'
import { useAppStore } from '@/store/useAppStore'
import { getPolicyMap } from '@/data/catalog'
import { runAnalysis, type EligiblePolicy } from '@/lib/welfare-engine'
import { parseMonthly, formatWon, isCashBenefit, sumCashMonthly } from '@/lib/format'
import { applyLink } from '@/lib/officialLinks'
import { STATUS_META } from '@/components/TrackedCard'
import type { Policy } from '@/data/policies'

/**
 * 인쇄 헤더의 합산·건수 — 화면 헤더(ResultsView)·통화 브리핑·복지 리포트와 동일한 보수 기준(순수 함수).
 * · 분석 결과 경로(fromResult=true): 금액은 POL- 정밀추천 중 강력추천(high)의 '현금성'만 합산.
 *   관련복지(GOV-/LOC- 저신뢰 추론)·중간/낮음 우선순위까지 더하면 화면보다 부풀린 금액이
 *   '주민센터 지참용' 종이로 나간다(금액 과장 금지). 건수도 '맞춤 N건 · 관련 M건'으로 분리 표기.
 * · 관심목록 폴백(fromResult=false): 사용자가 직접 담은 목록(priority 없음)이라 전체 현금성 합산 유지.
 */
export function printHeadline(
  policies: (Policy | EligiblePolicy)[],
  fromResult: boolean,
): { monthlyTotal: number; countLabel: string; amountLabel: string } {
  const list = Array.isArray(policies) ? policies : []
  if (fromResult) {
    const primary = list.filter((p) => /^POL-/.test(p.id))
    const strong = primary.filter((p) => (p as EligiblePolicy).priority === 'high')
    const relatedCount = list.length - primary.length
    const monthlyTotal = sumCashMonthly(strong)
    return {
      monthlyTotal,
      countLabel: `맞춤 ${primary.length}건${relatedCount > 0 ? ` · 관련 ${relatedCount}건` : ''}`,
      amountLabel: monthlyTotal > 0
        ? ` · 강력추천 현금성만 보수 합산 월 최대 ${formatWon(monthlyTotal)}(중복수급 미반영)`
        : '',
    }
  }
  const monthlyTotal = sumCashMonthly(list)
  return {
    monthlyTotal,
    countLabel: `수혜 가능 ${list.length}건`,
    amountLabel: monthlyTotal > 0 ? ` · 예상 현금성 월 합계 최대 ${formatWon(monthlyTotal)}(중복수급 미반영)` : '',
  }
}

/**
 * 인쇄/PDF 전용 "내 복지 안내서" — 화면에는 숨김(print-only).
 * 분석 결과(없으면 관심목록)를 깔끔한 흑백 문서로 출력. 주민센터 지참용.
 * ⚠️ 도우미 모드(#helper=)에선 '내' 데이터가 아니라 받은 가족 프로필의 재계산 결과를 인쇄한다
 *    (App.tsx가 PrintSummary를 항상 렌더하므로, helper 상태를 여기서 인지하지 않으면 내 이름·수급목록이 새어나감).
 */
export function PrintSummary() {
  const { profile, result, tracked } = useAppStore()
  const helper = useAppStore((s) => s.helper)
  const view = useAppStore((s) => s.view)
  const map = getPolicyMap()

  // 도우미 모드: 받은 프로필로 온디바이스 재계산(내 저장 데이터 미사용 — 상태 격리·개인정보 보호)
  const helperResult = useMemo(() => (helper ? runAnalysis(helper.profile) : null), [helper])

  // ⚠️ helper 상태만으로 전환하면, 도우미 세션이 남은 채 '나의 복지' 탭으로 이동해 인쇄할 때
  //    화면의 내 목록 대신 가족 문서가 인쇄된다(화면-인쇄 불일치). HelperView가 실제로 보이는
  //    analyze 뷰일 때만 가족 문서를 인쇄한다(그 외 탭에선 내 데이터).
  const isHelper = !!helper && view === 'analyze'
  const displayName = isHelper ? '' : profile?.name // 도우미 모드에선 이름 미표기(가족 이름도 링크에 없음)
  const fromResult = isHelper ? (helperResult?.eligible_policies ?? []) : (result?.eligible_policies ?? [])
  const helperTracked = isHelper ? (helper?.tracked ?? []).map((t) => map[t.policyId]).filter(Boolean) : []
  const fromTracked = isHelper ? helperTracked : tracked.map((t) => map[t.policyId]).filter(Boolean)
  const policies = fromResult.length > 0 ? fromResult : fromTracked
  // ⚠️ 화면 헤더와 동일 기준: 분석 결과 경로에선 POL- 강력추천(high)의 현금성만 보수 합산한다.
  //   전체 eligible(관련복지·중간/낮음 포함)을 더하면 화면(핵심 현금지원)보다 부풀린 금액·건수가
  //   종이 문서로 나간다(과거 결함 — printHeadline이 단일 기준, 관심목록 폴백은 전체 현금성 유지).
  const head = printHeadline(policies, fromResult.length > 0)

  if (policies.length === 0) return null

  return (
    <div className="print-only print-doc">
      <header className="print-head">
        <h1>모두봄 · {isHelper ? '가족 복지 안내서' : '내 복지 안내서'} 🌱</h1>
        <p className="print-sub">
          {displayName ? `${displayName} 님` : '신청자'} 맞춤 복지 정리 ·
          {' '}{head.countLabel}{head.amountLabel}
        </p>
      </header>

      <ol className="print-list">
        {policies.map((p) => {
          // 현금성일 때만 '월 N원까지' 금액을 표기 — 서비스한도·바우처·감면을 개인 현금처럼 적지 않는다(정직성).
          const monthly = isCashBenefit(p.benefit, `${p.name} ${p.category}`) ? parseMonthly(p.benefit) : 0
          // 도우미 모드에선 '내' 신청 상태 배지를 붙이지 않는다(남의 문서에 내 상태가 새면 안 됨)
          const tracking = isHelper ? undefined : tracked.find((t) => t.policyId === p.id)
          return (
            <li key={p.id} className="print-item">
              <div className="print-item-head">
                <span className="print-name">{p.name}</span>
                <span className="print-cat">{p.category}{tracking ? ` · ${STATUS_META[tracking.status].label}` : ''}</span>
              </div>
              {monthly > 0 && <p className="print-amount">예상 혜택: 월 {formatWon(monthly)}까지</p>}
              <p><b>지원 대상</b> {p.target}</p>
              <p><b>자격 요건</b> {p.eligibility}</p>
              <p><b>신청 방법</b> {p.application}（{applyLink(p.application).label}）</p>
              {p.required_docs.length > 0 && (
                <p><b>필요 서류</b> {p.required_docs.map((d) => `☐ ${d}`).join('   ')}</p>
              )}
              <p className="print-dept">담당: {p.department} · 갱신: {p.renewal}</p>
            </li>
          )
        })}
      </ol>

      <footer className="print-foot">
        <p>※ 본 안내서는 참고용입니다. 최종 수급 자격은 주민센터·복지로(www.bokjiro.go.kr)·☎129에서 확인하세요.</p>
        <p>모두봄 — 모두의 봄날을 위한 복지 도우미</p>
      </footer>
    </div>
  )
}
