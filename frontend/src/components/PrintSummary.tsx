import { useMemo } from 'react'
import { useAppStore } from '@/store/useAppStore'
import { getPolicyMap } from '@/data/catalog'
import { runAnalysis } from '@/lib/welfare-engine'
import { parseMonthly, formatWon, isCashBenefit, sumCashMonthly } from '@/lib/format'
import { applyLink } from '@/lib/officialLinks'
import { STATUS_META } from '@/components/TrackedCard'

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
  // '나의 복지' 탭에서 인쇄하면 화면과 같이 '담은 목록'을 출력한다(과거 분석결과가 아니라).
  //   그 외 뷰에선 분석결과 우선(없으면 담은 목록) — 화면-인쇄 불일치 해소(감사 확정).
  const inMy = !isHelper && view === 'my'
  const policies = inMy ? fromTracked : (fromResult.length > 0 ? fromResult : fromTracked)
  // '수혜 가능'은 화면과 동일하게 핵심(정밀 판정 POL-)만 — 저신뢰 '관련'(GOV/LOC)과 심사·선발형
  //   민간재단(PRV)까지 합치면 인쇄물이 화면 주장보다 부풀려진다(12차 감사). 관련·민간은 건수만 병기.
  const primary = policies.filter((p) => p.id.startsWith('POL-'))
  const othersCount = policies.length - primary.length
  // ⚠️ 화면 헤드라인과 동일하게 '현금성'만 합산한다(isCashBenefit). raw parseMonthly로 전부 더하면
  //   서비스 이용 한도액·바우처·감면·고용주 지원까지 개인 현금소득처럼 부풀려져 인쇄물이 과장된다.
  //   합산 대상도 핵심(POL-)만 — 담은 목록 인쇄(inMy)는 사용자가 고른 것이라 전체 합산 유지.
  const monthlyTotal = sumCashMonthly(inMy ? policies : primary)

  // 0건이어도 백지를 인쇄하지 않는다 — main 전체가 no-print라 이 컴포넌트가 유일한 인쇄물(12차 감사).
  if (policies.length === 0) {
    return (
      <div className="print-only print-doc">
        <header className="print-head"><h1>모두봄 · 내 복지 안내서 🌱</h1></header>
        <p>아직 인쇄할 복지 목록이 없어요. 먼저 <b>복지 찾기</b>에서 분석하거나, 마음에 드는 복지를 <b>담아</b> 주세요.</p>
        <p className="print-dept">모두봄 — https://biocode67.github.io/modoo-bom/ · 복지 상담 ☎129</p>
      </div>
    )
  }

  return (
    <div className="print-only print-doc">
      <header className="print-head">
        <h1>모두봄 · {isHelper ? '가족 복지 안내서' : '내 복지 안내서'} 🌱</h1>
        <p className="print-sub">
          {displayName ? `${displayName} 님` : '신청자'} 맞춤 복지 정리 ·
          {inMy
            ? ` 담은 복지 ${policies.length}건`
            : ` 핵심 수혜 가능 ${primary.length}건${othersCount > 0 ? ` · 관련·민간 ${othersCount}건(자격·심사 별도 확인)` : ''}`}
          {monthlyTotal > 0 ? ` · 예상 현금성 월 합계 최대 ${formatWon(monthlyTotal)}(중복수급 미반영)` : ''}
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
