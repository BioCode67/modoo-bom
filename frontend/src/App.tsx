import { useState } from 'react'
import { ProfileForm } from '@/components/ProfileForm'
import { NodeStatusPanel } from '@/components/NodeStatusPanel'
import { Dashboard } from '@/components/Dashboard'
import { useAgentWebSocket } from '@/hooks/useAgentWebSocket'
import { Loader2, AlertCircle, Sprout, Terminal, ExternalLink } from 'lucide-react'
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
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-background">
      {/* 헤더 */}
      <header className="sticky top-0 z-20 bg-white/80 backdrop-blur-md border-b shadow-sm">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-lg bg-blue-600 flex items-center justify-center">
              <Sprout className="h-4 w-4 text-white" />
            </div>
            <span className="font-bold text-base tracking-tight">모두봄</span>
          </div>
          <span className="hidden sm:block text-xs text-muted-foreground border-l pl-3 ml-1">
            개인 복지 자산 관리 AI Agent
          </span>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-[10px] rounded-full bg-blue-100 text-blue-700 px-2 py-0.5 font-semibold">
              Week 3 Prototype
            </span>
            {phase === 'running' && (
              <span className="flex items-center gap-1 text-xs text-blue-600 font-medium animate-pulse">
                <Loader2 className="h-3 w-3 animate-spin" />
                분석 중
              </span>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8">

        {/* ── 유휴: 프로필 입력 ── */}
        {phase === 'idle' && (
          <div className="max-w-lg mx-auto space-y-8">
            <div className="text-center space-y-3">
              <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-600 shadow-lg mx-auto">
                <Sprout className="h-9 w-9 text-white" />
              </div>
              <h1 className="text-3xl font-bold tracking-tight">
                내 복지 혜택을 찾아드립니다
              </h1>
              <p className="text-muted-foreground text-sm leading-relaxed max-w-sm mx-auto">
                프로필을 입력하면 LangGraph 10노드 AI가 맞춤 복지 정책을 분석하고
                서류 자동 취득까지 도와드립니다.
              </p>
              <div className="flex flex-wrap justify-center gap-2 pt-1">
                {['ChromaDB RAG', 'Claude Sonnet 자격판별', '정부24 RPA', 'Reflection Loop'].map((tag) => (
                  <span key={tag} className="text-[11px] bg-muted text-muted-foreground px-2 py-0.5 rounded-full">
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
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 max-w-5xl mx-auto">
            {/* 왼쪽: 프로필 (disabled) */}
            <div className="lg:col-span-2">
              <ProfileForm onSubmit={handleSubmit} disabled />
            </div>
            {/* 오른쪽: 노드 상태 */}
            <div className="lg:col-span-3 space-y-3">
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                <h2 className="font-semibold text-sm">AI 에이전트 실행 중…</h2>
                <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                  {progress}%
                </span>
              </div>
              <Card>
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
          <div className="max-w-md mx-auto mt-16 space-y-4">
            <Card className="border-destructive/40">
              <CardContent className="pt-6 space-y-4">
                <div className="flex items-start gap-3">
                  <AlertCircle className="h-6 w-6 text-destructive shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p className="font-semibold text-sm">연결 오류</p>
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">{errorMsg}</p>
                  </div>
                </div>

                {/* 서버 실행 안내 */}
                <div className="rounded-lg bg-muted p-3 space-y-1.5">
                  <p className="text-xs font-semibold flex items-center gap-1.5">
                    <Terminal className="h-3.5 w-3.5" />
                    백엔드 서버 실행 방법
                  </p>
                  <code className="text-[11px] text-muted-foreground block">
                    cd modoo-bom/backend
                  </code>
                  <code className="text-[11px] text-muted-foreground block">
                    pip install -r requirements.txt
                  </code>
                  <code className="text-[11px] text-muted-foreground block">
                    uvicorn main:app --reload --port 8000
                  </code>
                  <a
                    href="http://localhost:8000/api/health"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] text-primary flex items-center gap-1 mt-1"
                  >
                    <ExternalLink className="h-3 w-3" />
                    헬스체크 확인
                  </a>
                </div>

                <button
                  onClick={reset}
                  className="w-full rounded-lg bg-primary text-primary-foreground py-2.5 text-sm font-medium hover:bg-primary/90 transition-colors"
                >
                  다시 시도
                </button>
              </CardContent>
            </Card>
          </div>
        )}
      </main>

      {/* 푸터 */}
      <footer className="mt-20 border-t py-6 text-center text-[11px] text-muted-foreground">
        <p>모두봄 (ModooBom) — 2026 AI·SW 중심대학 디지털 경진대회 SW부문</p>
        <p className="mt-1 opacity-70">
          React 18 · Vite · shadcn/ui · FastAPI · LangGraph · ChromaDB · Claude Sonnet
        </p>
      </footer>
    </div>
  )
}
