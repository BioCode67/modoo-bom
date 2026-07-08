import { motion } from 'framer-motion'
import { TrendingUp, Coins } from 'lucide-react'
import { annualCashflow } from '@/lib/cashflow'
import { formatWon } from '@/lib/format'

// name/category/benefit만 사용 — 결과의 EligiblePolicy와 나의복지의 Policy 둘 다 받는다.
type CashflowInput = { name: string; category?: string; benefit?: string }

/**
 * 올해 복지 현금흐름 — 앞으로 12개월 '언제 얼마' 받는지 막대로.
 * 포트폴리오(카테고리별)·수령액 막대(정책별 스냅샷)와 달리 '시간축'으로 연간 총액을 체감시킨다.
 * 현금성만(정직성) — 바우처·대출·서비스 한도·현물 제외.
 */
export function AnnualCashflow({ policies }: { policies: CashflowInput[] }) {
  const cf = annualCashflow(policies)
  if (cf.annualTotal <= 0) return null
  // 누적 막대 — 1년에 걸쳐 쌓이는 총액(마지막 달 = 연간 총액). 일시금은 첫 달을 크게 올린다.
  const cumulative: number[] = []
  cf.months.reduce((acc, m, i) => (cumulative[i] = acc + m), 0)
  const cmax = cumulative[cumulative.length - 1] || 1
  const startMonth = new Date().getMonth() // 이번 달부터 12개월
  const label = (i: number) => (((startMonth + i) % 12) + 1)

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
      className="mt-6 rounded-3xl border-2 border-sprout-100 bg-white p-5 sm:p-6"
    >
      <div className="flex items-center gap-2 text-sprout-700">
        <TrendingUp className="h-5 w-5" />
        <span className="text-sm font-bold">올해 복지 현금흐름</span>
      </div>
      <h3 className="mt-1.5 text-lg font-extrabold sm:text-xl">
        앞으로 1년, <span className="text-sprout-700">{formatWon(cf.annualTotal)}</span> 받을 것으로 보여요
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">
        매월 <b className="text-foreground">{formatWon(cf.monthlyRecurring)}</b>
        {cf.oneTimeTotal > 0 && <> + 첫 달 일시금 <b className="text-peach-700">{formatWon(cf.oneTimeTotal)}</b></>}
        <span className="block mt-0.5 text-xs">※ 현금으로 받는 지원만 더한 값이에요(상품권·서비스·대출 제외). 실제 조건·중복수급 여부에 따라 달라질 수 있어요.</span>
      </p>

      {/* 누적 막대 — 달이 갈수록 쌓여 마지막에 연간 총액. 막대 행/라벨 행 분리(% 높이 기준 고정). */}
      <div className="mt-4" role="img"
        aria-label={`앞으로 12개월 누적 복지 수령액. 연말 총 ${formatWon(cf.annualTotal)}.`}>
        <p className="text-[11px] font-semibold text-muted-foreground mb-1">📈 쌓이면 (누적)</p>
        <div className="flex items-end gap-1 h-28">
          {cumulative.map((c, i) => {
            const h = Math.max(6, Math.round((c / cmax) * 100))
            const last = i === cumulative.length - 1
            return (
              <div key={i}
                className={`flex-1 rounded-t-lg transition-all ${last ? 'bg-sprout-700' : 'bg-sprout-400'}`}
                style={{ height: `${h}%` }}
                title={`${label(i)}월까지 누적: ${formatWon(c)}`}
              />
            )
          })}
        </div>
        <div className="flex gap-1 mt-1">
          {cumulative.map((_, i) => (
            <span key={i} className="flex-1 text-center text-[9px] text-muted-foreground tabular-nums">{label(i)}</span>
          ))}
        </div>
      </div>

      {cf.items.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {cf.items.slice(0, 6).map((it) => (
            <span key={it.name} className="inline-flex items-center gap-1 rounded-full bg-sprout-50 px-2.5 py-1 text-xs font-semibold text-sprout-800">
              <Coins className="h-3 w-3" />{it.name} {formatWon(it.won)}{it.kind === 'monthly' ? '/월' : ' 1회'}
            </span>
          ))}
        </div>
      )}

      {/* 비현금 지원 — 현금 합계엔 안 넣되 '따로 받을 수 있다'고 정직히 안내(예: 첫만남이용권 바우처). */}
      {cf.nonCash.length > 0 && (
        <p className="mt-3 rounded-xl bg-peach-50 px-3 py-2 text-xs text-peach-800">
          🎟️ 이 외에 <b>{cf.nonCash.slice(0, 3).join(' · ')}</b>{cf.nonCash.length > 3 ? ` 등 ${cf.nonCash.length}건` : ''} 처럼
          바우처·상품권·서비스로 받는 지원도 있어요. 현금이 아니라 위 금액엔 안 넣었지만, 꼭 챙기세요.
        </p>
      )}
    </motion.section>
  )
}
