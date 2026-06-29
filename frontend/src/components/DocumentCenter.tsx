import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { FileText, ExternalLink, Bot, Loader2, CheckCircle2, AlertCircle } from 'lucide-react'
import { WELFARE_POLICIES, type Policy } from '@/data/policies'
import { useAppStore } from '@/store/useAppStore'
import { docLink, isRpaSupported } from '@/lib/officialLinks'
import { checkBackend, API_BASE } from '@/lib/backend'

const POLICY_MAP: Record<string, Policy> = Object.fromEntries(WELFARE_POLICIES.map((p) => [p.id, p]))

type RpaState = { status: string; step: string } | null

export function DocumentCenter() {
  const { tracked, profile } = useAppStore()
  const [backend, setBackend] = useState<boolean | null>(null)
  const [rpa, setRpa] = useState<Record<string, RpaState>>({})

  useEffect(() => { checkBackend().then(setBackend) }, [])

  // 담은 정책들의 필요 서류 합집합
  const docs = useMemo(() => {
    const set = new Set<string>()
    tracked.forEach((t) => POLICY_MAP[t.policyId]?.required_docs.forEach((d) => set.add(d)))
    return [...set]
  }, [tracked])

  if (docs.length === 0) return null

  const startRpa = async (doc: string) => {
    setRpa((s) => ({ ...s, [doc]: { status: 'running', step: '시작 중…' } }))
    try {
      const res = await fetch(`${API_BASE}/api/documents/rpa-issue`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ doc_name: doc, user_name: profile?.name || '사용자' }),
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

      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
        {docs.map((doc) => {
          const link = docLink(doc)
          const supported = isRpaSupported(doc)
          const st = rpa[doc]
          return (
            <div key={doc} className="card-cute p-4 flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-sky2-100 text-sky2-600"><FileText className="h-5 w-5" /></div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-sm truncate">{doc}</p>
                {st ? (
                  <p className="text-xs flex items-center gap-1 mt-0.5">
                    {st.status === 'error' ? <AlertCircle className="h-3.5 w-3.5 text-rose-500" />
                      : st.status === 'done' || st.status === 'completed' ? <CheckCircle2 className="h-3.5 w-3.5 text-sprout-500" />
                      : <Loader2 className="h-3.5 w-3.5 animate-spin text-sky2-500" />}
                    <span className="text-muted-foreground truncate">{st.step || st.status}</span>
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground truncate">{link.label}</p>
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
