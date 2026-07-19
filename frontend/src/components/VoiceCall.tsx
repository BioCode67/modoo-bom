import { useEffect, useRef, useState } from 'react'
import { Mic, PhoneOff, Volume2, VolumeX, Send } from 'lucide-react'
import { SproutLogo } from '@/ui/SproutLogo'
import { useAppStore } from '@/store/useAppStore'
import { useBackend } from '@/lib/useBackend'
import { useSpeech } from '@/lib/useSpeech'
import { useTTS } from '@/lib/useTTS'
import { agentReply, greetingReply, type AgentReply } from '@/lib/chatAgent'
import { speakableText } from '@/lib/speakable'
import { cn } from '@/lib/utils'

interface Turn { role: 'user' | 'bot'; text: string; policies?: AgentReply['policies']; cta?: AgentReply['cta'] }

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
export function VoiceCall({ open, onClose }: { open: boolean; onClose: () => void }) {
  const profile = useAppStore((s) => s.profile)
  const result = useAppStore((s) => s.result)
  const tracked = useAppStore((s) => s.tracked)
  const docDone = useAppStore((s) => s.docDone)
  const setView = useAppStore((s) => s.setView)
  const { ready, caps } = useBackend()
  const agentOn = ready === true && !!caps?.rpa // 데스크탑 에이전트 연결 시 자동화 경로 안내(챗위젯과 동일 기준)
  const tts = useTTS()
  const [turns, setTurns] = useState<Turn[]>([])
  const [muted, setMuted] = useState(false)
  const [thinking, setThinking] = useState(false)
  const [typed, setTyped] = useState('')
  const mutedRef = useRef(muted)
  mutedRef.current = muted
  const listRef = useRef<HTMLDivElement>(null)

  const say = (r: AgentReply) => {
    setTurns((t) => [...t, { role: 'bot', text: r.text, policies: r.policies, cta: r.cta }])
    if (!mutedRef.current) tts.speak(speakableText(r.text))
  }

  const handle = (raw: string) => {
    const q = raw.trim()
    if (!q) return
    setTurns((t) => [...t, { role: 'user', text: q }])
    setThinking(true)
    // 답변 생성은 동기·즉시지만, '생각 중' 상태가 눈에 보이게 다음 틱으로 넘긴다(통화 감각)
    setTimeout(() => {
      say(agentReply(q, { profile, result, tracked, agentOn }))
      setThinking(false)
    }, 150)
  }

  const speech = useSpeech((t) => handle(t))

  // 열릴 때: 인사 브리핑을 큰 글씨 + 음성으로 시작
  useEffect(() => {
    if (!open) return
    setTurns([])
    const g = greetingReply(profile, tracked, docDone)
    setTurns([{ role: 'bot', text: g.text, policies: g.policies, cta: g.cta }])
    if (!mutedRef.current) tts.speak(speakableText(g.text))
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
            {speech.listening ? '🎤 듣고 있어요 — 편하게 말씀하세요' : thinking ? '생각하고 있어요…' : tts.speaking ? '🔊 읽어드리는 중' : '아래 버튼을 누르고 말씀하세요'}
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
                  onClick={() => { setView(t.cta!.view); onClose() }}
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

      {/* 조작부 — 크게 하나 */}
      <div className="border-t border-sprout-100 bg-white px-4 py-4">
        <div className="max-w-3xl mx-auto space-y-3">
          {speech.supported ? (
            <button
              onClick={speech.toggle}
              className={cn('w-full rounded-3xl py-5 font-extrabold text-xl flex items-center justify-center gap-3 transition-colors',
                speech.listening ? 'bg-rose-500 text-white animate-pulse' : 'bg-sprout-600 text-white hover:bg-sprout-700')}
            >
              <Mic className="h-7 w-7" /> {speech.listening ? '말씀이 끝나면 잠시 기다려 주세요' : '누르고 말씀하세요'}
            </button>
          ) : (
            <p className="text-base text-amber-800 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3">
              이 브라우저는 음성 인식을 지원하지 않아요 — 아래 칸에 입력하시면 똑같이 답해드려요.
            </p>
          )}
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
              placeholder="말 대신 입력하기 (예: 기초연금 알려줘)"
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
