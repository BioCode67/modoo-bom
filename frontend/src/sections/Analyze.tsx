import { useState } from 'react'
import { motion } from 'framer-motion'
import { Sparkles } from 'lucide-react'
import { ProfileWizard } from '@/components/ProfileWizard'
import { QuickAsk } from '@/components/QuickAsk'
import { AnalyzingOverlay } from '@/components/AnalyzingOverlay'
import { ResultsView } from '@/components/ResultsView'
import { runAnalysis, type UserProfile, type AnalysisResult } from '@/lib/welfare-engine'
import { useAppStore } from '@/store/useAppStore'

type Phase = 'form' | 'analyzing' | 'result'

export function Analyze() {
  const { profile: savedProfile, result: savedResult, setAnalysis, clearAnalysis } = useAppStore()
  // 캐시된 결과가 있으면 바로 결과 화면 (오랜만에 들어와도 즉시 표시)
  const [phase, setPhase] = useState<Phase>(savedResult ? 'result' : 'form')
  const [pending, setPending] = useState<{ profile: UserProfile; result: AnalysisResult } | null>(null)

  const handleSubmit = (profile: UserProfile) => {
    const result = runAnalysis(profile)
    setPending({ profile, result })
    setPhase('analyzing')
  }

  const handleAnalyzed = () => {
    if (pending) {
      setAnalysis(pending.profile, pending.result)
      setPhase('result')
    }
  }

  const reset = () => {
    clearAnalysis()
    setPending(null)
    setPhase('form')
  }

  if (phase === 'analyzing') return <AnalyzingOverlay onDone={handleAnalyzed} />

  if (phase === 'result' && savedResult && savedProfile) {
    return <ResultsView result={savedResult} profile={savedProfile} onReset={reset} />
  }

  return (
    <div className="page-container py-8 sm:py-12">
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-7">
        <span className="chip-sprout inline-flex"><Sparkles className="h-3.5 w-3.5" /> 1분이면 충분해요</span>
        <h1 className="mt-3 text-2xl sm:text-3xl font-extrabold">내 복지 찾기</h1>
        <p className="text-muted-foreground mt-1.5">간단한 정보만 알려주시면 맞춤 복지를 찾아드려요.</p>
      </motion.div>
      <QuickAsk onSubmit={handleSubmit} />
      <div className="flex items-center gap-3 my-5 text-xs text-muted-foreground/70">
        <span className="h-px flex-1 bg-sprout-100" /> 또는 직접 입력 <span className="h-px flex-1 bg-sprout-100" />
      </div>
      <ProfileWizard onSubmit={handleSubmit} />
    </div>
  )
}
