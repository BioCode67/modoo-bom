import { useRef } from 'react'
import { Printer, X, Phone } from 'lucide-react'
import type { Policy } from '@/data/policies'
import type { EligiblePolicy } from '@/lib/welfare-engine'
import { t as tr, RTL, type UiLang } from '@/lib/i18nLite'
import { useModalFocus } from '@/hooks/useModalFocus'

/**
 * 창구 도움 카드 — 한국어가 서툰 외국인·다문화 이용자가 주민센터 창구에서 '말없이 보여주는' 카드.
 * 위쪽은 본인용(자국어 한 줄, 검증된 i18nLite 사전만 사용), 아래는 직원이 읽을 큰 한국어 문장.
 * 기계번역·환각 0 — 번역 불확실성이 있는 문장은 만들지 않고, 핵심 전달은 전부 한국어(직원용)로 한다(정직성).
 * 인쇄는 방문 키트와 동일한 vk-printing 경로(13차 감사에서 헤드리스 PDF 실측 검증된 인프라) 재사용.
 */
export function ClerkCard({ policy, lang, onClose }: { policy: Policy | EligiblePolicy; lang: UiLang; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null)
  useModalFocus(panelRef, true, onClose)
  const docs = policy.required_docs || []
  const rtl = RTL.includes(lang)

  const doPrint = () => {
    document.body.classList.add('vk-printing')
    const cleanup = () => { document.body.classList.remove('vk-printing'); window.removeEventListener('afterprint', cleanup) }
    window.addEventListener('afterprint', cleanup)
    requestAnimationFrame(() => window.print())
  }

  return (
    <div className="modal-overlay no-print" onClick={onClose} role="dialog" aria-modal="true" aria-label={tr(lang, 'clerkCard')}>
      {/* ESC는 이 카드만 닫고 상위 드로어까지 닫히지 않게 전파 차단(VisitKit과 동일 패턴) */}
      <div ref={panelRef} tabIndex={-1} className="modal-content vk-doc"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }}>
        <div className="flex items-center justify-between p-4 border-b border-sprout-100 no-print">
          <p className="font-extrabold">🪪 {tr(lang, 'clerkCard')}</p>
          <button onClick={onClose} aria-label="닫기" className="btn-ghost !p-2"><X className="h-4 w-4" /></button>
        </div>

        {/* 인쇄 대상(화면 미리보기 = 인쇄물) */}
        <div className="p-5 vk-print-area">
          {/* 본인용 안내(자국어) — 검증된 정적 사전 문자열만 */}
          <p dir={rtl ? 'rtl' : 'ltr'} className="rounded-xl bg-sky2-50 border border-sky2-100 px-3 py-2 text-sm font-semibold text-sky2-800">
            {tr(lang, 'clerkHint')}
          </p>

          {/* 직원용 큰 한국어 — 핵심 전달은 전부 한국어(번역 리스크 0) */}
          <div className="vk-block mt-4">
            <p className="vk-h">🙏 창구 직원분께</p>
            <p className="vk-say">안녕하세요. 이 분은 한국어가 서툽니다.</p>
            <p className="vk-say mt-2">「{policy.name}」 신청을 도와주세요.</p>
            <p className="vk-say mt-2">필요한 서류와 다음 절차를 알려주세요.</p>
          </div>

          {docs.length > 0 && (
            <div className="vk-block">
              <p className="vk-h">📑 필요 서류 (같이 확인해 주세요)</p>
              <ul className="vk-docs">
                {docs.map((d) => <li key={d}>☐ {d}</li>)}
              </ul>
            </div>
          )}

          <div className="vk-block">
            <p className="vk-h">📞 통역·상담 지원</p>
            {/* 다누리콜센터는 아랍어 미지원 — 아랍어 사용자에겐 129만 안내(거짓 통역 약속 금지, aiAnswer·banner와 동일 규칙) */}
            {lang !== 'ar' && <p className="vk-tel"><Phone className="inline h-5 w-5 mr-1" /> 다누리콜센터 ☎ 1577-1366 (13개 언어 통역)</p>}
            <p className="vk-tel"><Phone className="inline h-5 w-5 mr-1" /> 보건복지상담센터 ☎ 129</p>
          </div>

          <p className="text-[11px] text-muted-foreground">모두봄 — 몰라서 못 받는 복지를 찾아드립니다 · biocode67.github.io/modoo-bom</p>
        </div>

        <div className="p-4 border-t border-sprout-100 no-print">
          <button onClick={doPrint} className="btn-primary w-full"><Printer className="h-4 w-4" /> {tr(lang, 'visitPrint')}</button>
        </div>
      </div>
    </div>
  )
}
