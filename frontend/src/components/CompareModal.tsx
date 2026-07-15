import { useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X } from 'lucide-react'
import type { Policy } from '@/data/policies'
import { parseMonthly, formatWon, categoryMeta, isCashBenefit } from '@/lib/format'
import { useModalFocus } from '@/hooks/useModalFocus'

export function CompareModal({ policies, onClose }: { policies: Policy[]; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null)
  useModalFocus(panelRef, true, onClose) // 포커스 이동·트랩·ESC·스크롤잠금·복원
  const rows: { label: string; get: (p: Policy) => string }[] = [
    { label: '카테고리', get: (p) => p.category },
    // 현금성 혜택만 '월 N원'(바우처·감면·서비스한도는 현금 아님 → '상세 확인').
    // 이름·분류를 context로 넘겨 '장기요양(재가급여)' 같은 서비스 한도액을 현금으로 과장하지 않게(감사 HIGH, PolicyCard와 동일).
    { label: '예상 월 혜택', get: (p) => { const m = isCashBenefit(p.benefit, `${p.name} ${p.category}`) ? parseMonthly(p.benefit) : 0; return m > 0 ? `월 ${formatWon(m)}` : '상세 확인' } },
    { label: '지원 대상', get: (p) => p.target },
    { label: '필요 서류', get: (p) => p.required_docs.join(', ') },
    { label: '신청처', get: (p) => p.application },
    { label: '담당', get: (p) => p.department },
  ]

  return (
    <AnimatePresence>
      <motion.div className="modal-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
        <motion.div
          className="card-cute w-full max-w-3xl max-h-[90vh] overflow-auto nice-scroll"
          initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, opacity: 0 }}
          onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="정책 비교"
          ref={panelRef} tabIndex={-1}
        >
          <div className="sticky top-0 bg-white/95 backdrop-blur border-b border-sprout-100 px-5 py-4 flex items-center justify-between">
            <h2 className="font-extrabold text-lg">정책 비교 ⚖️</h2>
            <button onClick={onClose} aria-label="닫기" className="rounded-full p-2 hover:bg-muted"><X className="h-5 w-5" /></button>
          </div>
          <div className="overflow-x-auto nice-scroll p-2">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className="p-2 text-left text-xs text-muted-foreground sticky left-0 bg-white">항목</th>
                  {policies.map((p) => {
                    const m = categoryMeta(p.category)
                    return (
                      <th key={p.id} className="p-2 text-left min-w-[160px]">
                        <span className="text-lg">{m.emoji}</span>
                        <div className="font-bold leading-tight">{p.name}</div>
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.label} className="border-t border-sprout-50">
                    <td className="p-2 text-xs font-bold text-muted-foreground sticky left-0 bg-white align-top">{r.label}</td>
                    {policies.map((p) => (
                      <td key={p.id} className="p-2 align-top text-foreground/80 text-xs leading-relaxed">{r.get(p)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
