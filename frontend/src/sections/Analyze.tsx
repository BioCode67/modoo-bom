import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Sparkles, MessageCircleHeart, ListChecks } from 'lucide-react'
import { ProfileWizard } from '@/components/ProfileWizard'
import { MascotChat } from '@/components/MascotChat'
import { HelperView } from '@/components/HelperView'
import { QuickAsk } from '@/components/QuickAsk'
import { AgeAskStep } from '@/components/AgeAskStep'
import { AnalyzingOverlay } from '@/components/AnalyzingOverlay'
import { ResultsView } from '@/components/ResultsView'
import { runAnalysis, type UserProfile, type AnalysisResult } from '@/lib/welfare-engine'
import { useAppStore } from '@/store/useAppStore'

type Phase = 'form' | 'age' | 'analyzing' | 'result'

export function Analyze() {
  const { profile: savedProfile, result: savedResult, setAnalysis, clearAnalysis, pendingProfile, setPendingProfile, helper } = useAppStore()
  // 캐시된 결과가 있으면 바로 결과 화면 (오랜만에 들어와도 즉시 표시)
  const [phase, setPhase] = useState<Phase>(savedResult ? 'result' : 'form')
  const [mode, setMode] = useState<'chat' | 'quick' | 'form'>('chat')
  const [pending, setPending] = useState<{ profile: UserProfile; result: AnalysisResult } | null>(null)
  // 🎂 나이 추정 시 되물을 프로필 — 대화형(홈 한 문장·QuickAsk) 진입의 단일 게이트
  const [needAge, setNeedAge] = useState<UserProfile | null>(null)

  const runNow = (profile: UserProfile) => {
    const result = runAnalysis(profile)
    setPending({ profile, result })
    setPhase('analyzing')
  }
  const handleSubmit = (profile: UserProfile) => {
    // 대화형 파싱이 정확한 나이(N세/살)를 못 잡아 추정값(청년→27·기본 30)을 쓴 경우엔 분석 전에
    //   토스식으로 딱 한 번 되묻는다. 위저드·가이드챗은 정확한 나이를 직접 받으므로 _ageExplicit 미설정
    //   → 엄격 비교(=== false)로 그 경우엔 게이트하지 않는다(불필요한 되물음 방지).
    if (profile._ageExplicit === false) {
      setNeedAge(profile)
      setPhase('age')
      return
    }
    runNow(profile)
  }

  // 홈에서 한 문장 입력으로 넘어온 경우: 분석 오버레이(실제 AI)를 태운다
  useEffect(() => {
    if (pendingProfile) {
      const profile = pendingProfile
      setPendingProfile(null)
      handleSubmit(profile)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingProfile])

  const handleAnalyzed = () => {
    if (pending) {
      setAnalysis(pending.profile, pending.result)
      setPhase('result')
    }
  }

  const reset = () => {
    clearAnalysis()
    setPending(null)
    setNeedAge(null)
    setPhase('form')
  }

  // 가족 도움 링크로 진입 시 — 도우미 뷰(남의 프로필 온디바이스 재계산)를 최우선으로 표시
  if (helper) return <HelperView />

  // 🎂 나이 확인 단계 — 추정값으로 바로 분석하지 않고 정확한 나이를 한 번 받는다(토스식).
  if (phase === 'age' && needAge)
    return (
      <AgeAskStep
        initialAge={needAge.age}
        onConfirm={(age) => { const p = { ...needAge, age, _ageExplicit: true }; setNeedAge(null); runNow(p) }}
        onSkip={() => { const p = needAge; setNeedAge(null); runNow(p) }}
        onBack={() => { setNeedAge(null); setPhase('form') }}
      />
    )

  if (phase === 'analyzing' && pending)
    return <AnalyzingOverlay profile={pending.profile} eligible={pending.result.eligible_policies} onDone={handleAnalyzed} />

  if (phase === 'result' && savedResult && savedProfile) {
    return <ResultsView result={savedResult} profile={savedProfile} onReset={reset} />
  }

  return (
    <div className="page-container py-8 sm:py-12">
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-7">
        <span className="chip-sprout inline-flex"><Sparkles className="h-3.5 w-3.5" /> 1분이면 충분해요</span>
        <h1 className="mt-3 text-2xl sm:text-3xl font-extrabold">내 복지 찾기</h1>
        <p className="text-muted-foreground mt-1.5">폼을 채우지 마세요. 새싹이와 <b>말하듯 답만 골라주시면</b> 딱 맞는 복지를 찾아드려요.</p>
      </motion.div>

      {/* 입력 방식 선택 — 대화형(기본) / 한 문장 / 직접 입력 */}
      <div className="flex justify-center gap-2 mb-5">
        <ModeTab active={mode === 'chat'} onClick={() => setMode('chat')} icon={<MessageCircleHeart className="h-4 w-4" />}>새싹이와 대화</ModeTab>
        <ModeTab active={mode === 'quick'} onClick={() => setMode('quick')} icon={<Sparkles className="h-4 w-4" />}>한 문장으로</ModeTab>
        <ModeTab active={mode === 'form'} onClick={() => setMode('form')} icon={<ListChecks className="h-4 w-4" />}>직접 입력</ModeTab>
      </div>

      {mode === 'chat' && <MascotChat onSubmit={handleSubmit} />}
      {mode === 'quick' && <QuickAsk onSubmit={handleSubmit} />}
      {mode === 'form' && <ProfileWizard onSubmit={handleSubmit} />}

      {/* 📞 통화형 상담 — 화면 읽기·타이핑이 어려운 분을 위한 말로만 완주 경로(어르신 최우선) */}
      <button
        onClick={() => window.dispatchEvent(new Event('modoobom:voice-call'))}
        className="mt-4 w-full rounded-3xl border-2 border-sprout-200 bg-white py-4 font-extrabold text-lg text-sprout-800 hover:bg-sprout-50 flex items-center justify-center gap-2.5"
      >
        📞 새싹이와 통화하기 <span className="text-sm font-semibold text-muted-foreground">— 말로 묻고 소리로 듣는 상담</span>
      </button>
    </div>
  )
}

function ModeTab({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={active
        ? 'inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-bold bg-sprout-700 text-white shadow-soft transition-all'
        : 'inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold bg-white border-2 border-sprout-100 text-muted-foreground hover:border-sprout-300 hover:text-foreground transition-all'}
    >
      {icon}{children}
    </button>
  )
}
