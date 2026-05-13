import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { EligiblePolicy, ApplicationGuide } from '@/types'
import { ShieldCheck, ChevronDown, ChevronUp, Clock, Banknote, Building2 } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/utils'

const PRIORITY_LABELS = { high: '높음', medium: '보통', low: '낮음' } as const
const PRIORITY_VARIANTS = { high: 'default', medium: 'warning', low: 'secondary' } as const

interface Props {
  policies: EligiblePolicy[]
  guides: ApplicationGuide[]
}

export function PolicyList({ policies, guides }: Props) {
  const eligible = policies.filter((p) => p.eligible)
  const guideMap = Object.fromEntries(guides.map((g) => [g.policy_id, g]))
  const [expandedId, setExpandedId] = useState<string | null>(null)

  if (eligible.length === 0) return (
    <Card>
      <CardContent className="py-12 text-center text-muted-foreground">자격 있는 정책이 없습니다.</CardContent>
    </Card>
  )

  return (
    <div className="space-y-3">
      {eligible
        .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))
        .map((policy) => {
          const guide = guideMap[policy.id]
          const expanded = expandedId === policy.id
          return (
            <Card key={policy.id} className={cn('transition-all', expanded && 'ring-2 ring-primary/30')}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <ShieldCheck className="h-4 w-4 text-green-600 shrink-0" />
                    <CardTitle className="text-base">{policy.name}</CardTitle>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant={PRIORITY_VARIANTS[policy.priority ?? 'low'] as 'default' | 'warning' | 'secondary'}>
                      우선순위: {PRIORITY_LABELS[policy.priority ?? 'low']}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      확신도 {Math.round((policy.confidence ?? 0) * 100)}%
                    </span>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground mt-1">{policy.reason}</p>
                <div className="flex flex-wrap gap-3 mt-2">
                  {policy.benefit && (
                    <div className="flex items-center gap-1 text-xs text-green-700">
                      <Banknote className="h-3.5 w-3.5" />
                      {policy.benefit}
                    </div>
                  )}
                  {policy.department && (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Building2 className="h-3.5 w-3.5" />
                      {policy.department}
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent className="pb-3">
                <button
                  onClick={() => setExpandedId(expanded ? null : policy.id)}
                  className="flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  {expanded ? '신청 가이드 접기' : '신청 가이드 보기'}
                </button>

                {expanded && guide && (
                  <div className="mt-3 space-y-3 border-t pt-3">
                    <p className="text-sm text-foreground">{guide.plain_description}</p>
                    <ol className="space-y-1.5">
                      {guide.steps.map((step, i) => (
                        <li key={i} className="flex gap-2 text-sm">
                          <span className="shrink-0 font-bold text-primary">{i + 1}.</span>
                          <span>{step}</span>
                        </li>
                      ))}
                    </ol>
                    {guide.tips && (
                      <div className="rounded-lg bg-yellow-50 border border-yellow-200 px-3 py-2 text-xs text-yellow-800">
                        💡 {guide.tips}
                      </div>
                    )}
                    {guide.estimated_days && (
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Clock className="h-3.5 w-3.5" />
                        예상 처리 기간: 약 {guide.estimated_days}일
                      </div>
                    )}
                    {policy.application && (
                      <div className="rounded-lg bg-blue-50 border border-blue-200 px-3 py-2 text-xs text-blue-800">
                        🏛️ 신청 방법: {policy.application}
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          )
        })}
    </div>
  )
}
