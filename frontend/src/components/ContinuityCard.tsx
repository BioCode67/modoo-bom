import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { History, ArrowRight, Sparkles, ChevronRight } from 'lucide-react'
import type { Policy } from '@/data/policies'
import type { UserProfile, EligiblePolicy } from '@/lib/welfare-engine'
import { getLastSnapshot, recordSnapshot, profilesEqual, diffProfiles, newlyUnlocked, type ProfileChange } from '@/lib/continuity'

/**
 * 연속성 에이전트 카드 — 다시 방문한 사용자에게 "지난 방문 이후 달라진 점과
 * 그래서 새로 열린 복지"를 선제적으로 안내한다. 지속적 관계·경험 축적의 표현.
 * 데이터는 브라우저에만 저장(서버 미전송).
 */
export function ContinuityCard({ profile, onOpen }: { profile: UserProfile; onOpen: (p: Policy | EligiblePolicy) => void }) {
  const [info, setInfo] = useState<{ days: number; changes: ProfileChange[]; newly: EligiblePolicy[] } | null>(null)
  const ran = useRef(false)

  useEffect(() => {
    if (ran.current) return
    ran.current = true
    const last = getLastSnapshot()
    const now = Date.now()
    if (last && !profilesEqual(last.profile, profile)) {
      const changes = diffProfiles(last.profile, profile)
      const newly = newlyUnlocked(last.profile, profile)
      if (changes.length || newly.length) {
        setInfo({ days: Math.floor((now - last.at) / 86400000), changes, newly })
      }
    }
    recordSnapshot(profile, now)
  }, [profile])

  if (!info) return null
  const { days, changes, newly } = info

  return (
    <motion.section
      initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
      className="card-cute p-4 sm:p-5 mb-5 border-2 border-sprout-200 bg-sprout-50/40"
    >
      <div className="flex items-center gap-2">
        <History className="h-5 w-5 text-sprout-500" />
        <h2 className="font-extrabold">
          {days <= 0 ? '다시 오셨네요' : `${days}일 만에 오셨네요`}, {profile.name || '회원'}님 👋
        </h2>
      </div>
      <p className="text-sm text-muted-foreground mt-1">지난 방문 이후 상황이 이렇게 달라졌어요.</p>

      {changes.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {changes.map((c, i) => (
            <span key={i} className="inline-flex items-center gap-1 rounded-full bg-white border border-sprout-200 px-2.5 py-1 text-xs font-semibold">
              {c.label} <span className="text-muted-foreground/70">{c.from}</span>
              <ArrowRight className="h-3 w-3 opacity-60" />
              <span className={c.kind === 'down' ? 'text-amber-700' : c.kind === 'up' ? 'text-sprout-700' : ''}>{c.to}</span>
            </span>
          ))}
        </div>
      )}

      {newly.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-bold text-sprout-700 flex items-center gap-1">
            <Sparkles className="h-3.5 w-3.5" /> 그래서 새로 받을 수 있는 복지 {newly.length}개
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {newly.slice(0, 6).map((p) => (
              <button key={p.id} onClick={() => onOpen(p)}
                className="inline-flex items-center gap-1 rounded-full bg-sprout-100 border border-sprout-200 px-2.5 py-1 text-xs font-semibold hover:bg-sprout-200">
                {p.name} <ChevronRight className="h-3 w-3 opacity-60" />
              </button>
            ))}
          </div>
        </div>
      )}
    </motion.section>
  )
}
