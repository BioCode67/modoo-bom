import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { Users, X, Heart } from 'lucide-react'
import { runAnalysis } from '@/lib/welfare-engine'
import { useAppStore } from '@/store/useAppStore'
import { ResultsView } from '@/components/ResultsView'

/**
 * 도우미 모드 — 가족·복지사가 받은 '#helper=' 링크로 남의 복지를 대신 본다.
 * 받은 프로필로 온디바이스 재계산(서버 전송 없음). 내 저장 데이터는 건드리지 않는다(별도 세션).
 */
export function HelperView() {
  const helper = useAppStore((s) => s.helper)
  const setHelper = useAppStore((s) => s.setHelper)
  const setView = useAppStore((s) => s.setView)
  const toggleSaved = useAppStore((s) => s.toggleSaved)

  const result = useMemo(() => (helper ? runAnalysis(helper.profile) : null), [helper])
  if (!helper || !result) return null

  const exit = () => { setHelper(null); setView('home') }

  return (
    <div>
      {/* 도우미 배너 — 누구를 돕는지, 내 데이터가 아님을 명확히 */}
      <div className="sticky top-0 z-30 no-print">
        <motion.div initial={{ y: -20, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
          className="bg-gradient-to-r from-violet-500 to-sky2-500 text-white px-4 py-2.5">
          <div className="page-container flex items-center gap-2 justify-between">
            <p className="text-sm font-bold flex items-center gap-2 min-w-0">
              <Users className="h-4 w-4 shrink-0" />
              <span className="truncate">가족의 복지를 대신 보는 중 — 이 결과는 <b>받은 정보로 다시 계산</b>했어요(내 저장 목록과 별개).</span>
            </p>
            <button onClick={exit} aria-label="도우미 모드 종료" className="shrink-0 inline-flex items-center gap-1 rounded-full bg-white/20 hover:bg-white/30 px-3 py-1 text-xs font-bold transition-colors">
              <X className="h-3.5 w-3.5" /> 종료
            </button>
          </div>
        </motion.div>
      </div>

      {/* 공유자가 미리 담아둔 목록(있으면) — 한 번에 내 목록으로도 담을 수 있게 */}
      {helper.tracked.length > 0 && (
        <div className="page-container pt-4 no-print">
          <div className="card-cute p-4">
            <p className="text-sm font-bold flex items-center gap-1.5"><Heart className="h-4 w-4 text-peach-500" /> 가족이 관심 표시한 복지 {helper.tracked.length}건</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {helper.tracked.map((t) => (
                <span key={t.policyId} className="chip-peach text-xs">{t.name}</span>
              ))}
            </div>
            <button
              onClick={() => helper.tracked.forEach((t) => {
                const p = result.eligible_policies.find((e) => e.id === t.policyId)
                toggleSaved({ id: t.policyId, name: t.name, category: p?.category || '' })
              })}
              className="btn-secondary !py-2 text-xs mt-2.5"
            >
              내 ‘나의 복지’에도 담기
            </button>
          </div>
        </div>
      )}

      {/* 결과 — 기존 결과 뷰 재사용(다시 분석 버튼은 종료로 대체) */}
      <ResultsView result={result} profile={helper.profile} onReset={exit} />
    </div>
  )
}
