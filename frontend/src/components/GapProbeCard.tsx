import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { HelpCircle, TrendingUp } from 'lucide-react'
import type { UserProfile } from '@/lib/welfare-engine'
import { scanProfileGaps } from '@/lib/profileGaps'
import { formatWon } from '@/lib/format'

/**
 * 숨은 자격 발굴기 카드 — 프로필에서 '아니오/공백'으로 남은 차원을 골라,
 * "해당되시면 +N개 복지·월 +X원이 열려요"라고 임팩트순으로 되묻는다.
 * 순수 로직(scanProfileGaps)이 가설 프로필 diff로 계산하고 여기선 표시만.
 * 사실을 단정하지 않고 '혹시 해당되세요?'라고 물을 뿐 — 입력 안 한 것의 기회비용을 드러낸다.
 */
export function GapProbeCard({ profile, onEdit }: { profile: UserProfile; onEdit?: () => void }) {
  const probes = useMemo(() => scanProfileGaps(profile, { limit: 3 }), [profile])
  if (probes.length === 0) return null

  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}
      className="mt-5 card-cute p-5 border-2 border-sky2-100 bg-gradient-to-br from-sky2-50/60 to-white"
      aria-label="혹시 이런 상황이신가요"
    >
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-sky2-100 text-sky2-600">
          <HelpCircle className="h-4 w-4" />
        </span>
        <p className="font-extrabold text-[15px]">혹시 이런 상황이신가요?</p>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">말씀 안 하신 것 중, 해당되면 받을 복지가 크게 늘어나는 것만 추려 여쭤봐요.</p>

      <ul className="mt-3 space-y-2.5">
        {probes.map((g) => (
          <li key={g.key} className="rounded-2xl border border-sky2-100 bg-white/70 p-3.5">
            <p className="text-sm font-semibold text-foreground/90">{g.question}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-full bg-sprout-50 px-2 py-0.5 text-[11px] font-bold text-sprout-700">
                <TrendingUp className="h-3 w-3" /> {g.assumeLabel} +{g.newCount}개
              </span>
              {g.monthlyDelta > 0 && (
                <span className="rounded-full bg-peach-50 px-2 py-0.5 text-[11px] font-bold text-peach-700">
                  월 최대 +{formatWon(g.monthlyDelta)} (추정)
                </span>
              )}
            </div>
            {g.examples.length > 0 && (
              <p className="mt-1.5 text-[11px] text-muted-foreground line-clamp-1">
                예: {g.examples.map((e) => e.name).join(', ')}
              </p>
            )}
            <p className="mt-0.5 text-[10px] text-muted-foreground/80">{g.note}</p>
          </li>
        ))}
      </ul>

      {onEdit && (
        <button onClick={onEdit} className="btn-secondary !py-2 !text-xs mt-3">프로필 고쳐서 다시 보기</button>
      )}
    </motion.section>
  )
}
