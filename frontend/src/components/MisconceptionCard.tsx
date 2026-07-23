import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { Lightbulb } from 'lucide-react'
import type { EligiblePolicy, UserProfile } from '@/lib/welfare-engine'
import { matchMyths, type MythSeverity } from '@/lib/misconceptions'

/**
 * 오해 진단 카드 — 이 프로필에 '실제로 걸리는' 복지 통념만 골라 구조 규칙으로 바로잡는다.
 * 순수 로직(matchMyths)이 판단하고 여기선 표시만. 걸린 오해가 없으면 아무것도 렌더하지 않는다.
 * '틀린 확신' 때문에 신청을 포기하는 사각지대를 줄이는 게 목적(자격 재판정 아님).
 */

const SEV_META: Record<MythSeverity, { label: string; cls: string }> = {
  blocks: { label: '이것 때문에 포기하기 쉬워요', cls: 'bg-rose-50 text-rose-700' },
  reduces: { label: '덜 받거나 늦어지기 쉬워요', cls: 'bg-amber-50 text-amber-700' },
  info: { label: '알아두면 좋아요', cls: 'bg-sky2-50 text-sky2-700' },
}

export function MisconceptionCard({ profile, eligible }: { profile: UserProfile; eligible: EligiblePolicy[] }) {
  const myths = useMemo(() => matchMyths(profile, eligible), [profile, eligible])
  if (myths.length === 0) return null

  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
      className="mt-5 card-cute p-5 border-2 border-amber-100 bg-gradient-to-br from-amber-50/60 to-white"
      aria-label="혹시 이렇게 생각하고 계셨나요"
    >
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-100 text-amber-600">
          <Lightbulb className="h-4 w-4" />
        </span>
        <p className="font-extrabold text-[15px]">혹시 이렇게 생각하고 계셨나요?</p>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">복지를 포기하게 만드는 흔한 오해를, {profile.name || '회원'}님 상황에 맞춰 바로잡아 드릴게요.</p>

      <ul className="mt-3 space-y-3">
        {myths.map((m) => {
          const sev = SEV_META[m.severity]
          return (
            <li key={m.id} className="rounded-2xl border border-amber-100 bg-white/70 p-3.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${sev.cls}`}>{sev.label}</span>
              </div>
              {/* 통념(틀린 확신) → 취소선으로 '이건 사실이 아니에요' 신호 */}
              <p className="mt-1.5 text-sm text-muted-foreground line-through decoration-rose-300">“{m.belief}”</p>
              {/* 구조 규칙 기반 반박(정직성 라벨은 truth 안에 이미 포함) */}
              <p className="mt-1 text-sm font-semibold leading-relaxed text-foreground/90">{m.truth}</p>
              {m.appliesWhy && <p className="mt-1 text-[11px] text-muted-foreground">왜 보이나요 — {m.appliesWhy}</p>}
              {/* 적격 정책 원문 근거(개인화) */}
              {m.evidenceText && (
                <p className="mt-2 rounded-lg bg-sprout-50 px-2.5 py-1.5 text-[11px] text-sprout-800">
                  <span className="font-bold">근거</span> · {m.evidenceText}
                </p>
              )}
            </li>
          )
        })}
      </ul>
    </motion.section>
  )
}
