import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { X, ChevronLeft, ChevronRight, RotateCcw, Mic, Volume2, VolumeX, Sparkles } from 'lucide-react'
import { useAppStore, type View } from '@/store/useAppStore'
import { useTTS } from '@/lib/useTTS'
import { useSpeech } from '@/lib/useSpeech'
import { speakableText } from '@/lib/speakable'
import { useModalFocus } from '@/hooks/useModalFocus'
import { SproutLogo } from '@/ui/SproutLogo'
import { cn } from '@/lib/utils'
import { GUIDE_STEPS, matchGuideCommand, applyGuideCommand } from '@/lib/voiceGuide'

/**
 * 🔊 음성 사용법 안내 — 새싹이가 사용법을 '소리로' 차근차근 설명하는 가이드 투어.
 *
 * 왜: 온보딩·새싹이 가이드는 전부 글자라 어르신·저시력·저문해 계층이 읽어야만 안다.
 * 여기선 각 단계를 TTS로 낭독하고, 자막도 큰 글씨로 함께 보여준다. 조작은 큰 버튼과
 * 음성 명령('다음'·'그만') 둘 다 가능(useSpeech). 소리 미지원 브라우저는 자막만으로 폴백.
 *
 * 백엔드·LLM 키 없이 동작(브라우저 내장 TTS·STT) — 데모 전제(Mock 모드) 충족.
 */
export function VoiceGuide() {
  const { voiceGuideOpen, closeVoiceGuide, setView } = useAppStore()
  const tts = useTTS()
  const [index, setIndex] = useState(0)
  const [muted, setMuted] = useState(false) // 소리 끄고 자막만 보고 싶을 때
  const panelRef = useRef<HTMLDivElement>(null)
  const mutedRef = useRef(muted)
  mutedRef.current = muted
  const indexRef = useRef(index)
  indexRef.current = index

  const step = GUIDE_STEPS[index]
  const isLast = index === GUIDE_STEPS.length - 1

  useModalFocus(panelRef, voiceGuideOpen, closeVoiceGuide)

  // 이 단계 문장을 소리로 읽는다(자막과 동일 문장). muted면 낭독 생략.
  const speakStep = (i: number) => {
    if (mutedRef.current) return
    const s = GUIDE_STEPS[i]
    if (s) tts.speak(speakableText(s.say))
  }

  // 투어를 끝낸다 — 낭독·마이크 정지 후 닫고, goto가 있으면 그 화면으로 이어 준다(설명→실제 사용).
  const finish = (goto?: View) => {
    tts.stop()
    if (speechRef.current.listening) speechRef.current.toggle() // toggle=정지(useSpeech엔 stop 없음)
    closeVoiceGuide()
    if (goto) setView(goto)
  }

  // 음성 명령 처리 — 최신 index는 ref로 참조(useSpeech가 매 렌더 콜백을 최신화하므로 stale 없음)
  const handleVoice = (text: string) => {
    const cmd = matchGuideCommand(text)
    if (!cmd) return
    const cur = indexRef.current
    if (cmd === 'repeat') { speakStep(cur); return }
    const nextIdx = applyGuideCommand(cmd, cur)
    if (nextIdx < 0) {
      // start, 또는 마지막 단계에서 next → 마무리 화면으로 이어감. stop이면 그냥 닫기.
      const goTo = cmd === 'stop' ? undefined : GUIDE_STEPS[cur].goto ?? 'analyze'
      finish(goTo)
      return
    }
    setIndex(nextIdx)
  }
  const speech = useSpeech(handleVoice, 'ko-KR')
  // finish에서 최신 speech를 참조하기 위한 미러(콜백/effect의 stale 방지)
  const speechRef = useRef(speech)
  speechRef.current = speech

  // 열릴 때 첫 단계로 리셋. 닫히면 낭독·마이크 정지.
  useEffect(() => {
    if (voiceGuideOpen) {
      setIndex(0)
    } else {
      tts.stop()
      if (speechRef.current.listening) speechRef.current.toggle() // toggle=정지
    }
    // tts는 매 렌더 새 객체라 deps에서 제외(VoiceCall과 동일 패턴) — voiceGuideOpen 전이에만 반응
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceGuideOpen])

  // 단계가 바뀌면 그 문장을 낭독(열려 있을 때만).
  useEffect(() => {
    if (!voiceGuideOpen) return
    speakStep(index)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, voiceGuideOpen])

  if (!voiceGuideOpen) return null

  const goNext = () => {
    if (isLast) { finish(step.goto ?? 'analyze'); return }
    setIndex((i) => Math.min(GUIDE_STEPS.length - 1, i + 1))
  }
  const goPrev = () => setIndex((i) => Math.max(0, i - 1))
  const replay = () => { if (muted) setMuted(false); speakStep(index) }
  const toggleMute = () => {
    setMuted((m) => {
      const next = !m
      if (next) tts.stop() // 끄면 즉시 멈춤
      return next
    })
  }

  return (
    <div className="modal-overlay" onClick={closeVoiceGuide}>
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="card-cute w-full max-w-md p-6"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="음성 사용법 안내"
        ref={panelRef}
        tabIndex={-1}
      >
        {/* 헤더 */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2.5">
            <span className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-sprout-100', tts.speaking && 'ring-4 ring-sprout-300 animate-pulse')}>
              <SproutLogo withFace className="h-9 w-9" />
            </span>
            <div>
              <p className="text-[11px] font-extrabold text-sprout-700">새싹이 · 소리로 듣는 사용법</p>
              <p className="font-extrabold text-base sm:text-lg leading-tight">{step.title}</p>
            </div>
          </div>
          <button onClick={closeVoiceGuide} aria-label="닫기" className="rounded-full p-2 hover:bg-muted"><X className="h-5 w-5" /></button>
        </div>

        {/* 진행 표시(칩) */}
        <div className="mt-4 flex items-center gap-1.5" aria-hidden="true">
          {GUIDE_STEPS.map((s, i) => (
            <span
              key={s.id}
              className={cn(
                'h-1.5 flex-1 rounded-full transition-colors',
                i < index ? 'bg-sprout-300' : i === index ? 'bg-sprout-600' : 'bg-sprout-100',
              )}
            />
          ))}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {index + 1} / {GUIDE_STEPS.length} · <span className="font-semibold text-sprout-700">{step.chip}</span>
        </p>

        {/* 자막(낭독과 동일 문장) — 큰 글씨로 함께 보여 소리 미지원·저청력도 읽게 */}
        <p className="mt-3 min-h-[7rem] text-base leading-relaxed text-foreground/90">
          {step.say}
        </p>

        {!tts.supported && (
          <div className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700">
            이 브라우저는 소리 안내를 지원하지 않아요 — 위 글로 안내해 드릴게요.
          </div>
        )}

        {/* 재생 컨트롤 */}
        <div className="mt-4 flex items-center gap-2">
          <button
            onClick={replay}
            className="btn-secondary flex-1 justify-center whitespace-nowrap"
            aria-label="다시 듣기"
          >
            <RotateCcw className="h-4 w-4" /> 다시 듣기
          </button>
          {tts.supported && (
            <button
              onClick={toggleMute}
              aria-pressed={muted}
              title={muted ? '소리 켜기' : '소리 끄기'}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-bold border-2 transition-colors whitespace-nowrap',
                muted ? 'bg-white border-sprout-100 text-muted-foreground' : 'bg-sprout-50 border-sprout-200 text-sprout-700',
              )}
            >
              {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              {muted ? '소리 꺼짐' : '소리 켜짐'}
            </button>
          )}
          {speech.supported && (
            <button
              onClick={speech.toggle}
              aria-pressed={speech.listening}
              title="음성으로 넘기기 (다음·이전·그만)"
              className={cn(
                'inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-bold border-2 transition-colors whitespace-nowrap',
                speech.listening ? 'bg-rose-500 border-rose-500 text-white animate-pulse' : 'bg-white border-sprout-100 text-sprout-700 hover:border-sprout-200',
              )}
            >
              <Mic className="h-4 w-4" /> {speech.listening ? '듣는 중…' : '말로'}
            </button>
          )}
        </div>

        {speech.error && (
          <p className="mt-2 text-xs text-rose-600" role="alert">{speech.error}</p>
        )}
        {speech.supported && !speech.error && (
          <p className="mt-2 text-[11px] text-muted-foreground">🎤 “말로” 를 누르고 <b>“다음”·“이전”·“다시”·“그만”</b> 이라고 하셔도 돼요.</p>
        )}

        {/* 이전 / 다음(마지막은 시작) */}
        <div className="mt-4 flex items-center gap-2">
          <button
            onClick={goPrev}
            disabled={index === 0}
            className="btn-secondary justify-center whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed"
            aria-label="이전"
          >
            <ChevronLeft className="h-4 w-4" /> 이전
          </button>
          <button onClick={goNext} className="btn-primary flex-1 justify-center whitespace-nowrap">
            {isLast ? (<><Sparkles className="h-4 w-4" /> 복지 찾으러 가기</>) : (<>다음 <ChevronRight className="h-4 w-4" /></>)}
          </button>
        </div>
      </motion.div>
    </div>
  )
}
