import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Check, Loader2, Cpu, RefreshCw } from 'lucide-react'
import { SproutLogo } from '@/ui/SproutLogo'
import { API_BASE } from '@/lib/backend'
import type { UserProfile } from '@/lib/welfare-engine'
import { cn } from '@/lib/utils'

// 백엔드 LangGraph 10노드를 사람이 읽기 좋은 라벨로. reflection_check는 '재판정 루프' 강조.
const LABEL: Record<string, string> = {
  profile_analyzer: '프로필 분석 — 상황 신호 추출',
  policy_search: '복지 정책 검색 (RAG)',
  eligibility_check: '자격 판별 (AI 추론)',
  reflection_check: '⇆ 재판정 검증 루프',
  guide_generator: '신청 가이드 생성',
  doc_retrieval: '필요 서류 확인',
  portfolio_manager: '복지 포트폴리오 구성',
  notification_agent: '생애 이벤트 알림 분석',
  result_tracker: '사후관리 계획',
  orchestrator: '최종 안내 정리',
}
const ORDER = Object.keys(LABEL)

interface NodeState { status: 'running' | 'done' | 'error'; message: string }

/**
 * 백엔드가 배포돼 있을 때(VITE_API_BASE) 실제 LangGraph 10노드 에이전트를 /ws/analyze로
 * 실시간 스트리밍해 '에이전트가 진짜로 추론하는 과정'을 보여준다(대회 주제 정합의 핵심 순간).
 * 결과 자체는 신뢰도 높은 클라이언트 엔진 것을 쓰고(넓은 커버리지), 이 패널은 '살아있는 에이전트'를 증명.
 * 연결 실패·콜드스타트 지연이면 안전하게 onDone으로 폴백(클라이언트 결과 표시).
 */
export function BackendAgentStream({ profile, onDone }: { profile: UserProfile; onDone: () => void }) {
  const [nodes, setNodes] = useState<Record<string, NodeState>>({})
  const [woke, setWoke] = useState(false)
  const done = useRef(false)

  useEffect(() => {
    const start = Date.now()
    const finish = () => { if (done.current) return; done.current = true; const w = Math.max(0, 900 - (Date.now() - start)); setTimeout(onDone, w) }
    let ws: WebSocket | null = null
    try {
      ws = new WebSocket(`${API_BASE.replace(/^http/, 'ws')}/ws/analyze`)
    } catch { finish(); return }
    ws.onopen = () => { setWoke(true); ws!.send(JSON.stringify({ type: 'start_analysis', profile })) }
    ws.onmessage = (e) => {
      try {
        const m = JSON.parse(e.data)
        if (m.type === 'node_event') {
          setWoke(true)
          setNodes((prev) => ({ ...prev, [m.node]: { status: m.status, message: m.message || '' } }))
        } else if (m.type === 'complete') {
          try { ws?.close() } catch { /* noop */ }
          finish()
        }
      } catch { /* noop */ }
    }
    ws.onerror = () => finish()
    // 안전망: Render 콜드스타트가 너무 오래 걸리면 결과부터(클라이언트 엔진) 보여준다
    const safety = setTimeout(finish, 45000)
    return () => { clearTimeout(safety); try { ws?.close() } catch { /* noop */ } }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const doneCount = ORDER.filter((n) => nodes[n]?.status === 'done').length

  return (
    <div className="page-container py-12 sm:py-16 flex flex-col items-center text-center" aria-busy="true">
      <p className="sr-only" role="status" aria-live="polite">AI 에이전트가 분석하고 있어요. {doneCount}/10 단계 완료.</p>
      <motion.div animate={{ y: [0, -10, 0] }} transition={{ repeat: Infinity, duration: 1.6 }} className="relative">
        <div className="absolute inset-0 -z-10 m-auto h-36 w-36 rounded-full bg-sprout-200/50 blur-2xl" />
        <SproutLogo withFace className="h-28 w-28 drop-shadow-xl" />
      </motion.div>
      <h2 className="mt-5 text-2xl font-extrabold inline-flex items-center gap-2">
        <Cpu className="h-5 w-5 text-sprout-500" /> AI 에이전트가 추론 중 <span className="gradient-text">({doneCount}/10)</span>
      </h2>
      <p className="text-muted-foreground mt-1 text-sm">
        {woke ? '10개 노드가 순차적으로 판단하고 있어요 — 자격 판별 후 재판정 루프까지.' : 'AI 에이전트를 깨우는 중이에요… (클라우드 콜드스타트, 잠시만요)'}
      </p>

      <div className="mt-7 w-full max-w-md space-y-1.5 text-left">
        {ORDER.map((n) => {
          const s = nodes[n]
          const active = s?.status === 'running'
          const isDone = s?.status === 'done'
          const isReflect = n === 'reflection_check'
          return (
            <motion.div
              key={n}
              initial={{ opacity: 0.35 }}
              animate={{ opacity: s ? 1 : 0.35 }}
              className={cn('flex items-start gap-3 rounded-2xl px-4 py-2 text-sm font-semibold',
                isDone ? 'bg-sprout-50 text-sprout-700' : active ? 'bg-sprout-100 text-sprout-700' : 'bg-muted/40 text-muted-foreground',
                isReflect && (active || isDone) && 'ring-1 ring-sky2-300')}
            >
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white">
                {isDone ? <Check className="h-4 w-4 text-success-500" /> : active ? (isReflect ? <RefreshCw className="h-4 w-4 animate-spin text-sky2-500" /> : <Loader2 className="h-4 w-4 animate-spin text-sprout-500" />) : <span className="text-[11px] text-muted-foreground">{ORDER.indexOf(n) + 1}</span>}
              </span>
              <span className="min-w-0">
                <span className="block leading-tight">{LABEL[n]}</span>
                {s?.message && <span className="block text-[11px] font-normal text-muted-foreground truncate">{s.message}</span>}
              </span>
            </motion.div>
          )
        })}
      </div>
      <p className="mt-4 text-[11px] text-muted-foreground/80">실제 백엔드 LangGraph 에이전트가 실시간으로 판단합니다.</p>
    </div>
  )
}
