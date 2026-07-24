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
import { guideSteps, guideUi, matchGuideCommand, applyGuideCommand, GUIDE_LANGS, type GuideLang } from '@/lib/voiceGuide'
import { VOICE_LANGS } from '@/lib/voiceI18n'

/**
 * 🔊 음성 사용법 안내 — 새싹이가 사용법을 '소리로' 차근차근 설명하는 가이드 투어. (다국어)
 *
 * 왜: 온보딩·새싹이 가이드는 전부 글자라 어르신·저시력·저문해 계층이 읽어야만 안다.
 * 여기선 각 단계를 TTS로 낭독하고, 자막도 큰 글씨로 함께 보여준다. 조작은 큰 버튼과
 * 음성 명령('다음'·'그만') 둘 다 가능(useSpeech). 소리 미지원 브라우저는 자막만으로 폴백.
 *
 * 다국어(외국인·다문화): 통화 상담과 같은 4개 언어로 대본·조작 UI·음성 명령·낭독을 제공.
 * 언어를 바꾸면 낭독·자막·STT 인식 언어가 함께 따라간다. 그 언어 음성이 없는 기기는 자막으로 안내.
 *
 * 백엔드·LLM 키 없이 동작(브라우저 내장 TTS·STT) — 데모 전제(Mock 모드) 충족.
 */

/** store.uiLang을 가이드 지원 언어로 정규화(미지원이면 한국어). */
function normalizeLang(code: string): GuideLang {
  return (GUIDE_LANGS as string[]).includes(code) ? (code as GuideLang) : 'ko'
}

export function VoiceGuide() {
  const { voiceGuideOpen, closeVoiceGuide, setView, uiLang } = useAppStore()
  const tts = useTTS()
  const [index, setIndex] = useState(0)
  const [lang, setLang] = useState<GuideLang>('ko')
  const [muted, setMuted] = useState(false) // 소리 끄고 자막만 보고 싶을 때
  const panelRef = useRef<HTMLDivElement>(null)
  const mutedRef = useRef(muted)
  mutedRef.current = muted
  const indexRef = useRef(index)
  indexRef.current = index
  const langRef = useRef(lang)
  langRef.current = lang

  const steps = guideSteps(lang)
  const ui = guideUi(lang)
  const step = steps[index]
  const isLast = index === steps.length - 1
  const sttTag = VOICE_LANGS[lang]?.sttTag ?? 'ko-KR'
  const hasVoice = tts.hasVoice(lang)

  useModalFocus(panelRef, voiceGuideOpen, closeVoiceGuide)

  // 이 단계 문장을 그 언어 음성으로 읽는다(자막과 동일 문장). muted·음성없음이면 낭독 생략(자막이 대신).
  const speakStep = (i: number, l: GuideLang) => {
    if (mutedRef.current || !tts.hasVoice(l)) return
    const s = guideSteps(l)[i]
    if (s) tts.speak(speakableText(s.say), l)
  }

  // 투어를 끝낸다 — 낭독·마이크 정지 후 닫고, goto가 있으면 그 화면으로 이어 준다(설명→실제 사용).
  const finish = (goto?: View) => {
    tts.stop()
    if (speechRef.current.listening) speechRef.current.toggle() // toggle=정지(useSpeech엔 stop 없음)
    closeVoiceGuide()
    if (goto) setView(goto)
  }

  // 음성 명령 처리 — 최신 index/lang은 ref로 참조(useSpeech가 매 렌더 콜백을 최신화하므로 stale 없음)
  const handleVoice = (text: string) => {
    const cmd = matchGuideCommand(text)
    if (!cmd) return
    const cur = indexRef.current
    if (cmd === 'repeat') { speakStep(cur, langRef.current); return }
    const nextIdx = applyGuideCommand(cmd, cur, guideSteps(langRef.current).length)
    if (nextIdx < 0) {
      // start, 또는 마지막 단계에서 next → 마무리 화면으로 이어감. stop이면 그냥 닫기.
      const goTo = cmd === 'stop' ? undefined : guideSteps(langRef.current)[cur].goto ?? 'analyze'
      finish(goTo)
      return
    }
    setIndex(nextIdx)
  }
  const speech = useSpeech(handleVoice, sttTag)
  // finish에서 최신 speech를 참조하기 위한 미러(콜백/effect의 stale 방지)
  const speechRef = useRef(speech)
  speechRef.current = speech

  // 열릴 때 첫 단계로 리셋 + 감지된 UI 언어를 기본 언어로. 닫히면 낭독·마이크 정지.
  useEffect(() => {
    if (voiceGuideOpen) {
      setIndex(0)
      setLang(normalizeLang(uiLang))
    } else {
      tts.stop()
      if (speechRef.current.listening) speechRef.current.toggle() // toggle=정지
    }
    // tts는 매 렌더 새 객체라 deps에서 제외(VoiceCall과 동일 패턴) — voiceGuideOpen 전이에만 반응
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceGuideOpen])

  // 단계·언어가 바뀌면 그 문장을 낭독(열려 있을 때만).
  useEffect(() => {
    if (!voiceGuideOpen) return
    speakStep(index, lang)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, lang, voiceGuideOpen])

  if (!voiceGuideOpen) return null

  const goNext = () => {
    if (isLast) { finish(step.goto ?? 'analyze'); return }
    setIndex((i) => Math.min(steps.length - 1, i + 1))
  }
  const goPrev = () => setIndex((i) => Math.max(0, i - 1))
  const replay = () => { if (muted) setMuted(false); speakStep(index, lang) }
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
        aria-label={ui.dialogLabel}
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
              <p className="text-[11px] font-extrabold text-sprout-700">{ui.kicker}</p>
              <p className="font-extrabold text-base sm:text-lg leading-tight">{step.title}</p>
            </div>
          </div>
          <button onClick={closeVoiceGuide} aria-label={ui.close} className="rounded-full p-2 hover:bg-muted"><X className="h-5 w-5" /></button>
        </div>

        {/* 언어 선택(외국인·다문화) — 통화 상담과 같은 4개 언어 */}
        <div className="mt-3 flex items-center gap-1.5" role="group" aria-label={ui.langLabel}>
          {GUIDE_LANGS.map((l) => (
            <button
              key={l}
              onClick={() => setLang(l)}
              aria-pressed={lang === l}
              className={cn(
                'inline-flex items-center gap-1 rounded-full border-2 px-2.5 py-1 text-xs font-bold transition-colors',
                lang === l ? 'bg-sprout-100 border-sprout-300 text-sprout-700' : 'bg-white border-sprout-100 text-muted-foreground hover:border-sprout-200',
              )}
            >
              <span aria-hidden="true">{VOICE_LANGS[l]?.flag}</span>
              <span className="hidden sm:inline">{VOICE_LANGS[l]?.label}</span>
            </button>
          ))}
        </div>

        {/* 진행 표시(칩) */}
        <div className="mt-3 flex items-center gap-1.5" aria-hidden="true">
          {steps.map((s, i) => (
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
          {index + 1} / {steps.length} · <span className="font-semibold text-sprout-700">{step.chip}</span>
        </p>

        {/* 자막(낭독과 동일 문장) — 큰 글씨로 함께 보여 소리 미지원·저청력도 읽게 */}
        <p className="mt-3 min-h-[7rem] text-base leading-relaxed text-foreground/90">
          {step.say}
        </p>

        {!tts.supported && (
          <div className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700">{ui.noTts}</div>
        )}
        {tts.supported && !hasVoice && !muted && (
          <div className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700">{ui.noVoice}</div>
        )}

        {/* 재생 컨트롤 */}
        <div className="mt-4 flex items-center gap-2">
          <button
            onClick={replay}
            className="btn-secondary flex-1 justify-center whitespace-nowrap"
            aria-label={ui.replay}
          >
            <RotateCcw className="h-4 w-4" /> {ui.replay}
          </button>
          {tts.supported && (
            <button
              onClick={toggleMute}
              aria-pressed={muted}
              title={muted ? ui.soundOff : ui.soundOn}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-bold border-2 transition-colors whitespace-nowrap',
                muted ? 'bg-white border-sprout-100 text-muted-foreground' : 'bg-sprout-50 border-sprout-200 text-sprout-700',
              )}
            >
              {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              {muted ? ui.soundOff : ui.soundOn}
            </button>
          )}
          {speech.supported && (
            <button
              onClick={speech.toggle}
              aria-pressed={speech.listening}
              title={ui.voice}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-bold border-2 transition-colors whitespace-nowrap',
                speech.listening ? 'bg-rose-500 border-rose-500 text-white animate-pulse' : 'bg-white border-sprout-100 text-sprout-700 hover:border-sprout-200',
              )}
            >
              <Mic className="h-4 w-4" /> {speech.listening ? ui.listening : ui.voice}
            </button>
          )}
        </div>

        {speech.error && (
          <p className="mt-2 text-xs text-rose-600" role="alert">{speech.error}</p>
        )}
        {speech.supported && !speech.error && (
          <p className="mt-2 text-[11px] text-muted-foreground">🎤 {ui.micHint}</p>
        )}

        {/* 이전 / 다음(마지막은 시작) */}
        <div className="mt-4 flex items-center gap-2">
          <button
            onClick={goPrev}
            disabled={index === 0}
            className="btn-secondary justify-center whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed"
            aria-label={ui.prev}
          >
            <ChevronLeft className="h-4 w-4" /> {ui.prev}
          </button>
          <button onClick={goNext} className="btn-primary flex-1 justify-center whitespace-nowrap">
            {isLast ? (<><Sparkles className="h-4 w-4" /> {ui.start}</>) : (<>{ui.next} <ChevronRight className="h-4 w-4" /></>)}
          </button>
        </div>
      </motion.div>
    </div>
  )
}
