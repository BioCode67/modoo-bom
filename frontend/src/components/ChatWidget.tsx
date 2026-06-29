import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { MessageCircleHeart, X, Send, Mic, Compass, Sparkles, ArrowRight } from 'lucide-react'
import type { Policy } from '@/data/policies'
import { getCatalog } from '@/data/catalog'
import { parseMonthly, formatWon } from '@/lib/format'
import { applyLink } from '@/lib/officialLinks'
import { useSpeech } from '@/lib/useSpeech'
import { GUIDE_STEPS, recommend, type GuideAnswers } from '@/lib/guidedChat'
import { useAppStore } from '@/store/useAppStore'
import { SproutLogo } from '@/ui/SproutLogo'
import { cn } from '@/lib/utils'

interface Msg { role: 'user' | 'bot'; text: string }

const SUGGESTIONS = ['기초연금', '출산·육아', '청년', '실업급여']

/** 문장형 질문도 잘 잡도록 토큰(단어) 단위 점수 검색 */
function tokenSearch(q: string, limit = 3): Policy[] {
  const tokens = (q.toLowerCase().match(/[가-힣a-z0-9]+/g) || []).filter((t) => t.length >= 2)
  if (tokens.length === 0) return []
  const scored = getCatalog().map((p) => {
    const hay = (p.name + ' ' + p.category + ' ' + p.target + ' ' + p.eligibility + ' ' + p.benefit).toLowerCase()
    let score = 0
    for (const t of tokens) {
      if (p.name.toLowerCase().includes(t)) score += 3
      else if (p.category.toLowerCase().includes(t) || p.target.toLowerCase().includes(t)) score += 2
      else if (hay.includes(t)) score += 1
    }
    return { p, score }
  }).filter((x) => x.score > 0)
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, limit).map((x) => x.p)
}

function answer(q: string): string {
  const query = q.trim()
  if (!query) return ''
  if (/안녕|하이|hello|반가/i.test(query)) return '안녕하세요! 🌱 어떤 복지가 궁금하세요? 나이나 상황을 알려주시면 딱 맞는 혜택을 찾아드릴게요.'
  const found = tokenSearch(query, 3)
  if (found.length === 0) {
    return `'${query}'에 딱 맞는 정책을 바로 찾지 못했어요. 😅 "내 복지 찾기"에서 상황을 입력하면 더 정확하게 안내해 드릴 수 있어요. 급하시면 복지로(129) 무료 상담도 좋아요.`
  }
  const lines = found.map((p) => {
    const m = parseMonthly(p.benefit)
    const amt = m > 0 ? ` (월 ${formatWon(m)}까지)` : ''
    return `• ${p.name}${amt} — ${applyLink(p.application).label}`
  })
  return `이런 복지가 있어요! 👇\n${lines.join('\n')}\n\n자세한 내용은 "정책 탐색"에서 확인할 수 있어요.`
}

export function ChatWidget() {
  const [open, setOpen] = useState(false)
  const [msgs, setMsgs] = useState<Msg[]>([{ role: 'bot', text: '안녕하세요! 복지 도우미예요 🌱\n"🧭 맞춤 상담"으로 몇 가지만 답하면 딱 맞는 복지를 찾아드려요.' }])
  const [input, setInput] = useState('')
  const [step, setStep] = useState(-1) // -1: 가이드 비활성
  const [answers, setAnswers] = useState<GuideAnswers>({ situations: [] })
  const [multiSel, setMultiSel] = useState<{ v: string; l: string }[]>([])
  const setView = useAppStore((s) => s.setView)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs, open, step])

  const botSay = (text: string) => setMsgs((m) => [...m, { role: 'bot', text }])

  const send = (text: string) => {
    const q = text.trim()
    if (!q) return
    setMsgs((m) => [...m, { role: 'user', text: q }])
    setInput('')
    setTimeout(() => botSay(answer(q)), 350)
  }

  // ── 가이드형 상담 ──
  const startGuide = () => {
    setAnswers({ situations: [] }); setMultiSel([]); setStep(0)
    setMsgs((m) => [...m, { role: 'user', text: '맞춤 상담 시작' }, { role: 'bot', text: GUIDE_STEPS[0].question }])
  }
  const stopGuide = () => { setStep(-1); setMultiSel([]); botSay('상담을 멈췄어요. 언제든 다시 시작할 수 있어요. 🙂') }

  const advance = (next: GuideAnswers) => {
    const ns = step + 1
    if (ns < GUIDE_STEPS.length) { setStep(ns); setMultiSel([]); setTimeout(() => botSay(GUIDE_STEPS[ns].question), 300) }
    else { setStep(-1); const { text } = recommend(next); setTimeout(() => botSay(text), 300) }
  }
  const pickSingle = (o: { value: string; label: string }) => {
    const cur = GUIDE_STEPS[step]
    const next: GuideAnswers = { ...answers }
    if (cur.id === 'age') next.age = Number(o.value)
    else if (cur.id === 'income') next.income = Number(o.value)
    setAnswers(next)
    setMsgs((m) => [...m, { role: 'user', text: o.label }])
    advance(next)
  }
  const confirmMulti = () => {
    const next: GuideAnswers = { ...answers, situations: multiSel.map((x) => x.v) }
    setAnswers(next)
    setMsgs((m) => [...m, { role: 'user', text: multiSel.length ? multiSel.map((x) => x.l).join(', ') : '해당 없음' }])
    advance(next)
  }

  // 음성으로 질문 → 바로 전송
  const { supported: micOk, listening, toggle: toggleMic } = useSpeech((text) => send(text))

  return (
    <>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="복지 도우미 챗봇 열기"
        className="fixed bottom-20 md:bottom-6 right-4 sm:right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-sprout-500 text-white shadow-cute hover:bg-sprout-600 hover:scale-105 active:scale-95 transition-all"
      >
        <AnimatePresence mode="wait">
          {open ? <motion.span key="x" initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 90, opacity: 0 }}><X className="h-6 w-6" /></motion.span>
            : <motion.span key="c" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}><MessageCircleHeart className="h-6 w-6" /></motion.span>}
        </AnimatePresence>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 20, scale: 0.95 }}
            className="fixed bottom-36 md:bottom-24 right-4 sm:right-6 z-40 w-[calc(100vw-2rem)] max-w-sm card-cute overflow-hidden flex flex-col"
            style={{ height: 'min(70vh, 520px)' }}
            role="dialog" aria-label="복지 도우미 챗봇"
          >
            <div className="flex items-center gap-2.5 bg-gradient-to-r from-sprout-500 to-emerald-500 px-4 py-3 text-white">
              <SproutLogo withFace className="h-8 w-8 bg-white/20 rounded-full p-0.5" />
              <div>
                <p className="font-bold leading-tight">복지 도우미</p>
                <p className="text-[11px] text-white/80">무엇이든 물어보세요</p>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto nice-scroll p-3 space-y-2.5 bg-sprout-50/30" role="log" aria-live="polite" aria-label="대화 내용">
              {msgs.map((m, i) => (
                <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                  <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm whitespace-pre-line leading-relaxed ${m.role === 'user' ? 'bg-sprout-500 text-white rounded-br-sm' : 'bg-white border border-sprout-100 rounded-bl-sm'}`}>
                    {m.text}
                  </div>
                </div>
              ))}
              <div ref={endRef} />
            </div>

            <div className="px-3 pt-2 flex gap-1.5 flex-wrap border-t border-sprout-100 max-h-28 overflow-y-auto nice-scroll">
              {step >= 0 ? (
                <>
                  {GUIDE_STEPS[step].options.map((o) => {
                    const sel = multiSel.some((x) => x.v === o.value)
                    return GUIDE_STEPS[step].multi ? (
                      <button key={o.value} onClick={() => setMultiSel((s) => (sel ? s.filter((x) => x.v !== o.value) : [...s, { v: o.value, l: o.label }]))}
                        aria-pressed={sel} className={cn('chip transition-colors', sel ? 'bg-sprout-500 text-white' : 'bg-muted hover:bg-sprout-100')}>{o.label}</button>
                    ) : (
                      <button key={o.value} onClick={() => pickSingle({ value: o.value, label: o.label })} className="chip bg-muted hover:bg-sprout-100 transition-colors">{o.label}</button>
                    )
                  })}
                  {GUIDE_STEPS[step].multi && <button onClick={confirmMulti} className="chip bg-sprout-600 text-white font-bold">다음 <ArrowRight className="h-3.5 w-3.5" /></button>}
                  <button onClick={stopGuide} className="chip bg-white border border-sprout-100 text-muted-foreground">그만두기</button>
                </>
              ) : (
                <>
                  <button onClick={startGuide} className="chip-peach font-bold"><Compass className="h-3.5 w-3.5" /> 맞춤 상담</button>
                  {SUGGESTIONS.map((s) => (
                    <button key={s} onClick={() => send(s)} className="chip-sprout hover:bg-sprout-200 transition-colors">{s}</button>
                  ))}
                  <button onClick={() => { setView('analyze'); setOpen(false) }} className="chip bg-muted hover:bg-sprout-100"><Sparkles className="h-3.5 w-3.5" /> 정밀 분석</button>
                </>
              )}
            </div>

            <form onSubmit={(e) => { e.preventDefault(); send(input) }} className="p-3 flex gap-2">
              <input
                value={input} onChange={(e) => setInput(e.target.value)} placeholder={listening ? '듣고 있어요…' : '복지 질문을 입력하세요'}
                className="flex-1 rounded-xl border-2 border-sprout-100 bg-white px-3 py-2 text-sm focus-ring" aria-label="질문 입력"
              />
              {micOk && (
                <button type="button" onClick={toggleMic} aria-label={listening ? '음성 입력 중지' : '음성으로 질문'}
                  className={cn('rounded-xl px-3 border-2 transition-colors', listening ? 'bg-rose-500 border-rose-500 text-white animate-pulse' : 'bg-white border-sprout-100 text-sprout-600 hover:border-sprout-300')}>
                  <Mic className="h-4 w-4" />
                </button>
              )}
              <button type="submit" className="btn-primary !px-3" aria-label="전송"><Send className="h-4 w-4" /></button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
