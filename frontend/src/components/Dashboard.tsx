import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import type { AnalysisResult } from '@/types'
import { PolicyList } from './PolicyList'
import { DocumentList } from './DocumentList'
import { RpaDocumentPanel } from './RpaDocumentPanel'
import { Bell, ClipboardList, BarChart3, CheckCircle2, AlertCircle, RefreshCcw } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/utils'

type Tab = 'portfolio' | 'policies' | 'docs' | 'tracker' | 'notifications'

const TABS: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'portfolio', label: '포트폴리오', icon: BarChart3 },
  { id: 'policies', label: '수혜 정책', icon: CheckCircle2 },
  { id: 'docs', label: '서류 취득', icon: ClipboardList },
  { id: 'tracker', label: '신청 추적', icon: RefreshCcw },
  { id: 'notifications', label: '알림', icon: Bell },
]

const STATUS_COLORS: Record<string, string> = {
  '신청 완료': 'bg-blue-100 text-blue-700',
  '검토 중': 'bg-yellow-100 text-yellow-700',
  '추가 서류 요청': 'bg-orange-100 text-orange-700',
  '승인': 'bg-green-100 text-green-700',
  '거절': 'bg-red-100 text-red-700',
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

  return (
    <div className="space-y-5">
      {/* 헤더 요약 */}
      <Card className="bg-gradient-to-r from-blue-600 to-blue-500 text-white border-0">
        <CardContent className="py-5 px-6">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-blue-100 text-sm">{userName}님 분석 완료 ✓</p>
              <h2 className="text-2xl font-bold mt-0.5">
                수혜 가능 정책 <span className="text-yellow-300">{eligibleCount}건</span>
              </h2>
              {profileSummary && <p className="text-blue-100 text-sm mt-2 max-w-md">{profileSummary}</p>}
            </div>
            <button onClick={onReset} className="text-blue-200 hover:text-white text-sm flex items-center gap-1 mt-1">
              <RefreshCcw className="h-4 w-4" /> 새 분석
            </button>
          </div>

          {/* 핵심 지표 */}
          <div className="grid grid-cols-4 gap-3 mt-5">
            {[
              { label: '수혜 가능', value: eligibleCount, unit: '건' },
              { label: '우선순위 高', value: portfolio_summary?.high_priority_count ?? 0, unit: '건' },
              { label: '서류 취득', value: retrieved_docs.filter((d) => d.success).length, unit: '건' },
              { label: '알림', value: notifications.length, unit: '건' },
            ].map((stat) => (
              <div key={stat.label} className="rounded-lg bg-white/20 p-3 text-center">
                <p className="text-xl font-bold">{stat.value}<span className="text-sm font-normal ml-0.5">{stat.unit}</span></p>
                <p className="text-xs text-blue-100 mt-0.5">{stat.label}</p>
              </div>
            ))}
          </div>
          {(portfolio_summary?.total_benefit_amount ?? 0) > 0 && (
            <div className="mt-3 rounded-lg bg-white/15 px-4 py-2.5 flex items-center justify-between">
              <span className="text-blue-100 text-sm">예상 월 수혜 금액</span>
              <span className="text-white font-bold text-lg">
                최대 {portfolio_summary.total_benefit_amount.toLocaleString()}원<span className="text-blue-200 text-sm font-normal">/월</span>
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* AI 최종 안내 */}
      {final_response && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">AI 안내 메시지</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="prose prose-sm max-w-none text-sm text-foreground whitespace-pre-wrap">
              {final_response}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 탭 네비게이션 */}
      <div className="flex gap-1 border-b">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={cn(
              'flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors',
              activeTab === id
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
            {id === 'policies' && eligibleCount > 0 && (
              <Badge variant="default" className="ml-1 text-[10px] py-0 px-1.5">{eligibleCount}</Badge>
            )}
            {id === 'notifications' && notifications.length > 0 && (
              <Badge variant="destructive" className="ml-1 text-[10px] py-0 px-1.5">{notifications.length}</Badge>
            )}
          </button>
        ))}
      </div>

      {/* 탭 콘텐츠 */}
      <div>
        {activeTab === 'portfolio' && <PortfolioTab summary={portfolio_summary} />}
        {activeTab === 'policies' && <PolicyList policies={eligible_policies} guides={application_guides} />}
        {activeTab === 'docs' && (
          <div className="space-y-6">
            <DocumentList docs={retrieved_docs} />
            <RpaDocumentPanel userName={userName} />
          </div>
        )}
        {activeTab === 'tracker' && <TrackerTab applications={tracked_applications} />}
        {activeTab === 'notifications' && <NotificationsTab notifications={notifications} />}
      </div>
    </div>
  )
}

function PortfolioTab({ summary }: { summary: AnalysisResult['portfolio_summary'] }) {
  if (!summary) return <p className="text-muted-foreground text-sm">포트폴리오 데이터 없음</p>

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: '우선순위 높음', value: summary.high_priority_count, color: 'text-red-600 bg-red-50 border-red-200' },
          { label: '우선순위 보통', value: summary.medium_priority_count, color: 'text-yellow-600 bg-yellow-50 border-yellow-200' },
          { label: '우선순위 낮음', value: summary.low_priority_count, color: 'text-green-600 bg-green-50 border-green-200' },
        ].map((s) => (
          <div key={s.label} className={`rounded-xl border p-4 text-center ${s.color}`}>
            <p className="text-2xl font-bold">{s.value}</p>
            <p className="text-xs mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {summary.categories?.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {summary.categories.map((cat) => (
            <span key={cat} className="inline-flex rounded-full bg-blue-100 text-blue-700 border border-blue-200 px-2.5 py-0.5 text-xs font-medium">
              {cat}
            </span>
          ))}
        </div>
      )}

      {summary.high_priority_policies?.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">우선 신청 추천 정책</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {summary.high_priority_policies.map((p) => (
              <div key={p.id} className="flex gap-2 text-sm">
                <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5 shrink-0" />
                <div>
                  <span className="font-medium">{p.name}</span>
                  <p className="text-muted-foreground text-xs">{p.reason}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {summary.all_eligible_names?.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">전체 수혜 가능 목록</CardTitle></CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-1.5">
              {summary.all_eligible_names.map((name) => (
                <span key={name} className="inline-flex rounded-full bg-green-50 border border-green-200 text-green-800 px-2 py-0.5 text-[11px]">
                  {name}
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function TrackerTab({ applications }: { applications: AnalysisResult['tracked_applications'] }) {
  if (applications.length === 0) return (
    <Card><CardContent className="py-12 text-center text-muted-foreground">추적 중인 신청이 없습니다.</CardContent></Card>
  )

  return (
    <div className="space-y-3">
      {applications.map((app) => (
        <Card key={app.policy_id}>
          <CardContent className="py-4">
            <div className="flex items-center justify-between mb-2">
              <span className="font-medium text-sm">{app.policy_name}</span>
              <span className={`text-xs font-semibold rounded-full px-2.5 py-0.5 ${STATUS_COLORS[app.application_status] ?? 'bg-gray-100 text-gray-700'}`}>
                {app.application_status}
              </span>
            </div>
            <div className="text-xs text-muted-foreground space-y-0.5">
              <p>신청일: {app.applied_at} · 최종 업데이트: {app.last_updated}</p>
              {app.rejection_reason && (
                <div className="mt-2 rounded-lg bg-red-50 border border-red-200 p-2">
                  <p className="text-red-700 font-medium flex items-center gap-1">
                    <AlertCircle className="h-3.5 w-3.5" /> 거절 사유: {app.rejection_reason}
                  </p>
                  {app.alternative && <p className="text-red-600 mt-1">{app.alternative}</p>}
                </div>
              )}
              {app.required_additional_docs && (
                <div className="mt-2 rounded-lg bg-orange-50 border border-orange-200 p-2">
                  <p className="text-orange-700 font-medium">추가 서류 필요:</p>
                  <ul className="list-disc list-inside text-orange-600 mt-0.5">
                    {app.required_additional_docs.map((d) => <li key={d}>{d}</li>)}
                  </ul>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

function NotificationsTab({ notifications }: { notifications: AnalysisResult['notifications'] }) {
  if (notifications.length === 0) return (
    <Card><CardContent className="py-12 text-center text-muted-foreground">새로운 알림이 없습니다.</CardContent></Card>
  )

  const urgencyColors = { high: 'border-red-300 bg-red-50', medium: 'border-yellow-300 bg-yellow-50', low: 'border-blue-200 bg-blue-50' }
  const urgencyLabels = { high: '긴급', medium: '중요', low: '일반' }
  const urgencyBadge = { high: 'bg-red-100 text-red-700', medium: 'bg-yellow-100 text-yellow-700', low: 'bg-blue-100 text-blue-700' }

  return (
    <div className="space-y-3">
      {notifications.map((n, i) => (
        <div key={i} className={`rounded-xl border p-4 ${urgencyColors[n.urgency] ?? ''}`}>
          <div className="flex items-start gap-3">
            <Bell className="h-4 w-4 mt-0.5 text-foreground shrink-0" />
            <div className="flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-sm font-medium">{n.title}</p>
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${urgencyBadge[n.urgency] ?? ''}`}>
                  {urgencyLabels[n.urgency] ?? n.urgency}
                </span>
              </div>
              {n.trigger && (
                <p className="text-xs text-muted-foreground mt-0.5">트리거: {n.trigger}</p>
              )}
              <div className="flex flex-wrap gap-1 mt-2">
                {n.recommended_policies.map((p) => (
                  <span key={p} className="inline-flex rounded-full bg-white border border-border px-2 py-0.5 text-[11px]">{p}</span>
                ))}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
