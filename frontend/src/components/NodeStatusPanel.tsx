import { cn } from '@/lib/utils'
import { Progress } from '@/components/ui/progress'
import { NODE_ORDER, NODE_LABELS } from '@/types'
import type { NodeState } from '@/hooks/useAgentWebSocket'
import {
  CheckCircle2, Circle, Loader2, XCircle,
  Brain, Search, ShieldCheck, RefreshCw,
  BookOpen, FileText, BarChart3, Bell, ClipboardList, Cpu,
} from 'lucide-react'

const NODE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  profile_analyzer: Brain,
  policy_search: Search,
  eligibility_check: ShieldCheck,
  reflection_check: RefreshCw,
  guide_generator: BookOpen,
  doc_retrieval: FileText,
  portfolio_manager: BarChart3,
  notification_agent: Bell,
  result_tracker: ClipboardList,
  orchestrator: Cpu,
}

const NODE_COLORS = {
  running: {
    border: 'border-blue-300',
    bg: 'bg-blue-50',
    text: 'text-blue-700',
    badge: 'bg-blue-500 text-white',
  },
  done: {
    border: 'border-green-200',
    bg: 'bg-green-50',
    text: 'text-green-700',
    badge: 'bg-green-100 text-green-700',
  },
  error: {
    border: 'border-red-200',
    bg: 'bg-red-50',
    text: 'text-red-700',
    badge: 'bg-red-100 text-red-700',
  },
  pending: {
    border: 'border-border',
    bg: 'bg-background',
    text: 'text-muted-foreground',
    badge: '',
  },
}

interface Props {
  nodeStates: Record<string, NodeState>
  progress: number
  doneCount: number
}

function elapsedMs(state: NodeState): string | null {
  if (state.status === 'running' && state.startedAt) {
    const ms = Date.now() - state.startedAt
    return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
  }
  if (state.status === 'done' && state.startedAt && state.doneAt) {
    const ms = state.doneAt - state.startedAt
    return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
  }
  return null
}

export function NodeStatusPanel({ nodeStates, progress, doneCount }: Props) {
  return (
    <div className="space-y-4">
      {/* 진행 헤더 */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">에이전트 진행 상태</span>
        <span className="text-sm font-bold text-primary tabular-nums">
          {doneCount} / {NODE_ORDER.length}
        </span>
      </div>
      <Progress value={progress} className="h-2" />

      {/* 노드 목록 */}
      <div className="space-y-1.5">
        {NODE_ORDER.map((nodeKey, idx) => {
          const state = nodeStates[nodeKey]
          const status = state?.status ?? 'pending'
          const colors = NODE_COLORS[status]
          const Icon = NODE_ICONS[nodeKey] ?? Circle
          const elapsed = state ? elapsedMs(state) : null

          return (
            <div
              key={nodeKey}
              className={cn(
                'flex items-start gap-2.5 rounded-lg border px-3 py-2.5 transition-all duration-300',
                colors.border,
                colors.bg,
                status === 'pending' && 'opacity-40',
                status === 'running' && 'node-running shadow-sm',
              )}
            >
              {/* 번호 */}
              <span className="w-4 shrink-0 text-[11px] font-bold text-muted-foreground mt-0.5">
                {idx + 1}
              </span>

              {/* 상태 아이콘 */}
              <div className="shrink-0 mt-0.5">
                {status === 'running' && <Loader2 className="h-3.5 w-3.5 text-blue-500 animate-spin" />}
                {status === 'done'    && <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />}
                {status === 'error'   && <XCircle className="h-3.5 w-3.5 text-red-500" />}
                {status === 'pending' && <Icon className="h-3.5 w-3.5 text-muted-foreground" />}
              </div>

              {/* 본문 */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-1">
                  <span className={cn('text-xs font-semibold truncate', colors.text)}>
                    {NODE_LABELS[nodeKey] ?? nodeKey}
                  </span>
                  {/* 실행 시간 */}
                  {elapsed && (
                    <span className={cn(
                      'text-[10px] font-mono shrink-0 px-1.5 py-0.5 rounded-full',
                      status === 'running' ? 'bg-blue-100 text-blue-600' : 'bg-muted text-muted-foreground',
                    )}>
                      {elapsed}
                    </span>
                  )}
                </div>

                {state?.message && (
                  <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                    {state.message}
                  </p>
                )}

                {/* 데이터 칩 */}
                {status === 'done' && state?.data && <DataChips data={state.data} />}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function DataChips({ data }: { data: Record<string, unknown> }) {
  const chips: string[] = []

  if (typeof data.count === 'number')          chips.push(`${data.count}건 검색`)
  if (typeof data.eligible_count === 'number') chips.push(`자격 ${data.eligible_count}건`)
  if (typeof data.guide_count === 'number')    chips.push(`가이드 ${data.guide_count}건`)
  if (typeof data.success === 'number')        chips.push(`취득 ${data.success}건`)
  if (typeof data.passed === 'boolean')        chips.push(data.passed ? '검증 통과' : '재검토')
  if (Array.isArray(data.keywords) && (data.keywords as string[]).length > 0) {
    ;(data.keywords as string[]).slice(0, 3).forEach((k) => chips.push(k))
  }
  if (Array.isArray(data.notifications))
    chips.push(`알림 ${(data.notifications as unknown[]).length}건`)

  if (chips.length === 0) return null

  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {chips.map((chip, i) => (
        <span
          key={i}
          className="inline-flex rounded-full bg-white border border-border px-1.5 py-0.5 text-[10px] text-foreground"
        >
          {chip}
        </span>
      ))}
    </div>
  )
}
