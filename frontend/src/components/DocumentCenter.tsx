import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { FileText, ExternalLink, Bot, Loader2, CheckCircle2, AlertCircle } from 'lucide-react'
import { getPolicyMap } from '@/data/catalog'
import { useAppStore } from '@/store/useAppStore'
import { docLink, isRpaSupported } from '@/lib/officialLinks'
import { API_BASE } from '@/lib/backend'
import { useBackend } from '@/lib/useBackend'
import { detectExtension, issueViaExtension, issueManyViaExtension, getExtensionTrace, onExtensionStatus, sameDocName } from '@/lib/extension'
import { RpaInfoForm } from '@/components/RpaInfoForm'

type RpaState = { status: string; step: string; at?: number } | null

export function DocumentCenter() {
  const { tracked, profile, rpaInfo } = useAppStore()
  const { ready, caps } = useBackend()
  const localAgent = ready === true && !!caps?.rpa   // RPA 가능한 로컬 에이전트
  const [ext, setExt] = useState(false)              // 크롬 확장(브라우저 내 자동화)
  const backend = localAgent || ext                  // 둘 중 하나면 자동발급 노출
  const [rpa, setRpa] = useState<Record<string, RpaState>>({})
  const [diagCopied, setDiagCopied] = useState(false)

  // 확장 감지 + 진행상태 구독(확장은 서류명별 status를 푸시)
  // ⚠️ 확장은 서류명을 정규화(resolveDoc)해 보내므로 퍼지매칭으로 기존 카드 키에 연결(불일치 시 '시작 중' 멈춤 방지)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    detectExtension().then(setExt)
    const t = setInterval(() => setTick((x) => x + 1), 7000) // 무응답 감지용 리렌더
    const off = onExtensionStatus((s) => {
      if (!s.docName) return
      setRpa((prev) => {
        // 확장은 서류명을 정규화(resolveDoc)해 보내므로, 표기가 다른 여러 카드('주민등록등본',
        // '청년 주민등록등본' 등)가 같은 정규명으로 매칭될 수 있음 → 매칭되는 카드 전부 갱신
        // (첫 카드만 갱신하면 나머지가 '대기열…'에 영구히 멈춤)
        const keys = Object.keys(prev).filter((k) => sameDocName(k, s.docName))
        const entry = { status: s.status, step: s.step, at: Date.now() }
        const targets = keys.length ? keys : [s.docName!]
        return { ...prev, ...Object.fromEntries(targets.map((k) => [k, entry])) }
      })
    })
    return () => { clearInterval(t); off() }
  }, [])

  // 담은 정책들의 필요 서류 → 어떤 복지들에 필요한지까지 집계 (공통 서류 우선 준비)
  const docNeeds = useMemo(() => {
    const map = getPolicyMap()
    const m = new Map<string, string[]>()
    tracked.forEach((t) => map[t.policyId]?.required_docs.forEach((d) => {
      const arr = m.get(d) ?? []
      const nm = map[t.policyId]?.name
      if (nm && !arr.includes(nm)) arr.push(nm)
      m.set(d, arr)
    }))
    // 여러 복지에 공통으로 필요한 서류를 위로 정렬
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length)
  }, [tracked])

  if (docNeeds.length === 0) return null
  const docs = docNeeds.map(([d]) => d)
  const needText = (doc: string) => {
    const ns = docNeeds.find(([d]) => d === doc)?.[1] ?? []
    return ns.length > 1 ? `${ns[0]} 외 ${ns.length - 1}곳에 필요` : `${ns[0]}에 필요`
  }

  const startRpa = async (doc: string) => {
    // 본인인증 자동입력엔 실명·생년월일·휴대폰이 필요 — 비어 있으면 시작 전에 안내
    if (!rpaInfo.name?.trim() || !rpaInfo.birth_date?.trim() || !rpaInfo.phone?.trim()) {
      setRpa((s) => ({ ...s, [doc]: { status: 'error', step: '아래 "자동입력 추가정보"에 실명·생년월일·휴대폰을 먼저 입력해 주세요. (본인인증 자동입력용 — 내 기기에만 저장)', at: Date.now() } }))
      return
    }
    setRpa((s) => ({ ...s, [doc]: { status: 'running', step: '시작 중…', at: Date.now() } }))
    // 채널 라우팅: 로컬 백엔드는 6종만 지원 — 로컬이 못 하는 서류는 확장으로(있으면), 둘 다 안 되면 정직한 안내
    const localOk = isRpaSupported(doc, 'local')
    if ((!localAgent || !localOk) && ext) {
      const r = await issueViaExtension(doc, {
        // 본인인증엔 실명(rpaInfo.name)이 필요 — 프로필 이름(데모 페르소나일 수 있음)은 폴백
        user_name: rpaInfo.name || profile?.name || '사용자',
        birth_date: rpaInfo.birth_date, phone: rpaInfo.phone, carrier: rpaInfo.carrier,
      })
      if (!r.ok) setRpa((s) => ({ ...s, [doc]: { status: 'error', step: r.error || '확장이 이 서류를 지원하지 않아요.', at: Date.now() } }))
      return
    }
    if (localAgent && !localOk) {
      setRpa((s) => ({ ...s, [doc]: { status: 'error', step: '이 서류는 크롬 확장에서만 자동발급돼요 — 확장을 설치하거나 공식 사이트에서 발급하세요.', at: Date.now() } }))
      return
    }
    try {
      const res = await fetch(`${API_BASE}/api/documents/rpa-issue`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          doc_name: doc, user_name: rpaInfo.name || profile?.name || '사용자',
          birth_date: rpaInfo.birth_date, phone: rpaInfo.phone, carrier: rpaInfo.carrier,
        }),
      })
      if (!res.ok) throw new Error('지원하지 않는 서류')
      const { task_id } = await res.json()
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 1500))
        const st = await fetch(`${API_BASE}/api/documents/rpa-status/${task_id}`).then((r) => r.json())
        setRpa((s) => ({ ...s, [doc]: { status: st.status, step: st.current_step || '' } }))
        if (st.status === 'done' || st.status === 'error' || st.status === 'completed') break
      }
    } catch (e) {
      setRpa((s) => ({ ...s, [doc]: { status: 'error', step: e instanceof Error ? e.message : '실패' } }))
    }
  }

  // 🚀 연쇄 자동발급 — 지원 서류 전부를 한 흐름으로(정부24는 한 번 로그인으로 이어짐)
  const rpaDocs = docs.filter((d) => isRpaSupported(d)) // 연쇄 발급은 확장 전용(ext && … 조건으로만 노출)
  const startAll = async () => {
    if (!rpaInfo.name?.trim() || !rpaInfo.birth_date?.trim() || !rpaInfo.phone?.trim()) {
      setRpa((s) => ({ ...s, [rpaDocs[0]]: { status: 'error', step: '아래 "자동입력 추가정보"에 실명·생년월일·휴대폰을 먼저 입력해 주세요.', at: Date.now() } }))
      return
    }
    const userInfo = {
      user_name: rpaInfo.name || profile?.name || '사용자',
      birth_date: rpaInfo.birth_date, phone: rpaInfo.phone, carrier: rpaInfo.carrier,
    }
    setRpa((s) => ({ ...s, ...Object.fromEntries(rpaDocs.map((d) => [d, { status: 'running', step: '대기열에 추가됨…', at: Date.now() }])) }))
    const r = await issueManyViaExtension(rpaDocs, userInfo)
    if (!r.ok) { setRpa((s) => ({ ...s, [rpaDocs[0]]: { status: 'error', step: r.error || '연쇄 발급을 시작하지 못했어요.', at: Date.now() } })); return }
    // 확장이 표기변형을 정규화·디듑해 실제 큐에 들어간 목록(r.docs)만 진행 대상 — 나머지 카드는
    // 중복(같은 서류)이므로 '동일 서류로 함께 발급됨'으로 표시(영구 '대기열…' 방지)
    if (r.docs && r.docs.length) {
      setRpa((s) => {
        const next = { ...s }
        for (const d of rpaDocs) {
          if (!r.docs!.some((rd) => sameDocName(rd, d))) next[d] = { status: 'running', step: '같은 서류로 함께 발급돼요…', at: Date.now() }
        }
        return next
      })
    }
  }

  return (
    <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="mt-8">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-extrabold flex items-center gap-2"><FileText className="h-5 w-5 text-sky2-500" /> 서류 준비 도우미</h2>
        {backend ? (
          <span className="chip-sprout"><Bot className="h-3.5 w-3.5" /> 자동발급 가능</span>
        ) : (
          <span className="chip-sky">공식 사이트 바로가기</span>
        )}
      </div>
      <p className="text-sm text-muted-foreground mt-1">
        담은 복지에 필요한 서류 {docs.length}종이에요. 발급처로 바로 이동하거나{backend ? ' 에이전트로 자동 발급하세요.' : ' 직접 발급하세요.'}
        {backend && <span className="block mt-0.5 text-xs">🔒 카카오 본인인증은 보안을 위해 본인이 직접 진행해요.</span>}
      </p>

      {/* 확장/로컬 에이전트 둘 다 없을 때 — 설치하면 이 브라우저에서 자동발급이 켜진다는 안내 */}
      {!backend && (
        <div className="mt-3 rounded-2xl border-2 border-dashed border-sprout-200 bg-sprout-50/50 p-3 flex items-start gap-2.5">
          <span className="text-lg">🧩</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold">크롬 확장을 설치하면 여기서 <b>서류 자동발급</b>이 켜져요</p>
            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
              설치 없이 정부24 서류를 이 브라우저 안에서 자동 발급해요. 개인정보는 서버로 전송되지 않아요.
              <b> 본인인증만 직접</b> 하시면 됩니다.
            </p>
            <a
              href="https://github.com/BioCode67/modoo-bom/tree/main/extension#설치-개발자-모드--데모"
              target="_blank" rel="noopener noreferrer"
              className="btn-secondary !px-3 !py-1.5 text-xs mt-2"
            >
              <ExternalLink className="h-3.5 w-3.5" /> 확장 설치 방법
            </a>
          </div>
        </div>
      )}
      {backend && <RpaInfoForm />}

      {/* 🚀 연쇄 자동발급 — 확장이 있고 지원 서류가 2개 이상일 때 */}
      {ext && rpaDocs.length > 1 && (
        <button onClick={startAll} className="btn-primary w-full mt-3 !py-2.5 text-sm">
          🚀 필요한 서류 {rpaDocs.length}종 전부 자동발급 (한 번 인증으로 이어서)
        </button>
      )}

      {/* 🔍 진단 복사 — 발급이 멈추거나 오류일 때만 노출(완료는 제외 — 성공 후에도 뜨면 오해) */}
      {ext && Object.values(rpa).some((s) => s && (s.status === 'error' || (!['done', 'completed'].includes(s.status) && s.at && Date.now() - s.at > 30000))) && (
        <button
          onClick={async () => {
            const t = await getExtensionTrace()
            if (t) { try { await navigator.clipboard.writeText(t); setDiagCopied(true); setTimeout(() => setDiagCopied(false), 3000) } catch { /* noop */ } }
          }}
          className="btn-secondary w-full mt-2 !py-2 text-xs"
        >
          {diagCopied ? '✅ 진단이 복사됐어요 — 개발자에게 붙여넣어 주세요' : '🔍 진단 복사 (발급이 안 될 때 눌러 신고)'}
        </button>
      )}

      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
        {docs.map((doc) => {
          const link = docLink(doc)
          // 확장 있으면 13종, 로컬 백엔드만이면 6종만 '자동' 표시(과대 표시 시 클릭 오류 — 감사 실측)
          const supported = ext ? isRpaSupported(doc) : isRpaSupported(doc, 'local')
          const st = rpa[doc]
          // 30초 넘게 진행상태가 안 오면(새 탭에서 사용자 조작 대기 등) 웹에서도 정직하게 안내
          const stale = !!(st && !['done', 'completed', 'error'].includes(st.status) && st.at && Date.now() - st.at > 30000 && tick >= 0)
          return (
            <div key={doc} className="card-cute p-4 flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-sky2-100 text-sky2-600"><FileText className="h-5 w-5" /></div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-sm truncate">{doc}</p>
                {st ? (
                  <>
                  {/* 자동발급 진행/완료/오류를 스크린리더가 즉시 읽도록 라이브 영역으로 */}
                  <p className="text-xs flex items-center gap-1 mt-0.5" role="status" aria-live="polite">
                    {st.status === 'error' ? <AlertCircle className="h-3.5 w-3.5 text-rose-500" />
                      : st.status === 'done' || st.status === 'completed' ? <CheckCircle2 className="h-3.5 w-3.5 text-success-500" />
                      : <Loader2 className="h-3.5 w-3.5 animate-spin text-sky2-500" />}
                    <span className="text-muted-foreground truncate">{st.step || st.status}</span>
                  </p>
                  {stale && (
                    <p className="text-[11px] text-amber-700 mt-0.5">
                      진행이 잠시 멈춘 듯해요 — 확장이 연 <b>정부 사이트 탭</b>을 확인해 주세요(본인인증 등 직접 눌러야 하는 단계일 수 있어요).
                      안 되면 <a href={link.url} target="_blank" rel="noopener noreferrer" className="underline font-semibold">공식 사이트에서 직접 발급</a>하세요.
                    </p>
                  )}
                  </>
                ) : (
                  <>
                    <p className="text-xs text-sprout-600 font-semibold truncate">{needText(doc)}</p>
                    <p className="text-[11px] text-muted-foreground truncate">{link.label}</p>
                  </>
                )}
              </div>
              <div className="flex shrink-0 gap-1.5">
                {backend && supported && (
                  <button onClick={() => startRpa(doc)} disabled={st?.status === 'running'} className="btn-primary !px-3 !py-2 text-xs">
                    <Bot className="h-4 w-4" /> 자동
                  </button>
                )}
                <a href={link.url} target="_blank" rel="noopener noreferrer" className="btn-secondary !px-3 !py-2 text-xs">
                  <ExternalLink className="h-4 w-4" /> 발급
                </a>
              </div>
            </div>
          )
        })}
      </div>
    </motion.section>
  )
}
