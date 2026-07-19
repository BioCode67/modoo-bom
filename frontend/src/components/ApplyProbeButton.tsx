import { useRef, useState } from 'react'
import { getRpaBase } from '@/lib/backend'
import { useBackend } from '@/lib/useBackend'
import { isBokjiroApplyable } from '@/lib/quickApply'
import { addApplyExtra, isApplyExtra, removeApplyExtra } from '@/lib/applyExtra'

/**
 * 🔎 자동신청 가능 확인(β) — 자동신청 버튼이 안 뜨는 정책에서, 데스크탑 에이전트가 복지로를
 * 실측(검색→wlfareInfoId 발굴→상세 일치 확인)해 통과하면 이 브라우저에 β 딥링크로 기억한다
 * → AgentSubmitButton(불변)이 다음 렌더에서 그대로 나타난다.
 *
 * 정직성: 복지로는 비로그인 시 방문형에도 '신청하기'를 렌더하므로 결과는 '후보(β)'다 —
 * 온라인 신청형인지는 첫 자동신청이 판별(버튼 없으면 백엔드가 정직한 실패 + 공식 링크 폴백).
 * 지자체(LOC-) 정책은 동명 국가사업 오연결 위험이 있어 실측 대상에서 제외한다(기존 규칙과 동일).
 */
export function ApplyProbeButton({ policy }: { policy: { id: string; name: string; application: string } }) {
  const { ready, caps } = useBackend()
  const [phase, setPhase] = useState<'idle' | 'running' | 'fail'>('idle')
  const [msg, setMsg] = useState('')
  const busyRef = useRef(false)

  // 본인 PC 에이전트에서만(원격/공유는 서버도 403) · LOC- 제외(오연결 금지)
  const canProbe = ready === true && !!caps?.rpa && !caps?.rpaRemote && !caps?.shared
  if (!canProbe || policy.id.startsWith('LOC-')) return null

  if (isBokjiroApplyable(policy.application, policy.name, policy.id)) {
    // 이미 신청 가능 — 그중 'β 실측 등록'으로 가능해진 경우만 관리 줄(β 의미 + 해제) 노출
    if (!isApplyExtra(policy.name)) return null
    return (
      <p className="mt-1.5 text-[11px] text-muted-foreground">
        🔎 <b className="text-sky2-700">실측 등록(β)</b>된 신청 딥링크예요 — 첫 자동신청 완주(양식 도달)가 최종 검증.
        방문형으로 판명되면{' '}
        <button onClick={() => removeApplyExtra(policy.name)} className="underline font-semibold hover:text-rose-600">
          등록 해제
        </button>
        하면 공식 링크 안내로 돌아가요.
      </p>
    )
  }

  const run = async () => {
    if (busyRef.current) return
    busyRef.current = true
    setPhase('running')
    setMsg('')
    try {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 90000)
      const r = await fetch(`${getRpaBase()}/api/apply/probe`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ service_name: policy.name }), signal: ctrl.signal,
      })
      clearTimeout(timer)
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j?.detail || `확인 실패(${r.status})`)
      if (j.status === 'candidate' && addApplyExtra(policy.name, { url: j.url, wlfareInfoId: j.wlfareInfoId, title: j.title })) {
        setPhase('idle') // 등록 이벤트로 드로어가 재렌더 → 자동신청 버튼 + 위 β 관리 줄로 전환
      } else {
        setPhase('fail')
        setMsg(j.message || '복지로에서 신청 상세를 확정하지 못했어요 — 공식 링크로 신청해 주세요.')
      }
    } catch (e) {
      setPhase('fail')
      setMsg(e instanceof Error ? e.message : '실측 확인에 실패했어요 — 잠시 후 다시 시도해 주세요.')
    } finally {
      busyRef.current = false
    }
  }

  return (
    <div className="mt-2">
      <button onClick={run} disabled={phase === 'running'}
        title="복지로를 실측 조사해(개인정보 없이) 이 정책의 신청 딥링크를 찾으면 자동신청 버튼이 바로 생겨요(β)"
        className="rounded-xl border-2 border-sky2-100 bg-white px-3 py-2 text-xs font-semibold text-sky2-700 hover:border-sky2-300 transition-colors disabled:opacity-60">
        {phase === 'running' ? '⏳ 복지로에서 실측 확인 중… (30초 정도)' : '🔎 자동신청 가능한지 실측 확인(β)'}
      </button>
      {phase === 'fail' && (
        <p className="mt-1 text-[11px] font-semibold text-rose-600" role="status" aria-live="polite">{msg}</p>
      )}
    </div>
  )
}
