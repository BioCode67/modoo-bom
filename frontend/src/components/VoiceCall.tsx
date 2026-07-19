import { useEffect, useRef, useState } from 'react'
import { Mic, PhoneOff, Volume2, VolumeX, Send } from 'lucide-react'
import { SproutLogo } from '@/ui/SproutLogo'
import { useAppStore } from '@/store/useAppStore'
import { useBackend } from '@/lib/useBackend'
import { useSpeech } from '@/lib/useSpeech'
import { useTTS } from '@/lib/useTTS'
import { agentReply, greetingReply, matchSaveIntent, type AgentReply } from '@/lib/chatAgent'
import type { Policy } from '@/data/policies'
import { parseProfileFromText, profileSignalCount } from '@/lib/parseQuery'
import { VOICE_LANGS, voiceStrings, voiceRouteLang, routeReplyFor } from '@/lib/voiceI18n'
import { runAnalysis } from '@/lib/welfare-engine'
import { formatWon } from '@/lib/format'
import { speakableText } from '@/lib/speakable'
import { cn } from '@/lib/utils'

interface Turn {
  role: 'user' | 'bot'
  text: string
  policies?: AgentReply['policies']
  cta?: AgentReply['cta']
  /** CTA를 실제로 눌렀을 때만 실행할 부수효과(예: AI 검색 프리필) — 답변 시점에 심으면 ESC 후에도 상태가 남는다 */
  act?: () => void
}

/**
 * 📞 새싹이와 통화하기 — 어르신 우선 '음성 통화형' 상담.
 *
 * 화면 글씨를 읽기 어려워도, 타이핑이 어려워도 전화 걸듯 말로만 복지 상담을 완주한다.
 * - 두뇌는 챗위젯과 동일한 규칙 엔진(agentReply) — LLM·서버 없이 동작(데모·오프라인 안전)
 * - 버튼을 누르고 말하면(tap-to-talk) 답을 큰 글씨로 보여주고 소리로 읽어준다(useTTS)
 * - 음성 인식이 안 되는 브라우저·환경에서는 같은 화면의 큰 입력창으로 동일하게 진행(이중 경로)
 * - 음성 인식은 브라우저 기능(Web Speech)을 쓴다 — 온디바이스 임베딩 검색과 달리
 *   브라우저에 따라 음성이 외부로 전송될 수 있어 '온디바이스'라고 과장하지 않는다.
 */
export function VoiceCall({ open, onClose, presetLang }: { open: boolean; onClose: () => void; presetLang?: string }) {
  const profile = useAppStore((s) => s.profile)
  const result = useAppStore((s) => s.result)
  const tracked = useAppStore((s) => s.tracked)
  const docDone = useAppStore((s) => s.docDone)
  const setView = useAppStore((s) => s.setView)
  const setAnalysis = useAppStore((s) => s.setAnalysis)
  const toggleSaved = useAppStore((s) => s.toggleSaved)
  const setAiQuery = useAppStore((s) => s.setAiQuery)
  const setAiIntent = useAppStore((s) => s.setAiIntent)
  const { ready, caps } = useBackend()
  const agentOn = ready === true && !!caps?.rpa // 데스크탑 에이전트 연결 시 자동화 경로 안내(챗위젯과 동일 기준)
  const tts = useTTS()
  const [turns, setTurns] = useState<Turn[]>([])
  const [muted, setMuted] = useState(false)
  const [thinking, setThinking] = useState(false)
  const [typed, setTyped] = useState('')
  // 🌍 통화 언어 — 음성 인식은 시작 전에 언어를 알아야 하므로(recognition.lang) 선택형.
  // 글로 외국어를 입력하면(라우팅 감지) 마이크 언어도 자동으로 따라간다.
  const [lang, setLang] = useState('ko')
  const L = voiceStrings(lang)
  const mutedRef = useRef(muted)
  mutedRef.current = muted
  const turnsRef = useRef<Turn[]>([]) // setTimeout 클로저의 stale turns 방지(담기 맥락은 최신 bot 턴 기준)
  turnsRef.current = turns
  const listRef = useRef<HTMLDivElement>(null)

  const say = (r: AgentReply, speakLang?: string, act?: () => void) => {
    setTurns((t) => [...t, { role: 'bot', text: r.text, policies: r.policies, cta: r.cta, act }])
    // 해당 언어 보이스가 없는 브라우저에서 외국어를 한국어 보이스로 읽으면 발음이 깨진다 → 자막만(정직한 축소)
    if (!mutedRef.current && (!speakLang || tts.hasVoice(speakLang))) tts.speak(speakableText(r.text), speakLang)
  }

  const handle = (raw: string) => {
    const q = raw.trim()
    if (!q) return
    setTurns((t) => [...t, { role: 'user', text: q }])
    setThinking(true)
    // 답변 생성은 동기·즉시지만, '생각 중' 상태가 눈에 보이게 다음 틱으로 넘긴다(통화 감각)
    setTimeout(() => {
      // 📞→다국어: 외국어 발화·입력은 한국어 규칙 두뇌가 이해하지 못한다 → 날조 답변 대신
      // 검증된 '온디바이스 다국어 AI 의미 검색'(탐색)으로 정직하게 넘긴다(QuickAsk와 동일 선례).
      // 게이트는 detectUiLang 보수 기준 — 영문 약어('LH')·한/영 오타('dkssud')는 오발동하지 않음.
      const route = voiceRouteLang(q)
      if (route !== 'ko') {
        const r = routeReplyFor(route)
        if (VOICE_LANGS[route]) setLang(route) // 다음 발화부터 마이크·버튼도 그 언어로
        // 프리필은 CTA를 '눌렀을 때만' — 답변 시점에 심으면 ESC로 닫아도 aiIntent가 남아
        // 나중에 무관한 탐색 진입에서 옛 외국어 질의가 튀어나온다(스테일 상태 잔존 방지)
        say({ text: r.text, cta: { view: 'explore', label: r.cta } }, r.speakLang,
          () => { setAiQuery(q); setAiIntent(true) })
        setThinking(false)
        return
      }
      // 📞→담기: "다 담아줘/기초연금 담아줘"를 말하면 실제로 담는다(챗위젯과 동일 검증 로직 재사용).
      // 맥락은 직전 답변에서 보여준 정책 → 없으면 분석 결과의 정밀추천(POL-, 명시 지시만) 폴백.
      const shown = [...turnsRef.current].reverse().find((t) => t.role === 'bot' && t.policies?.length)?.policies ?? []
      const fallback = (result?.eligible_policies?.filter((p) => /^POL-/.test(p.id)) ?? []) as Policy[]
      const saveCtx = shown.length ? (shown as Policy[]) : fallback
      const toSave = matchSaveIntent(q, saveCtx, shown.length === 0)
      if (toSave) {
        const added: string[] = []
        toSave.forEach((p) => { if (!tracked.some((t) => t.policyId === p.id)) { toggleSaved(p); added.push(p.name) } })
        const msg = added.length
          ? `${added.join(', ')} 담았어요. 서류 준비와 마감은 나의 복지에서 제가 챙겨드릴게요.`
          : `${toSave.map((p) => p.name).join(', ')}는 이미 담겨 있어요.`
        say({ text: msg, cta: { view: 'my', label: '나의 복지 보기' } })
        setThinking(false)
        return
      }
      // 📞→진단: "72세 혼자 사는데 소득이 적어요"처럼 프로필 신호가 2개 이상 담긴 '상황 문장'이면
      // 질문 응대가 아니라 그 자리에서 분석까지 실행하고 결과를 말로 브리핑한다(전화 한 통 완주).
      // "기초연금 알려줘"(신호 0~1)는 기존 지식·행동 답변 그대로.
      if (profileSignalCount(q) >= 2) {
        const prof = parseProfileFromText(q)
        const res = runAnalysis(prof)
        setAnalysis(prof, res)
        const top = res.eligible_policies.slice(0, 3).map((p) => p.name)
        const monthly = res.portfolio_summary?.total_monthly
        const text =
          `말씀하신 상황으로 바로 찾아봤어요. 지금 신청해볼 만한 복지가 ${res.eligible_policies.length}개 있어요.\n` +
          `대표적으로 ${top.join(', ')} 이에요.` +
          (monthly ? `\n현금성 지원만 더하면 다달이 최대 ${formatWon(monthly)}까지예요 — 실제 조건·중복수급에 따라 달라질 수 있어요.` : '') +
          `\n자세한 자격과 신청 방법은 결과 화면에서 하나씩 짚어드릴게요.`
        say({ text, cta: { view: 'analyze', label: '결과 화면에서 자세히 보기' } })
      } else {
        say(agentReply(q, { profile, result, tracked, agentOn }))
      }
      setThinking(false)
    }, 150)
  }

  const speech = useSpeech((t) => handle(t), L.sttTag)

  // 🌍 수동 언어 전환: 그 언어 인사를 보여주고 들려줘 '이 언어로 말해도 된다'를 즉시 확인시킨다
  const changeLang = (code: string) => {
    setLang(code)
    const s = voiceStrings(code)
    say({ text: s.greeting }, code === 'ko' ? undefined : code)
  }

  // 열릴 때: 인사 브리핑을 큰 글씨 + 음성으로 시작.
  // 진입로가 언어를 지정하면(외국인 섹션 '자국어 통화' 직행) 그 언어로, 아니면 마지막 선택 언어로.
  useEffect(() => {
    if (!open) return
    setTurns([])
    const eff = presetLang && VOICE_LANGS[presetLang] ? presetLang : lang
    if (eff !== lang) setLang(eff)
    if (eff !== 'ko') {
      const s = voiceStrings(eff)
      setTurns([{ role: 'bot', text: s.greeting }])
      if (!mutedRef.current && tts.hasVoice(eff)) tts.speak(s.greeting, eff)
    } else {
      const g = greetingReply(profile, tracked, docDone)
      setTurns([{ role: 'bot', text: g.text, policies: g.policies, cta: g.cta }])
      if (!mutedRef.current) tts.speak(speakableText(g.text))
    }
    return () => { window.speechSynthesis?.cancel?.() }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 열릴 때 1회 브리핑(상태 스냅샷)
  }, [open])

  // ESC로 종료(프로젝트 공통 패턴) + 새 턴마다 맨 아래로
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [turns, thinking])

  if (!open) return null

  return (
    <div role="dialog" aria-modal="true" aria-label="새싹이와 통화 상담" className="fixed inset-0 z-[80] flex flex-col bg-gradient-to-b from-sprout-50 to-white">
      {/* 헤더 — 통화 상대 + 종료 */}
      <div className="flex items-center gap-3 px-5 py-4 border-b border-sprout-100 bg-white/80 backdrop-blur">
        <div className={cn('relative flex h-14 w-14 items-center justify-center rounded-full bg-sprout-100', tts.speaking && 'ring-4 ring-sprout-300 animate-pulse')}>
          <SproutLogo withFace className="h-11 w-11" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-extrabold text-xl">새싹이 복지 상담</p>
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {speech.listening ? L.statusListening : thinking ? L.statusThinking : tts.speaking ? L.statusSpeaking : L.statusIdle}
          </p>
        </div>
        <button
          onClick={() => { setMuted((m) => !m); if (!muted) window.speechSynthesis?.cancel?.() }}
          className="rounded-full p-3 bg-slate-100 hover:bg-slate-200"
          aria-label={muted ? '소리 켜기' : '소리 끄기'}
          aria-pressed={muted}
        >
          {muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
        </button>
        <button onClick={onClose} className="rounded-full p-3 bg-rose-100 text-rose-700 hover:bg-rose-200" aria-label="통화 종료">
          <PhoneOff className="h-5 w-5" />
        </button>
      </div>

      {/* 대화 — 큰 글씨 자막 */}
      <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-5 space-y-4 max-w-3xl w-full mx-auto" aria-live="polite">
        {turns.map((t, i) => (
          <div key={i} className={cn('flex', t.role === 'user' ? 'justify-end' : 'justify-start')}>
            <div className={cn('rounded-3xl px-5 py-3.5 max-w-[88%] whitespace-pre-wrap text-lg leading-relaxed',
              t.role === 'user' ? 'bg-sprout-600 text-white' : 'bg-white border border-sprout-100 shadow-sm')}>
              {t.text}
              {t.role === 'bot' && t.cta && (
                <button
                  onClick={() => { t.act?.(); setView(t.cta!.view); onClose() }}
                  className="btn-primary mt-3 w-full !py-3 text-base"
                >
                  {t.cta.label} →
                </button>
              )}
            </div>
          </div>
        ))}
        {thinking && <p className="text-center text-muted-foreground text-lg">🌱 …</p>}
      </div>

      {/* 조작부 — 크게 하나 (+ 🌍 언어: 말하기 직전에 고르는 자리 — 헤더에 두면 모바일 제목이 깨진다) */}
      <div className="border-t border-sprout-100 bg-white px-4 py-4">
        <div className="max-w-3xl mx-auto space-y-3">
          <div className="flex gap-2 items-stretch">
            <select
              value={lang}
              onChange={(e) => changeLang(e.target.value)}
              aria-label="상담 언어 선택 (Language)"
              className="rounded-2xl border-2 border-sprout-200 bg-white px-2 text-sm font-semibold shrink-0"
            >
              {Object.entries(VOICE_LANGS).map(([code, s]) => (
                <option key={code} value={code}>{s.flag} {s.label}</option>
              ))}
            </select>
            {speech.supported ? (
              <button
                onClick={speech.toggle}
                className={cn('flex-1 min-w-0 rounded-3xl py-5 font-extrabold text-xl flex items-center justify-center gap-3 transition-colors',
                  speech.listening ? 'bg-rose-500 text-white animate-pulse' : 'bg-sprout-600 text-white hover:bg-sprout-700')}
              >
                <Mic className="h-7 w-7 shrink-0" /> <span className="truncate">{speech.listening ? L.micListening : L.micIdle}</span>
              </button>
            ) : (
              <p className="flex-1 min-w-0 text-base text-amber-800 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3">
                이 브라우저는 음성 인식을 지원하지 않아요 — 아래 칸에 입력하시면 똑같이 답해드려요.
              </p>
            )}
          </div>
          {speech.error && (
            <p role="alert" className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-2.5">🎤 {speech.error}</p>
          )}
          {/* 이중 경로: 잘 안 들리는 환경·무마이크 PC에서도 같은 상담을 글로 진행 */}
          <form
            className="flex gap-2"
            onSubmit={(e) => { e.preventDefault(); handle(typed); setTyped('') }}
          >
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={L.placeholder}
              aria-label="말 대신 입력하기"
              className="input-cute flex-1 text-base"
            />
            <button type="submit" className="btn-primary !px-4" aria-label="입력 보내기"><Send className="h-5 w-5" /></button>
          </form>
        </div>
      </div>
    </div>
  )
}
