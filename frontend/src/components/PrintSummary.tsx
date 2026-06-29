import { useAppStore } from '@/store/useAppStore'
import { getPolicyMap } from '@/data/catalog'
import { parseMonthly, formatWon } from '@/lib/format'
import { applyLink } from '@/lib/officialLinks'
import { STATUS_META } from '@/components/TrackedCard'

/**
 * 인쇄/PDF 전용 "내 복지 안내서" — 화면에는 숨김(print-only).
 * 분석 결과(없으면 관심목록)를 깔끔한 흑백 문서로 출력. 주민센터 지참용.
 */
export function PrintSummary() {
  const { profile, result, tracked } = useAppStore()
  const map = getPolicyMap()

  const fromResult = result?.eligible_policies ?? []
  const fromTracked = tracked.map((t) => map[t.policyId]).filter(Boolean)
  const policies = fromResult.length > 0 ? fromResult : fromTracked
  const monthlyTotal = policies.reduce((s, p) => s + parseMonthly(p.benefit), 0)

  if (policies.length === 0) return null

  return (
    <div className="print-only print-doc">
      <header className="print-head">
        <h1>모두봄 · 내 복지 안내서 🌱</h1>
        <p className="print-sub">
          {profile?.name ? `${profile.name} 님` : '신청자'} 맞춤 복지 정리 ·
          수혜 가능 {policies.length}건{monthlyTotal > 0 ? ` · 예상 월 합계 ${formatWon(monthlyTotal)}` : ''}
        </p>
      </header>

      <ol className="print-list">
        {policies.map((p) => {
          const monthly = parseMonthly(p.benefit)
          const tracking = tracked.find((t) => t.policyId === p.id)
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
