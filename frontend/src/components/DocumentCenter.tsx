import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { FileText, ExternalLink, Bot, Loader2, CheckCircle2, AlertCircle } from 'lucide-react'
import { getPolicyMap } from '@/data/catalog'
import { useAppStore } from '@/store/useAppStore'
import { docLink, isRpaSupported } from '@/lib/officialLinks'
import { API_BASE } from '@/lib/backend'
import { useBackend } from '@/lib/useBackend'
import { detectExtension, issueViaExtension, onExtensionStatus, sameDocName } from '@/lib/extension'
import { RpaInfoForm } from '@/components/RpaInfoForm'

type RpaState = { status: string; step: string; at?: number } | null

export function DocumentCenter() {
  const { tracked, profile, rpaInfo } = useAppStore()
  const { ready, caps } = useBackend()
  const localAgent = ready === true && !!caps?.rpa   // RPA 가능한 로컬 에이전트
  const [ext, setExt] = useState(false)              // 크롬 확장(브라우저 내 자동화)
  const backend = localAgent || ext                  // 둘 중 하나면 자동발급 노출
  const [rpa, setRpa] = useState<Record<string, RpaState>>({})

  // 확장 감지 + 진행상태 구독(확장은 서류명별 status를 푸시)
  // ⚠️ 확장은 서류명을 정규화(resolveDoc)해 보내므로 퍼지매칭으로 기존 카드 키에 연결(불일치 시 '시작 중' 멈춤 방지)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    detectExtension().then(setExt)
    const t = setInterval(() => setTick((x) => x + 1), 7000) // 무응답 감지용 리렌더
    const off = onExtensionStatus((s) => {
      if (!s.docName) return
      setRpa((prev) => {
        const key = Object.keys(prev).find((k) => sameDocName(k, s.docName)) || s.docName!
        return { ...prev, [key]: { status: s.status, step: s.step, at: Date.now() } }
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
    // 로컬 에이전트가 없고 확장만 있으면 브라우저 내 확장으로 발급(진행상태는 구독으로 수신)
    if (!localAgent && ext) {
      const r = await issueViaExtension(doc, {
        // 본인인증엔 실명(rpaInfo.name)이 필요 — 프로필 이름(데모 페르소나일 수 있음)은 폴백
        user_name: rpaInfo.name || profile?.name || '사용자',
        birth_date: rpaInfo.birth_date, phone: rpaInfo.phone, carrier: rpaInfo.carrier,
      })
      if (!r.ok) setRpa((s) => ({ ...s, [doc]: { status: 'error', step: r.error || '확장이 이 서류를 지원하지 않아요.', at: Date.now() } }))
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

      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
        {docs.map((doc) => {
          const link = docLink(doc)
          const supported = isRpaSupported(doc)
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
                  <p className="text-xs flex items-center gap-1 mt-0.5">
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
