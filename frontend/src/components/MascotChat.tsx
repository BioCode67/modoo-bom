import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowLeft, Eye, RotateCcw, Sparkles, Volume2, VolumeX } from 'lucide-react'
import { SproutLogo } from '@/ui/SproutLogo'
import { useAppStore } from '@/store/useAppStore'
import { useTTS } from '@/lib/useTTS'
import type { UserProfile } from '@/lib/welfare-engine'
import {
  EMPTY_PROFILE, AGE_BRACKETS, INCOME_OPTIONS, HOUSEHOLD_OPTIONS, SITUATIONS,
  CHILD_AGE_OPTIONS, DISABILITY_OPTIONS, REGIONS, applySituations,
  nextStep, progressOf, mascotReaction, parseBirthInput, formatBirth, type StepId,
} from '@/lib/onboardingFlow'
import { cn } from '@/lib/utils'

type Msg = { role: 'bot' | 'user'; text: string }

function questionText(step: StepId, name: string): string {
  const nm = name ? `${name}님, ` : ''
  switch (step) {
    case 'name': return '안녕하세요! 저는 모두봄 새싹이에요 🌱 몇 가지만 여쭤보고 딱 맞는 복지를 찾아드릴게요. 먼저 성함을 알려주세요 — 나중에 복지 신청서에 그대로 들어가요.'
    case 'age': return `${nm}반가워요! 생년월일을 알려주세요.`
    case 'income': return '요즘 형편은 어떠세요? 편하게 골라주세요.'
    case 'household': return '누구와 함께 지내세요?'
    case 'situations': return '혹시 요즘 이런 상황이 있으신가요? 해당되는 걸 모두 골라주세요.'
    case 'childAges': return '자녀가 몇 살인가요? 여러 명이면 다 골라주세요.'
    case 'disability': return '장애 정도를 알려주시면 더 정확히 찾아드려요.'
    case 'region': return '거의 다 왔어요! 어디 사세요? 우리 동네 복지도 함께 찾아드릴게요.'
  }
}

/**
 * 대화형 온보딩 — 마스코트가 한 번에 하나씩 물어보고, 사용자는 '탭'으로 답한다.
 * 폼을 채우는 느낌이 아니라 에이전트와 대화하는 느낌(대회 주제: AI Agent). 접근성: 큰 탭 타깃·키보드·ARIA.
 */
// 진행 중 대화 임시저장(같은 브라우저 세션) — 실수로 새로고침해도 이어서.
// 기존 복지앱 최대 불만("입력하다 상태를 잃고 처음부터") 대응. 탭을 닫으면 사라진다.
// ⚠️ 실명(강식별 PII)은 저장하지 않는다(공용/키오스크 기기 잔존 방지) — store partialize와 동일 원칙. 이름은 React state로만.
const DRAFT_KEY = 'modoo-chat-draft-v1'
type Draft = { profile: UserProfile; step: StepId; msgs: Msg[]; history?: { step: StepId; profile: UserProfile; len: number }[] }
function loadDraft(): Draft | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY)
    if (!raw) return null
    const d = JSON.parse(raw) as Draft
    if (!d || !d.profile || !d.step || !Array.isArray(d.msgs) || d.msgs.length < 2) return null
    return d
  } catch { return null }
}

export function MascotChat({ onSubmit }: { onSubmit: (p: UserProfile) => void }) {
  const draft = useRef<Draft | null>(loadDraft()).current
  const [profile, setProfile] = useState<UserProfile>(draft?.profile ?? EMPTY_PROFILE)
  const [step, setStep] = useState<StepId>(draft?.step ?? 'name')
  const [msgs, setMsgs] = useState<Msg[]>(draft?.msgs ?? [{ role: 'bot', text: questionText('name', '') }])
  const [nameDraft, setNameDraft] = useState('')
  const [multi, setMulti] = useState<string[]>([])   // situations 선택
  const [ages, setAges] = useState<number[]>([])      // 자녀 나이대 선택
  const [houses, setHouses] = useState<string[]>([])  // 가구유형 선택(복수 — 다문화+한부모 등)
  const [history, setHistory] = useState<{ step: StepId; profile: UserProfile; len: number }[]>(draft?.history ?? [])
  const [done, setDone] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  // 완료 시 onSubmit을 900ms 지연 호출하는 타이머 — 언마운트(중간 이탈) 시 취소해 떠난 뒤 제출/화면전환되지 않게
  const submitTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (submitTimer.current) clearTimeout(submitTimer.current) }, [])
  // 어르신(65+) 선택 시 큰글씨 모드를 즉시 제안 — 기존 복지앱의 최대 불만('작은 글씨, 어르신 미고려') 대응.
  const { elderly, toggleElderly, setRpaInfo } = useAppStore()
  const [offerElderly, setOfferElderly] = useState(false)
  // 질문 읽어주기(옵트인) — 시력 저하 어르신 배려. 켜면 새싹이의 새 질문을 음성으로 읽는다.
  const tts = useTTS()
  const [readAloud, setReadAloud] = useState(false)
  useEffect(() => {
    if (!readAloud) return
    const lastBot = [...msgs].reverse().find((m) => m.role === 'bot')
    if (lastBot) tts.speak(lastBot.text)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msgs, readAloud])

  // 새 메시지가 쌓이면 항상 아래로 스크롤(대화 흐름)
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [msgs])

  // 진행 상태 임시저장 — 새로고침해도 이어서(완료되면 지움). 저장 전 실명은 제거(PII 최소저장).
  useEffect(() => {
    try {
      if (done) { sessionStorage.removeItem(DRAFT_KEY); return }
      const nm = profile.name
      const scrub = (t: string) => (nm ? t.split(nm).join('회원') : t) // 봇 문구 속 '홍길동님'도 실명 제거
      const safe: Draft = {
        profile: { ...profile, name: '' },
        step,
        msgs: nm ? msgs.map((m) => ({ ...m, text: scrub(m.text) })) : msgs,
        history: history.map((h) => ({ ...h, profile: { ...h.profile, name: '' } })),
      }
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify(safe))
    } catch { /* 저장 불가 환경(시크릿 등)은 조용히 무시 */ }
  }, [profile, step, msgs, history, done])

  const advance = (patched: UserProfile, userLabel: string) => {
    setHistory((h) => [...h, { step, profile, len: msgs.length }])
    // 어르신을 골랐고 아직 큰글씨가 아니면, 다음 질문과 함께 큰글씨 제안 카드를 띄운다(원탭·강요 없음)
    if (step === 'age' && patched.age >= 65 && !elderly) setOfferElderly(true)
    const reaction = mascotReaction(step, patched)
    const nxt = nextStep(step, patched)
    setProfile(patched)
    setMulti([]); setAges([]); setHouses([])
    setMsgs((m) => {
      const out = [...m, { role: 'user' as const, text: userLabel }]
      if (reaction) out.push({ role: 'bot', text: reaction })
      if (nxt) out.push({ role: 'bot', text: questionText(nxt, patched.name) })
      else out.push({ role: 'bot', text: `${patched.name ? patched.name + '님께 ' : ''}딱 맞는 복지를 지금 찾아볼게요! 🎉` })
      return out
    })
    if (nxt) setStep(nxt)
    else { setDone(true); submitTimer.current = setTimeout(() => onSubmit(patched), 900) }
  }

  // 이름 확정 — 실제 복지 신청에 그대로 쓰이므로, 입력한 성함을 신청 자동입력(rpaInfo.name)에도 채운다.
  //   (rpaInfo는 메모리 저장·디스크 미영속이라 PII 최소저장 원칙 유지. 비면 덮어쓰지 않음.)
  const submitName = () => {
    const clean = nameDraft.trim()
    if (clean) setRpaInfo({ name: clean })
    advance({ ...profile, name: clean }, clean || '시작할게요')
  }

  const back = () => {
    setHistory((h) => {
      if (!h.length) return h
      const last = h[h.length - 1]
      setProfile(last.profile)
      setStep(last.step)
      setMulti([]); setAges([]); setHouses([])
      setOfferElderly(false) // 나이 단계로 되돌아가 다시 65+를 고르면 advance에서 재제안됨
      setMsgs((m) => m.slice(0, last.len))
      return h.slice(0, -1)
    })
  }

  const restart = () => {
    try { sessionStorage.removeItem(DRAFT_KEY) } catch { /* noop */ }
    setProfile(EMPTY_PROFILE); setStep('name'); setNameDraft(''); setMulti([]); setAges([]); setHouses([])
    setHistory([]); setDone(false); setOfferElderly(false)
    setMsgs([{ role: 'bot', text: questionText('name', '') }])
  }

  const pct = Math.round(progressOf(step, profile) * 100)

  return (
    <div className="card-cute p-0 max-w-xl mx-auto overflow-hidden">
      {/* 헤더 — 마스코트 + 진행률 */}
      <div className="flex items-center gap-3 bg-gradient-to-r from-sprout-500 to-emerald-500 px-5 py-3.5 text-white">
        <motion.div animate={{ y: [0, -3, 0] }} transition={{ repeat: Infinity, duration: 2.4, ease: 'easeInOut' }} className="shrink-0">
          <SproutLogo withFace className="h-10 w-10 drop-shadow" />
        </motion.div>
        <div className="flex-1 min-w-0">
          <p className="font-extrabold leading-tight">모두봄 에이전트</p>
          <p className="text-xs text-white/85">말 걸듯 답만 골라주세요 · {done ? '완료!' : `${pct}%`}</p>
        </div>
        <div className="flex gap-1">
          {tts.supported && (
            <button
              onClick={() => { if (readAloud) tts.stop(); setReadAloud((v) => !v) }}
              aria-label={readAloud ? '질문 읽어주기 끄기' : '질문 읽어주기 켜기'}
              aria-pressed={readAloud}
              className={`rounded-full p-2 transition-colors ${readAloud ? 'bg-white/25' : 'hover:bg-white/15'}`}
              title="질문을 소리로 읽어드려요"
            >
              {readAloud ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
            </button>
          )}
          {history.length > 0 && !done && (
            <button onClick={back} aria-label="이전 질문" className="rounded-full p-2 hover:bg-white/15 transition-colors">
              <ArrowLeft className="h-4 w-4" />
            </button>
          )}
          {(history.length > 0 || step !== 'name') && !done && (
            <button onClick={restart} aria-label="처음부터 다시" className="rounded-full p-2 hover:bg-white/15 transition-colors">
              <RotateCcw className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
      {/* 진행 바 */}
      <div className="h-1.5 bg-sprout-100">
        <motion.div className="h-full bg-sprout-400" animate={{ width: `${done ? 100 : pct}%` }} transition={{ duration: 0.4 }} />
      </div>

      {/* 대화 내역 */}
      <div ref={scrollRef} className="nice-scroll max-h-[46vh] min-h-[220px] overflow-y-auto px-4 py-4 space-y-2.5 bg-sprout-50/30" aria-live="polite">
        {msgs.map((m, i) => (
          <Bubble key={i} role={m.role} text={m.text} />
        ))}
        {/* 어르신 배려 — 글씨를 크게 해드릴까요? (원탭, 거절도 존중) */}
        {offerElderly && (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex items-end gap-2">
            <SproutLogo withFace className="h-7 w-7 shrink-0 mb-0.5" />
            <div className="max-w-[85%] rounded-2xl rounded-bl-sm border border-sprout-100 bg-white px-3.5 py-2.5">
              <p className="text-sm leading-relaxed">화면 글씨를 <b>크게</b> 해드릴까요? 언제든 위 메뉴의 ‘큰글씨’로 바꿀 수 있어요.</p>
              <div className="mt-2 flex gap-2">
                <button
                  onClick={() => { toggleElderly(); setOfferElderly(false) }}
                  className="btn-primary !px-3.5 !py-2 text-xs"
                >
                  <Eye className="h-3.5 w-3.5" /> 네, 크게 볼래요
                </button>
                <button onClick={() => setOfferElderly(false)} className="btn-secondary !px-3.5 !py-2 text-xs">지금은 괜찮아요</button>
              </div>
            </div>
          </motion.div>
        )}
      </div>

      {/* 답변 입력부 — 현재 단계에 맞는 컨트롤 */}
      {!done && (
        <div className="border-t-2 border-sprout-100 p-4">
          <AnimatePresence mode="wait">
            <motion.div key={step} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}>
              {step === 'name' && (
                <div className="flex flex-col gap-2">
                  <input
                    value={nameDraft}
                    onChange={(e) => setNameDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && nameDraft.trim()) submitName() }}
                    placeholder="본명 (예: 홍길동)"
                    aria-label="성함"
                    className="input-cute"
                    autoFocus
                  />
                  <p className="px-1 text-xs text-muted-foreground">실제 신청·서류 발급에 쓰이니 <b>본명</b>으로 적어주세요. 그냥 둘러볼 거면 건너뛰어도 돼요.</p>
                  <div className="flex gap-2">
                    <button onClick={() => advance({ ...profile, name: '' }, '그냥 시작할게요')} className="btn-secondary flex-1">건너뛰기</button>
                    <button onClick={submitName} className="btn-primary flex-1">
                      다음 <Sparkles className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )}

              {step === 'age' && (
                <BirthdateStep
                  onBirth={(yyyymmdd, age) => {
                    setRpaInfo({ birth_date: yyyymmdd })   // 신청·발급 본인인증 자동입력에 그대로 사용(재입력 제거)
                    advance({ ...profile, age, _ageExplicit: true }, `${formatBirth(yyyymmdd)} · 만 ${age}세`)
                  }}
                  onBracket={(age, label) => advance({ ...profile, age, _ageExplicit: true }, label)}
                />
              )}

              {step === 'income' && (
                <ChoiceGrid>
                  {INCOME_OPTIONS.map((o) => (
                    <ChoiceBtn key={o.value} emoji={o.emoji} sub={o.sub} onClick={() => advance({ ...profile, income_percentile: o.value }, `${o.label} (${o.sub})`)}>{o.label}</ChoiceBtn>
                  ))}
                </ChoiceGrid>
              )}

              {step === 'household' && (
                <div>
                  <div className="grid grid-cols-2 gap-2">
                    {HOUSEHOLD_OPTIONS.map((h) => {
                      const on = houses.includes(h.label)
                      return (
                        <button
                          key={h.label}
                          aria-pressed={on}
                          onClick={() => setHouses((cur) => {
                            // '일반가구'(특별 유형 없음)는 배타 선택 — 다른 것과 함께 못 고른다(상황 단계 '해당 없어요'와 동일 패턴)
                            if (h.label === '일반가구') return on ? [] : ['일반가구']
                            const base = cur.filter((x) => x !== '일반가구')
                            return base.includes(h.label) ? base.filter((x) => x !== h.label) : [...base, h.label]
                          })}
                          className={cn('flex items-center gap-2 rounded-2xl border-2 px-3 py-2.5 text-sm font-semibold text-left transition-all active:scale-95',
                            on ? 'bg-sprout-700 border-sprout-700 text-white shadow-soft' : 'bg-white border-sprout-100 hover:border-sprout-300')}
                        >
                          <span className="text-lg">{h.emoji}</span> <span className="min-w-0">{h.label}</span>
                        </button>
                      )
                    })}
                  </div>
                  <button
                    onClick={() => advance({ ...profile, household_type: houses.join('·') }, houses.join(', '))}
                    disabled={!houses.length}
                    className="btn-primary w-full mt-3 disabled:opacity-50"
                  >
                    {houses.length ? `${houses.length}개 골랐어요, 다음 →` : '해당하는 걸 골라주세요'}
                  </button>
                  <p className="mt-2 text-center text-xs text-muted-foreground">여러 개 해당되면 모두 골라주세요 (예: 다문화가족 + 한부모가족)</p>
                </div>
              )}

              {step === 'situations' && (
                <div>
                  <div className="grid grid-cols-2 gap-2">
                    {SITUATIONS.map((s) => {
                      const on = multi.includes(s.id)
                      return (
                        <button
                          key={s.id}
                          aria-pressed={on}
                          onClick={() => setMulti((cur) => {
                            if (s.id === 'none') return on ? [] : ['none']
                            const base = cur.filter((x) => x !== 'none')
                            return base.includes(s.id) ? base.filter((x) => x !== s.id) : [...base, s.id]
                          })}
                          className={cn('flex items-center gap-2 rounded-2xl border-2 px-3 py-2.5 text-sm font-semibold text-left transition-all active:scale-95',
                            on ? 'bg-sprout-700 border-sprout-700 text-white shadow-soft' : 'bg-white border-sprout-100 hover:border-sprout-300')}
                        >
                          <span className="text-lg">{s.emoji}</span> <span className="min-w-0">{s.label}</span>
                        </button>
                      )
                    })}
                  </div>
                  <button
                    onClick={() => {
                      const patched = applySituations(profile, multi)
                      const label = multi.length && !multi.includes('none')
                        ? SITUATIONS.filter((s) => multi.includes(s.id)).map((s) => s.label).join(', ')
                        : '해당 없어요'
                      advance(patched, label)
                    }}
                    className="btn-primary w-full mt-3"
                  >
                    {multi.length && !multi.includes('none') ? `${multi.length}개 골랐어요, 다음 →` : '해당 없어요, 다음 →'}
                  </button>
                </div>
              )}

              {step === 'childAges' && (
                <div>
                  <ChoiceGrid cols2>
                    {CHILD_AGE_OPTIONS.map((c) => {
                      const on = ages.includes(c.age)
                      return (
                        <button
                          key={c.age}
                          aria-pressed={on}
                          onClick={() => setAges((cur) => cur.includes(c.age) ? cur.filter((x) => x !== c.age) : [...cur, c.age])}
                          className={cn('flex items-center gap-2 rounded-2xl border-2 px-3 py-2.5 text-sm font-semibold text-left transition-all active:scale-95',
                            on ? 'bg-sprout-700 border-sprout-700 text-white shadow-soft' : 'bg-white border-sprout-100 hover:border-sprout-300')}
                        >
                          <span className="text-lg">{c.emoji}</span> {c.label}
                        </button>
                      )
                    })}
                  </ChoiceGrid>
                  <button
                    onClick={() => {
                      // 건너뛰면 나이 미상으로 유지(자리표시 0세 금지 — 신생아 오추천 방지).
                      // 단 '최근 아기를 낳았어요'로 이미 [0]이 잡혔으면, 여기서 손위 자녀 나이를 골라도
                      // [0]을 잃지 않도록 '병합'한다(덮어쓰면 부모급여·첫만남 등 영아 지원이 통째로 탈락).
                      const picked = ages.length
                        ? Array.from(new Set([...(profile.children_ages || []), ...ages])).sort((a, b) => a - b)
                        : profile.children_ages
                      const label = ages.length
                        ? CHILD_AGE_OPTIONS.filter((c) => ages.includes(c.age)).map((c) => c.label).join(', ')
                        : '나중에 알려줄게요'
                      advance({ ...profile, children_ages: picked }, label)
                    }}
                    className="btn-primary w-full mt-3"
                  >
                    {ages.length ? `${ages.length}개 골랐어요, 다음 →` : '건너뛰기 (나이를 알면 더 정확해요)'}
                  </button>
                </div>
              )}

              {step === 'disability' && (
                <ChoiceGrid cols2>
                  {DISABILITY_OPTIONS.map((d) => (
                    <ChoiceBtn key={d.value} onClick={() => advance({ ...profile, disability_grade: d.value }, d.label)}>{d.label}</ChoiceBtn>
                  ))}
                </ChoiceGrid>
              )}

              {step === 'region' && (
                <div>
                  <div className="flex flex-wrap gap-1.5">
                    {REGIONS.map((r) => (
                      <button
                        key={r}
                        onClick={() => advance({ ...profile, region: r }, `${r} 거주`)}
                        className="rounded-xl border-2 border-sprout-100 bg-white px-3.5 py-2 text-sm font-semibold hover:border-sprout-300 hover:bg-sprout-50 transition-all active:scale-95"
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                  <button onClick={() => advance({ ...profile, region: '' }, '괜찮아요, 넘어갈게요')} className="btn-secondary w-full mt-3">
                    괜찮아요, 넘어갈게요 →
                  </button>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      )}
    </div>
  )
}

function Bubble({ role, text }: { role: 'bot' | 'user'; text: string }) {
  const bot = role === 'bot'
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className={cn('flex items-end gap-2', bot ? 'justify-start' : 'justify-end')}>
      {bot && <SproutLogo withFace className="h-7 w-7 shrink-0 mb-0.5" />}
      <div className={cn('max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-line',
        bot ? 'bg-white border border-sprout-100 rounded-bl-sm text-foreground' : 'bg-sprout-700 text-white rounded-br-sm font-semibold')}>
        {text}
      </div>
    </motion.div>
  )
}

function ChoiceGrid({ children, cols2 }: { children: React.ReactNode; cols2?: boolean }) {
  return <div className={cn('grid gap-2', cols2 ? 'grid-cols-2' : 'grid-cols-1')}>{children}</div>
}

function ChoiceBtn({ children, emoji, sub, onClick }: { children: React.ReactNode; emoji?: string; sub?: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2.5 rounded-2xl border-2 border-sprout-100 bg-white px-4 py-3 text-sm font-semibold text-left hover:border-sprout-300 hover:bg-sprout-50 transition-all active:scale-95"
    >
      {emoji && <span className="text-xl shrink-0">{emoji}</span>}
      <span className="min-w-0">{children}{sub && <span className="block text-xs font-normal text-muted-foreground">{sub}</span>}</span>
    </button>
  )
}

/**
 * 🎂 생년월일 입력(토스·PASS 방식) — 8자리 숫자를 받아 정확한 만 나이를 계산하고, 그 값을 신청/발급
 * 본인인증 자동입력(rpaInfo.birth_date)에도 그대로 쓴다(나이대 어림값보다 정확 + 재입력 제거).
 * 타이핑이 어려운 어르신을 위해 '생년월일 대신 나이대로 고르기' 폴백을 함께 둔다(접근성).
 */
function BirthdateStep({ onBirth, onBracket }: {
  onBirth: (yyyymmdd: string, age: number) => void
  onBracket: (age: number, label: string) => void
}) {
  const [raw, setRaw] = useState('')   // 숫자만(최대 8자리)
  const [showBrackets, setShowBrackets] = useState(false)
  const [err, setErr] = useState('')
  const parsed = parseBirthInput(raw)
  const display = raw.length <= 4 ? raw
    : raw.length <= 6 ? `${raw.slice(0, 4)}.${raw.slice(4)}`
    : `${raw.slice(0, 4)}.${raw.slice(4, 6)}.${raw.slice(6)}`
  const submit = () => {
    const p = parseBirthInput(raw)
    if (!p) { setErr('생년월일 8자리를 정확히 입력해 주세요 (예: 1960.01.01)'); return }
    onBirth(p.yyyymmdd, p.age)
  }
  if (showBrackets) {
    return (
      <div>
        <ChoiceGrid>
          {AGE_BRACKETS.map((a) => (
            <ChoiceBtn key={a.label} emoji={a.emoji} onClick={() => onBracket(a.age, a.label)}>{a.label}</ChoiceBtn>
          ))}
        </ChoiceGrid>
        <button onClick={() => setShowBrackets(false)} className="btn-secondary w-full mt-3">← 생년월일로 입력할게요</button>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-2">
      <input
        value={display}
        onChange={(e) => { setRaw(e.target.value.replace(/\D/g, '').slice(0, 8)); setErr('') }}
        onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
        inputMode="numeric"
        placeholder="생년월일 8자리 (예: 1960.01.01)"
        aria-label="생년월일"
        className="input-cute text-center tracking-widest"
        autoFocus
      />
      {parsed && <p className="text-center text-xs font-bold text-sprout-700">만 {parsed.age}세로 찾아드릴게요 ✨</p>}
      {err && <p className="text-center text-xs font-semibold text-rose-600">{err}</p>}
      <button onClick={submit} disabled={!parsed} className="btn-primary w-full disabled:opacity-50">
        다음 <Sparkles className="h-4 w-4" />
      </button>
      <button onClick={() => setShowBrackets(true)} className="mx-auto text-xs text-muted-foreground underline underline-offset-2">
        생년월일 대신 나이대로 고를게요
      </button>
    </div>
  )
}
