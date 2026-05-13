import { useState } from 'react'
import { ProfileForm } from '@/components/ProfileForm'
import { NodeStatusPanel } from '@/components/NodeStatusPanel'
import { Dashboard } from '@/components/Dashboard'
import { ChatBot } from '@/components/ChatBot'
import { useAgentWebSocket } from '@/hooks/useAgentWebSocket'
import {
  Loader2, AlertCircle, Sprout, Terminal, ExternalLink,
  Sparkles, Shield, Clock, FileText, TrendingUp, Eye,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { DashboardSkeleton } from '@/components/DashboardSkeleton'
import type { UserProfile } from '@/types'
import { cn } from '@/lib/utils'

const FEATURES = [
  { icon: Sparkles, title: 'AI 맞춤 분석', desc: 'Claude 기반 LangGraph 10노드 에이전트가 수백 개 정책 중 적합한 혜택만 선별' },
  { icon: FileText, title: '서류 자동취득', desc: '정부24 · 건강보험공단 RPA로 필요 서류를 자동으로 발급·준비' },
  { icon: TrendingUp, title: '혜택 계산기', desc: '실제 수령 가능 금액을 월별로 산출, 우선순위 높은 정책부터 안내' },
  { icon: Shield, title: '개인정보 보호', desc: '분석 후 즉시 파기, 서버 저장 없는 로컬 처리 방식' },
]

export default function App() {
  const { phase, nodeStates, result, errorMsg, progress, doneCount, startAnalysis, reset } =
    useAgentWebSocket()
  const [submittedProfile, setSubmittedProfile] = useState<UserProfile | null>(null)
  const [elderlyMode, setElderlyMode] = useState(false)

  const handleSubmit = (profile: UserProfile) => {
    setSubmittedProfile(profile)
    startAnalysis(profile)
  }

  const handleReset = () => {
    reset()
    setSubmittedProfile(null)
  }

  return (
    <div className={cn('min-h-screen bg-gradient-to-b from-slate-50 via-white to-background', elderlyMode && 'elderly-mode')}>
      {/* ── 헤더 ── */}
      <header className="sticky top-0 z-30 bg-white/85 backdrop-blur-xl border-b border-border/40 shadow-sm">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-3">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center shadow-md shadow-blue-500/30">
              <Sprout className="h-4.5 w-4.5 text-white" />
            </div>
            <span className="font-extrabold text-base tracking-tight gradient-text select-none">모두봄</span>
          </div>
          <div className="h-4 w-px bg-border/60 mx-1" />
          <span className="hidden sm:block text-xs text-muted-foreground font-medium">
            개인 복지 자산 관리 AI Agent
          </span>
          <div className="ml-auto flex items-center gap-2">
            {phase === 'running' && (
              <div className="flex items-center gap-1.5 text-xs text-blue-600 font-semibold bg-blue-50 rounded-full px-3 py-1">
                <Loader2 className="h-3 w-3 animate-spin" />
                <span className="hidden sm:inline">분석 중 {progress}%</span>
                <span className="sm:hidden">{progress}%</span>
              </div>
            )}
            <button
              onClick={() => setElderlyMode(m => !m)}
              title={elderlyMode ? '일반 모드로 전환' : '큰 글씨 모드 (어르신용)'}
              className={cn(
                'flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-semibold border transition-all duration-200',
                elderlyMode
                  ? 'bg-amber-100 border-amber-300 text-amber-700'
                  : 'bg-muted/60 border-border/50 text-muted-foreground hover:bg-muted',
              )}
            >
              <Eye className="h-3.5 w-3.5" />
              {elderlyMode ? '큰글씨 ON' : '큰글씨'}
            </button>
            <span className="text-[10px] rounded-full bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-2.5 py-1 font-bold shadow-sm">
              Beta
            </span>
          </div>
        </div>
      </header>

      {/* ── 유휴: 랜딩 ── */}
      {phase === 'idle' && (
        <main>
          {/* 히어로 섹션 */}
          <section className="relative overflow-hidden">
            {/* 배경 그라디언트 */}
            <div className="absolute inset-0 bg-gradient-to-br from-blue-50 via-indigo-50/30 to-white pointer-events-none" />
            <div className="absolute -top-24 -right-24 h-96 w-96 rounded-full bg-blue-100/50 blur-3xl pointer-events-none" />
            <div className="absolute -bottom-12 -left-12 h-64 w-64 rounded-full bg-indigo-100/40 blur-3xl pointer-events-none" />

            <div className="relative max-w-6xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16 items-start">
                {/* 왼쪽: 텍스트 + 피처 */}
                <div className="space-y-8 animate-fade-in">
                  {/* 뱃지 */}
                  <div className="inline-flex items-center gap-2 rounded-full bg-blue-600/10 text-blue-700 px-4 py-1.5 text-xs font-semibold border border-blue-200/60">
                    <Sparkles className="h-3.5 w-3.5" />
                    AI 기반 복지 자산 매니저
                  </div>

                  {/* 타이틀 */}
                  <div className="space-y-4">
                    <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight leading-tight">
                      내가 받을 수 있는<br />
                      <span className="gradient-text">복지 혜택</span>을<br />
                      한 번에 찾아드립니다
                    </h1>
                    <p className="text-muted-foreground leading-relaxed max-w-md text-base">
                      프로필 입력 한 번으로 AI가 수백 개 복지 정책을 분석하고,
                      서류 취득부터 신청까지 도와드립니다.
                    </p>
                  </div>

                  {/* 핵심 지표 */}
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { value: '500+', label: '복지 정책', sub: '데이터베이스' },
                      { value: '10', label: 'AI 노드', sub: 'LangGraph' },
                      { value: '3분', label: '분석 시간', sub: '자동 서류 포함' },
                    ].map((s) => (
                      <div key={s.label} className="rounded-2xl bg-white border border-border/60 p-4 shadow-sm text-center">
                        <p className="text-2xl font-extrabold gradient-text">{s.value}</p>
                        <p className="text-xs font-semibold text-foreground mt-0.5">{s.label}</p>
                        <p className="text-[10px] text-muted-foreground">{s.sub}</p>
                      </div>
                    ))}
                  </div>

                  {/* 피처 리스트 */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {FEATURES.map(({ icon: Icon, title, desc }) => (
                      <div key={title} className="flex gap-3 rounded-2xl bg-white/80 border border-border/50 p-4 shadow-sm">
                        <div className="h-8 w-8 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                          <Icon className="h-4 w-4 text-primary" />
                        </div>
                        <div>
                          <p className="text-sm font-semibold">{title}</p>
                          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* 기술 스택 태그 */}
                  <div className="flex flex-wrap gap-1.5">
                    {['Claude AI', 'LangGraph', 'ChromaDB RAG', 'Playwright RPA', 'FastAPI', 'React 18'].map((tag) => (
                      <span key={tag} className="text-[11px] bg-muted/80 text-muted-foreground px-2.5 py-1 rounded-full border border-border/50 font-medium">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>

                {/* 오른쪽: 프로필 폼 */}
                <div className="lg:sticky lg:top-24 animate-slide-up">
                  <div className="mb-3">
                    <p className="text-sm font-semibold text-foreground">복지 분석 시작</p>
                    <p className="text-xs text-muted-foreground mt-0.5">약 2~3분 소요 · 개인정보 미저장</p>
                  </div>
                  <ProfileForm onSubmit={handleSubmit} />
                </div>
              </div>
            </div>
          </section>

          {/* 핵심 통계 섹션 */}
          <section className="py-10 border-t border-border/40 bg-gradient-to-r from-blue-600 to-indigo-700 text-white">
            <div className="max-w-6xl mx-auto px-4 sm:px-6">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 text-center">
                {[
                  { num: '60+', label: '복지 정책', desc: '2024년 기준 최신화' },
                  { num: '6종', label: '서류 자동취득', desc: '정부24·건보공단·고용24' },
                  { num: '10', label: 'AI 분석 노드', desc: 'LangGraph 파이프라인' },
                  { num: '129', label: '복지 상담', desc: '무료 전화 상담 가능' },
                ].map(({ num, label, desc }) => (
                  <div key={label}>
                    <p className="text-3xl font-extrabold text-white">{num}</p>
                    <p className="text-sm font-semibold text-blue-100 mt-1">{label}</p>
                    <p className="text-xs text-blue-300 mt-0.5">{desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* 어떻게 작동하나요 섹션 */}
          <section className="py-16 border-t border-border/40 bg-white/60">
            <div className="max-w-4xl mx-auto px-4 sm:px-6">
              <div className="text-center mb-10">
                <p className="text-xs font-semibold text-primary uppercase tracking-wider mb-2">HOW IT WORKS</p>
                <h2 className="text-2xl font-bold">3단계로 완성되는 복지 분석</h2>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                {[
                  { step: '01', icon: '📝', title: '프로필 입력', desc: '이름, 나이, 소득, 가구유형, 특수조건을 입력합니다. 데모 프로필로 빠르게 체험할 수 있습니다.' },
                  { step: '02', icon: '🤖', title: 'AI 자동 분석', desc: 'LangGraph 10노드 에이전트가 ChromaDB에서 관련 정책을 검색하고 자격 여부를 판별합니다.' },
                  { step: '03', icon: '📋', title: '맞춤 결과 제공', desc: '수혜 가능 정책 목록, 예상 금액, 신청 방법, 필요 서류까지 한 번에 안내합니다.' },
                ].map(({ step, icon, title, desc }) => (
                  <div key={step} className="relative">
                    <div className="rounded-2xl bg-white border border-border/60 p-6 shadow-sm h-full">
                      <div className="flex items-center gap-3 mb-4">
                        <span className="text-2xl">{icon}</span>
                        <span className="text-3xl font-extrabold text-muted-foreground/20">{step}</span>
                      </div>
                      <h3 className="font-bold text-base mb-2">{title}</h3>
                      <p className="text-sm text-muted-foreground leading-relaxed">{desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </main>
      )}

      {/* ── 실행 중 ── */}
      {phase === 'running' && (
        <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 max-w-5xl mx-auto animate-fade-in">
            {/* 왼쪽: 프로필 요약 + 노드 패널 */}
            <div className="lg:col-span-2 space-y-4">
              <ProfileForm onSubmit={handleSubmit} disabled />

              <div className="flex items-center gap-3 p-4 rounded-2xl bg-blue-50 border border-blue-100">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 shadow-md shadow-blue-500/30 shrink-0">
                  <Loader2 className="h-5 w-5 animate-spin text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="font-bold text-sm text-blue-900">AI 에이전트 실행 중</h2>
                  <p className="text-xs text-blue-600/70 mt-0.5">완료까지 약 2~3분</p>
                </div>
                <span className="text-2xl font-extrabold text-blue-600 tabular-nums shrink-0">{progress}%</span>
              </div>

              <div className="rounded-2xl border border-border/50 bg-white shadow-sm p-5">
                <div className="flex items-center justify-between mb-4">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">노드 실행 현황</p>
                  <span className="text-xs text-muted-foreground">{doneCount} / 10 완료</span>
                </div>
                <NodeStatusPanel
                  nodeStates={nodeStates}
                  progress={progress}
                  doneCount={doneCount}
                />
              </div>

              <div className="rounded-2xl bg-muted/40 border border-border/40 p-4">
                <p className="text-xs font-semibold text-muted-foreground mb-2">분석 과정</p>
                <ul className="space-y-1.5">
                  {[
                    'ChromaDB 벡터 검색으로 유사 정책 탐색',
                    'Claude AI가 자격요건 정밀 매칭',
                    '정부24 RPA 서류 발급 가능 여부 확인',
                  ].map((tip) => (
                    <li key={tip} className="flex items-start gap-2 text-xs text-muted-foreground">
                      <Clock className="h-3.5 w-3.5 mt-0.5 shrink-0 text-primary/60" />
                      {tip}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* 오른쪽: 대시보드 미리보기 스켈레톤 */}
            <div className="lg:col-span-3">
              <DashboardSkeleton progress={progress} />
            </div>
          </div>
        </main>
      )}

      {/* ── 완료: 대시보드 ── */}
      {phase === 'complete' && result && (
        <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
          <Dashboard
            result={result}
            profileSummary={result.profile_summary}
            userName={submittedProfile?.name ?? '사용자'}
            onReset={handleReset}
          />
        </main>
      )}

      {/* ── 오류 ── */}
      {phase === 'error' && (
        <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
          <div className="max-w-md mx-auto mt-8 space-y-4 animate-fade-in">
            <Card className="border-destructive/30 shadow-sm">
              <CardContent className="pt-6 space-y-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-destructive/10 shrink-0">
                    <AlertCircle className="h-5 w-5 text-destructive" />
                  </div>
                  <div className="space-y-1">
                    <p className="font-semibold text-sm">연결 오류</p>
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">{errorMsg}</p>
                  </div>
                </div>

                <div className="rounded-xl bg-muted/60 p-3 space-y-1.5">
                  <p className="text-xs font-semibold flex items-center gap-1.5 text-foreground">
                    <Terminal className="h-3.5 w-3.5" />
                    백엔드 서버 실행 방법
                  </p>
                  {['cd modoo-bom/backend', 'pip install -r requirements.txt', 'uvicorn main:app --reload --port 8000'].map((cmd) => (
                    <code key={cmd} className="block text-[11px] text-muted-foreground font-mono bg-background rounded px-2 py-1">
                      {cmd}
                    </code>
                  ))}
                  <a
                    href="http://localhost:8000/api/health"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-[11px] text-primary hover:underline mt-1"
                  >
                    <ExternalLink className="h-3 w-3" />
                    헬스체크 확인
                  </a>
                </div>

                <button
                  onClick={reset}
                  className="w-full rounded-xl bg-primary text-primary-foreground py-2.5 text-sm font-semibold hover:bg-primary/90 transition-colors"
                >
                  다시 시도
                </button>
              </CardContent>
            </Card>
          </div>
        </main>
      )}

      {/* ── FAQ 섹션 ── */}
      {phase === 'idle' && (
        <section className="py-16 border-t border-border/40">
          <div className="max-w-4xl mx-auto px-4 sm:px-6">
            <div className="text-center mb-10">
              <p className="text-xs font-semibold text-primary uppercase tracking-wider mb-2">FAQ</p>
              <h2 className="text-2xl font-bold">자주 묻는 질문</h2>
            </div>
            <div className="space-y-3">
              {[
                { q: '개인정보는 안전한가요?', a: '입력하신 정보는 분석 후 즉시 파기됩니다. 서버에 저장되지 않으며, 외부에 전송되지 않습니다. AI 분석을 위해 일시적으로만 사용됩니다.' },
                { q: '분석 결과가 정확한가요?', a: '60개 이상의 복지 정책 데이터와 AI 매칭으로 높은 정확도를 제공하지만, 최종 확인은 주민센터나 복지로(www.bokjiro.go.kr)에서 해주세요. 담당 공무원과 상담을 권장합니다.' },
                { q: 'RPA 서류 취득이 실제로 발급되나요?', a: '실제 정부 사이트(정부24, 건강보험공단, 고용24)에 브라우저가 자동으로 접속합니다. 카카오톡 간편인증으로 로그인하시면 서류 발급 절차를 자동으로 안내해드립니다.' },
                { q: '어떤 복지 정책을 분석하나요?', a: '기초연금, 아동수당, 부모급여, 청년 지원(내일저축계좌, 도약계좌), 장애인 지원, 실업급여, 한부모가족 지원 등 60개 이상의 정책을 분석합니다.' },
                { q: '무료로 이용할 수 있나요?', a: '모두봄은 복지 소외계층을 위한 공공 목적으로 개발된 서비스로, 완전 무료입니다. 언제든지 부담 없이 이용하실 수 있습니다.' },
              ].map(({ q, a }, i) => (
                <details key={i} className="group rounded-2xl border border-border/60 bg-white overflow-hidden">
                  <summary className="flex items-center justify-between gap-4 cursor-pointer px-5 py-4 font-semibold text-sm list-none hover:bg-muted/30 transition-colors">
                    <span>{q}</span>
                    <span className="text-muted-foreground group-open:rotate-180 transition-transform duration-200 shrink-0 text-lg leading-none">⌄</span>
                  </summary>
                  <div className="px-5 pb-4 text-sm text-muted-foreground leading-relaxed border-t border-border/40 pt-3">
                    {a}
                  </div>
                </details>
              ))}
            </div>

            {/* 복지 상담 CTA */}
            <div className="mt-8 rounded-2xl bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 p-6 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div>
                <p className="font-bold text-base text-blue-900">더 자세한 상담이 필요하신가요?</p>
                <p className="text-sm text-blue-600 mt-1">전국 복지 상담 무료 전화, 주민센터, 복지로에서 전문가 도움을 받으세요.</p>
              </div>
              <div className="flex gap-3 shrink-0">
                <a href="tel:129" className="flex items-center gap-1.5 rounded-xl bg-blue-600 text-white px-4 py-2.5 text-sm font-bold hover:bg-blue-700 transition-colors">
                  ☎ 129 무료상담
                </a>
                <a href="https://www.bokjiro.go.kr" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 rounded-xl border border-blue-300 text-blue-700 px-4 py-2.5 text-sm font-bold hover:bg-blue-50 transition-colors">
                  복지로 바로가기
                </a>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ── 복지 AI 챗봇 (모든 페이지) ── */}
      <ChatBot />

      {/* ── 푸터 ── */}
      {phase === 'idle' && (
        <footer className="border-t border-border/40 py-10 bg-white/80">
          <div className="max-w-6xl mx-auto px-4 sm:px-6">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-2.5">
                <div className="h-6 w-6 rounded-lg bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center">
                  <Sprout className="h-3.5 w-3.5 text-white" />
                </div>
                <span className="text-sm font-bold gradient-text">모두봄</span>
              </div>
              <div className="text-center">
                <p className="text-xs text-muted-foreground">2026 AI·SW 중심대학 디지털 경진대회 SW부문</p>
                <p className="text-[11px] text-muted-foreground/60 mt-0.5">
                  React 18 · Vite · FastAPI · LangGraph · ChromaDB · Claude AI
                </p>
              </div>
              <div className="text-xs text-muted-foreground">
                개인정보 미저장 · 로컬 처리
              </div>
            </div>
          </div>
        </footer>
      )}
    </div>
  )
}
