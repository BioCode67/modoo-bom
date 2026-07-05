import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Check, Loader2 } from 'lucide-react'
import { SproutLogo } from '@/ui/SproutLogo'
import type { EligiblePolicy, UserProfile } from '@/lib/welfare-engine'
import { incomeCeiling, sidoOf } from '@/lib/welfare-engine'
import { API_BASE } from '@/lib/backend'
import { BackendAgentStream } from '@/components/BackendAgentStream'
import { cn } from '@/lib/utils'

/**
 * 분석 오버레이 — '진짜로 하는 일'만 보여준다(가짜 단계 타이머 아님, 정직성 원칙).
 * 규칙 기반 자격 대조는 이미 끝났고, 여기서 **온디바이스 신경망 임베딩**으로 5천여 정책과의
 * 의미 유사도를 실제로 계산한다(semanticDiscover). 단계 전환은 실제 async 진행에 맞추고,
 * 표시되는 건수도 실측값. 임베딩을 미리 데워 결과화면의 'AI 관련 복지'가 즉시 뜨게 한다.
 */
export function AnalyzingOverlay({
  profile,
  eligible,
  onDone,
}: {
  profile: UserProfile
  eligible: EligiblePolicy[]
  onDone: () => void
}) {
  const [active, setActive] = useState(0)
  const [count, setCount] = useState<number | null>(null) // AI가 발견한 관련 복지 실측 건수
  const done = useRef(false)
  // 백엔드(LangGraph)가 배포돼 있으면 실제 10노드 에이전트를 실시간 스트리밍(대회 주제의 핵심 순간).
  // 결과는 신뢰도 높은 클라이언트 엔진 것을 쓰되, 이 화면이 '진짜 에이전트'를 보여준다.
  const useBackendStream = !!API_BASE

  useEffect(() => {
    if (useBackendStream) return // 백엔드 스트림 모드에선 클라이언트 단계 연출을 돌리지 않음
    const start = Date.now()
    const steps = 4
    const finish = () => {
      if (done.current) return
      done.current = true
      setActive(steps)
      const wait = Math.max(0, 1300 - (Date.now() - start)) // 최소 노출(깜빡임 방지)
      setTimeout(onDone, wait)
    }
    setActive(1)
    ;(async () => {
      try {
        // 데이터 절약·저사양·2G 환경에선 3.9MB 임베딩을 받지 않고 규칙기반 결과로 바로 진행(정직 폴백).
        const { prefersDataSaving } = await import('@/lib/netHint')
        if (prefersDataSaving()) { finish(); return }
        const { semanticDiscover } = await import('@/lib/semanticSearch')
        setActive(2) // 신경망 임베딩 로드·의미 유사도 계산(실제 async 작업)
        const userSido = sidoOf(profile.region)
        const excludeNames = new Set(eligible.map((e) => e.name.replace(/\s/g, '')))
        const seedIds = eligible.slice(0, 16).map((e) => e.id)
        const hits = await semanticDiscover(seedIds, {
          topK: 9,
          excludeNames,
          keep: (p) => {
            if (p.id.startsWith('LOC-') && userSido) { const ps = sidoOf(p.target); if (ps && ps !== userSido) return false }
            const c = incomeCeiling(`${p.eligibility} ${p.target} ${p.name}`)
            if (c !== null && profile.income_percentile > c) return false
            return true
          },
        })
        setActive(3)
        setCount(hits.length)
        finish()
      } catch {
        finish() // 오프라인·로드 실패 시에도 규칙 기반 결과로 진행(정직 폴백)
      }
    })()
    // 안전망: 신경망이 너무 오래 걸리면(첫 임베딩 다운로드 등) 결과부터 보여준다
    const safety = setTimeout(finish, 12000)
    return () => clearTimeout(safety)
  }, [profile, eligible, onDone, useBackendStream])

  // 백엔드 배포 시: 실제 LangGraph 10노드 에이전트 실시간 스트리밍
  if (useBackendStream) return <BackendAgentStream profile={profile} onDone={onDone} />

  // 인지 단계에서 실제로 읽어낸 '상황 신호'를 사람이 읽을 수 있게(에이전트가 무엇을 근거로 판단하는지 투명하게)
  const signals: string[] = []
  if (profile.age >= 65) signals.push('어르신')
  else if (profile.age >= 19 && profile.age <= 34) signals.push('청년')
  if (profile.income_percentile <= 50) signals.push('저소득')
  if (profile.disability) signals.push('장애')
  if (profile.is_pregnant) signals.push('임신')
  if (profile.has_children) signals.push('자녀 양육')
  if (profile.employment_status === 'unemployed') signals.push('구직 중')
  if (/한부모|조손/.test(profile.household_type)) signals.push('한부모·조손')
  if (profile.household_type.includes('다문화')) signals.push('다문화')
  if (profile.household_type) signals.push(profile.household_type)
  const signalText = signals.length ? ` — ${[...new Set(signals)].slice(0, 4).join('·')}` : ''

  const STEPS = [
    `프로필에서 상황 신호를 읽었어요${signalText}`,
    `내게 맞는 복지를 자격 기준으로 대조했어요 (${eligible.length}건 해당)`,
    '온디바이스 신경망으로 5천여 복지와 의미를 비교하는 중…',
    count === null ? '관련 복지를 정리하는 중…' : `AI가 놓치기 쉬운 관련 복지 ${count}건을 더 찾았어요`,
  ]

  return (
    <div className="page-container py-12 sm:py-20 flex flex-col items-center text-center" aria-busy="true">
      <p className="sr-only" role="status" aria-live="polite">복지를 분석하고 있어요. {STEPS[Math.min(active, STEPS.length - 1)]}</p>
      <motion.div animate={{ y: [0, -12, 0] }} transition={{ repeat: Infinity, duration: 1.6 }} className="relative">
        <div className="absolute inset-0 -z-10 m-auto h-40 w-40 rounded-full bg-sprout-200/50 blur-2xl" />
        <SproutLogo withFace className="h-32 w-32 drop-shadow-xl" />
      </motion.div>
      <h2 className="mt-6 text-2xl font-extrabold">AI가 복지를 찾고 있어요 <span className="gradient-text">🔎</span></h2>
      <p className="text-muted-foreground mt-1">기기 안에서 직접 계산해요 · 서버 전송 없음</p>

      <div className="mt-8 w-full max-w-md space-y-2 text-left">
        {STEPS.map((s, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0.4 }}
            animate={{ opacity: i <= active ? 1 : 0.4 }}
            className={cn('flex items-center gap-3 rounded-2xl px-4 py-2.5 text-sm font-semibold transition-colors',
              i < active ? 'bg-sprout-50 text-sprout-700' : i === active ? 'bg-sprout-100 text-sprout-700' : 'bg-muted/40 text-muted-foreground')}
          >
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white">
              {i < active ? <Check className="h-4 w-4 text-success-500" /> : i === active ? <Loader2 className="h-4 w-4 animate-spin text-sprout-500" /> : <span className="text-xs text-muted-foreground">{i + 1}</span>}
            </span>
            {s}
          </motion.div>
        ))}
      </div>
    </div>
  )
}
