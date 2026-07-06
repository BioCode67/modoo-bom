import { MapPin } from 'lucide-react'
import { SIDOS } from '@/lib/localWelfare'

/**
 * 한국 지도(자체 렌더) — 17개 시·도를 지리적 위치에 배치한 단계구분도(choropleth).
 * 외부 지도 API·타일 없이 순수 CSS로 그려 오프라인·프라이버시 원칙을 지킨다.
 * 복지 건수가 많을수록 진한 초록. 클릭하면 그 지역 복지 탐색으로 이동.
 */

// 각 시·도의 지도상 대략 위치(x%, y%) — 남한 지리를 근사(정밀 국경 아님, 인식 가능한 배치).
const POS: Record<string, [number, number]> = {
  서울: [38, 21], 인천: [21, 26], 경기: [52, 29], 강원: [72, 16],
  충남: [26, 43], 세종: [40, 44], 충북: [56, 37], 경북: [73, 40],
  대전: [46, 51], 대구: [71, 53],
  전북: [34, 58], 울산: [83, 57],
  광주: [29, 70], 경남: [58, 65], 부산: [77, 68],
  전남: [33, 80],
  제주: [30, 95],
}

// 건수 비율(0~1) → 단계 색(연한 초록 → 진한 초록)
function shade(t: number): { bg: string; fg: string } {
  const from = [225, 247, 231], to = [21, 128, 61] // #e1f7e7 → #15803d
  const c = from.map((f, i) => Math.round(f + (to[i] - f) * t))
  return { bg: `rgb(${c[0]},${c[1]},${c[2]})`, fg: t > 0.55 ? '#fff' : '#14532d' }
}

interface Props {
  counts: Record<string, number>
  myS: string
  sel: string
  onHover: (s: string) => void
  onPick: (s: string) => void
}

export function KoreaTileMap({ counts, myS, sel, onHover, onPick }: Props) {
  const max = Math.max(1, ...SIDOS.map((s) => counts[s] || 0))
  return (
    <div
      className="relative mx-auto mt-5 w-full"
      style={{ maxWidth: 460, aspectRatio: '4 / 5' }}
      role="group" aria-label="지역별 복지 지도"
    >
      {SIDOS.map((s) => {
        const [x, y] = POS[s]
        const n = counts[s] || 0
        const { bg, fg } = shade(n / max)
        const active = sel === s
        const mine = myS === s
        return (
          <button
            key={s}
            onMouseEnter={() => onHover(s)}
            onFocus={() => onHover(s)}
            onClick={() => onPick(s)}
            aria-label={`${s} 복지 ${n}건`}
            className={
              'absolute -translate-x-1/2 -translate-y-1/2 rounded-lg px-1.5 py-0.5 text-center leading-none ' +
              'shadow-sm transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-sprout-500 ' +
              (active ? 'z-20 scale-110 ring-2 ring-sprout-600'
                : mine ? 'z-10 ring-2 ring-sky2-500'
                : 'hover:z-10 hover:scale-105 ring-1 ring-black/5')
            }
            style={{ left: `${x}%`, top: `${y}%`, background: bg, color: fg }}
          >
            <span className="flex items-center justify-center gap-0.5 text-[10px] font-extrabold sm:text-[11px]">
              {mine && <MapPin className="h-2.5 w-2.5" />}{s}
            </span>
            <span className="block text-[8px] font-bold tabular-nums opacity-90 sm:text-[9px]">
              {n.toLocaleString()}
            </span>
          </button>
        )
      })}
      {/* 범례 (오른쪽 하단 — 제주와 겹치지 않게) */}
      <div className="absolute bottom-1 right-1 flex items-center gap-1.5 rounded-full bg-white/85 px-2.5 py-1 text-[10px] font-semibold text-muted-foreground shadow-sm">
        적음
        <span className="flex overflow-hidden rounded-full">
          {[0, 0.25, 0.5, 0.75, 1].map((t) => (
            <span key={t} className="h-2.5 w-3.5" style={{ background: shade(t).bg }} />
          ))}
        </span>
        많음
      </div>
    </div>
  )
}
