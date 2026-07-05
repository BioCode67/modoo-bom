import { useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { BookOpen, X, Search } from 'lucide-react'
import { searchGlossary } from '@/lib/glossary'
import { useModalFocus } from '@/hooks/useModalFocus'

/**
 * 복지 용어 쉬운 사전 — 어려운 용어를 일상어로. 어르신·저소득·청년 누구나 이해하도록.
 * 버튼으로 열리는 검색형 모달. 미션 '아주 쉽게'에 직결.
 */
export function Glossary({ trigger = 'button' }: { trigger?: 'button' | 'link' }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const results = searchGlossary(q)
  const panelRef = useRef<HTMLDivElement>(null)
  useModalFocus(panelRef, open, () => setOpen(false))

  return (
    <>
      {trigger === 'link' ? (
        <button onClick={() => setOpen(true)} className="inline-flex items-center gap-1 font-semibold text-sprout-600 hover:underline">
          <BookOpen className="h-3.5 w-3.5" /> 복지 용어 사전
        </button>
      ) : (
        <button onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 rounded-full border-2 border-sprout-100 bg-white px-3.5 py-2 text-sm font-semibold text-sprout-700 hover:border-sprout-200 transition-colors">
          <BookOpen className="h-4 w-4 text-sprout-500" /> 복지 용어가 어려우세요?
        </button>
      )}

      <AnimatePresence>
        {open && (
          <motion.div className="modal-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpen(false)}>
            <motion.div
              className="card-cute w-full max-w-lg max-h-[88vh] overflow-hidden flex flex-col"
              initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="복지 용어 사전"
              ref={panelRef} tabIndex={-1}
            >
              <div className="sticky top-0 bg-white/95 backdrop-blur border-b border-sprout-100 px-5 pt-4 pb-3">
                <div className="flex items-center justify-between">
                  <h2 className="font-extrabold text-lg flex items-center gap-2"><BookOpen className="h-5 w-5 text-sprout-500" /> 복지 용어 쉬운 사전</h2>
                  <button onClick={() => setOpen(false)} aria-label="닫기" className="rounded-full p-2 hover:bg-muted"><X className="h-5 w-5" /></button>
                </div>
                <div className="relative mt-3">
                  <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <input
                    value={q} onChange={(e) => setQ(e.target.value)} autoFocus
                    placeholder="궁금한 용어 검색 (예: 소득인정액, 차상위)"
                    aria-label="용어 검색"
                    className="w-full rounded-2xl border-2 border-sprout-100 bg-white pl-10 pr-3 py-2.5 text-sm font-medium focus-ring"
                  />
                </div>
              </div>

              <div className="overflow-y-auto nice-scroll px-5 py-4 space-y-3">
                {results.length === 0 ? (
                  <p className="text-center text-sm text-muted-foreground py-10">‘{q}’에 해당하는 용어가 없어요. 다른 말로 검색해 보세요.</p>
                ) : (
                  results.map((t) => (
                    <div key={t.term} className="rounded-2xl border border-sprout-100 bg-sprout-50/40 p-4">
                      <p className="font-bold text-sprout-700">{t.term}</p>
                      <p className="text-sm font-semibold text-foreground/90 mt-0.5">{t.short}</p>
                      <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">{t.plain}</p>
                      {t.example && (
                        <p className="mt-2 rounded-xl bg-white border border-sprout-100 px-3 py-2 text-xs text-sprout-700">
                          💡 {t.example}
                        </p>
                      )}
                    </div>
                  ))
                )}
              </div>
              <div className="border-t border-sprout-100 px-5 py-2.5 text-[11px] text-muted-foreground/80 text-center">
                정확한 자격·금액은 복지로 또는 주민센터(☎129)에서 확인하세요.
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
