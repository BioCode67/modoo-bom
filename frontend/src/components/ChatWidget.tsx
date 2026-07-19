import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { MessageCircleHeart, X, Send, Mic, Compass, Sparkles, ArrowRight, Plus, Check, Phone } from 'lucide-react'
import type { Policy } from '@/data/policies'
import { useSpeech } from '@/lib/useSpeech'
import { GUIDE_STEPS, recommend, type GuideAnswers } from '@/lib/guidedChat'
import { agentReply, greetingReply, matchSaveIntent, isLocalIntent, type AgentReply } from '@/lib/chatAgent'
import { API_BASE, checkBackend, getCapabilities } from '@/lib/backend'
import { useBackend } from '@/lib/useBackend'
import { getCatalog } from '@/data/catalog'
import { useAppStore } from '@/store/useAppStore'
import { SproutLogo } from '@/ui/SproutLogo'
import { VoiceCall, type Turn } from '@/components/VoiceCall'
import { cn } from '@/lib/utils'

interface Msg { role: 'user' | 'bot'; text: string; policies?: Policy[]; cta?: AgentReply['cta']; ai?: boolean; pending?: boolean; pendingId?: string }

const SUGGESTIONS = ['내가 받을 수 있는 거', '기초연금', '출산·육아', '청년', '실업급여']

export function ChatWidget() {
  const [open, setOpen] = useState(false)
  // 📞 통화형 상담 — 다른 화면(분석 등)의 CTA가 커스텀 이벤트로 열 수 있게(docs-changed와 동일 패턴)
  // detail.lang(en·vi·zh)이 오면 그 언어로 통화 시작(외국인 진입로의 '자국어 통화' 직행)
  const [callOpen, setCallOpen] = useState(false)
  const [callLang, setCallLang] = useState<string | undefined>(undefined)
  const [callBriefing, setCallBriefing] = useState(false) // 결과 화면 '📞 전화로 설명 듣기' — 인사 대신 결과 브리핑으로 시작
  useEffect(() => {
    const onCall = (e: Event) => {
      const d = (e as CustomEvent).detail
      setCallLang(d?.lang)
      setCallBriefing(!!d?.briefing)
      setCallOpen(true)
      setOpen(false)
    }
    window.addEventListener('modoobom:voice-call', onCall)
    return () => window.removeEventListener('modoobom:voice-call', onCall)
  }, [])
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [step, setStep] = useState(-1) // -1: 가이드 비활성
  const [answers, setAnswers] = useState<GuideAnswers>({ situations: [] })
  const [multiSel, setMultiSel] = useState<{ v: string; l: string }[]>([])
  const [guideName, setGuideName] = useState('') // 상담 중 성함(선택) — 실명이면 인증 자동입력에 활용
  const [guideAge, setGuideAge] = useState('')   // 정확한 나이 직접 입력(연령대 대표값 대신)
  const setView = useAppStore((s) => s.setView)
  const view = useAppStore((s) => s.view)
  const profile = useAppStore((s) => s.profile)
  const result = useAppStore((s) => s.result)
  const tracked = useAppStore((s) => s.tracked)
  const docDone = useAppStore((s) => s.docDone)
  const toggleSaved = useAppStore((s) => s.toggleSaved)
  const setRpaInfo = useAppStore((s) => s.setRpaInfo)
  const resetNonce = useAppStore((s) => s.resetNonce)
  const { ready, caps } = useBackend()
  const aiChat = ready === true && !!caps?.ai // 클라우드/로컬 백엔드의 진짜 LLM(Claude) 사용 가능
  const agentOn = ready === true && !!caps?.rpa // 데스크탑 에이전트 — 서류/신청 답변이 자동화 경로를 안내
  const endRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  /** 지식형 질문을 백엔드 LLM(/ws/chat)에 물어본다 — 실패·지연(12s)이면 null(로컬 폴백) */
  const askCloud = (q: string): Promise<{ answer: string; names: string[] } | null> =>
    new Promise((resolve) => {
      let done = false
      let sock: WebSocket | null = null
      const fin = (v: { answer: string; names: string[] } | null) => {
        if (done) return
        done = true
        try { sock?.close() } catch { /* noop */ }
        resolve(v)
      }
      try { sock = new WebSocket(`${API_BASE.replace(/^http/, 'ws')}/ws/chat`) } catch { return fin(null) }
      const to = setTimeout(() => fin(null), 12000)
      sock.onopen = () => sock?.send(JSON.stringify({ type: 'question', question: q }))
      sock.onerror = () => { clearTimeout(to); fin(null) }
      sock.onmessage = (e) => {
        try {
          const d = JSON.parse(e.data as string)
          if (d.type === 'answer') { clearTimeout(to); fin({ answer: String(d.answer || ''), names: ((d.related_policies as { name?: string }[]) || []).map((x) => String(x.name || '')) }) }
          else if (d.type === 'error') { clearTimeout(to); fin(null) }
        } catch { clearTimeout(to); fin(null) }
      }
    })

  // 챗을 '여는 순간'의 최신 상태(프로필·담아둔 복지)로 브리핑 — 능동적인 에이전트 인상.
  // 앱 로드 시점이 아니라 열 때 계산해야 분석을 나중에 마쳐도 stale 인사가 남지 않는다.
  // 사용자가 대화를 시작(user 메시지)한 뒤에는 갱신하지 않고 대화를 보존.
  useEffect(() => {
    if (!open) return
    setMsgs((m) => {
      if (m.some((x) => x.role === 'user')) return m
      const g = greetingReply(profile, tracked, docDone)
      return [{ role: 'bot', text: g.text, cta: g.cta }]
    })
  }, [open, profile, tracked, docDone])

  // 상담 전환('다음 분 상담 시작')이면 대화 내용(이전 어르신 실명·상담)을 비운다 — resetNonce 신호.
  useEffect(() => {
    if (resetNonce === 0) return
    setMsgs([]); setInput(''); setStep(-1)
    setAnswers({ situations: [] }); setMultiSel([]); setGuideName(''); setGuideAge('')
  }, [resetNonce])

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs, open, step])

  // 열릴 때 입력창으로 포커스 이동 + ESC로 닫기 — 키보드·스크린리더 접근성(다른 모달과 동작 통일)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    const t = setTimeout(() => inputRef.current?.focus(), 60)
    return () => { document.removeEventListener('keydown', onKey); clearTimeout(t) }
  }, [open])

  const botSay = (text: string, extra?: Partial<Msg>) => setMsgs((m) => [...m, { role: 'bot', text, ...extra }])

  // 📞 통화 기록 연속성 — 통화를 끊어도 대화가 증발하지 않고 챗에 이어진다("아까 뭐랬지?" 해결).
  // 정책 칩(policies)은 유지해 챗에서 '담기/상세'를 이어서 할 수 있게 하고, CTA·act(프리필 부수효과)는
  // 기록 목적에 맞지 않아 버린다. 인사만 하고 끊은 통화는 기록하지 않는다(노이즈 방지).
  // 대화 삭제('다음 분 상담 시작')는 챗과 같은 resetNonce로 함께 지워진다(개인정보 일관성).
  const absorbCall = (turns: Turn[]) => {
    if (!turns.some((t) => t.role === 'user')) return
    setMsgs((m) => [
      ...m,
      { role: 'bot', text: '📞 방금 통화하신 내용이에요 — 이어서 챗으로 물어보셔도 돼요.' },
      ...turns.map((t): Msg => ({ role: t.role, text: t.text, policies: t.policies })),
    ])
  }

  const send = (text: string) => {
    const q = text.trim()
    if (!q) return
    setMsgs((m) => [...m, { role: 'user', text: q }])
    setInput('')
    // 대화 맥락 기억: 직전에 보여준 복지를 "그거/첫번째/다 담아줘"로 가리키면 실제로 담는다.
    // 챗 내 맥락이 없으면(열자마자 "다 담아줘") 분석 결과의 정밀추천(POL-)을 저장 대상으로 폴백 —
    // '분석 → 챗 열기 → 다 담아줘'가 바로 동작하게(관련/민간은 과담기 방지 위해 제외).
    const inChat = [...msgs].reverse().find((m) => m.role === 'bot' && m.policies?.length)?.policies ?? []
    const fallback = result?.eligible_policies?.filter((p) => /^POL-/.test(p.id)) ?? []
    const context = inChat.length ? inChat : (fallback as Policy[])
    // 폴백(분석 결과 전체)일 땐 명시적 지시("다 담아줘"·정책명)만 저장 — 밋밋한 "담아줘"로 수십 건 무단 저장 방지
    const toSave = matchSaveIntent(q, context, inChat.length === 0)
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
    // 하이브리드: 행동·개인화 의도는 로컬 에이전트(정확·즉시), 지식 질문은 진짜 LLM(백엔드 시) — 실패하면 규칙 폴백
    // 콜드스타트(ready===null, 클라우드 깨우는 중)엔 웨이크 완료를 기다렸다가 LLM으로 답한다 —
    // 기다리지 않으면 첫 1분간 지식 질문이 전부 규칙 폴백("못 찾았어요")으로 떨어진다.
    if ((aiChat || ready === null) && !isLocalIntent(q)) {
      // 각 대기 버블에 고유 id — 연속 질문 시 '자기' 버블만 지운다(과거엔 첫 응답이 모든 pending 을 일괄
      //   제거해 두 번째 질문이 침묵하던 결함, 적대 리뷰 확정).
      const pid = `p${Date.now()}-${Math.round(Math.random() * 1e6)}`
      setMsgs((m) => [...m, {
        role: 'bot',
        text: aiChat ? '관련 복지를 찾아보고 있어요…' : 'AI 에이전트를 깨우는 중이에요… 첫 접속은 30초쯤 걸릴 수 있어요 🌱',
        pending: true, pendingId: pid,
      }])
      // 웨이크 대기는 25초 캡 — 콜드스타트가 길어지면 규칙 응답으로 폴백해 챗이 침묵하지 않게(적대 리뷰)
      const gate: Promise<boolean> = aiChat
        ? Promise.resolve(true)
        : Promise.race([checkBackend(), new Promise<boolean>((r) => setTimeout(() => r(false), 25000))])
      gate.then((ok) => (ok && getCapabilities()?.ai ? askCloud(q) : null)).then((res) => {
        setMsgs((m) => m.filter((x) => x.pendingId !== pid))
        if (res && res.answer) {
          // 관련 정책명을 카탈로그와 매칭해 '담기' 칩으로(행동 연결)
          const cat = getCatalog()
          const pols = res.names
            .map((n) => cat.find((p) => p.name.replace(/\s/g, '') === n.replace(/\s/g, '')))
            .filter((p): p is Policy => !!p)
            .slice(0, 3)
          botSay(res.answer, { policies: pols.length ? pols : undefined, ai: true })
        } else {
          const r = agentReply(q, { profile, result, tracked, agentOn })
          botSay(r.text, { policies: r.policies, cta: r.cta })
        }
      })
      return
    }
    const r = agentReply(q, { profile, result, tracked, agentOn })
    setTimeout(() => botSay(r.text, { policies: r.policies, cta: r.cta }), 350)
  }

  // ── 가이드형 상담 ──
  const startGuide = () => {
    setAnswers({ situations: [] }); setMultiSel([]); setGuideName(''); setGuideAge(''); setStep(0)
    setMsgs((m) => [...m, { role: 'user', text: '맞춤 상담 시작' }, { role: 'bot', text: GUIDE_STEPS[0].question }])
  }
  const stopGuide = () => { setStep(-1); setMultiSel([]); botSay('상담을 멈췄어요. 언제든 다시 시작할 수 있어요. 🙂') }

  const advance = (next: GuideAnswers) => {
    const ns = step + 1
    if (ns < GUIDE_STEPS.length) { setStep(ns); setMultiSel([]); setTimeout(() => botSay(GUIDE_STEPS[ns].question), 300) }
    else {
      setStep(-1)
      // 상담 결과도 에이전트 일관성: 정책 칩(바로 담기)+CTA를 붙이고, "다 담아줘" 맥락에도 잡히게 한다
      const { text, policies } = recommend(next)
      setTimeout(() => botSay(text, { policies, cta: { view: 'analyze', label: '정밀 분석하기' } }), 300)
    }
  }
  const pickSingle = (o: { value: string; label: string }) => {
    const cur = GUIDE_STEPS[step]
    const next: GuideAnswers = { ...answers }
    if (cur.id === 'age') {
      next.age = Number(o.value)
      if (guideName.trim()) { next.name = guideName.trim(); setRpaInfo({ name: guideName.trim() }) }
    } else if (cur.id === 'income') next.income = Number(o.value)
    setAnswers(next)
    setMsgs((m) => [...m, { role: 'user', text: o.label }])
    advance(next)
  }
  // 성함(선택)+정확한 나이 직접 입력 — 연령대 대표값(예: 청년→27) 대신 실제 나이로 정밀 판정.
  //   실명이면 서류 발급·신청의 본인인증 자동입력(rpaInfo)에도 바로 쓰인다.
  const submitNameAge = () => {
    const age = parseInt(guideAge, 10)
    if (Number.isNaN(age) || age < 0 || age > 120) return
    const nm = guideName.trim()
    const next: GuideAnswers = { ...answers, age, ...(nm ? { name: nm } : {}) }
    if (nm) setRpaInfo({ name: nm })
    setAnswers(next)
    setMsgs((m) => [...m, { role: 'user', text: `${nm ? nm + ', ' : ''}만 ${age}세` }])
    advance(next)
  }
  const confirmMulti = () => {
    const next: GuideAnswers = { ...answers, situations: multiSel.map((x) => x.v) }
    setAnswers(next)
    setMsgs((m) => [...m, { role: 'user', text: multiSel.length ? multiSel.map((x) => x.l).join(', ') : '해당 없음' }])
    advance(next)
  }

  // 음성으로 질문 → 바로 전송
  const { supported: micOk, listening, toggle: toggleMic, error: micError } = useSpeech((text) => send(text))

  return (
    <>
      <VoiceCall open={callOpen} presetLang={callLang} briefing={callBriefing} onTranscript={absorbCall} onClose={() => { setCallOpen(false); setCallLang(undefined); setCallBriefing(false) }} />
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? '복지 도우미 챗봇 닫기' : '복지 도우미 챗봇 열기'}
        aria-expanded={open}
        className={cn(
          'fixed bottom-20 md:bottom-6 right-4 sm:right-6 z-40 h-14 w-14 items-center justify-center rounded-full bg-sprout-700 text-white shadow-cute hover:bg-sprout-600 hover:scale-105 active:scale-95 transition-all',
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
            <div className="flex items-center gap-2.5 bg-gradient-to-r from-sprout-700 to-emerald-700 px-4 py-3 text-white">
              <SproutLogo withFace className="h-8 w-8 bg-white/20 rounded-full p-0.5" />
              <div className="flex-1 min-w-0">
                <p className="font-bold leading-tight">새싹이 · 복지 에이전트</p>
                <p className="text-[11px] text-white/80">{aiChat ? '물어보면 바로 찾아드려요 · 내 정보는 기기 안에서' : profile ? `${profile.name || '회원'}님 맞춤 · 담기까지 도와드려요` : '무엇이든 물어보세요'}</p>
              </div>
              <button
                onClick={() => { setCallOpen(true); setOpen(false) }}
                className="rounded-full p-2 bg-white/15 hover:bg-white/25"
                aria-label="음성 통화 상담으로 전환"
                title="📞 새싹이와 통화하기 — 말로만 상담"
              >
                <Phone className="h-[18px] w-[18px]" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto nice-scroll p-3 space-y-2.5 bg-sprout-50/30" role="log" aria-live="polite" aria-label="대화 내용">
              {msgs.map((m, i) => (
                <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex flex-col items-start gap-1.5'}>
                  <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm whitespace-pre-line leading-relaxed ${m.role === 'user' ? 'bg-sprout-700 text-white rounded-br-sm self-end' : 'bg-white border border-sprout-100 rounded-bl-sm'}`}>
                    {m.text}
                  </div>
                  {m.role === 'bot' && m.ai && (
                    <span className="text-[10px] text-sky2-700 font-semibold -mt-0.5">🌱 복지를 찾아 정리한 답변이에요</span>
                  )}
                  {m.role === 'bot' && (!!m.policies?.length || m.cta) && (
                    <div className="flex flex-wrap gap-1.5 max-w-[95%]">
                      {m.policies?.map((p) => {
                        const on = tracked.some((t) => t.policyId === p.id)
                        return (
                          <button
                            key={p.id}
                            onClick={() => toggleSaved(p)}
                            aria-pressed={on}
                            className={cn('chip text-xs transition-colors', on ? 'bg-sprout-700 text-white' : 'bg-white border border-sprout-200 text-sprout-700 hover:bg-sprout-50')}
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
                  {/* 나이 단계: 성함(선택)+정확한 나이 직접 입력 — 연령대 대표값 대신 실제 나이로(서류 자동입력에도 사용) */}
                  {GUIDE_STEPS[step].id === 'age' && (
                    <div className="w-full flex gap-1.5 items-center mb-1">
                      <input value={guideName} onChange={(e) => setGuideName(e.target.value)} placeholder="성함(선택)" aria-label="성함"
                        className="flex-1 min-w-0 rounded-lg border border-sprout-100 px-2 py-1 text-xs focus-ring" />
                      <input value={guideAge} onChange={(e) => setGuideAge(e.target.value.replace(/[^0-9]/g, ''))} placeholder="나이"
                        inputMode="numeric" aria-label="정확한 나이" onKeyDown={(e) => { if (e.key === 'Enter') submitNameAge() }}
                        className="w-12 rounded-lg border border-sprout-100 px-2 py-1 text-xs focus-ring" />
                      <button onClick={submitNameAge} disabled={!guideAge} className="chip bg-sprout-600 text-white font-bold disabled:opacity-40">확인</button>
                      <span className="text-[10px] text-muted-foreground self-center">또는 아래 선택</span>
                    </div>
                  )}
                  {GUIDE_STEPS[step].options.map((o) => {
                    const sel = multiSel.some((x) => x.v === o.value)
                    return GUIDE_STEPS[step].multi ? (
                      <button key={o.value} onClick={() => setMultiSel((s) => (sel ? s.filter((x) => x.v !== o.value) : [...s, { v: o.value, l: o.label }]))}
                        aria-pressed={sel} className={cn('chip transition-colors', sel ? 'bg-sprout-700 text-white' : 'bg-muted hover:bg-sprout-100')}>{o.label}</button>
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

            {micError && (
              <p role="alert" className="mx-3 mb-1 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">🎤 {micError}</p>
            )}
            <form onSubmit={(e) => { e.preventDefault(); send(input) }} className="p-3 flex gap-2">
              <input
                ref={inputRef}
                value={input} onChange={(e) => setInput(e.target.value)} placeholder={listening ? '듣고 있어요…' : '복지 질문을 입력하세요'}
                className="flex-1 rounded-xl border-2 border-sprout-100 bg-white px-3 py-2 text-sm focus-ring" aria-label="질문 입력"
              />
              {micOk && (
                <button type="button" onClick={toggleMic} aria-label={listening ? '음성 입력 중지' : '음성으로 질문'}
                  className={cn('rounded-xl px-3 border-2 transition-colors', listening ? 'bg-rose-500 border-rose-500 text-white animate-pulse' : 'bg-white border-sprout-100 text-sprout-700 hover:border-sprout-300')}>
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
