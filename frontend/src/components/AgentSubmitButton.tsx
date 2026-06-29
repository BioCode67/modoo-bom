import { useState } from 'react'
import { Bot, Loader2, ExternalLink, ShieldCheck, AlertCircle } from 'lucide-react'
import type { Policy } from '@/data/policies'
import type { EligiblePolicy } from '@/lib/welfare-engine'
import { useBackend } from '@/lib/useBackend'
import { isApplyAutomatable, applyLink } from '@/lib/officialLinks'
import { API_BASE } from '@/lib/backend'
import { RpaInfoForm } from '@/components/RpaInfoForm'
import { useAppStore } from '@/store/useAppStore'

type RunState = { status: string; step: string; shot?: string } | null

/**
 * 에이전트 신청 자동화 — 정직한 human-in-the-loop.
 * 백엔드(데스크톱) 있을 때만 실제 RPA 구동. 본인인증·최종 제출은 사용자가 직접.
 */
export function AgentSubmitButton({ policy }: { policy: Policy | EligiblePolicy }) {
  const backend = useBackend()
  const profile = useAppStore((s) => s.profile)
  const rpaInfo = useAppStore((s) => s.rpaInfo)
  const [run, setRun] = useState<RunState>(null)
  const automatable = isApplyAutomatable(policy.name)

  if (!automatable) return null

  // 백엔드 없음(배포 환경 등) → 정직한 안내 + 직접 신청 링크
  if (backend === false) {
    return (
      <div className="rounded-2xl border-2 border-dashed border-sprout-200 bg-sprout-50/50 p-4">
        <p className="text-sm font-bold flex items-center gap-1.5"><Bot className="h-4 w-4 text-sprout-500" /> 에이전트 자동 신청</p>
        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
          데스크톱 앱(백엔드)을 실행하면 에이전트가 복지로 로그인·이동·양식 작성까지 대신 해드려요.
          지금은 아래에서 직접 신청하실 수 있어요. <b>본인인증·최종 제출은 본인이 직접</b> 하셔야 해요.
        </p>
        <a href={applyLink(policy.application).url} target="_blank" rel="noopener noreferrer" className="btn-secondary !py-2 mt-2 text-xs">
          <ExternalLink className="h-3.5 w-3.5" /> {applyLink(policy.application).label}
        </a>
      </div>
    )
  }

  const start = async () => {
    setRun({ status: 'running', step: '에이전트 시작 — 복지로 접속 중…' })
    try {
      const res = await fetch(`${API_BASE}/api/apply/start`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ service_name: policy.name, user_name: profile?.name || '사용자', profile: { ...(profile || {}), ...rpaInfo } }),
      })
      if (!res.ok) throw new Error('이 서비스는 자동 신청을 지원하지 않아요')
      const { task_id } = await res.json()
      for (let i = 0; i < 200; i++) {
        await new Promise((r) => setTimeout(r, 1500))
        const st = await fetch(`${API_BASE}/api/apply/status/${task_id}`).then((r) => r.json())
        setRun({ status: st.status, step: st.current_step || st.status, shot: st.screenshot_b64 || undefined })
        if (['done', 'error', 'completed'].includes(st.status)) break
      }
    } catch (e) {
      setRun({ status: 'error', step: e instanceof Error ? e.message : '실패' })
    }
  }

  const done = run && ['done', 'error', 'completed'].includes(run.status)

  return (
    <div className="rounded-2xl border-2 border-sprout-200 bg-sprout-50/50 p-4">
      <p className="text-sm font-bold flex items-center gap-1.5"><Bot className="h-4 w-4 text-sprout-500" /> 에이전트 자동 신청 <span className="chip-sun !py-0 text-[10px]">베타</span></p>
      <p className="text-xs text-muted-foreground mt-1 leading-relaxed flex items-start gap-1">
        <ShieldCheck className="h-3.5 w-3.5 text-sprout-500 shrink-0 mt-0.5" />
        에이전트가 복지로 로그인→서비스 이동→양식 작성까지 진행해요. <b>카카오 본인인증과 최종 제출은 본인이 직접</b> 하셔야 안전해요.
      </p>

      {!run ? (
        <>
          <RpaInfoForm />
          <button onClick={start} className="btn-primary !py-2 mt-3 text-xs"><Bot className="h-4 w-4" /> 에이전트로 신청 시작</button>
        </>
      ) : (
        <div className="mt-3">
          <p className="text-xs flex items-center gap-1.5">
            {run.status === 'error' ? <AlertCircle className="h-4 w-4 text-rose-500" /> : done ? <ShieldCheck className="h-4 w-4 text-sprout-500" /> : <Loader2 className="h-4 w-4 animate-spin text-sprout-500" />}
            <span className="font-medium">{run.step}</span>
          </p>
          {run.shot && (
            <img src={`data:image/jpeg;base64,${run.shot}`} alt="에이전트 진행 화면" className="mt-2 w-full rounded-xl border border-sprout-100" />
          )}
          {done && <p className="text-[11px] text-muted-foreground mt-2">브라우저 창에서 본인인증 후 내용을 확인하고 최종 제출해 주세요.</p>}
        </div>
      )}
    </div>
  )
}
