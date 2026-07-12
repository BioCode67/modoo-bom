import { useId, useState } from 'react'
import { annotateTerms, type Term } from '@/lib/glossary'

/**
 * 본문 인라인 '쉬운말' — 어려운 행정용어를 읽는 자리에서 바로 풀어준다.
 * 사전 용어를 점선 밑줄로 표시하고, 탭/클릭하면 그 자리 아래에 쉬운 설명 카드를 편다.
 * 접근성: 각 용어는 button(키보드 접근), aria-expanded, 설명은 aria로 연결. 어르신·저소득층 최대 장벽 해소.
 */
export function TermText({ text, className = '' }: { text: string; className?: string }) {
  const segs = annotateTerms(text)
  const hasTerm = segs.some((s) => s.term)
  if (!hasTerm) return <span className={className}>{text}</span>
  return (
    <span className={className}>
      {segs.map((s, i) => (s.term ? <TermChip key={i} label={s.text} term={s.term} /> : <span key={i}>{s.text}</span>))}
    </span>
  )
}

function TermChip({ label, term }: { label: string; term: Term }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  return (
    <span className="relative inline">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v) }}
        onKeyDown={(e) => { if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false) } }}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        className="underline decoration-dotted decoration-sprout-400 decoration-2 underline-offset-2 text-sprout-700 hover:text-sprout-800 focus-visible:outline-2 focus-visible:outline-sprout-500 rounded-sm"
        title={`${term.term} — 쉬운 설명 보기`}
      >
        {label}<span aria-hidden className="text-[0.7em] align-super text-sprout-500">ⓘ</span>
      </button>
      {open && (
        <span
          id={id}
          role="note"
          className="block my-1.5 rounded-xl border border-sprout-200 bg-sprout-50 px-3 py-2 text-xs leading-relaxed text-foreground/90 not-italic"
        >
          <b className="text-sprout-700">{term.term}</b> — {term.short}
          <span className="block mt-1 text-muted-foreground">{term.plain}</span>
          {term.example && <span className="block mt-1 text-sprout-800">💡 {term.example}</span>}
        </span>
      )}
    </span>
  )
}
