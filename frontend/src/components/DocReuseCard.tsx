import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { Layers } from 'lucide-react'
import type { Policy } from '@/data/policies'
import { docReuseMap } from '@/lib/docReuse'

/**
 * 서류 재사용 카드 — "복지는 여러 개인데, 서류는 하나로 여러 곳"을 눈으로 보여 준비 부담을 낮춘다.
 * 순수 로직(docReuseMap)이 공통 서류를 집계하고 여기선 표시만. 공유 서류가 없으면 렌더 안 함.
 */
export function DocReuseCard({ policies }: { policies: Policy[] }) {
  const plan = useMemo(() => docReuseMap(policies), [policies])
  if (plan.shared.length === 0) return null

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      className="mt-5 card-cute p-5 border-2 border-sprout-100 bg-gradient-to-br from-sprout-50/50 to-white"
      aria-label="서류 재사용"
    >
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-sprout-100 text-sprout-600">
          <Layers className="h-4 w-4" />
        </span>
        <p className="font-extrabold text-[15px]">서류 하나로 여러 곳 — 한 번만 준비하세요</p>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        담은 복지 {plan.totalPolicies}개가 같은 서류를 함께 써요.
        {plan.savedCount > 0 && <> 공통 서류를 한 번씩만 떼면 <b className="text-sprout-700">{plan.savedCount}번</b> 덜 발급해도 돼요.</>}
      </p>

      <ul className="mt-3 space-y-2">
        {plan.shared.slice(0, 6).map((d) => (
          <li key={d.doc} className="flex items-center gap-2 rounded-xl border border-sprout-100 bg-white/70 px-3 py-2">
            <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-sprout-600 px-1.5 text-[11px] font-extrabold text-white tabular-nums">{d.count}</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold truncate">{d.doc}</p>
              <p className="text-[11px] text-muted-foreground truncate">{d.policyNames.slice(0, 3).join(', ')}{d.policyNames.length > 3 ? ` 외 ${d.policyNames.length - 3}곳` : ''}에서 사용</p>
            </div>
            {d.shareable && (
              <span className="shrink-0 rounded-full bg-sprout-50 px-2 py-0.5 text-[10px] font-semibold text-sprout-700" title="신청서 공동이용 동의로 생략 가능할 수 있어요">동의 시 생략 가능</span>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[10px] text-muted-foreground">※ ‘동의 시 생략 가능’은 행정정보 공동이용 대상 추정이에요. 최종은 접수처에서 확인하세요.</p>
    </motion.section>
  )
}
