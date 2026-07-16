import { useState } from 'react'
import { Bot, CheckCircle2, Loader2, AlertCircle, Stethoscope, ClipboardCopy } from 'lucide-react'
import { getRpaBase } from '@/lib/backend'
import { useBackend } from '@/lib/useBackend'

/**
 * 🤖 에이전트 상태 스트립 — 데스크탑앱의 '연결·버전·발급 여유'를 한 줄로 보여주고,
 * [브라우저 점검]으로 발급 시작 전에 브라우저/드라이버 파손을 미리 잡는다(발급을 시작해봐야 실패를
 * 아는 문제 해소). 감사 갭: version·capacity가 health에 있는데 UI 어디에도 없었다.
 */
export function AgentStatusStrip() {
  const { ready, caps } = useBackend()
  const [test, setTest] = useState<'idle' | 'running' | 'ok' | 'fail'>('idle')
  const [testMsg, setTestMsg] = useState('')
  const [diagDone, setDiagDone] = useState(false) // 진단 복사 완료 표시(훅은 조기 return 앞에)

  if (ready !== true || !caps?.rpa) return null
  const cap = caps.rpaCapacity
  const busy = cap && cap.accepting === false
  const slots = cap && typeof cap.active === 'number' && typeof cap.max_concurrent === 'number'
    ? `발급 슬롯 ${cap.active}/${cap.max_concurrent}${(cap.waiting || 0) > 0 ? ` · 대기 ${cap.waiting}` : ''}`
    : ''

  const runTest = async () => {
    if (test === 'running') return
    setTest('running'); setTestMsg('')
    try {
      const r = await fetch(`${getRpaBase()}/api/_selftest/browser`)
      const j = await r.json().catch(() => ({}))
      if (r.ok && j.ok) { setTest('ok'); setTestMsg(`브라우저 정상 (${j.browser || 'chromium'})`) }
      else { setTest('fail'); setTestMsg(j.error ? String(j.error).slice(0, 120) : '브라우저 점검 실패') }
    } catch {
      setTest('fail'); setTestMsg('에이전트에 연결할 수 없어요')
    }
  }

  // 🩺 진단 복사 — 발급이 안 될 때 개발자에게 그대로 붙여넣는 기술 정보(PII 무포함, 서버에서 걸러줌).
  const copyDiag = async () => {
    try {
      const r = await fetch(`${getRpaBase()}/api/_diag`)
      const j = await r.json()
      await navigator.clipboard.writeText(`[모두봄 에이전트 진단]\n${JSON.stringify(j, null, 2)}`)
      setDiagDone(true); setTimeout(() => setDiagDone(false), 2500)
    } catch { /* 클립보드 미지원 등 — 조용히 무시(부가 기능) */ }
  }

  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-sprout-100 bg-sprout-50/50 px-3.5 py-2 text-[11px]">
      <span className="inline-flex items-center gap-1.5 font-bold text-sprout-700">
        <Bot className="h-3.5 w-3.5" /> {caps.rpaRemote ? '원격 에이전트' : '내 PC 에이전트'} 연결됨
        {caps.version && <span className="font-semibold text-muted-foreground">v{caps.version}</span>}
      </span>
      {slots && <span className={busy ? 'font-semibold text-amber-700' : 'text-muted-foreground'}>{busy ? `혼잡 — ${slots}` : slots}</span>}
      <span className="ml-auto inline-flex items-center gap-1.5">
        {test !== 'idle' && (
          <span className={`inline-flex items-center gap-1 font-semibold ${test === 'ok' ? 'text-success-600' : test === 'fail' ? 'text-rose-600' : 'text-muted-foreground'}`}>
            {test === 'running' ? <Loader2 className="h-3 w-3 animate-spin" /> : test === 'ok' ? <CheckCircle2 className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
            {test === 'running' ? '점검 중…' : testMsg}
          </span>
        )}
        <button onClick={runTest} disabled={test === 'running'}
          title="발급용 브라우저가 실제로 뜨는지 창 없이 점검해요(발급 시작 전 사전 확인)"
          className="rounded-lg border border-sprout-200 bg-white px-2 py-1 font-semibold text-sprout-700 hover:bg-sprout-50 disabled:opacity-50 inline-flex items-center gap-1">
          <Stethoscope className="h-3 w-3" /> 브라우저 점검
        </button>
        <button onClick={copyDiag}
          title="발급이 안 될 때 개발자에게 붙여넣을 기술 정보를 복사해요(개인정보 없음)"
          className="rounded-lg border border-sprout-200 bg-white px-2 py-1 font-semibold text-sprout-700 hover:bg-sprout-50 inline-flex items-center gap-1">
          <ClipboardCopy className="h-3 w-3" /> {diagDone ? '복사됨 ✓' : '진단 복사'}
        </button>
      </span>
    </div>
  )
}
