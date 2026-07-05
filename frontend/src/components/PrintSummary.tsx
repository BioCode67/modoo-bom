import { useMemo } from 'react'
import { useAppStore } from '@/store/useAppStore'
import { getPolicyMap } from '@/data/catalog'
import { runAnalysis } from '@/lib/welfare-engine'
import { parseMonthly, formatWon } from '@/lib/format'
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
  const policies = fromResult.length > 0 ? fromResult : fromTracked
  const monthlyTotal = policies.reduce((s, p) => s + parseMonthly(p.benefit), 0)

  if (policies.length === 0) return null

  return (
    <div className="print-only print-doc">
      <header className="print-head">
        <h1>모두봄 · {isHelper ? '가족 복지 안내서' : '내 복지 안내서'} 🌱</h1>
        <p className="print-sub">
          {displayName ? `${displayName} 님` : '신청자'} 맞춤 복지 정리 ·
          수혜 가능 {policies.length}건{monthlyTotal > 0 ? ` · 예상 월 합계 ${formatWon(monthlyTotal)}` : ''}
        </p>
      </header>

      <ol className="print-list">
        {policies.map((p) => {
          const monthly = parseMonthly(p.benefit)
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
