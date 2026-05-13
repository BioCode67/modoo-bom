import { Card, CardContent } from '@/components/ui/card'
import type { EligiblePolicy, ApplicationGuide } from '@/types'
import { ChevronDown, ChevronUp, Clock, Banknote, Building2, MapPin, ExternalLink } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/utils'

const PRIORITY_CONFIG = {
  high:   { label: '높음', bar: 'bg-red-500',   badge: 'bg-red-50 text-red-600 border-red-200',   border: 'border-l-red-500' },
  medium: { label: '보통', bar: 'bg-amber-500',  badge: 'bg-amber-50 text-amber-600 border-amber-200', border: 'border-l-amber-500' },
  low:    { label: '낮음', bar: 'bg-emerald-500', badge: 'bg-emerald-50 text-emerald-600 border-emerald-200', border: 'border-l-emerald-500' },
}

interface Props {
  policies: EligiblePolicy[]
  guides: ApplicationGuide[]
}

export function PolicyList({ policies, guides }: Props) {
  const eligible = policies.filter((p) => p.eligible)
  const guideMap = Object.fromEntries(guides.map((g) => [g.policy_id, g]))
  const [expandedId, setExpandedId] = useState<string | null>(null)

  if (eligible.length === 0) return (
    <Card className="border-dashed">
      <CardContent className="py-16 text-center text-muted-foreground text-sm">
        자격 있는 정책이 없습니다.
      </CardContent>
    </Card>
  )

  const sorted = [...eligible].sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 }
    return (order[a.priority ?? 'low'] - order[b.priority ?? 'low']) || ((b.confidence ?? 0) - (a.confidence ?? 0))
  })

  return (
    <div className="space-y-3">
      {sorted.map((policy) => {
        const guide = guideMap[policy.id]
        const expanded = expandedId === policy.id
        const cfg = PRIORITY_CONFIG[policy.priority ?? 'low']
        const pct = Math.round((policy.confidence ?? 0) * 100)

        return (
          <Card
            key={policy.id}
            className={cn(
              'border-l-4 overflow-hidden transition-all duration-200',
              cfg.border,
              expanded ? 'shadow-md' : 'shadow-sm hover:shadow-md hover:-translate-y-0.5',
            )}
          >
            <CardContent className="p-4">
              {/* 헤더 */}
              <div className="flex items-start gap-3 mb-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <h3 className="font-semibold text-base leading-tight">{policy.name}</h3>
                    <span className={cn('text-[11px] font-semibold rounded-full border px-2 py-0.5', cfg.badge)}>
                      우선순위 {cfg.label}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed">{policy.reason}</p>
                </div>
                {/* 확신도 */}
                <div className="text-right shrink-0">
                  <p className="text-lg font-bold text-foreground">{pct}%</p>
                  <p className="text-[10px] text-muted-foreground">자격 확신도</p>
                </div>
              </div>

              {/* 확신도 바 */}
              <div className="h-1 w-full rounded-full bg-muted mb-3">
                <div
                  className={cn('h-1 rounded-full transition-all duration-700', cfg.bar)}
                  style={{ width: `${pct}%` }}
                />
              </div>

              {/* 메타 정보 */}
              <div className="flex flex-wrap gap-3 mb-3">
                {policy.benefit && (
                  <div className="flex items-center gap-1.5 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2.5 py-1">
                    <Banknote className="h-3 w-3" />
                    {policy.benefit}
                  </div>
                )}
                {policy.department && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Building2 className="h-3 w-3" />
                    {policy.department}
                  </div>
                )}
                {policy.category && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <MapPin className="h-3 w-3" />
                    {policy.category}
                  </div>
                )}
              </div>

              {/* 가이드 토글 */}
              <button
                onClick={() => setExpandedId(expanded ? null : policy.id)}
                className={cn(
                  'flex w-full items-center justify-between rounded-xl px-3 py-2 text-xs font-medium transition-colors',
                  expanded ? 'bg-primary/5 text-primary' : 'bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <span>{expanded ? '신청 가이드 접기' : '신청 방법 상세 보기'}</span>
                {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </button>

              {/* 확장 가이드 */}
              {expanded && guide && (
                <div className="mt-3 space-y-3 animate-fade-in">
                  <div className="rounded-xl bg-muted/40 p-3">
                    <p className="text-sm leading-relaxed text-foreground">{guide.plain_description}</p>
                  </div>

                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">신청 단계</p>
                    {guide.steps.map((step, i) => (
                      <div key={i} className="flex gap-3">
                        <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-[10px] font-bold mt-0.5">
                          {i + 1}
                        </div>
                        <p className="text-sm text-foreground/80 leading-relaxed">{step}</p>
                      </div>
                    ))}
                  </div>

                  {guide.tips && (
                    <div className="flex gap-2 rounded-xl bg-amber-50 border border-amber-100 px-3 py-2.5">
                      <span className="text-sm shrink-0">💡</span>
                      <p className="text-xs text-amber-800 leading-relaxed">{guide.tips}</p>
                    </div>
                  )}

                  <div className="flex flex-wrap gap-3">
                    {guide.estimated_days && (
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Clock className="h-3.5 w-3.5" />
                        처리 기간 약 {guide.estimated_days}일
                      </div>
                    )}
                    </div>

                  {/* 신청 버튼 */}
                  <div className="flex gap-2 pt-1">
                    <a
                      href="https://www.bokjiro.go.kr/ssis-tbu/twataa/wlfareInfo/moveTWAT52011M.do"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-primary text-primary-foreground py-2.5 text-xs font-semibold hover:bg-primary/90 transition-colors shadow-sm shadow-primary/20"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      복지로에서 신청하기
                    </a>
                    <a
                      href="tel:129"
                      className="flex items-center justify-center gap-1.5 rounded-xl border border-border px-4 py-2.5 text-xs font-semibold hover:bg-muted/50 transition-colors"
                    >
                      ☎ 129 상담
                    </a>
                  </div>
                </div>
              )}

              {expanded && !guide && (
                <div className="mt-3 space-y-3 animate-fade-in">
                  <div className="rounded-xl bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
                    신청 가이드 정보가 준비 중입니다.
                    {policy.application && <span className="ml-1 text-primary">{policy.application}</span>}
                  </div>
                  <div className="flex gap-2">
                    <a
                      href="https://www.bokjiro.go.kr/ssis-tbu/twataa/wlfareInfo/moveTWAT52011M.do"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-primary text-primary-foreground py-2.5 text-xs font-semibold hover:bg-primary/90 transition-colors"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      복지로에서 신청하기
                    </a>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
