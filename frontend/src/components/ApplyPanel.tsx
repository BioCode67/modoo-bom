/**
 * 복지 서비스 실제 신청 자동화 패널 (RPA)
 * 복지로에 자동으로 접속하여 신청 양식까지 안내
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { Badge } from '@/components/ui/badge'
import {
  Send, Loader2, CheckCircle2, XCircle, AlertTriangle, Monitor,
  ChevronDown, ChevronUp, ExternalLink,
} from 'lucide-react'
import type { EligiblePolicy } from '@/types'
import { cn } from '@/lib/utils'

const API_BASE = import.meta.env.VITE_API_BASE ?? `http://${window.location.hostname}:8000`

interface RpaStatus {
  task_id: string
  doc_name: string
  user_name: string
  status: 'pending' | 'running' | 'waiting_login' | 'done' | 'error'
  current_step: string
  steps: { time: string; msg: string }[]
  screenshot_b64: string | null
  result: { success: boolean; service_name?: string } | null
}

const SUPPORTED_SERVICES = [
  '기초연금', '아동수당', '부모급여', '청년 내일저축계좌', '첫만남이용권', '기초생활 생계급여',
]

const SERVICE_EMOJI: Record<string, string> = {
  '기초연금': '👴',
  '아동수당': '👶',
  '부모급여': '🤱',
  '청년 내일저축계좌': '💰',
  '첫만남이용권': '🎁',
  '기초생활 생계급여': '🏠',
}

const STATUS_LABEL: Record<string, string> = {
  pending: '대기', running: '신청 중',
  waiting_login: '📱 인증 대기', done: '✅ 완료', error: '❌ 오류',
}

interface Props {
  policies: EligiblePolicy[]
  userName: string
}

export function ApplyPanel({ policies, userName }: Props) {
  const [selectedService, setSelectedService] = useState<string | null>(null)
  const [taskId, setTaskId] = useState<string | null>(null)
  const [status, setStatus] = useState<RpaStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [showLog, setShowLog] = useState(false)
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopPolling = useCallback(() => {
    if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null }
  }, [])

  const pollStatus = useCallback(async (id: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/apply/status/${id}`)
      if (!res.ok) return
      const data: RpaStatus = await res.json()
      setStatus(data)
      if (data.status === 'done' || data.status === 'error') stopPolling()
    } catch { /* ignore */ }
  }, [stopPolling])

  useEffect(() => {
    if (taskId) pollingRef.current = setInterval(() => pollStatus(taskId), 1500)
    return stopPolling
  }, [taskId, pollStatus, stopPolling])

  const handleStart = async (serviceName: string) => {
    setLoading(true)
    setStatus(null)
    setSelectedService(serviceName)
    stopPolling()
    try {
      const res = await fetch(`${API_BASE}/api/apply/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ service_name: serviceName, user_name: userName }),
      })
      if (!res.ok) {
        const err = await res.json()
        alert(`오류: ${err.detail}`)
        setSelectedService(null)
        return
      }
      const data = await res.json()
      setTaskId(data.task_id)
    } catch {
      alert('신청 자동화 시작 실패: 백엔드 서버를 확인해주세요.')
      setSelectedService(null)
    } finally {
      setLoading(false)
    }
  }

  const handleReset = () => {
    stopPolling()
    setTaskId(null)
    setStatus(null)
    setSelectedService(null)
  }

  // 분석 결과에서 수혜 가능한 서비스와 지원 서비스 교집합
  const eligibleNames = policies.filter((p) => p.eligible).map((p) => p.name)
  const recommendedServices = SUPPORTED_SERVICES.filter((s) =>
    eligibleNames.some((n) => n.includes(s) || s.includes(n))
  )
  const otherServices = SUPPORTED_SERVICES.filter((s) => !recommendedServices.includes(s))

  const isDone = status?.status === 'done' || status?.status === 'error'
  const isWaiting = status?.status === 'waiting_login'
  const isRunning = status && !isDone

  return (
    <div className="space-y-4">
      {/* 안내 배너 */}
      <div className="rounded-2xl bg-gradient-to-r from-violet-50 to-purple-50 border border-violet-200 p-4 flex items-start gap-3">
        <Send className="h-5 w-5 text-violet-600 mt-0.5 shrink-0" />
        <div>
          <p className="text-sm font-bold text-violet-800">복지 서비스 신청 자동화 (Beta)</p>
          <p className="text-xs text-violet-600 mt-1 leading-relaxed">
            복지로에 자동으로 접속하여 신청 양식까지 안내합니다.
            로그인(카카오 간편인증)만 직접 하시면 신청서 작성을 도와드립니다.
            최종 제출은 내용 확인 후 직접 진행하시면 됩니다.
          </p>
        </div>
      </div>

      {/* 서비스 선택 */}
      {!taskId && (
        <div className="space-y-4">
          {recommendedServices.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2.5">
                ⭐ AI 분석 결과 추천 서비스
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {recommendedServices.map((service) => (
                  <button
                    key={service}
                    onClick={() => handleStart(service)}
                    disabled={loading}
                    className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-gradient-to-r from-violet-600 to-purple-600 text-white text-sm font-semibold disabled:opacity-50 hover:from-violet-700 hover:to-purple-700 transition-all hover:-translate-y-0.5 hover:shadow-lg hover:shadow-violet-500/20"
                  >
                    {loading && selectedService === service
                      ? <Loader2 className="h-5 w-5 animate-spin shrink-0" />
                      : <span className="text-xl shrink-0">{SERVICE_EMOJI[service] ?? '📋'}</span>
                    }
                    <span className="text-left">
                      <span className="block font-bold">{service}</span>
                      <span className="block text-[11px] text-violet-200">복지로 자동 신청</span>
                    </span>
                    <ExternalLink className="h-4 w-4 ml-auto shrink-0 opacity-60" />
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2.5">
              {recommendedServices.length > 0 ? '기타 지원 서비스' : '신청 가능한 서비스'}
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {(recommendedServices.length > 0 ? otherServices : SUPPORTED_SERVICES).map((service) => (
                <button
                  key={service}
                  onClick={() => handleStart(service)}
                  disabled={loading}
                  className="flex items-center gap-2.5 px-3 py-3 rounded-2xl border border-border bg-white text-sm font-medium disabled:opacity-50 hover:border-primary/40 hover:bg-muted/30 transition-all text-left"
                >
                  <span className="text-lg shrink-0">{SERVICE_EMOJI[service] ?? '📋'}</span>
                  <span className="min-w-0 truncate text-xs font-semibold">{service}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl bg-muted/40 border border-border/40 p-3 flex items-center gap-3">
            <a
              href="https://www.bokjiro.go.kr/ssis-tbu/twataa/wlfareInfo/moveTWAT52011M.do"
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-primary text-primary-foreground py-2 text-xs font-semibold hover:bg-primary/90 transition-colors"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              복지로에서 직접 신청
            </a>
            <a
              href="tel:129"
              className="flex items-center justify-center gap-1.5 rounded-xl border border-border px-4 py-2 text-xs font-semibold hover:bg-muted/50 transition-colors"
            >
              ☎ 129
            </a>
          </div>
        </div>
      )}

      {/* 진행 중 */}
      {taskId && status && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-lg">{SERVICE_EMOJI[status.doc_name] ?? '📋'}</span>
            <span className="text-sm font-bold">{status.doc_name}</span>
            <Badge variant={status.status === 'done' ? 'secondary' : status.status === 'error' ? 'destructive' : 'default'} className="ml-auto">
              {STATUS_LABEL[status.status]}
            </Badge>
          </div>

          {/* 상태 메시지 */}
          {status.current_step && (
            <div className={cn(
              'rounded-xl p-3 text-sm border whitespace-pre-line',
              isWaiting ? 'bg-amber-50 border-amber-300 text-amber-900' :
              status.status === 'error' ? 'bg-red-50 border-red-200 text-red-800' :
              status.status === 'done' ? 'bg-green-50 border-green-200 text-green-800' :
              'bg-violet-50 border-violet-200 text-violet-800',
            )}>
              <div className="flex items-start gap-2">
                {status.status === 'error'   && <XCircle className="h-4 w-4 mt-0.5 shrink-0" />}
                {status.status === 'done'    && <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />}
                {isWaiting                   && <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />}
                {isRunning && !isWaiting     && <Loader2 className="h-4 w-4 mt-0.5 shrink-0 animate-spin" />}
                <p>{status.current_step}</p>
              </div>
            </div>
          )}

          {/* 스크린샷 */}
          {status.screenshot_b64 && (
            <div className="rounded-xl overflow-hidden border border-border shadow-sm">
              <div className="bg-muted px-3 py-1.5 text-xs text-muted-foreground flex items-center gap-1.5">
                <Monitor className="h-3 w-3" />
                실시간 브라우저 화면
                {isRunning && <Loader2 className="h-3 w-3 animate-spin ml-auto text-primary" />}
              </div>
              <img
                src={`data:image/jpeg;base64,${status.screenshot_b64}`}
                alt="브라우저"
                className="w-full object-contain bg-white max-h-72"
              />
            </div>
          )}

          {/* 로그 */}
          {status.steps.length > 0 && (
            <div>
              <button
                onClick={() => setShowLog((v) => !v)}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-1"
              >
                {showLog ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                진행 로그 ({status.steps.length}단계)
              </button>
              {showLog && (
                <ol className="space-y-0.5 max-h-40 overflow-y-auto pr-1">
                  {status.steps.map((s, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                      <span className="font-mono text-muted-foreground/50 shrink-0">[{s.time}]</span>
                      <span className="whitespace-pre-line">{s.msg}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}

          {isDone && (
            <button
              onClick={handleReset}
              className="w-full px-4 py-2.5 rounded-xl border border-border bg-background text-sm font-medium hover:bg-muted/50 transition-colors"
            >
              다른 서비스 신청하기
            </button>
          )}
        </div>
      )}
    </div>
  )
}
