import { useState } from 'react'
import { ProfileForm } from '@/components/ProfileForm'
import { NodeStatusPanel } from '@/components/NodeStatusPanel'
import { Dashboard } from '@/components/Dashboard'
import { useAgentWebSocket } from '@/hooks/useAgentWebSocket'
import { Loader2, AlertCircle, Sprout, Terminal, ExternalLink, Sparkles } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import type { UserProfile } from '@/types'

export default function App() {
  const { phase, nodeStates, result, errorMsg, progress, doneCount, startAnalysis, reset } =
    useAgentWebSocket()
  const [submittedProfile, setSubmittedProfile] = useState<UserProfile | null>(null)

  const handleSubmit = (profile: UserProfile) => {
    setSubmittedProfile(profile)
    startAnalysis(profile)
  }

  const handleReset = () => {
    reset()
    setSubmittedProfile(null)
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-background">
      {/* 헤더 */}
      <header className="sticky top-0 z-20 bg-white/80 backdrop-blur-md border-b border-border/50 shadow-sm">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center shadow-sm shadow-blue-500/30">
              <Sprout className="h-4 w-4 text-white" />
            </div>
            <span className="font-bold text-base tracking-tight gradient-text">모두봄</span>
          </div>
          <div className="h-4 w-px bg-border mx-1" />
          <span className="hidden sm:block text-xs text-muted-foreground">
            개인 복지 자산 관리 AI Agent
          </span>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-[10px] rounded-full bg-blue-100 text-blue-700 px-2.5 py-1 font-semibold border border-blue-200/60">
              Week 3 Prototype
            </span>
            {phase === 'running' && (
              <span className="flex items-center gap-1.5 text-xs text-blue-600 font-medium">
                <Loader2 className="h-3 w-3 animate-spin" />
                <span className="hidden sm:inline">분석 중</span>
              </span>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8">

        {/* ── 유휴: 프로필 입력 ── */}
        {phase === 'idle' && (
          <div className="max-w-lg mx-auto space-y-8 animate-fade-in">
            <div className="text-center space-y-4">
              <div className="relative inline-flex">
                <div className="h-20 w-20 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-600 shadow-xl shadow-blue-500/25 flex items-center justify-center mx-auto">
                  <Sprout className="h-10 w-10 text-white" />
                </div>
                <div className="absolute -right-1 -top-1 h-6 w-6 rounded-full bg-yellow-400 flex items-center justify-center shadow-md">
                  <Sparkles className="h-3.5 w-3.5 text-yellow-900" />
                </div>
              </div>
              <div>
                <h1 className="text-3xl font-bold tracking-tight">
                  내 복지 혜택을 찾아드립니다
                </h1>
                <p className="text-muted-foreground text-sm leading-relaxed max-w-sm mx-auto mt-2">
                  프로필을 입력하면 LangGraph 10노드 AI가 맞춤 복지 정책을 분석하고
                  서류 자동 취득까지 도와드립니다.
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                {['ChromaDB RAG', 'Claude Sonnet 자격판별', '정부24 RPA', 'Reflection Loop'].map((tag) => (
                  <span key={tag} className="text-[11px] bg-muted/80 text-muted-foreground px-2.5 py-1 rounded-full border border-border/50">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
            <ProfileForm onSubmit={handleSubmit} />
          </div>
        )}

        {/* ── 실행 중: 2단 레이아웃 ── */}
        {phase === 'running' && (
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 max-w-5xl mx-auto animate-fade-in">
            <div className="lg:col-span-2">
              <ProfileForm onSubmit={handleSubmit} disabled />
            </div>
            <div className="lg:col-span-3 space-y-4">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-100">
                  <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                </div>
                <div>
                  <h2 className="font-semibold text-sm">LangGraph 10노드 에이전트 실행 중</h2>
                  <p className="text-xs text-muted-foreground">완료까지 잠시 기다려주세요</p>
                </div>
                <span className="ml-auto text-sm font-bold text-primary tabular-nums">{progress}%</span>
              </div>
              <Card className="border-0 shadow-sm">
                <CardContent className="pt-5 pb-4 px-4">
                  <NodeStatusPanel
                    nodeStates={nodeStates}
                    progress={progress}
                    doneCount={doneCount}
                  />
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {/* ── 완료: 대시보드 ── */}
        {phase === 'complete' && result && (
          <Dashboard
            result={result}
            profileSummary={result.profile_summary}
            userName={submittedProfile?.name ?? '사용자'}
            onReset={handleReset}
          />
        )}

        {/* ── 오류 ── */}
        {phase === 'error' && (
          <div className="max-w-md mx-auto mt-16 space-y-4 animate-fade-in">
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
        )}
      </main>

      {/* 푸터 */}
      <footer className="mt-20 border-t border-border/50 py-8 text-center">
        <div className="flex items-center justify-center gap-2 mb-2">
          <div className="h-5 w-5 rounded-md bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center">
            <Sprout className="h-3 w-3 text-white" />
          </div>
          <span className="text-sm font-semibold gradient-text">모두봄</span>
        </div>
        <p className="text-[11px] text-muted-foreground">2026 AI·SW 중심대학 디지털 경진대회 SW부문</p>
        <p className="text-[11px] text-muted-foreground/60 mt-1">
          React 18 · Vite · shadcn/ui · FastAPI · LangGraph · ChromaDB · Claude Sonnet
        </p>
      </footer>
    </div>
  )
}
