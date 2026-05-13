import { cn } from '@/lib/utils'
import { Progress } from '@/components/ui/progress'
import { NODE_ORDER, NODE_LABELS } from '@/types'
import type { NodeState } from '@/hooks/useAgentWebSocket'
import {
  CheckCircle2, Loader2, XCircle,
  Brain, Search, ShieldCheck, RefreshCw,
  BookOpen, FileText, BarChart3, Bell, ClipboardList, Cpu, Circle,
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

interface Props {
  nodeStates: Record<string, NodeState>
  progress: number
  doneCount: number
}

function elapsedLabel(state: NodeState): string | null {
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
    <div className="space-y-5">
      {/* 진행률 헤더 */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-semibold">에이전트 진행 상태</span>
          <span className="text-sm font-bold text-primary tabular-nums">
            {doneCount} <span className="text-muted-foreground font-normal">/ {NODE_ORDER.length}</span>
          </span>
        </div>
        <Progress value={progress} className="h-2 rounded-full" />
      </div>

      {/* 노드 리스트 */}
      <div className="space-y-1.5">
        {NODE_ORDER.map((nodeKey, idx) => {
          const state = nodeStates[nodeKey]
          const status = state?.status ?? 'pending'
          const Icon = NODE_ICONS[nodeKey] ?? Circle
          const elapsed = state ? elapsedLabel(state) : null

          return (
            <div
              key={nodeKey}
              className={cn(
                'flex items-center gap-3 rounded-xl px-3 py-2.5 transition-all duration-300',
                status === 'running' && 'bg-blue-50 border border-blue-200 node-running',
                status === 'done'    && 'bg-emerald-50/60 border border-emerald-100',
                status === 'error'   && 'bg-red-50 border border-red-200',
                status === 'pending' && 'bg-muted/30 border border-transparent opacity-50',
              )}
            >
              {/* 상태 아이콘 */}
              <div className="shrink-0 w-5 flex items-center justify-center">
                {status === 'running' && <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />}
                {status === 'done'    && <CheckCircle2 className="h-4 w-4 text-emerald-600" />}
                {status === 'error'   && <XCircle className="h-4 w-4 text-red-500" />}
                {status === 'pending' && (
                  <span className="text-[10px] font-bold text-muted-foreground/50">{idx + 1}</span>
                )}
              </div>

              {/* 노드 아이콘 */}
              <div className={cn(
                'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg',
                status === 'running' ? 'bg-blue-100' : status === 'done' ? 'bg-emerald-100' : status === 'error' ? 'bg-red-100' : 'bg-muted',
              )}>
                <Icon className={cn(
                  'h-3.5 w-3.5',
                  status === 'running' ? 'text-blue-600' : status === 'done' ? 'text-emerald-600' : status === 'error' ? 'text-red-600' : 'text-muted-foreground/40',
                )} />
              </div>

              {/* 본문 */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className={cn(
                    'text-xs font-semibold truncate',
                    status === 'running' ? 'text-blue-700' : status === 'done' ? 'text-emerald-700' : status === 'error' ? 'text-red-700' : 'text-muted-foreground/50',
                  )}>
                    {NODE_LABELS[nodeKey] ?? nodeKey}
                  </span>
                  {elapsed && (
                    <span className={cn(
                      'shrink-0 text-[10px] font-mono rounded-full px-1.5 py-0.5',
                      status === 'running' ? 'bg-blue-100 text-blue-600' : 'bg-muted text-muted-foreground',
                    )}>
                      {elapsed}
                    </span>
                  )}
                </div>
                {state?.message && status !== 'pending' && (
                  <p className="text-[11px] text-muted-foreground mt-0.5 leading-tight truncate">
                    {state.message}
                  </p>
                )}
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
  if (typeof data.failed === 'number' && data.failed > 0) chips.push(`수동 ${data.failed}건`)
  if (typeof data.total === 'number')          chips.push(`총 ${data.total}건`)
  if (typeof data.high === 'number')           chips.push(`우선高 ${data.high}건`)
  if (typeof data.passed === 'boolean')        chips.push(data.passed ? '✓ 검증 통과' : '재검토')
  if (Array.isArray(data.keywords) && (data.keywords as string[]).length > 0) {
    ;(data.keywords as string[]).slice(0, 2).forEach((k) => chips.push(k))
  }
  if (Array.isArray(data.notifications))
    chips.push(`알림 ${(data.notifications as unknown[]).length}건`)

  if (chips.length === 0) return null

  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {chips.map((chip, i) => (
        <span key={i} className="inline-flex rounded-full bg-white/80 border border-border/60 px-1.5 py-0.5 text-[10px] text-foreground/60 font-medium">
          {chip}
        </span>
      ))}
    </div>
  )
}
