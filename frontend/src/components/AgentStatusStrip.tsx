import { useEffect, useState } from 'react'
import { Bot, CheckCircle2, Loader2, AlertCircle, Stethoscope, ClipboardCopy, X, Volume2 } from 'lucide-react'
import { getRpaBase } from '@/lib/backend'
import { isAuthVoice, setAuthVoice } from '@/lib/authCue'
import { useBackend } from '@/lib/useBackend'

type PfCheck = { id: string; name: string; ok: boolean; detail?: string }
type PfResult = { ok: boolean; checks: PfCheck[] }

/**
 * 🤖 에이전트 상태 스트립 — 데스크탑앱의 '연결·버전·발급 여유'를 한 줄로 보여주고,
 * [발급 전 점검]으로 브라우저 기동·정부24/복지로 연결·발급 폴더·디스크를 한 번에 점검한다
 * (데모 런북의 '발표 직전 리허설' 자동화 — 발급을 시작해봐야 실패를 아는 문제 해소).
 */
export function AgentStatusStrip() {
  const { ready, caps } = useBackend()
  const [pf, setPf] = useState<'idle' | 'running' | 'error' | PfResult>('idle')
  const [diagDone, setDiagDone] = useState(false) // 진단 복사 완료 표시(훅은 조기 return 앞에)
  const [voice, setVoice] = useState(() => isAuthVoice()) // 🔊 인증 음성 안내(기기 기억, 옵트인)
  const [autoOk, setAutoOk] = useState(false) // 조용한 자가점검이 '통과'했음(무소음 ✓ 표기용)

  // 🩺 조용한 자가점검 — 스트립이 처음 보일 때 1회(탭 세션당), 문제를 '발급 시작 전에' 발견한다.
  //   통과면 작은 ✓만(패널 안 엶 — 무소음), 실패면 수동 점검과 같은 결과 패널을 자동 표시.
  //   본인 PC 전용(공유/원격은 서버 403과 동일 기준으로 건너뜀) · F5 재실행 없음(sessionStorage).
  useEffect(() => {
    if (ready !== true || !caps?.rpa || caps.rpaRemote || caps.shared) return
    try {
      if (sessionStorage.getItem('modoobom-auto-pf')) return
      sessionStorage.setItem('modoobom-auto-pf', '1')
    } catch { return } // 저장 불가 환경(시크릿 등)이면 반복 실행 위험 — 자동 점검 생략(수동 버튼은 그대로)
    let alive = true
    const timer = setTimeout(async () => {
      try {
        const ctrl = new AbortController()
        const kill = setTimeout(() => ctrl.abort(), 45000)
        const r = await fetch(`${getRpaBase()}/api/_preflight`, { signal: ctrl.signal })
        clearTimeout(kill)
        const j = await r.json()
        if (!alive || !Array.isArray(j?.checks)) return
        if (j.ok) setAutoOk(true)          // 전부 정상 — 조용히 ✓만
        else setPf(j as PfResult)          // 문제 발견 — 결과 패널 자동 표시(원인·조치 안내)
      } catch { /* 자동 점검 실패는 조용히 — 수동 [발급 전 점검]이 항상 남아 있다 */ }
    }, 2500) // 첫 화면 렌더·상태 연결이 끝난 뒤(초기 로딩과 브라우저 프로브 경합 방지)
    return () => { alive = false; clearTimeout(timer) }
  }, [ready, caps])

  if (ready !== true || !caps?.rpa) return null
  const cap = caps.rpaCapacity
  const busy = cap && cap.accepting === false
  const slots = cap && typeof cap.active === 'number' && typeof cap.max_concurrent === 'number'
    ? `발급 슬롯 ${cap.active}/${cap.max_concurrent}${(cap.waiting || 0) > 0 ? ` · 대기 ${cap.waiting}` : ''}`
    : ''
  const running = pf === 'running'
  const result = typeof pf === 'object' ? pf : null

  const runPreflight = async () => {
    if (running) return
    setPf('running')
    try {
      // 브라우저 기동(수 초) + 정부사이트 응답(최대 6초)이 병렬로 돌아 보통 10초 안에 끝난다
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 45000)
      const r = await fetch(`${getRpaBase()}/api/_preflight`, { signal: ctrl.signal })
      clearTimeout(timer)
      const j = await r.json()
      if (Array.isArray(j?.checks)) setPf(j as PfResult)
      else setPf('error')
    } catch {
      setPf('error')
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
    <div className="mb-3 rounded-2xl border border-sprout-100 bg-sprout-50/50 px-3.5 py-2 text-[11px]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="inline-flex items-center gap-1.5 font-bold text-sprout-700">
          <Bot className="h-3.5 w-3.5" /> {caps.rpaRemote ? '원격 에이전트' : caps.shared ? '공유 에이전트' : '내 PC 에이전트'} 연결됨
          {caps.version && <span className="font-semibold text-muted-foreground">v{caps.version}</span>}
        </span>
        {slots && <span className={busy ? 'font-semibold text-amber-700' : 'text-muted-foreground'}>{busy ? `혼잡 — ${slots}` : slots}</span>}
        {autoOk && !result && (
          <span className="inline-flex items-center gap-1 font-semibold text-success-600"
            title="앱이 켜질 때 브라우저·정부24/복지로 연결·발급 폴더·디스크·서류함을 스스로 점검했어요 — 전부 정상">
            <CheckCircle2 className="h-3 w-3" /> 자가점검 통과
          </span>
        )}
        <span className="ml-auto inline-flex items-center gap-1.5">
          {running && (
            <span className="inline-flex items-center gap-1 font-semibold text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> 점검 중…(브라우저·정부망 확인)
            </span>
          )}
          {pf === 'error' && (
            <span className="inline-flex items-center gap-1 font-semibold text-rose-600">
              <AlertCircle className="h-3 w-3" /> 점검 요청 실패 — 에이전트 연결 확인
            </span>
          )}
          <button
            onClick={() => setVoice((v) => { setAuthVoice(!v); return !v })}
            aria-pressed={voice}
            title="인증 승인 차례가 되면 알림음에 더해 '휴대폰에서 인증 요청을 승인해 주세요'를 음성으로 읽어줘요(화면을 안 보는 어르신용)"
            className={`rounded-lg border px-2 py-1 font-semibold inline-flex items-center gap-1 ${voice ? 'border-sprout-500 bg-sprout-500 text-white' : 'border-sprout-200 bg-white text-sprout-700 hover:bg-sprout-50'}`}>
            <Volume2 className="h-3 w-3" /> {voice ? '인증 음성 안내 켬' : '인증 음성 안내'}
          </button>
          {!caps.rpaRemote && !caps.shared && (
            /* 발급 전 점검은 '내 PC' 전용 — 공유(원격) 서버에선 슬롯 우회 브라우저 기동이라 서버가 403으로 막는다 */
            <button onClick={runPreflight} disabled={running}
              title="발급용 브라우저·정부24/복지로 연결·발급 폴더·디스크를 발급 시작 전에 한 번에 점검해요"
              className="rounded-lg border border-sprout-200 bg-white px-2 py-1 font-semibold text-sprout-700 hover:bg-sprout-50 disabled:opacity-50 inline-flex items-center gap-1">
              <Stethoscope className="h-3 w-3" /> 발급 전 점검
            </button>
          )}
          <button onClick={copyDiag}
            title="발급이 안 될 때 개발자에게 붙여넣을 기술 정보를 복사해요(개인정보 없음)"
            className="rounded-lg border border-sprout-200 bg-white px-2 py-1 font-semibold text-sprout-700 hover:bg-sprout-50 inline-flex items-center gap-1">
            <ClipboardCopy className="h-3 w-3" /> {diagDone ? '복사됨 ✓' : '진단 복사'}
          </button>
        </span>
      </div>
      {result && (
        <div className="mt-2 rounded-xl border border-sprout-100 bg-white px-3 py-2" role="status" aria-live="polite">
          <div className="mb-1 flex items-center justify-between">
            <span className={`font-bold ${result.ok ? 'text-success-600' : 'text-amber-700'}`}>
              {result.ok ? '✓ 모두 정상 — 발급 준비 완료' : '△ 일부 항목 점검 필요 (아래 표시)'}
            </span>
            <button onClick={() => setPf('idle')} aria-label="점검 결과 닫기"
              className="rounded p-0.5 text-muted-foreground hover:bg-sprout-50"><X className="h-3 w-3" /></button>
          </div>
          <ul className="grid gap-x-4 gap-y-0.5 sm:grid-cols-2">
            {result.checks.map(c => (
              <li key={c.id} className="flex items-center gap-1.5">
                {c.ok
                  ? <CheckCircle2 className="h-3 w-3 shrink-0 text-success-600" />
                  : <AlertCircle className="h-3 w-3 shrink-0 text-rose-600" />}
                <span className={c.ok ? '' : 'font-semibold text-rose-700'}>
                  {c.name}{c.detail ? <span className="text-muted-foreground"> · {c.detail}</span> : null}
                </span>
              </li>
            ))}
          </ul>
          {!result.ok && (
            <p className="mt-1 text-muted-foreground">
              정부 사이트 연결 실패는 발표장 회선이 정부망을 막는 경우가 많아요 — 핫스팟 등 다른 회선으로 확인해 보세요.
              브라우저 실패면 크롬 설치를 확인하세요. 안 되면 [진단 복사]로 기술 정보를 전달해 주세요.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
