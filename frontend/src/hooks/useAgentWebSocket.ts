import { useCallback, useRef, useState } from 'react'
import type { AnalysisResult, UserProfile, WsMessage, NodeStatus } from '@/types'
import { NODE_ORDER } from '@/types'

export interface NodeState {
  status: NodeStatus
  message: string
  data?: Record<string, unknown>
  startedAt?: number
  doneAt?: number
}

type AgentPhase = 'idle' | 'running' | 'complete' | 'error'

export function useAgentWebSocket() {
  const [phase, setPhase] = useState<AgentPhase>('idle')
  const [nodeStates, setNodeStates] = useState<Record<string, NodeState>>({})
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [errorMsg, setErrorMsg] = useState<string>('')
  const [progress, setProgress] = useState(0)
  const wsRef = useRef<WebSocket | null>(null)
  const activeRef = useRef(false)

  // doneCount는 nodeStates에서 직접 계산 (렌더 시점)
  const doneCount = Object.values(nodeStates).filter((n) => n.status === 'done').length

  const startAnalysis = useCallback((profile: UserProfile) => {
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }

    activeRef.current = true
    setPhase('running')
    setNodeStates({})
    setResult(null)
    setErrorMsg('')
    setProgress(0)

    const apiBase = import.meta.env.VITE_API_BASE ?? `http://${window.location.hostname}:8000`
    const wsUrl = apiBase.replace(/^http/, 'ws') + '/ws/analyze'
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'start_analysis', profile }))
    }

    ws.onmessage = (evt) => {
      let msg: WsMessage
      try {
        msg = JSON.parse(evt.data) as WsMessage
      } catch {
        return
      }

      if (msg.type === 'node_event') {
        const { node, status, message, data } = msg

        setNodeStates((prev) => {
          const existing = prev[node]
          const next: Record<string, NodeState> = {
            ...prev,
            [node]: {
              status,
              message,
              data,
              // running 진입 시 시작 시간 기록
              startedAt: status === 'running' ? Date.now() : existing?.startedAt,
              // done 시 종료 시간 기록
              doneAt: status === 'done' ? Date.now() : existing?.doneAt,
            },
          }
          // 최신 상태 기준으로 progress 재계산 (stale closure 없음)
          const done = NODE_ORDER.filter((n) => next[n]?.status === 'done').length
          setProgress(Math.round((done / NODE_ORDER.length) * 100))
          return next
        })
      } else if (msg.type === 'complete') {
        activeRef.current = false
        setResult(msg.result)
        setProgress(100)
        setPhase('complete')
        ws.close()
        wsRef.current = null
      } else if (msg.type === 'error') {
        activeRef.current = false
        setErrorMsg(msg.message)
        setPhase('error')
        ws.close()
        wsRef.current = null
      }
    }

    ws.onerror = () => {
      setErrorMsg(
        'WebSocket 연결 실패 — 백엔드 서버(포트 8000)가 실행 중인지 확인하세요.\n' +
        '실행 명령: cd backend && uvicorn main:app --reload --port 8000',
      )
      setPhase('error')
      wsRef.current = null
    }

    ws.onclose = (evt) => {
      if (!evt.wasClean && activeRef.current) {
        activeRef.current = false
        setErrorMsg('WebSocket 연결이 예기치 않게 끊어졌습니다.')
        setPhase('error')
      }
      wsRef.current = null
    }
  }, []) // 의존성 없음 — 내부에서 setNodeStates 함수형 업데이트 사용

  const reset = useCallback(() => {
    activeRef.current = false
    wsRef.current?.close()
    wsRef.current = null
    setPhase('idle')
    setNodeStates({})
    setResult(null)
    setErrorMsg('')
    setProgress(0)
  }, [])

  return { phase, nodeStates, result, errorMsg, progress, doneCount, startAnalysis, reset }
}
