import { useEffect, useRef, useState } from 'react'
import { PlayCircle, Loader2, ShieldCheck, AlertCircle } from 'lucide-react'
import { getDemoRpaBase } from '@/lib/backend'

/**
 * 실제 정부24 자동화 '체험' — 개인정보 없이, 실제 정부 사이트를 자동 조작하는 과정을 스크린샷으로 보여주고
 * 본인인증 화면에서 정지한다. 배포 사이트 방문자(심사위원·참가자)가 설치·인증·개인정보 없이 '진짜 자동화'를
 * 30초 체험 → 추천(표) 유도. Mock 아님(진짜 정부24 접속 스크린샷). 서버(getDemoRpaBase) 없으면 렌더 안 함.
 */
type Shot = { step: string; img: string }

export function DemoAutomation() {
  const base = getDemoRpaBase()
  const [state, setState] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [shots, setShots] = useState<Shot[]>([])
  const [msg, setMsg] = useState('')
  const [live, setLive] = useState<boolean | null>(null) // 서버 도달 여부(null=확인 중)
  const mounted = useRef(true)
  const running = useRef(false)
  useEffect(() => () => { mounted.current = false }, [])

  // 마운트 시 데모 서버 health 프리체크 — 서버가 꺼져 있으면 죽은 버튼을 안 보여주고 정직히 안내.
  useEffect(() => {
    if (!base) { setLive(false); return }
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 6000)
    fetch(`${base}/api/health`, { signal: ctrl.signal })
      .then((r) => r.ok ? r.json() : null)
      .then((j) => { if (mounted.current) setLive(!!(j && j.capabilities?.rpa)) })
      .catch(() => { if (mounted.current) setLive(false) })
      .finally(() => clearTimeout(t))
    return () => { clearTimeout(t); ctrl.abort() }
  }, [base])

  if (!base) return null // 데모 서버 미연결 시 노출 안 함(빌드 시 VITE_RPA_BASE 또는 로컬/옵트인 감지)
  if (live === false) return null // 서버는 지정됐지만 지금 꺼져 있음 → 죽은 버튼 대신 미노출(정직성)

  const start = async () => {
    if (running.current) return
    running.current = true
    setState('running'); setShots([]); setMsg('실제 정부24에 접속하고 있어요…')
    try {
      const res = await fetch(`${base}/api/rpa/demo-start`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.detail || '지금은 체험이 어려워요. 잠시 후 다시 시도해 주세요.')
      }
      const { task_id, download_token } = await res.json()
      const tq = download_token ? `?t=${encodeURIComponent(download_token)}` : ''
      const seen = new Set<string>()
      for (let i = 0; i < 40; i++) { // 최대 ~100초
        await new Promise((r) => setTimeout(r, 2500))
        if (!mounted.current) return
        const st = await fetch(`${base}/api/documents/rpa-status/${task_id}${tq}`).then((r) => r.json()).catch(() => null)
        if (!st) continue
        const step: string = st.current_step || ''
        const img: string = st.screenshot_b64 || ''
        if (step) setMsg(step)
        if (img && !seen.has(img.slice(0, 32))) { // 새 스크린샷만 누적
          seen.add(img.slice(0, 32))
          setShots((s) => [...s, { step: step || `단계 ${s.length + 1}`, img }])
        }
        if (st.status === 'done') { setState('done'); running.current = false; return }
        if (st.status === 'error') { setMsg(st.current_step || '체험 중 오류가 났어요.'); setState('error'); running.current = false; return }
      }
      setState('done'); running.current = false
    } catch (e) {
      if (!mounted.current) return
      setMsg(e instanceof Error ? e.message : '체험 중 오류가 났어요.')
      setState('error'); running.current = false
    }
  }

  return (
    <div className="mx-auto mt-8 max-w-2xl rounded-3xl border-2 border-sprout-200 bg-white/80 p-5 shadow-sm">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-5 w-5 text-sprout-600" />
        <h3 className="text-sm font-extrabold text-foreground">실제 정부24 자동화 체험 <span className="text-sprout-700">· 개인정보 없이 30초</span></h3>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        누르면 <b className="text-foreground">진짜 정부24</b>를 프로그램이 자동으로 조작하는 걸 화면으로 보여줘요.
        주민번호·이름은 <b className="text-foreground">묻지 않아요</b> — 본인인증 화면에서 멈춰요(실제 발급은 본인 폰 인증 후).
      </p>

      {state === 'idle' && live === null && (
        <div className="mt-4 inline-flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> 데모 서버 연결 확인 중…
        </div>
      )}
      {state === 'idle' && live === true && (
        <button onClick={start} className="btn-primary mt-4 inline-flex items-center gap-2 !py-2.5">
          <PlayCircle className="h-5 w-5" /> 실제 자동화 체험 시작
        </button>
      )}

      {(state === 'running' || shots.length > 0) && (
        <div className="mt-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium text-sprout-800">
            {state === 'running' && <Loader2 className="h-4 w-4 animate-spin" />}
            <span>{msg}</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {shots.map((s, i) => (
              <figure key={i} className="overflow-hidden rounded-xl border border-border/60">
                <img src={`data:image/jpeg;base64,${s.img}`} alt={s.step} className="w-full" loading="lazy" />
                <figcaption className="bg-sprout-50 px-2 py-1 text-[11px] text-sprout-800">{s.step}</figcaption>
              </figure>
            ))}
          </div>
        </div>
      )}

      {state === 'error' && (
        <div className="mt-3 flex items-start gap-2 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> <span>{msg}</span>
        </div>
      )}

      {state === 'done' && (
        <div className="mt-4 rounded-xl bg-sprout-50 p-3 text-sm text-sprout-900">
          ✅ 방금 <b>진짜 정부24</b>를 자동으로 조작했어요. 실제 서류 발급은 <b>본인인증(내 폰)</b>만 하면 이어서 자동으로 끝나요.
          <button onClick={() => { setState('idle'); setShots([]) }} className="ml-2 underline">다시 체험</button>
        </div>
      )}
    </div>
  )
}
