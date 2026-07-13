import { useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { LifeBuoy, X, Phone, ExternalLink } from 'lucide-react'
import { CRISES, matchEmergency } from '@/lib/emergency'
import { bestApplyUrl, bestApplyLabel } from '@/lib/quickApply'
import { parseMonthly, formatWon, categoryMeta, isCashBenefit } from '@/lib/format'
import { useModalFocus } from '@/hooks/useModalFocus'
import { cn } from '@/lib/utils'

/** 위기 상황 빠른 진단 — 복지 사각지대의 가장 급한 사용자를 즉시 돕는다. */
export function EmergencyHelp() {
  const [open, setOpen] = useState(false)
  const [sel, setSel] = useState<string[]>([])
  const matched = matchEmergency(sel)
  const panelRef = useRef<HTMLDivElement>(null)
  useModalFocus(panelRef, open, () => setOpen(false))

  const toggle = (k: string) => setSel((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]))

  return (
    <>
      {/* 배너 */}
      <div className="page-container -mt-4 mb-2">
        <button
          onClick={() => setOpen(true)}
          className="w-full flex items-center gap-3 rounded-2xl border-2 border-rose-200 bg-rose-50 px-5 py-3.5 text-left hover:bg-rose-100/70 transition-colors"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-500 text-white"><LifeBuoy className="h-5 w-5" /></span>
          <span className="flex-1">
            <span className="block font-bold text-rose-700">지금 위기 상황이신가요?</span>
            <span className="block text-xs text-rose-700">실직·질병·재난 등 긴급한 상황이면 바로 도와드릴게요</span>
          </span>
          <span className="chip bg-rose-600 text-white shrink-0">긴급 도움</span>
        </button>
      </div>

      <AnimatePresence>
        {open && (
          <motion.div className="modal-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpen(false)}>
            <motion.div
              className="card-cute w-full max-w-lg max-h-[90vh] overflow-auto nice-scroll"
              initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="긴급복지 빠른 진단" ref={panelRef} tabIndex={-1}
            >
              <div className="sticky top-0 bg-white/95 backdrop-blur border-b border-sprout-100 px-5 py-4 flex items-center justify-between">
                <h2 className="font-extrabold text-lg flex items-center gap-2"><LifeBuoy className="h-5 w-5 text-rose-500" /> 긴급 도움받기</h2>
                <button onClick={() => setOpen(false)} aria-label="닫기" className="rounded-full p-2 hover:bg-muted"><X className="h-5 w-5" /></button>
              </div>

              <div className="p-5">
                <p className="text-sm text-muted-foreground">지금 겪고 계신 상황을 선택하세요(중복 가능). <b>관련 있는</b> 긴급 지원을 바로 찾아드려요. <span className="text-[11px]">(긴급복지 등은 소득·재산 요건이 있어 실제 자격은 129·주민센터에서 확인해요.)</span></p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {CRISES.map((c) => (
                    <button
                      key={c.key}
                      onClick={() => toggle(c.key)}
                      aria-pressed={sel.includes(c.key)}
                      className={cn('flex items-center gap-2 rounded-xl border-2 px-3 py-2.5 text-sm font-semibold text-left transition-all active:scale-95',
                        sel.includes(c.key) ? 'bg-rose-500 border-rose-500 text-white' : 'bg-white border-rose-100 hover:border-rose-200')}
                    >
                      <span className="text-lg">{c.emoji}</span> {c.label}
                    </button>
                  ))}
                </div>

                {/* 긴급 연락 — 항상 표시 */}
                <div className="mt-4 rounded-2xl bg-rose-50 border border-rose-200 p-4">
                  <p className="text-sm font-bold text-rose-700">⏱️ 한시가 급하면 바로 연락하세요</p>
                  <div className="mt-2 flex gap-2">
                    <a href="tel:129" className="btn-warm !bg-rose-500 hover:!bg-rose-600 !py-2.5 flex-1"><Phone className="h-4 w-4" /> 129 긴급복지 상담</a>
                    <a href="https://www.bokjiro.go.kr" target="_blank" rel="noopener noreferrer" className="btn-secondary !py-2.5"><ExternalLink className="h-4 w-4" /> 복지로</a>
                  </div>
                  <p className="mt-2 text-[11px] text-rose-700">긴급복지지원은 ‘선지원 후심사’ — 주민센터·129에 먼저 알리면 빠르게 도움받을 수 있어요.</p>
                </div>

                {/* 안전 위기(폭력·학대) 선택 시 — 복지 상담이 아니라 전용 긴급 핫라인을 최우선 표시(생명·안전 우선) */}
                {sel.includes('violence') && (
                  <div className="mt-3 rounded-2xl bg-red-600 text-white p-4">
                    <p className="text-sm font-extrabold">🆘 안전이 급하면 지금 바로 — 24시간 무료</p>
                    <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <a href="tel:112" className="flex items-center gap-2 rounded-xl bg-white/15 hover:bg-white/25 px-3 py-2.5 text-sm font-bold transition-colors"><Phone className="h-4 w-4" /> 112 경찰(범죄·아동학대 신고)</a>
                      <a href="tel:1366" className="flex items-center gap-2 rounded-xl bg-white/15 hover:bg-white/25 px-3 py-2.5 text-sm font-bold transition-colors"><Phone className="h-4 w-4" /> 1366 여성긴급전화(가정폭력·성폭력)</a>
                      <a href="tel:1577-1391" className="flex items-center gap-2 rounded-xl bg-white/15 hover:bg-white/25 px-3 py-2.5 text-sm font-bold transition-colors"><Phone className="h-4 w-4" /> 1577-1391 아동보호전문기관</a>
                      <a href="tel:1393" className="flex items-center gap-2 rounded-xl bg-white/15 hover:bg-white/25 px-3 py-2.5 text-sm font-bold transition-colors"><Phone className="h-4 w-4" /> 1393 자살예방 상담</a>
                    </div>
                    <p className="mt-2 text-[11px] text-white/85">위험한 상황이면 복지 신청보다 위 번호로 먼저 연락하세요. 통화가 어려우면 112에 문자도 가능해요.</p>
                  </div>
                )}

                {/* 매칭 결과 */}
                {matched.length > 0 && (
                  <div className="mt-4">
                    <p className="text-sm font-bold mb-2">관련 있는 긴급 지원 {matched.length}건 <span className="text-[11px] font-normal text-muted-foreground">· 자격은 소득·재산 심사 후 확정</span></p>
                    <ul className="space-y-2">
                      {matched.map((p) => {
                        // 월 배지는 '현금성 월지원'만 — 일시금·바우처·서비스는 "월 X"로 오표기하지 않는다(정직성)
                        const m = isCashBenefit(p.benefit, `${p.name} ${p.category}`) ? parseMonthly(p.benefit) : 0
                        return (
                          <li key={p.id} className="card-cute p-3">
                            <div className="flex items-center gap-2">
                              <span>{categoryMeta(p.category).emoji}</span>
                              <span className="font-bold text-sm flex-1">{p.name}</span>
                              {m > 0 && <span className="text-xs font-extrabold text-sprout-700">월 {formatWon(m)}</span>}
                            </div>
                            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{p.benefit}</p>
                            <a href={bestApplyUrl(p.application, p.name)} target="_blank" rel="noopener noreferrer" className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-sprout-700 hover:underline">
                              {bestApplyLabel(p.application, p.name)} <ExternalLink className="h-3 w-3" />
                            </a>
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
