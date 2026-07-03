import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { MessageCircleHeart, X, Send, Mic, Compass, Sparkles, ArrowRight, Plus, Check } from 'lucide-react'
import type { Policy } from '@/data/policies'
import { useSpeech } from '@/lib/useSpeech'
import { GUIDE_STEPS, recommend, type GuideAnswers } from '@/lib/guidedChat'
import { agentReply, greetingReply, matchSaveIntent, type AgentReply } from '@/lib/chatAgent'
import { useAppStore } from '@/store/useAppStore'
import { SproutLogo } from '@/ui/SproutLogo'
import { cn } from '@/lib/utils'

interface Msg { role: 'user' | 'bot'; text: string; policies?: Policy[]; cta?: AgentReply['cta'] }

const SUGGESTIONS = ['내가 받을 수 있는 거', '기초연금', '출산·육아', '청년', '실업급여']

export function ChatWidget() {
  const [open, setOpen] = useState(false)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [step, setStep] = useState(-1) // -1: 가이드 비활성
  const [answers, setAnswers] = useState<GuideAnswers>({ situations: [] })
  const [multiSel, setMultiSel] = useState<{ v: string; l: string }[]>([])
  const setView = useAppStore((s) => s.setView)
  const view = useAppStore((s) => s.view)
  const profile = useAppStore((s) => s.profile)
  const result = useAppStore((s) => s.result)
  const tracked = useAppStore((s) => s.tracked)
  const toggleSaved = useAppStore((s) => s.toggleSaved)
  const endRef = useRef<HTMLDivElement>(null)

  // 열 때 현재 상태(프로필·담아둔 복지)를 먼저 브리핑 — 능동적인 에이전트 인상. 최초 1회.
  useEffect(() => {
    const g = greetingReply(profile, tracked)
    setMsgs([{ role: 'bot', text: g.text, cta: g.cta }])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs, open, step])

  const botSay = (text: string, extra?: Partial<Msg>) => setMsgs((m) => [...m, { role: 'bot', text, ...extra }])

  const send = (text: string) => {
    const q = text.trim()
    if (!q) return
    setMsgs((m) => [...m, { role: 'user', text: q }])
    setInput('')
    // 대화 맥락 기억: 직전에 보여준 복지를 "그거/첫번째/다 담아줘"로 가리키면 실제로 담는다
    const context = [...msgs].reverse().find((m) => m.role === 'bot' && m.policies?.length)?.policies ?? []
    const toSave = matchSaveIntent(q, context)
    if (toSave) {
      const added: string[] = []
      toSave.forEach((p) => {
        if (!tracked.some((t) => t.policyId === p.id)) { toggleSaved(p); added.push(p.name) }
      })
      const msg = added.length
        ? `${added.join(', ')} 담았어요 ✅ 마감·서류는 제가 챙길게요.`
        : `${toSave.map((p) => p.name).join(', ')}는 이미 담겨 있어요 🙂`
      setTimeout(() => botSay(msg, { cta: { view: 'my', label: '나의 복지 보기' } }), 300)
      return
    }
    const r = agentReply(q, { profile, result })
    setTimeout(() => botSay(r.text, { policies: r.policies, cta: r.cta }), 350)
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
        className={cn(
          'fixed bottom-20 md:bottom-6 right-4 sm:right-6 z-40 h-14 w-14 items-center justify-center rounded-full bg-sprout-500 text-white shadow-cute hover:bg-sprout-600 hover:scale-105 active:scale-95 transition-all',
          // 모바일 홈 최상단에서 히어로 CTA와 겹치므로 모바일 홈에서만 숨김(데스크톱 홈·다른 뷰는 유지)
          view === 'home' ? 'hidden md:flex' : 'flex',
        )}
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
                <p className="text-[11px] text-white/80">{profile ? `${profile.name || '회원'}님 맞춤 · 담기까지 도와드려요` : '무엇이든 물어보세요'}</p>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto nice-scroll p-3 space-y-2.5 bg-sprout-50/30" role="log" aria-live="polite" aria-label="대화 내용">
              {msgs.map((m, i) => (
                <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex flex-col items-start gap-1.5'}>
                  <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm whitespace-pre-line leading-relaxed ${m.role === 'user' ? 'bg-sprout-500 text-white rounded-br-sm self-end' : 'bg-white border border-sprout-100 rounded-bl-sm'}`}>
                    {m.text}
                  </div>
                  {m.role === 'bot' && (!!m.policies?.length || m.cta) && (
                    <div className="flex flex-wrap gap-1.5 max-w-[95%]">
                      {m.policies?.map((p) => {
                        const on = tracked.some((t) => t.policyId === p.id)
                        return (
                          <button
                            key={p.id}
                            onClick={() => toggleSaved(p)}
                            aria-pressed={on}
                            className={cn('chip text-xs transition-colors', on ? 'bg-sprout-500 text-white' : 'bg-white border border-sprout-200 text-sprout-700 hover:bg-sprout-50')}
                          >
                            {on ? <Check className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
                            {p.name.length > 11 ? p.name.slice(0, 11) + '…' : p.name}
                          </button>
                        )
                      })}
                      {m.cta && (
                        <button onClick={() => { setView(m.cta!.view); setOpen(false) }} className="chip text-xs bg-sprout-600 text-white font-bold hover:bg-sprout-700">
                          {m.cta.label} <ArrowRight className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  )}
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
