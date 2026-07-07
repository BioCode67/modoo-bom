import { useRef, useState } from 'react'
import { Printer, X } from 'lucide-react'
import type { Policy } from '@/data/policies'
import type { EligiblePolicy, UserProfile } from '@/lib/welfare-engine'
import { docLink } from '@/lib/officialLinks'
import { useModalFocus } from '@/hooks/useModalFocus'

/** 정책 문의처 문자열에서 전화번호만 추출(없으면 ''). */
export function extractTel(contact?: string): string {
  if (!contact) return ''
  // 일반 전화(지역·대표) 우선, 없으면 정부 상담 단축번호(전부 '1'로 시작 3~4자리: 129·1355·1577·1600 등)
  const m = contact.match(/\d{2,3}[-\s]?\d{3,4}[-\s]?\d{4}|\d{3,4}[-\s]?\d{4}|\b1\d{2,3}\b/)
  return m ? m[0].replace(/\s/g, '') : ''
}

/**
 * 주민센터 방문 키트 — 정책 1건을 큰 글씨 A4로 인쇄해 손에 들고 갈 수 있게.
 * 어르신·디지털 소외층의 실제 신청 경로(온라인 아님, 창구 방문)를 정직하게 지원(human-in-the-loop).
 * 개인정보는 100% 로컬(인쇄만), 실데이터 필드(required_docs·department·contact)만 사용(날조 없음).
 */
export function VisitKit({ policy, profile, onClose }: { policy: Policy | EligiblePolicy; profile: UserProfile | null; onClose: () => void }) {
  const [includeProfile, setIncludeProfile] = useState(true)
  const panelRef = useRef<HTMLDivElement>(null)
  // 이 키트는 PolicyDetailDrawer 내부(panelRef 안)에 렌더돼 자체 포커스 관리가 없었다 → 포커스 이동·트랩·복원 공용훅 적용.
  useModalFocus(panelRef, true, onClose)
  const tel = extractTel(policy.contact)
  const docs = policy.required_docs || []

  const doPrint = () => {
    document.body.classList.add('vk-printing')
    const cleanup = () => { document.body.classList.remove('vk-printing'); window.removeEventListener('afterprint', cleanup) }
    window.addEventListener('afterprint', cleanup)
    requestAnimationFrame(() => window.print())
  }

  const householdLabel = profile?.household_type || ''
  const regionLabel = profile?.region || ''

  return (
    <div className="modal-overlay no-print" onClick={onClose} role="dialog" aria-modal="true" aria-label="주민센터 방문용 인쇄">
      {/* ESC는 이 키트만 닫고 상위 드로어까지 닫히지 않게 전파 차단(둘 다 document keydown을 듣기 때문) */}
      <div ref={panelRef} tabIndex={-1} className="modal-content vk-doc"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }}>
        <div className="flex items-center justify-between p-4 border-b border-sprout-100 no-print">
          <p className="font-extrabold">📄 주민센터 방문용 인쇄</p>
          <button onClick={onClose} aria-label="닫기" className="btn-ghost !p-2"><X className="h-4 w-4" /></button>
        </div>

        {/* 인쇄 대상 문서(화면 미리보기 = 인쇄물) */}
        <div className="p-5 vk-print-area">
          <p className="vk-cat">{policy.category} · 정부/지자체 복지</p>
          <h1 className="vk-title">{policy.name}</h1>

          <div className="vk-block">
            <p className="vk-h">📌 창구에서 이렇게 말하세요</p>
            <p className="vk-say">“{policy.name} 신청하러 왔어요.”</p>
          </div>

          <div className="vk-block">
            <p className="vk-h">🏢 담당·문의</p>
            <p className="vk-line">{policy.department || '관할 주민센터'}</p>
            {tel ? <p className="vk-tel">☎ {tel}</p> : <p className="vk-line">가까운 행정복지센터(주민센터) 또는 ☎129(보건복지상담)</p>}
          </div>

          <div className="vk-block">
            <p className="vk-h">📑 챙겨갈 서류 (체크하며 준비)</p>
            {docs.length ? (
              <ul className="vk-docs">
                {docs.map((d: string) => {
                  const where = docLink(d).label
                  return <li key={d}><span className="vk-check">☐</span> {d}{where ? <span className="vk-where"> — {where}</span> : null}</li>
                })}
                <li><span className="vk-check">☐</span> 신분증 (필수)</li>
              </ul>
            ) : (
              <p className="vk-line">필요 서류는 창구에서 안내받으실 수 있어요. 신분증은 꼭 챙겨가세요.</p>
            )}
          </div>

          {includeProfile && (householdLabel || regionLabel || profile?.age) && (
            <div className="vk-block">
              <p className="vk-h">🙋 내 상황 (참고용)</p>
              <p className="vk-line">
                {profile?.age ? `만 ${profile.age}세` : ''}{householdLabel ? ` · ${householdLabel}` : ''}{regionLabel ? ` · ${regionLabel}` : ''}
              </p>
            </div>
          )}

          <p className="vk-foot">이 안내는 참고용이에요. 최종 자격·금액은 창구·복지로(129)에서 확인하세요. · 모두봄</p>
        </div>

        {/* 옵션·인쇄 버튼(인쇄 제외) */}
        <div className="p-4 border-t border-sprout-100 no-print">
          <label className="flex items-center gap-2 text-sm mb-3">
            <input type="checkbox" checked={includeProfile} onChange={(e) => setIncludeProfile(e.target.checked)} className="accent-sprout-500" />
            내 상황(나이·가구·지역) 포함 <span className="text-xs text-muted-foreground">— 이름은 넣지 않아요</span>
          </label>
          <button onClick={doPrint} className="btn-primary w-full"><Printer className="h-4 w-4" /> 큰 글씨로 인쇄 / PDF 저장</button>
        </div>
      </div>
    </div>
  )
}
