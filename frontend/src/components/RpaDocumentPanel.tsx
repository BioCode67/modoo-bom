/**
 * 정부24 실제 브라우저 자동화(RPA) 패널
 * - "실제 발급 시도" 버튼 → 백엔드에서 Playwright 브라우저 열기
 * - 실시간 진행 상황 + 스크린샷 표시 (1초 폴링)
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Monitor, Loader2, CheckCircle2, XCircle, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react'

const API_BASE = import.meta.env.VITE_API_BASE ?? `http://${window.location.hostname}:8000`

interface RpaStep {
  time: string
  msg: string
}

interface RpaStatus {
  task_id: string
  doc_name: string
  user_name: string
  status: 'pending' | 'running' | 'waiting_login' | 'done' | 'error'
  current_step: string
  steps: RpaStep[]
  screenshot_b64: string | null
  result: { success: boolean; message: string } | null
}

interface Props {
  userName: string
}

const STATUS_LABEL: Record<string, string> = {
  pending: '대기 중',
  running: '자동화 실행 중',
  waiting_login: '로그인 대기',
  done: '완료',
  error: '오류',
}

const STATUS_COLOR: Record<string, string> = {
  pending: 'secondary',
  running: 'default',
  waiting_login: 'warning',
  done: 'success',
  error: 'destructive',
}

export function RpaDocumentPanel({ userName }: Props) {
  const [taskId, setTaskId] = useState<string | null>(null)
  const [status, setStatus] = useState<RpaStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [showSteps, setShowSteps] = useState(true)
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current)
      pollingRef.current = null
    }
  }, [])

  const pollStatus = useCallback(async (id: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/documents/rpa-status/${id}`)
      if (!res.ok) return
      const data: RpaStatus = await res.json()
      setStatus(data)
      if (data.status === 'done' || data.status === 'error') {
        stopPolling()
      }
    } catch {
      // 일시적 네트워크 오류 무시
    }
  }, [stopPolling])

  useEffect(() => {
    if (taskId) {
      pollingRef.current = setInterval(() => pollStatus(taskId), 1000)
    }
    return stopPolling
  }, [taskId, pollStatus, stopPolling])

  const handleStart = async () => {
    setLoading(true)
    setStatus(null)
    stopPolling()
    try {
      const res = await fetch(`${API_BASE}/api/documents/rpa-issue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ doc_name: '주민등록등본', user_name: userName }),
      })
      const data = await res.json()
      setTaskId(data.task_id)
    } catch (e) {
      alert('RPA 시작 실패: 백엔드 서버를 확인해주세요.')
    } finally {
      setLoading(false)
    }
  }

  const handleReset = () => {
    stopPolling()
    setTaskId(null)
    setStatus(null)
  }

  const isDone = status?.status === 'done' || status?.status === 'error'
  const isWaitingLogin = status?.status === 'waiting_login'

  return (
    <Card className="border-2 border-dashed border-blue-200 bg-blue-50/30">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Monitor className="h-5 w-5 text-blue-600" />
            <CardTitle className="text-base text-blue-800">실제 정부24 자동 발급 (RPA)</CardTitle>
            <Badge variant="secondary" className="text-xs">BETA</Badge>
          </div>
          {status && (
            <Badge variant={STATUS_COLOR[status.status] as 'default' | 'secondary' | 'destructive' | 'outline'}>
              {STATUS_LABEL[status.status]}
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          실제 브라우저(Chrome)를 자동으로 열어 정부24에서 주민등록등본 발급을 시도합니다.
          로그인만 직접 하시면 이후는 자동으로 진행됩니다.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* 시작 버튼 */}
        {!taskId && (
          <button
            onClick={handleStart}
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Monitor className="h-4 w-4" />}
            {loading ? '브라우저 실행 중...' : '주민등록등본 실제 발급 시도'}
          </button>
        )}

        {/* 현재 상태 메시지 */}
        {status?.current_step && (
          <div className={`rounded-lg p-3 text-sm border ${
            isWaitingLogin
              ? 'bg-amber-50 border-amber-200 text-amber-800'
              : status.status === 'error'
              ? 'bg-red-50 border-red-200 text-red-800'
              : status.status === 'done'
              ? 'bg-green-50 border-green-200 text-green-800'
              : 'bg-blue-50 border-blue-200 text-blue-800'
          }`}>
            <div className="flex items-start gap-2">
              {status.status === 'error' && <XCircle className="h-4 w-4 mt-0.5 shrink-0" />}
              {status.status === 'done' && <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />}
              {isWaitingLogin && <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />}
              {status.status === 'running' && <Loader2 className="h-4 w-4 mt-0.5 shrink-0 animate-spin" />}
              <p>{status.current_step}</p>
            </div>
            {isWaitingLogin && (
              <p className="mt-2 font-medium">열린 Chrome 브라우저에서 로그인 후 기다리세요. 자동으로 진행됩니다.</p>
            )}
          </div>
        )}

        {/* 실시간 스크린샷 */}
        {status?.screenshot_b64 && (
          <div className="rounded-lg overflow-hidden border border-gray-200 shadow-sm">
            <div className="bg-gray-100 px-3 py-1.5 text-xs text-gray-500 flex items-center gap-1">
              <Monitor className="h-3 w-3" />
              실시간 브라우저 화면
              {status.status === 'running' && (
                <span className="ml-auto flex items-center gap-1 text-blue-600">
                  <Loader2 className="h-3 w-3 animate-spin" /> 진행 중
                </span>
              )}
            </div>
            <img
              src={`data:image/jpeg;base64,${status.screenshot_b64}`}
              alt="브라우저 스크린샷"
              className="w-full object-contain bg-white"
            />
          </div>
        )}

        {/* 단계 로그 */}
        {status && status.steps.length > 0 && (
          <div>
            <button
              onClick={() => setShowSteps((v) => !v)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-2"
            >
              {showSteps ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              진행 단계 로그 ({status.steps.length}단계)
            </button>
            {showSteps && (
              <ol className="space-y-1">
                {status.steps.map((step, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                    <span className="font-mono text-gray-400 shrink-0">[{step.time}]</span>
                    <span>{step.msg}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}

        {/* 완료 후 초기화 */}
        {isDone && (
          <button
            onClick={handleReset}
            className="w-full px-4 py-2 rounded-lg border border-input bg-background text-sm hover:bg-accent transition-colors"
          >
            다시 시도
          </button>
        )}
      </CardContent>
    </Card>
  )
}
