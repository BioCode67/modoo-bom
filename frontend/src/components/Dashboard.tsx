import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import type { AnalysisResult } from '@/types'
import { PolicyList } from './PolicyList'
import { DocumentList } from './DocumentList'
import { RpaDocumentPanel } from './RpaDocumentPanel'
import {
  Bell, ClipboardList, BarChart3, CheckCircle2, AlertCircle,
  RefreshCcw, Sparkles, TrendingUp, FileCheck, Zap, Calculator,
} from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/utils'
import { WelfareCalculator } from './WelfareCalculator'
import { LocalOfficeInfo } from './LocalOfficeInfo'
import { ApplyPanel } from './ApplyPanel'
import { MapPin, Send } from 'lucide-react'

type Tab = 'portfolio' | 'policies' | 'docs' | 'apply' | 'calculator' | 'local' | 'tracker' | 'notifications'

const TABS: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'portfolio', label: '포트폴리오', icon: BarChart3 },
  { id: 'policies', label: '수혜 정책', icon: CheckCircle2 },
  { id: 'docs', label: '서류 취득', icon: ClipboardList },
  { id: 'apply', label: '신청 자동화', icon: Send },
  { id: 'calculator', label: '계산기', icon: Calculator },
  { id: 'local', label: '복지시설', icon: MapPin },
  { id: 'tracker', label: '신청 추적', icon: RefreshCcw },
  { id: 'notifications', label: '알림', icon: Bell },
]

const STATUS_CONFIG: Record<string, { bg: string; text: string; dot: string }> = {
  '신청 완료': { bg: 'bg-blue-50', text: 'text-blue-700', dot: 'bg-blue-400' },
  '검토 중':   { bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-400' },
  '추가 서류 요청': { bg: 'bg-orange-50', text: 'text-orange-700', dot: 'bg-orange-400' },
  '승인':      { bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-400' },
  '거절':      { bg: 'bg-red-50', text: 'text-red-700', dot: 'bg-red-400' },
}

interface Props {
  result: AnalysisResult
  profileSummary?: string
  userName?: string
  onReset: () => void
}

export function Dashboard({ result, profileSummary, userName = '사용자', onReset }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('portfolio')
  const { eligible_policies, application_guides, retrieved_docs, portfolio_summary, notifications, tracked_applications, final_response } = result
  const eligibleCount = eligible_policies.filter((p) => p.eligible).length
  const docsOk = retrieved_docs.filter((d) => d.success).length

  return (
    <div className="space-y-6 animate-fade-in">
      {/* ── 히어로 헤더 ── */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-blue-600 via-blue-600 to-indigo-700 text-white shadow-lg shadow-blue-500/20">
        {/* 배경 장식 */}
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -right-8 -top-8 h-48 w-48 rounded-full bg-white/5" />
          <div className="absolute -bottom-12 -left-4 h-40 w-40 rounded-full bg-indigo-500/30" />
        </div>

        <div className="relative px-6 pt-6 pb-5">
          {/* 상단 바 */}
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/20">
                <Sparkles className="h-4 w-4" />
              </div>
              <div>
                <p className="text-blue-200 text-xs font-medium tracking-wide uppercase">분석 완료</p>
                <p className="text-white text-sm font-semibold">{userName}님</p>
              </div>
            </div>
            <button
              onClick={onReset}
              className="flex items-center gap-1.5 rounded-full bg-white/15 hover:bg-white/25 px-3 py-1.5 text-xs font-medium transition-colors"
            >
              <RefreshCcw className="h-3.5 w-3.5" />
              새 분석
            </button>
          </div>

          {/* 메인 타이틀 */}
          <div className="mb-5">
            <h2 className="text-3xl font-bold tracking-tight">
              수혜 가능 정책{' '}
              <span className="text-yellow-300">{eligibleCount}건</span>
            </h2>
            {profileSummary && (
              <p className="mt-1.5 text-blue-100 text-sm leading-relaxed max-w-lg opacity-90">
                {profileSummary}
              </p>
            )}
          </div>

          {/* 핵심 지표 4개 */}
          <div className="grid grid-cols-4 gap-2.5">
            {[
              { label: '수혜 가능', value: eligibleCount, icon: CheckCircle2, color: 'text-green-300' },
              { label: '우선순위 高', value: portfolio_summary?.high_priority_count ?? 0, icon: TrendingUp, color: 'text-yellow-300' },
              { label: '서류 취득', value: docsOk, icon: FileCheck, color: 'text-blue-300' },
              { label: '생애 알림', value: notifications.length, icon: Bell, color: 'text-purple-300' },
            ].map(({ label, value, icon: Icon, color }) => (
              <div key={label} className="rounded-xl bg-white/10 backdrop-blur-sm p-3 text-center">
                <Icon className={cn('h-4 w-4 mx-auto mb-1', color)} />
                <p className="text-xl font-bold leading-none">{value}</p>
                <p className="text-[11px] text-blue-200 mt-1 leading-tight">{label}</p>
              </div>
            ))}
          </div>

          {/* 월 수혜 금액 */}
          {(portfolio_summary?.total_benefit_amount ?? 0) > 0 && (
            <div className="mt-4 flex items-center justify-between rounded-xl bg-white/10 backdrop-blur-sm px-4 py-3">
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-yellow-300" />
                <span className="text-blue-100 text-sm">예상 월 수혜 금액</span>
              </div>
              <span className="text-white font-bold text-lg">
                최대 {portfolio_summary.total_benefit_amount.toLocaleString()}원
                <span className="text-blue-300 text-sm font-normal ml-1">/월</span>
              </span>
            </div>
          )}
        </div>
      </div>

      {/* AI 최종 안내 */}
      {final_response && (
        <Card className="border-blue-100 bg-gradient-to-br from-blue-50/50 to-transparent">
          <CardHeader className="pb-2 pt-4">
            <div className="flex items-center gap-2">
              <div className="h-5 w-5 rounded-full bg-blue-600 flex items-center justify-center">
                <Sparkles className="h-3 w-3 text-white" />
              </div>
              <CardTitle className="text-sm font-semibold text-blue-900">AI 맞춤 안내</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="pb-4">
            <div className="text-sm text-foreground/80 leading-relaxed whitespace-pre-wrap">
              {final_response}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 탭 네비게이션 — 스크롤 가능 */}
      <div className="overflow-x-auto -mx-0 pb-1">
        <div className="flex gap-1 rounded-xl bg-muted/60 p-1 min-w-max sm:min-w-0">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={cn(
                'flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-all duration-200 whitespace-nowrap',
                activeTab === id
                  ? 'bg-white shadow-sm text-primary'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span>{label}</span>
              {id === 'policies' && eligibleCount > 0 && (
                <span className="rounded-full bg-primary text-primary-foreground text-[9px] font-bold px-1.5 py-0.5 leading-none">
                  {eligibleCount}
                </span>
              )}
              {id === 'notifications' && notifications.length > 0 && (
                <span className="rounded-full bg-destructive text-destructive-foreground text-[9px] font-bold px-1.5 py-0.5 leading-none">
                  {notifications.length}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* 탭 콘텐츠 */}
      <div className="animate-fade-in" key={activeTab}>
        {activeTab === 'portfolio' && <PortfolioTab summary={portfolio_summary} />}
        {activeTab === 'policies' && <PolicyList policies={eligible_policies} guides={application_guides} />}
        {activeTab === 'docs' && (
          <div className="space-y-6">
            <DocumentList docs={retrieved_docs} />
            <RpaDocumentPanel userName={userName} />
          </div>
        )}
        {activeTab === 'apply' && <ApplyPanel policies={eligible_policies} userName={userName} />}
        {activeTab === 'calculator' && <WelfareCalculator />}
        {activeTab === 'local' && <LocalOfficeInfo />}
        {activeTab === 'tracker' && <TrackerTab applications={tracked_applications} />}
        {activeTab === 'notifications' && <NotificationsTab notifications={notifications} />}
      </div>
    </div>
  )
}

function PortfolioTab({ summary }: { summary: AnalysisResult['portfolio_summary'] }) {
  if (!summary) return (
    <div className="py-16 text-center text-muted-foreground text-sm">포트폴리오 데이터 없음</div>
  )

  const total = summary.high_priority_count + summary.medium_priority_count + summary.low_priority_count || 1

  return (
    <div className="space-y-4">
      {/* 우선순위 분포 */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: '높음', value: summary.high_priority_count, barColor: 'bg-red-400', cardColor: 'border-red-100 bg-red-50', textColor: 'text-red-600', pct: Math.round((summary.high_priority_count / total) * 100) },
          { label: '보통', value: summary.medium_priority_count, barColor: 'bg-amber-400', cardColor: 'border-amber-100 bg-amber-50', textColor: 'text-amber-600', pct: Math.round((summary.medium_priority_count / total) * 100) },
          { label: '낮음', value: summary.low_priority_count, barColor: 'bg-emerald-400', cardColor: 'border-emerald-100 bg-emerald-50', textColor: 'text-emerald-600', pct: Math.round((summary.low_priority_count / total) * 100) },
        ].map((s) => (
          <div key={s.label} className={`rounded-2xl border p-4 ${s.cardColor}`}>
            <div className="flex items-end justify-between mb-2">
              <p className={`text-3xl font-bold ${s.textColor}`}>{s.value}</p>
              <p className={`text-xs font-medium ${s.textColor} opacity-70`}>{s.pct}%</p>
            </div>
            <div className="h-1.5 rounded-full bg-black/10 mb-2">
              <div className={`h-1.5 rounded-full ${s.barColor} transition-all duration-700`} style={{ width: `${s.pct}%` }} />
            </div>
            <p className={`text-xs font-medium ${s.textColor}`}>우선순위 {s.label}</p>
          </div>
        ))}
      </div>

      {/* 카테고리 태그 */}
      {summary.categories?.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">관련 분야</p>
          <div className="flex flex-wrap gap-1.5">
            {summary.categories.map((cat) => (
              <span key={cat} className="inline-flex items-center rounded-full bg-blue-600/10 text-blue-700 border border-blue-200/60 px-3 py-1 text-xs font-medium">
                {cat}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 우선 신청 추천 */}
      {summary.high_priority_policies?.length > 0 && (
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-red-500" />
              <CardTitle className="text-sm">지금 바로 신청하세요</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            {summary.high_priority_policies.map((p, i) => (
              <div key={p.id} className="flex gap-3">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-600 text-xs font-bold mt-0.5">
                  {i + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground">{p.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{p.reason}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* 전체 수혜 가능 목록 */}
      {summary.all_eligible_names?.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">전체 수혜 가능 정책</p>
          <div className="flex flex-wrap gap-1.5">
            {summary.all_eligible_names.map((name) => (
              <span key={name} className="inline-flex rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 px-2.5 py-0.5 text-[11px] font-medium">
                ✓ {name}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function TrackerTab({ applications }: { applications: AnalysisResult['tracked_applications'] }) {
  if (applications.length === 0) return (
    <Card className="border-dashed">
      <CardContent className="py-16 text-center">
        <ClipboardList className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
        <p className="text-muted-foreground text-sm">추적 중인 신청이 없습니다.</p>
      </CardContent>
    </Card>
  )

  return (
    <div className="space-y-3">
      {applications.map((app) => {
        const cfg = STATUS_CONFIG[app.application_status]
        return (
          <Card key={app.policy_id} className="overflow-hidden border-0 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-3 mb-3">
                <p className="font-semibold text-sm leading-tight">{app.policy_name}</p>
                <span className={cn('flex items-center gap-1 shrink-0 text-xs font-semibold rounded-full px-2.5 py-1', cfg?.bg ?? 'bg-gray-100', cfg?.text ?? 'text-gray-700')}>
                  <span className={cn('h-1.5 w-1.5 rounded-full', cfg?.dot ?? 'bg-gray-400')} />
                  {app.application_status}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mb-2">
                신청일 {app.applied_at} · 업데이트 {app.last_updated}
              </p>
              {app.rejection_reason && (
                <div className="mt-2 rounded-xl bg-red-50 border border-red-100 p-3">
                  <p className="text-red-700 font-semibold text-xs flex items-center gap-1.5 mb-1">
                    <AlertCircle className="h-3.5 w-3.5" /> 거절 사유
                  </p>
                  <p className="text-red-600 text-xs">{app.rejection_reason}</p>
                  {app.alternative && (
                    <p className="text-red-500 text-xs mt-1.5 pt-1.5 border-t border-red-100">
                      💡 {app.alternative}
                    </p>
                  )}
                </div>
              )}
              {app.required_additional_docs && (
                <div className="mt-2 rounded-xl bg-orange-50 border border-orange-100 p-3">
                  <p className="text-orange-700 font-semibold text-xs mb-1.5">추가 서류 요청</p>
                  <div className="flex flex-wrap gap-1">
                    {app.required_additional_docs.map((d) => (
                      <span key={d} className="rounded-full bg-orange-100 text-orange-700 text-[11px] px-2 py-0.5">{d}</span>
                    ))}
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

function NotificationsTab({ notifications }: { notifications: AnalysisResult['notifications'] }) {
  if (notifications.length === 0) return (
    <Card className="border-dashed">
      <CardContent className="py-16 text-center">
        <Bell className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
        <p className="text-muted-foreground text-sm">새로운 알림이 없습니다.</p>
      </CardContent>
    </Card>
  )

  const URGENCY = {
    high:   { border: 'border-red-200',    bg: 'bg-red-50',    badge: 'bg-red-100 text-red-700',    label: '긴급', dot: 'bg-red-400' },
    medium: { border: 'border-amber-200',  bg: 'bg-amber-50',  badge: 'bg-amber-100 text-amber-700', label: '중요', dot: 'bg-amber-400' },
    low:    { border: 'border-blue-200',   bg: 'bg-blue-50',   badge: 'bg-blue-100 text-blue-700',   label: '일반', dot: 'bg-blue-400' },
  }

  return (
    <div className="space-y-3">
      {notifications.map((n, i) => {
        const u = URGENCY[n.urgency] ?? URGENCY.low
        return (
          <div key={i} className={cn('rounded-2xl border p-4', u.border, u.bg)}>
            <div className="flex items-start gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white shadow-sm">
                <Bell className="h-4 w-4 text-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-0.5">
                  <p className="text-sm font-semibold">{n.title}</p>
                  <span className={cn('flex items-center gap-1 text-[10px] font-bold rounded-full px-2 py-0.5', u.badge)}>
                    <span className={cn('h-1.5 w-1.5 rounded-full', u.dot)} />
                    {u.label}
                  </span>
                </div>
                {n.trigger && (
                  <p className="text-xs text-muted-foreground mb-1">이벤트: {n.trigger}</p>
                )}
                {(n as { deadline?: string }).deadline && (
                  <p className="text-xs text-amber-700 font-medium mb-1.5">
                    ⏰ {(n as { deadline?: string }).deadline}
                  </p>
                )}
                <div className="flex flex-wrap gap-1 mb-2">
                  {n.recommended_policies.map((p) => (
                    <span key={p} className="inline-flex rounded-full bg-white/80 border border-white text-foreground/70 px-2 py-0.5 text-[11px] font-medium shadow-sm">
                      {p}
                    </span>
                  ))}
                </div>
                {(n as { action?: string }).action && (
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    📋 {(n as { action?: string }).action}
                  </p>
                )}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
