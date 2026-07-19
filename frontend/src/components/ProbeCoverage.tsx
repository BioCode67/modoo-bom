import { useEffect, useRef, useState } from 'react'
import { getRpaBase } from '@/lib/backend'

/**
 * 🔎 커버리지 실측 추가 — 서류명 하나(또는 후보 일괄)로 데스크탑 에이전트가 정부24를 실제 조사해
 * (검색→민원 코드 발굴→발급버튼 확인) 통과하면 **재시작 없이** 자동발급 목록(β)에 추가한다.
 *
 * 정직성: 실측 실패·온라인 발급 비대상은 그대로 보고(추측 등재 없음). 성공해도 β —
 * '첫 실발급 완주'가 최종 검증임을 문구로 명시한다. 본인 PC 전용(공유 배포는 서버가 403).
 * 후보 칩은 카탈로그 required_docs 빈도 기반 '실측 대상 목록'일 뿐, 지원을 약속하지 않는다.
 */
export const PROBE_DOC_EVENT = 'modoobom:probe-doc'

// 패널이 아직 안 열려 컴포넌트가 마운트 전이면 이벤트가 유실된다 — 보류 이름을 남겨 마운트 시 이어받는다
let _pending = ''
export function requestProbe(doc: string) {
  _pending = doc
  try { window.dispatchEvent(new CustomEvent(PROBE_DOC_EVENT, { detail: doc })) } catch { /* SSR 등 무시 */ }
}
function takePending(): string {
  const p = _pending
  _pending = ''
  return p
}

type ProbeState =
  | { phase: 'idle' }
  | { phase: 'running'; label: string }
  | { phase: 'done'; ok: boolean; msg: string }

export function ProbeCoverage({ onExpanded }: { onExpanded: (supported: string[], beta: string[]) => void }) {
  const [name, setName] = useState('')
  const [cands, setCands] = useState<string[]>([])
  const [st, setSt] = useState<ProbeState>({ phase: 'idle' })
  const busyRef = useRef(false)

  // 실측 요청 공통 경로 — 단건({doc_name})·일괄({doc_names}) 모두 여기로
  const probe = async (body: { doc_name?: string; doc_names?: string[] }, label: string) => {
    if (busyRef.current) return
    busyRef.current = true
    setSt({ phase: 'running', label })
    try {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 300000) // 일괄(최대 12종 × ~30초) 대비 — 무한 대기는 금지
      const r = await fetch(`${getRpaBase()}/api/docs/probe`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: ctrl.signal,
      })
      clearTimeout(timer)
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j?.detail || `확인 실패(${r.status})`)
      if (j.status === 'ok') {
        onExpanded(j.supported || [], j.beta || [])
        const reg: string[] = j.registered || []
        const failed = (j.rows || []).filter((row: { verdict?: string }) => !String(row.verdict || '').startsWith('✅'))
        setCands((c) => c.filter((n) => !reg.includes(n)))
        setSt({
          phase: 'done', ok: true,
          msg: `✅ ${reg.length}종이 자동발급 목록에 추가됐어요(β): ${reg.join(' · ')} — 첫 실발급 완주가 최종 검증이에요.`
            + (failed.length ? ` (미지원 ${failed.length}종은 그대로 — 공식 사이트·📷 촬영 경로)` : ''),
        })
      } else if (j.status === 'already') {
        setSt({ phase: 'done', ok: true, msg: j.message || '이미 자동발급을 지원하는 서류예요.' })
      } else if (j.status === 'not_supported') {
        const note = j.rows?.[0]?.note || ''
        setSt({ phase: 'done', ok: false, msg: `정부24에서 온라인 발급을 확인하지 못했어요${note ? ` (${note})` : ''} — 공식 사이트 발급이나 📷 촬영 등록을 이용해 주세요.` })
      } else {
        setSt({ phase: 'done', ok: false, msg: j.message || '실측 확인에 실패했어요 — 잠시 후 다시 시도해 주세요.' })
      }
    } catch (e) {
      setSt({ phase: 'done', ok: false, msg: e instanceof Error ? e.message : '실측 확인에 실패했어요 — 잠시 후 다시 시도해 주세요.' })
    } finally {
      busyRef.current = false
    }
  }

  const run = (raw: string) => {
    const doc = raw.trim()
    if (doc) probe({ doc_name: doc }, doc)
  }
  const runRef = useRef(run)
  runRef.current = run

  useEffect(() => {
    // 서류 카드의 [🔎 자동 확인]이 보낸 이름을 이어받는다 — 마운트 전 클릭(패널 닫힘)도 pending으로 흡수
    const onProbe = (e: Event) => {
      const doc = takePending() || String((e as CustomEvent).detail || '')
      if (doc) { setName(doc); runRef.current(doc) }
    }
    window.addEventListener(PROBE_DOC_EVENT, onProbe)
    const pend = takePending()
    if (pend) { setName(pend); runRef.current(pend) }
    // 실측 후보 칩(기본 후보 중 아직 미지원인 것) — 실패해도 입력창 경로는 그대로(정직 폴백)
    let alive = true
    fetch(`${getRpaBase()}/api/docs/probe-candidates`)
      .then((r) => r.json())
      .then((j: { candidates?: string[] }) => { if (alive && Array.isArray(j.candidates)) setCands(j.candidates) })
      .catch(() => { /* 미응답 — 칩 없이 동작 */ })
    return () => { alive = false; window.removeEventListener(PROBE_DOC_EVENT, onProbe) }
  }, [])

  const running = st.phase === 'running'
  return (
    <div className="mt-2.5 rounded-xl border border-sky2-100 bg-white p-2.5">
      <p className="text-[11px] font-bold text-sky2-800">
        🔎 목록에 없는 서류도 실측으로 추가
        <span className="ml-1 font-semibold text-muted-foreground">— 정부24를 실제 조사해 자동발급이 되면 β로 바로 추가돼요(재시작 불필요)</span>
      </p>
      <div className="mt-1.5 flex gap-1.5">
        <input value={name} onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') run(name) }}
          placeholder="서류 이름 (예: 혼인관계증명서)" maxLength={40}
          aria-label="실측 확인할 서류 이름"
          className="min-w-0 flex-1 rounded-lg border border-sky2-200 px-2.5 py-1.5 text-xs focus-visible:outline-sky2-400" />
        <button onClick={() => run(name)} disabled={running || !name.trim()}
          className="btn-secondary !px-3 !py-1.5 text-xs whitespace-nowrap disabled:opacity-50">
          {running ? '확인 중…' : '🔎 실측 확인'}
        </button>
      </div>
      {cands.length > 0 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          {cands.map((c) => (
            <button key={c} onClick={() => { setName(c); run(c) }} disabled={running}
              title="이 후보를 정부24에서 실측 확인해요"
              className="rounded-lg border border-sky2-100 bg-sky2-50/60 px-2 py-0.5 text-[11px] font-semibold text-sky2-700 hover:border-sky2-300 disabled:opacity-50">
              {c}
            </button>
          ))}
          <button onClick={() => probe({ doc_names: cands.slice(0, 12) }, `후보 ${Math.min(cands.length, 12)}종`)} disabled={running}
            title="후보 전체를 한 브라우저로 순서대로 실측 확인해요 — 통과분만 β로 추가돼요"
            className="rounded-lg border border-sprout-200 bg-sprout-50 px-2 py-0.5 text-[11px] font-bold text-sprout-700 hover:bg-sprout-100 disabled:opacity-50">
            🚀 후보 {Math.min(cands.length, 12)}종 한번에 실측
          </button>
        </div>
      )}
      {running && (
        <p className="mt-1 text-[11px] text-sky2-700" role="status" aria-live="polite">
          ⏳ 정부24에서 「{st.label}」를 실측 확인 중이에요… (종당 30초 정도 — 로그인·개인정보 없이 안내 페이지만 확인해요)
        </p>
      )}
      {st.phase === 'done' && (
        <p className={`mt-1 text-[11px] font-semibold ${st.ok ? 'text-sprout-700' : 'text-rose-600'}`} role="status" aria-live="polite">{st.msg}</p>
      )}
    </div>
  )
}
