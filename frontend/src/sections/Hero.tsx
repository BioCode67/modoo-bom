import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Sparkles, ArrowRight, ShieldCheck, Compass, Search, Volume2 } from 'lucide-react'
import { MascotCanvas } from '@/three/MascotCanvas'
import { HeroAgentBubble } from '@/components/HeroAgentBubble'
import { useAppStore } from '@/store/useAppStore'
import { useCatalog } from '@/data/useCatalog'
import { parseProfileFromText } from '@/lib/parseQuery'

const STATS = [
  { value: '5,000+', label: '정부·지자체·민간 복지' }, // 공공데이터 + 민간재단 큐레이션(PRV)까지
  { value: '13종', label: '서류 발급 바로 연결' }, // 배포(무설치)에선 딥링크 직결 — '자동발급'은 확장/에이전트 연결 시에만 사실이라 과장 금지
  { value: '무료', label: '평생 이용' },
]

const HERO_EXAMPLES = ['72세 혼자 사는데 소득이 적어요', '서울 사는 한부모, 5살 아이 키워요', '퇴사하고 일자리 찾는 청년이에요']

// 입력창 타이프라이터 — '한 문장이면 된다 + 외국어도 된다'를 첫 화면에서 스스로 시연.
// 사용자가 입력을 시작하면 즉시 정적 문구로 전환, 접근성(reduced motion)도 존중.
const TYPE_EXAMPLES = [
  '72세 혼자 사는데 소득이 적어요',
  'I lost my job and need help',
  '아이 셋 키우는데 생활이 빠듯해요',
  'Tôi cần hỗ trợ tiền thuê nhà',
]

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** 플레이스홀더 타이프라이터(타이핑→홀드→지움→다음). reduced-motion이면 첫 예시 고정. */
function useTypewriterPlaceholder(enabled: boolean): string {
  const [text, setText] = useState(TYPE_EXAMPLES[0])
  useEffect(() => {
    if (!enabled) return
    if (prefersReducedMotion()) { setText(TYPE_EXAMPLES[0]); return }
    let alive = true
    let ex = 0, pos = 0, phase: 'type' | 'hold' | 'del' = 'type'
    let timer: number
    const tick = () => {
      if (!alive) return
      const full = TYPE_EXAMPLES[ex]
      let delay = 62
      if (phase === 'type') {
        pos++
        setText(full.slice(0, pos) + '▏')
        if (pos >= full.length) { phase = 'hold'; delay = 1700 }
      } else if (phase === 'hold') {
        setText(full)
        phase = 'del'; delay = 500
      } else {
        pos -= 2
        if (pos <= 0) { pos = 0; ex = (ex + 1) % TYPE_EXAMPLES.length; phase = 'type'; delay = 350; setText('') }
        else { setText(full.slice(0, pos) + '▏'); delay = 22 }
      }
      timer = window.setTimeout(tick, delay)
    }
    timer = window.setTimeout(tick, 900)
    return () => { alive = false; window.clearTimeout(timer) }
  }, [enabled])
  return text
}

/** 숫자 카운트업 — '5,300+' 같은 값을 0부터 차오르게(신뢰 스탯에 생동감). reduced-motion이면 즉시 표기. */
function CountUpValue({ value }: { value: string }) {
  const m = value.match(/^([\d,]+)(\+?)$/)
  const target = m ? parseInt(m[1].replace(/,/g, ''), 10) : NaN
  const suffix = m?.[2] ?? ''
  const [n, setN] = useState(0)
  useEffect(() => {
    if (!m || Number.isNaN(target)) return
    if (prefersReducedMotion()) { setN(target); return }
    let raf = 0
    const t0 = performance.now()
    const dur = 1200
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / dur)
      setN(Math.round(target * (1 - Math.pow(1 - k, 3)))) // ease-out cubic
      if (k < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target])
  if (!m || Number.isNaN(target)) return <>{value}</>
  return <>{n.toLocaleString('en-US')}{suffix}</>
}

export function Hero() {
  const { setView, setPendingProfile, setAiIntent, setAiQuery, openVoiceGuide } = useAppStore()
  // 실제 카탈로그 수를 신뢰 스탯으로 — 공공데이터(policies.json) 병합 후엔 정확한 수, 병합 전(시드 190)엔
  // 낮은 수 노출 방지를 위해 '5,000+' 보수 폴백(과장 없이 실제보다 작게). 병합되면 자동 리렌더.
  const catalogCount = useCatalog().length
  const stats = STATS.map((s, i) =>
    i === 0 && catalogCount > 1000 ? { ...s, value: `${(Math.floor(catalogCount / 100) * 100).toLocaleString('en-US')}+` } : s,
  )
  const [text, setText] = useState('')
  const typed = useTypewriterPlaceholder(!text) // 입력 시작하면 즉시 정지(정적 안내로)
  const inputRef = useRef<HTMLInputElement>(null)
  const focusInput = () => { inputRef.current?.focus(); inputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }) }

  // 🌍 다국어 시연 — 외국어 한 문장 → 온디바이스 AI 의미검색(번역 없이 한국 복지 매칭).
  // 대회 헤드라인이자 참가자 투표용 30초 임팩트. 호버 시 모델을 미리 데워 체감 지연을 줄인다.
  const MULTI = [
    { flag: '🇻🇳', q: 'Tôi mất việc và không có tiền sinh hoạt' },
    { flag: '🇬🇧', q: 'I am a single mother raising a child alone' },
    { flag: '🇨🇳', q: '我是残疾人，需要医疗费用支持' },
  ]
  const askAI = (q: string) => {
    setAiQuery(q); setAiIntent(true); setView('explore')
    // 결과를 그 언어로 보여주려면 번역기도 미리 준비 — 이 클릭이 '사용자 제스처'라
    // downloadable 모델도 여기서 받을 수 있다(결과 진입 시 첫 카드부터 번역돼 뜨게).
    import('@/lib/detectLang').then(({ detectLang }) => {
      const code = detectLang(q)?.code
      if (code && code !== 'ko') import('@/lib/onDeviceTranslate').then((m) => m.getTranslator(code)).catch(() => {})
    }).catch(() => {})
  }
  const warm = () => { import('@/lib/semanticSearch').then((m) => m.warmupSemantic()).catch(() => {}) }

  // 자연어 한 문장 → 분석 대기 프로필만 넘기고 이동 → 분석 화면에서 실제 AI 오버레이를 태운다
  // (홈에서 결과를 즉시 캐시하면 '데이터 조회'처럼 보여, 온디바이스 AI가 도는 과정을 놓친다)
  const quickAnalyze = (raw: string) => {
    const t = raw.trim()
    if (!t) { setView('analyze'); return }
    setPendingProfile(parseProfileFromText(t))
    setView('analyze')
  }

  return (
    <section className="relative overflow-hidden">
      {/* 배경 블롭 */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-24 -right-16 h-80 w-80 rounded-full bg-sprout-200/50 blur-3xl animate-blob" />
        <div className="absolute top-40 -left-20 h-72 w-72 rounded-full bg-peach-200/40 blur-3xl animate-blob" style={{ animationDelay: '2s' }} />
        <div className="absolute bottom-0 right-1/3 h-64 w-64 rounded-full bg-sky2-200/40 blur-3xl animate-blob" style={{ animationDelay: '4s' }} />
      </div>

      <div className="page-container grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-6 items-center pt-10 pb-12 sm:pt-16">
        {/* 좌: 텍스트 */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="order-2 lg:order-1 text-center lg:text-left"
        >
          <span className="chip-sprout inline-flex mb-5">
            <Sparkles className="h-3.5 w-3.5" /> AI가 찾아주는 내 복지 혜택
          </span>
          <h1 className="text-4xl sm:text-5xl lg:text-[3.4rem] font-extrabold tracking-tight !leading-[1.35] text-balance">
            받을 수 있는 <span className="gradient-text">복지 혜택</span>,<br />
            <span className="gradient-text-warm">모두</span> 찾아드릴게요 🌱
          </h1>
          <p className="mt-5 text-base sm:text-lg text-muted-foreground leading-relaxed max-w-xl mx-auto lg:mx-0 text-balance">
            나이·소득·상황만 알려주시면, 숨어있던 복지 혜택을 한 번에 찾아
            <b className="text-foreground"> 신청 방법과 필요 서류</b>까지 쉽게 안내해 드려요.
          </p>

          {/* 자연어 즉시 분석 — 첫 방문자도 한 문장이면 바로 결과 */}
          <form
            onSubmit={(e) => { e.preventDefault(); quickAnalyze(text) }}
            className="mt-7 flex flex-col sm:flex-row gap-2 max-w-xl mx-auto lg:mx-0"
          >
            <div className="relative flex-1">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
              <input
                ref={inputRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={text ? '상황을 한 문장으로 적어주세요' : `예: ${typed}`}
                aria-label="상황을 한 문장으로 입력하면 바로 복지를 찾아드려요"
                className="w-full rounded-2xl border-2 border-sprout-200 bg-white pl-12 pr-4 py-3.5 text-sm font-medium focus-ring shadow-soft"
              />
            </div>
            <button type="submit" className="btn-primary text-base !px-6 !py-3.5 shrink-0">
              <Sparkles className="h-5 w-5" /> 내 복지 찾기 <ArrowRight className="h-4 w-4" />
            </button>
          </form>
          <div className="mt-3 flex flex-wrap gap-1.5 justify-center lg:justify-start">
            {HERO_EXAMPLES.map((ex) => (
              <button key={ex} onClick={() => quickAnalyze(ex)}
                className="text-xs rounded-full border border-sprout-100 bg-white/70 px-2.5 py-1 text-muted-foreground hover:border-sprout-300 hover:text-foreground transition-colors">
                {ex}
              </button>
            ))}
            <button onClick={() => setView('explore')}
              className="text-xs rounded-full border border-sky2-100 bg-sky2-50/70 px-2.5 py-1 font-semibold text-sky2-700 hover:border-sky2-300 transition-colors inline-flex items-center gap-1">
              <Compass className="h-3 w-3" /> 정책 둘러보기
            </button>
            {/* 🔊 글 읽기 어려운 어르신·저시력 배려 — 첫 화면에서 사용법을 소리로 듣는 경로(발견성) */}
            <button onClick={openVoiceGuide}
              className="text-xs rounded-full border border-sprout-200 bg-sprout-50/80 px-2.5 py-1 font-semibold text-sprout-700 hover:border-sprout-400 transition-colors inline-flex items-center gap-1">
              <Volume2 className="h-3 w-3" /> 🔊 음성으로 사용법 듣기
            </button>
          </div>

          {/* 🌍 다국어 AI — 외국어로 물어도 한국 복지를 '의미'로 찾아줘요(브라우저 안에서, 번역 없이) */}
          <div className="mt-4 rounded-2xl border border-violet-200 bg-violet-50/50 px-3 py-2.5">
            <p className="text-[11px] font-bold text-violet-700 flex items-center gap-1">
              🌍 외국어로도 찾아드려요 <span className="font-normal text-violet-600">— 온디바이스 AI 의미 매칭 (실험적 · Chrome·Edge 권장)</span>
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {MULTI.map((m) => (
                <button key={m.q} onClick={() => askAI(m.q)} onMouseEnter={warm} onFocus={warm} onTouchStart={warm}
                  className="text-xs rounded-full border border-violet-200 bg-white px-2.5 py-1 text-violet-800 hover:border-violet-400 transition-colors max-w-full truncate">
                  {m.flag} {m.q}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-6 flex items-center gap-2 justify-center lg:justify-start text-xs text-muted-foreground">
            <ShieldCheck className="h-4 w-4 text-sprout-500" />
            개인정보는 <b className="mx-1 text-foreground">내 기기에만</b> 저장돼요. 회원가입 없이 바로 이용.
          </div>

          {/* 통계 */}
          <div className="mt-8 grid grid-cols-3 gap-3 max-w-md mx-auto lg:mx-0">
            {stats.map((s, i) => (
              <motion.div
                key={s.label}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 + i * 0.1 }}
                className="card-cute px-3 py-3 text-center"
              >
                <p className="text-2xl font-extrabold gradient-text"><CountUpValue value={s.value} /></p>
                <p className="text-xs font-semibold text-muted-foreground mt-0.5">{s.label}</p>
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* 우: 새싹이 에이전트가 먼저 말을 건다 + 3D 마스코트 */}
        <motion.div
          initial={{ opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.7, delay: 0.1 }}
          className="order-1 lg:order-2 relative"
        >
          {/* 말풍선 — 마스코트 '위쪽'에 흐름 배치(꼬리가 아래 새싹이를 가리켜 말하는 느낌).
              절대배치(z-20 오버레이)는 데스크탑에서 새싹이 얼굴을 가려 제거함. */}
          <div className="relative z-20 px-2 -mb-2">
            <HeroAgentBubble onFocusInput={focusInput} />
          </div>
          <div className="h-[300px] sm:h-[420px] lg:h-[440px]">
            <MascotCanvas />
          </div>
        </motion.div>
      </div>
    </section>
  )
}
