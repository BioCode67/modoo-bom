/**
 * 정부 사이트 실제 브라우저 자동화(RPA) 패널
 * 지원: 주민등록등본/초본 (정부24), 건강보험 자격득실확인서 (건보공단), 고용보험 이력내역서 (고용24)
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Monitor, Loader2, CheckCircle2, XCircle, AlertTriangle,
  ChevronDown, ChevronUp, FileText,
} from 'lucide-react'

const API_BASE = import.meta.env.VITE_API_BASE ?? `http://${window.location.hostname}:8000`

interface RpaStep { time: string; msg: string }

interface RpaStatus {
  task_id: string
  doc_name: string
  user_name: string
  status: 'pending' | 'running' | 'waiting_login' | 'done' | 'error'
  current_step: string
  steps: RpaStep[]
  screenshot_b64: string | null
  result: { success: boolean; message?: string } | null
}

interface Props { userName: string }

const SUPPORTED_DOCS = [
  { name: '주민등록등본', site: '정부24', color: 'bg-blue-600 hover:bg-blue-700' },
  { name: '주민등록초본', site: '정부24', color: 'bg-blue-500 hover:bg-blue-600' },
  { name: '건강보험 자격득실확인서', site: '건강보험공단', color: 'bg-green-600 hover:bg-green-700' },
  { name: '고용보험 피보험자격 이력내역서', site: '고용24', color: 'bg-orange-600 hover:bg-orange-700' },
]

const STATUS_LABEL: Record<string, string> = {
  pending: '대기 중', running: '자동화 실행 중',
  waiting_login: '📱 카카오 인증 대기', done: '✅ 완료', error: '❌ 오류',
}

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  pending: 'secondary', running: 'default',
  waiting_login: 'outline', done: 'secondary', error: 'destructive',
}

export function RpaDocumentPanel({ userName }: Props) {
  const [selectedDoc, setSelectedDoc] = useState<string | null>(null)
  const [taskId, setTaskId] = useState<string | null>(null)
  const [status, setStatus] = useState<RpaStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [showSteps, setShowSteps] = useState(true)
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopPolling = useCallback(() => {
    if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null }
  }, [])

  const pollStatus = useCallback(async (id: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/documents/rpa-status/${id}`)
      if (!res.ok) return
      const data: RpaStatus = await res.json()
      setStatus(data)
      if (data.status === 'done' || data.status === 'error') stopPolling()
    } catch { /* ignore transient */ }
  }, [stopPolling])

  useEffect(() => {
    if (taskId) pollingRef.current = setInterval(() => pollStatus(taskId), 1000)
    return stopPolling
  }, [taskId, pollStatus, stopPolling])

  const handleStart = async (docName: string) => {
    setLoading(true)
    setStatus(null)
    setSelectedDoc(docName)
    stopPolling()
    try {
      const res = await fetch(`${API_BASE}/api/documents/rpa-issue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ doc_name: docName, user_name: userName }),
      })
      if (!res.ok) {
        const err = await res.json()
        alert(`오류: ${err.detail}`)
        setSelectedDoc(null)
        return
      }
      const data = await res.json()
      setTaskId(data.task_id)
    } catch {
      alert('RPA 시작 실패: 백엔드 서버를 확인해주세요.')
      setSelectedDoc(null)
    } finally {
      setLoading(false)
    }
  }

  const handleReset = () => {
    stopPolling()
    setTaskId(null)
    setStatus(null)
    setSelectedDoc(null)
  }

  const isDone = status?.status === 'done' || status?.status === 'error'
  const isWaiting = status?.status === 'waiting_login'
  const isRunning = status && !isDone

  return (
    <Card className="border-2 border-dashed border-blue-200 bg-blue-50/30">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Monitor className="h-5 w-5 text-blue-600" />
            <CardTitle className="text-base text-blue-800">실제 서류 자동 취득 (RPA)</CardTitle>
            <Badge variant="secondary" className="text-xs">LIVE</Badge>
          </div>
          {status && (
            <Badge variant={STATUS_VARIANT[status.status]}>
              {STATUS_LABEL[status.status]}
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          실제 정부 사이트에서 카카오 간편인증으로 로그인 후 서류를 자동으로 발급합니다.
          로그인만 직접 하시면 이후는 자동 진행됩니다.
        </p>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* 서류 선택 버튼 */}
        {!taskId && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {SUPPORTED_DOCS.map((doc) => (
              <button
                key={doc.name}
                onClick={() => handleStart(doc.name)}
                disabled={loading}
                className={`flex items-center gap-2 px-3 py-2.5 rounded-lg text-white text-sm font-medium disabled:opacity-50 transition-colors ${doc.color}`}
              >
                {loading && selectedDoc === doc.name
                  ? <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                  : <FileText className="h-4 w-4 shrink-0" />
                }
                <span className="text-left leading-tight">
                  <span className="block">{doc.name}</span>
                  <span className="block text-[10px] opacity-80">{doc.site}</span>
                </span>
              </button>
            ))}
          </div>
        )}

        {/* 진행 중인 서류 이름 */}
        {taskId && status && (
          <div className="flex items-center gap-2 text-sm font-medium">
            <FileText className="h-4 w-4 text-blue-600" />
            <span>{status.doc_name}</span>
            <span className="text-xs text-muted-foreground">({
              status.doc_name.includes('등본') || status.doc_name.includes('초본')
                ? '정부24' : status.doc_name.includes('건강') ? '건강보험공단' : '고용24'
            })</span>
          </div>
        )}

        {/* 현재 상태 메시지 */}
        {status?.current_step && (
          <div className={`rounded-lg p-3 text-sm border whitespace-pre-line ${
            isWaiting
              ? 'bg-amber-50 border-amber-300 text-amber-900'
              : status.status === 'error'
              ? 'bg-red-50 border-red-200 text-red-800'
              : status.status === 'done'
              ? 'bg-green-50 border-green-200 text-green-800'
              : 'bg-blue-50 border-blue-200 text-blue-800'
          }`}>
            <div className="flex items-start gap-2">
              {status.status === 'error'   && <XCircle className="h-4 w-4 mt-0.5 shrink-0" />}
              {status.status === 'done'    && <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />}
              {isWaiting                   && <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />}
              {isRunning && !isWaiting     && <Loader2 className="h-4 w-4 mt-0.5 shrink-0 animate-spin" />}
              <p>{status.current_step}</p>
            </div>
            {isWaiting && (
              <p className="mt-2 font-semibold text-amber-800">
                카카오톡 알림을 확인해주세요 → [본인인증 허용] 버튼을 누르면 자동으로 계속됩니다.
              </p>
            )}
          </div>
        )}

        {/* 실시간 브라우저 스크린샷 */}
        {status?.screenshot_b64 && (
          <div className="rounded-lg overflow-hidden border border-gray-200 shadow-sm">
            <div className="bg-gray-100 px-3 py-1.5 text-xs text-gray-500 flex items-center gap-1.5">
              <Monitor className="h-3 w-3" />
              실시간 브라우저 화면
              {isRunning && (
                <span className="ml-auto flex items-center gap-1 text-blue-600">
                  <Loader2 className="h-3 w-3 animate-spin" /> 진행 중
                </span>
              )}
              {status.status === 'done' && (
                <span className="ml-auto text-green-600 font-medium">완료</span>
              )}
            </div>
            <img
              src={`data:image/jpeg;base64,${status.screenshot_b64}`}
              alt="브라우저 화면"
              className="w-full object-contain bg-white max-h-80"
            />
          </div>
        )}

        {/* 진행 단계 로그 */}
        {status && status.steps.length > 0 && (
          <div>
            <button
              onClick={() => setShowSteps((v) => !v)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-1.5"
            >
              {showSteps ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              진행 로그 ({status.steps.length}단계)
            </button>
            {showSteps && (
              <ol className="space-y-0.5 max-h-48 overflow-y-auto pr-1">
                {status.steps.map((step, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                    <span className="font-mono text-gray-400 shrink-0">[{step.time}]</span>
                    <span className="whitespace-pre-line">{step.msg}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}

        {/* 완료 후 리셋 */}
        {isDone && (
          <button
            onClick={handleReset}
            className="w-full px-4 py-2 rounded-lg border border-input bg-background text-sm hover:bg-accent transition-colors"
          >
            다른 서류 발급하기
          </button>
        )}
      </CardContent>
    </Card>
  )
}
