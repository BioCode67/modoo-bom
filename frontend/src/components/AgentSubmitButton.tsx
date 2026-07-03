import { useEffect, useState } from 'react'
import { Bot, Loader2, ExternalLink, ShieldCheck, AlertCircle } from 'lucide-react'
import type { Policy } from '@/data/policies'
import type { EligiblePolicy } from '@/lib/welfare-engine'
import { useBackend } from '@/lib/useBackend'
import { isApplyAutomatable, applyLink } from '@/lib/officialLinks'
import { API_BASE } from '@/lib/backend'
import { detectExtension, applyViaExtension, onExtensionStatus, sameDocName } from '@/lib/extension'
import { RpaInfoForm } from '@/components/RpaInfoForm'
import { useAppStore } from '@/store/useAppStore'

type RunState = { status: string; step: string; shot?: string; at?: number } | null

/**
 * 에이전트 신청 자동화 — 정직한 human-in-the-loop.
 * 로컬 에이전트(백엔드) 또는 크롬 확장이 있을 때 실제 RPA 구동. 본인인증·최종 제출은 사용자가 직접.
 */
export function AgentSubmitButton({ policy }: { policy: Policy | EligiblePolicy }) {
  const { ready, caps } = useBackend()
  const profile = useAppStore((s) => s.profile)
  const rpaInfo = useAppStore((s) => s.rpaInfo)
  const [run, setRun] = useState<RunState>(null)
  const [ext, setExt] = useState(false)
  const automatable = isApplyAutomatable(policy.name)

  // 확장 감지 + 진행상태 구독(해당 서비스만 — 표기 차이는 퍼지매칭) + 무응답 감지용 틱
  const [tick, setTick] = useState(0)
  useEffect(() => {
    detectExtension().then(setExt)
    const t = setInterval(() => setTick((x) => x + 1), 7000)
    const off = onExtensionStatus((s) => {
      if (sameDocName(s.docName, policy.name)) setRun({ status: s.status, step: s.step, at: Date.now() })
    })
    return () => { clearInterval(t); off() }
  }, [policy.name])

  // 복지로/한국장학재단 신청 URL을 가진 정책이면 확장으로 자동신청 가능(내장 6종에 국한하지 않음)
  const app = policy.application || ''
  const isExtApplyable = /bokjiro\.go\.kr/.test(app) || /kosaf\.go\.kr/.test(app)
  const showApply = automatable || isExtApplyable
  if (!showApply) return null

  // 실제 자동화 가능 여부: 확장(복지로/장학재단) 또는 로컬 에이전트(내장 6종).
  const rpaReady = ready === true && !!caps?.rpa
  const canExt = ext && isExtApplyable
  const canLocal = rpaReady && automatable
  const canRpa = canExt || canLocal
  if (!canRpa) {
    return (
      <div className="rounded-2xl border-2 border-dashed border-sprout-200 bg-sprout-50/50 p-4">
        <p className="text-sm font-bold flex items-center gap-1.5"><Bot className="h-4 w-4 text-sprout-500" /> 에이전트 자동 신청</p>
        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
          크롬 확장(또는 데스크톱 앱)을 설치하면 에이전트가 복지로 로그인·이동·양식 작성까지 대신 해드려요.
          지금은 아래에서 직접 신청하실 수 있어요. <b>본인인증·최종 제출은 본인이 직접</b> 하셔야 해요.
        </p>
        <a href={applyLink(policy.application).url} target="_blank" rel="noopener noreferrer" className="btn-secondary !py-2 mt-2 text-xs">
          <ExternalLink className="h-3.5 w-3.5" /> {applyLink(policy.application).label}
        </a>
      </div>
    )
  }

  const start = async () => {
    setRun({ status: 'running', step: '에이전트 시작 — 새 탭에서 복지로에 접속해요…', at: Date.now() })
    // 로컬 에이전트(내장 6종)가 되면 백엔드 우선, 아니면 확장으로 신청(복지로 딥링크 전달)
    if (!canLocal && canExt) {
      const r = await applyViaExtension(policy.name, {
        user_name: rpaInfo.name || profile?.name || '사용자', birth_date: rpaInfo.birth_date, phone: rpaInfo.phone, carrier: rpaInfo.carrier,
      }, policy.application)
      if (!r.ok) setRun({ status: 'error', step: r.error || '이 서비스는 확장 자동신청을 아직 지원하지 않아요.', at: Date.now() })
      return
    }
    try {
      const res = await fetch(`${API_BASE}/api/apply/start`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ service_name: policy.name, user_name: rpaInfo.name || profile?.name || '사용자', profile: { ...(profile || {}), ...rpaInfo } }),
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
  // 30초 넘게 진행상태가 안 오면(새 탭에서 본인인증 대기 등) 멈춘 게 아니라는 걸 정직하게 안내
  const stale = !!(run && !done && run.at && Date.now() - run.at > 30000 && tick >= 0)

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
            {run.status === 'error' ? <AlertCircle className="h-4 w-4 text-rose-500" /> : done ? <ShieldCheck className="h-4 w-4 text-success-500" /> : <Loader2 className="h-4 w-4 animate-spin text-sprout-500" />}
            <span className="font-medium">{run.step}</span>
          </p>
          {stale && (
            <div className="mt-2 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-[11px] text-amber-800">
              진행이 잠시 멈춘 듯해요 — 확장이 연 <b>복지로 탭</b>을 확인해 주세요. 본인인증·'신청하기'처럼
              <b> 직접 눌러야 하는 단계</b>일 수 있어요(그 탭 화면의 안내를 따라주세요).
              <span className="block mt-1">
                <a href={applyLink(policy.application).url} target="_blank" rel="noopener noreferrer" className="underline font-semibold">공식 페이지에서 직접 신청</a>
                {' · '}<button onClick={() => setRun(null)} className="underline font-semibold">처음부터 다시</button>
              </span>
            </div>
          )}
          {run.shot && (
            <img src={`data:image/jpeg;base64,${run.shot}`} alt="에이전트 진행 화면" className="mt-2 w-full rounded-xl border border-sprout-100" />
          )}
          {done && <p className="text-[11px] text-muted-foreground mt-2">브라우저 창에서 본인인증 후 내용을 확인하고 최종 제출해 주세요.</p>}
        </div>
      )}
    </div>
  )
}
