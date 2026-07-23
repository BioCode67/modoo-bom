import type { Policy } from '@/data/policies'
import { assessRecord, type FreshnessLevel, type CompletenessLevel } from '@/lib/freshness'

/**
 * 데이터 신선도·완결성 배지 — 이 레코드를 얼마나 믿고, 무엇을 공식 확인해야 하는지 정직하게 보여준다.
 * 약 5,300건 카탈로그의 요약형(LOC-/GOV-)은 요건이 불완전/오래됐을 수 있으므로, 휴리스틱 지표임을
 * 명시하고 '공식 확인 권장'으로 프레이밍한다(권위적 단정 아님). 순수 로직(assessRecord)이 계산.
 */

const FRESH_META: Record<FreshnessLevel, { label: string; cls: string }> = {
  current: { label: '최신 반영', cls: 'bg-sprout-50 text-sprout-700' },
  provisional: { label: '잠정·예정 포함', cls: 'bg-amber-50 text-amber-700' },
  possibly_stale: { label: '오래됐을 수 있음', cls: 'bg-rose-50 text-rose-700' },
  unknown: { label: '기준연도 미상', cls: 'bg-muted text-muted-foreground' },
}

const LEVEL_LABEL: Record<CompletenessLevel, string> = {
  detailed: '정보 충실',
  summary: '요약 정보',
  sparse: '정보 부족',
}

export function FreshnessBadge({ policy }: { policy: Policy }) {
  const r = assessRecord(policy)
  const fresh = FRESH_META[r.freshness]
  const barCls = r.completeness >= 70 ? 'bg-sprout-500' : r.completeness >= 40 ? 'bg-amber-400' : 'bg-rose-400'

  return (
    <div className="rounded-2xl border border-sky2-100 bg-white/60 p-3 text-xs leading-relaxed">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-bold text-foreground/80">데이터 충실도</span>
        <span className="tabular-nums font-extrabold text-foreground/80">{r.completeness}%</span>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground">{LEVEL_LABEL[r.level]}</span>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${fresh.cls}`}>{fresh.label}{r.yearSeen ? ` · ${r.yearSeen}` : ''}</span>
      </div>
      {/* 완결성 게이지(휴리스틱 점수) */}
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-sky2-100" role="presentation">
        <div className={`h-full rounded-full ${barCls} transition-all`} style={{ width: `${Math.max(4, Math.min(100, r.completeness))}%` }} />
      </div>
      {r.advisories.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-[11px] text-muted-foreground">
          {r.advisories.map((a, i) => (
            <li key={i}>· {a}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
