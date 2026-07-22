import { useEffect, useState } from 'react'
import { Bot, CheckCircle2, Loader2, AlertCircle, Stethoscope, ClipboardCopy, X, Volume2, Film } from 'lucide-react'
import { getRpaBase } from '@/lib/backend'
import { copyAgentDiagnostic, copyFlowRecord } from '@/lib/diag'
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
  const [flowDone, setFlowDone] = useState(false) // 🎬 흐름 기록 복사 완료 표시
  const [voice, setVoice] = useState(() => isAuthVoice()) // 🔊 인증 음성 안내(기기 기억, 옵트인)
  const [autoOk, setAutoOk] = useState(false) // 조용한 자가점검이 '통과'했음(무소음 ✓ 표기용)

  // 🩺 조용한 자가점검 — 스트립이 처음 보일 때 1회(탭 세션당), 문제를 '발급 시작 전에' 발견한다.
  //   통과면 작은 ✓만(패널 안 엶 — 무소음), 실패면 수동 점검과 같은 결과 패널을 자동 표시.
  //   본인 PC 전용(공유/원격은 서버 403과 동일 기준으로 건너뜀) · F5 재실행 없음(sessionStorage).
  useEffect(() => {
    if (ready !== true || !caps?.rpa || caps.rpaRemote || caps.shared) return
    try {
      if (sessionStorage.getItem('modoobom-auto-pf')) return
    } catch { return } // 접근 불가 환경(시크릿 등)이면 반복 실행 위험 — 자동 점검 생략(수동 버튼은 그대로)
    let alive = true
    const timer = setTimeout(async () => {
      // 실행 '시점'에 기록 — 2.5초 안에 화면을 떠나 타이머가 취소되면 다음 방문에서 다시 시도되게
      try {
        if (sessionStorage.getItem('modoobom-auto-pf')) return
        sessionStorage.setItem('modoobom-auto-pf', '1')
      } catch { return }
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

  // 🩺 진단 복사 — 기술정보(_diag) + 실패 화면 구조(자가진단)를 한 번에(공용 lib/diag). 개발 환경에서
  //   실제 gov 사이트에 접속 못 하는 제약을, 사용자가 스샷 대신 이 한 번의 복사로 메운다.
  const copyDiag = async () => {
    if (await copyAgentDiagnostic()) { setDiagDone(true); setTimeout(() => setDiagDone(false), 2500) }
  }

  // 🎬 흐름 기록 복사 — run-local-app.bat 로 앱을 켜면 흐름 기록(RPA_FLOW_RECORD=1)이 자동으로 켜져,
  //   자동발급/신청을 한 번 진행하면 '지나간 화면들'의 구조가 쌓인다(값 없음). 이 버튼이 그걸 한 덩어리로
  //   복사 → 개발자가 스샷 없이 다음 화면·새 팝업까지 한 번에 파악.
  const copyFlow = async () => {
    if (await copyFlowRecord()) { setFlowDone(true); setTimeout(() => setFlowDone(false), 2500) }
  }

  return (
    <div className="mb-3 rounded-2xl border border-sprout-100 bg-sprout-50/50 px-3.5 py-2 text-[11px]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="inline-flex items-center gap-1.5 font-bold text-sprout-700">
          <Bot className="h-3.5 w-3.5" /> {caps.rpaRemote ? '원격 에이전트' : caps.shared ? '공유 에이전트' : '내 PC 에이전트'} 연결됨
          {caps.version && (
            /* 버전·빌드일·커밋을 함께 — '이 exe가 최신 코드인지'를 한눈에(구버전이면 날짜/커밋이 다름).
               버전은 백엔드(로컬 에이전트), 빌드일·커밋은 지금 보는 프론트 번들 — 데스크탑앱은 함께 빌드된다.
               ⚠️ 사용자가 '어느 버전인지 헷갈린다' 제보 → 은은한 muted 텍스트를 '테두리 알약'으로 승격해 눈에 띄게. */
            <span className="inline-flex items-center gap-1 rounded-full border border-sprout-300 bg-white px-2 py-0.5 font-mono text-[10.5px] leading-none"
              title={`앱 버전 v${caps.version} · 프론트 빌드 ${__BUILD_DATE__}${__BUILD_SHA__ ? ` (${__BUILD_SHA__})` : ''} — 최신 배포와 커밋/날짜가 같으면 최신본입니다`}>
              <span className="font-extrabold text-sprout-700">모두봄 v{caps.version}</span>
              <span className="font-normal text-muted-foreground">· 빌드 {__BUILD_DATE__}{__BUILD_SHA__ ? ` · ${__BUILD_SHA__}` : ''}</span>
            </span>
          )}
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
          {caps.flowRecord && (
            /* 🎬 흐름 기록 모드에서만 노출(run-local-app.bat 는 자동 켬 · 설치 EXE는 미설정이라 심사위원에겐 안 보임).
               자동발급/신청을 한 번 끝까지 진행한 뒤 이 버튼으로 '지나간 화면 구조'(값 없음)를 복사해 개발자에게. */
            <button onClick={copyFlow}
              title="지나간 화면 구조를 기록 중이에요 — 자동발급/신청을 한 번 진행한 뒤 이 버튼으로 화면 구조(개인정보 없음)를 복사해 개발자에게 붙여넣어 주세요"
              className="rounded-lg border border-violet-300 bg-violet-50 px-2 py-1 font-semibold text-violet-700 hover:bg-violet-100 inline-flex items-center gap-1">
              <Film className="h-3 w-3" /> {flowDone ? '복사됨 ✓' : '흐름 기록 복사'}
            </button>
          )}
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
                {/* 발견에서 조치까지 원탭 — 서류함 손상은 바로 그 자리(⚠️ 배지·재발급 버튼)로 데려간다 */}
                {c.id === 'vault' && !c.ok && (
                  <button
                    onClick={() => document.getElementById('doc-vault')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                    className="shrink-0 rounded-md border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-[10px] font-bold text-rose-600 hover:bg-rose-100">
                    서류함 보기 ↓
                  </button>
                )}
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
