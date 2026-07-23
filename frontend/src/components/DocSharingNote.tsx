import type { Policy } from '@/data/policies'
import { classifyDocSharing } from '@/lib/sharedDocInfo'

/**
 * 행정정보 공동이용 안내 — 신청서 '공동이용 동의' 서명 하나로 안 떼도 되는 서류를 짚어준다.
 * 순수 로직(classifyDocSharing)이 각 서류를 직접제출/생략가능/조건부로 분류하고 여기선 표시만.
 * 생략 가능한 게 하나도 없으면 렌더하지 않는다. '최종은 접수처 확인' 취지를 데이터가 이미 담는다.
 */
export function DocSharingNote({ policy }: { policy: Policy }) {
  const plan = classifyDocSharing(policy)
  if (plan.skippableCount <= 0) return null
  const skippable = plan.rows.filter((r) => r.sharable === 'yes')

  return (
    <div className="mt-2 rounded-xl border border-sprout-100 bg-sprout-50/40 p-2.5 text-xs leading-relaxed">
      <p className="font-bold text-sprout-700">🖊️ 안 떼도 되는 서류가 있어요</p>
      <p className="mt-0.5 text-muted-foreground">{plan.summary}</p>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {skippable.map((r) => (
          <span key={r.doc} className="rounded-full bg-white border border-sprout-200 px-2 py-0.5 text-[11px] font-semibold text-sprout-700">
            {r.doc}
          </span>
        ))}
      </div>
    </div>
  )
}
