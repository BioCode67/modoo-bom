import { KOREA_GEO, KOREA_VIEWBOX } from '@/components/koreaGeo'

/**
 * 한국 지도(자체 렌더) — 실제 시·도 행정경계(간략화 SVG)를 그대로 그린 단계구분도(choropleth).
 * 외부 지도 API·타일 없이 정적 경로 데이터(koreaGeo.ts)만 사용해 오프라인·프라이버시 원칙을 지킨다.
 * 복지 건수가 많을수록 진한 초록. 시·도를 클릭하면 그 지역 복지 탐색으로 이동.
 */

// 건수 비율(0~1) → 단계 색(연한 초록 → 진한 초록)
function shade(t: number): { bg: string; fg: string } {
  const from = [225, 247, 231], to = [21, 128, 61] // #e1f7e7 → #15803d
  const c = from.map((f, i) => Math.round(f + (to[i] - f) * t))
  return { bg: `rgb(${c[0]},${c[1]},${c[2]})`, fg: t > 0.55 ? '#fff' : '#14532d' }
}

// 면적이 좁은 광역시·인접 시·도의 라벨 겹침 방지 오프셋(px, 뷰박스 좌표)
const NUDGE: Record<string, [number, number]> = {
  서울: [-16, -13], 경기: [16, 12], 인천: [-24, 10],
  세종: [-4, -13], 대전: [15, 12], 충남: [-22, 14],
  광주: [-25, 2], 전남: [8, 26], 부산: [17, 16], 울산: [17, -4],
}

interface Props {
  counts: Record<string, number>
  myS: string
  sel: string
  onHover: (s: string) => void
  onPick: (s: string) => void
}

export function KoreaTileMap({ counts, myS, sel, onHover, onPick }: Props) {
  const max = Math.max(1, ...KOREA_GEO.map((g) => counts[g.name] || 0))
  const active = KOREA_GEO.find((g) => g.name === sel)
  return (
    <div className="mx-auto mt-5 w-full max-w-[440px]" role="group" aria-label="지역별 복지 지도">
      <svg viewBox={KOREA_VIEWBOX} className="w-full drop-shadow-sm" role="presentation">
        {/* 면(경계) — 클릭·호버 대상 */}
        {KOREA_GEO.map((g) => {
          const n = counts[g.name] || 0
          const { bg } = shade(n / max)
          const isSel = sel === g.name
          const mine = myS === g.name
          return (
            <path
              key={g.name}
              d={g.d}
              fill={bg}
              stroke={isSel ? '#16a34a' : mine ? '#0ea5e9' : '#ffffff'}
              strokeWidth={isSel || mine ? 2.5 : 1.2}
              strokeLinejoin="round"
              role="button"
              tabIndex={0}
              aria-label={`${g.name} 복지 ${n}건`}
              className="cursor-pointer transition-[filter] hover:brightness-95 focus:outline-none focus-visible:brightness-90"
              onMouseEnter={() => onHover(g.name)}
              onFocus={() => onHover(g.name)}
              onClick={() => onPick(g.name)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(g.name) } }}
            />
          )
        })}
        {/* 선택 시·도 경계를 맨 위에 다시 그려 테두리가 이웃에 가려지지 않게 */}
        {active && (
          <path d={active.d} fill="none" stroke="#16a34a" strokeWidth={2.5} strokeLinejoin="round" pointerEvents="none" />
        )}
        {/* 라벨(이름+건수) — 흰 테두리 헤일로로 어떤 색 위에서도 읽히게 */}
        {KOREA_GEO.map((g) => {
          const n = counts[g.name] || 0
          const [dx, dy] = NUDGE[g.name] || [0, 0]
          const x = g.cx + dx, y = g.cy + dy
          return (
            <g key={g.name} pointerEvents="none" textAnchor="middle"
              style={{ paintOrder: 'stroke', stroke: '#ffffff', strokeWidth: 3, strokeLinejoin: 'round' }}>
              <text x={x} y={y} fontSize={13} fontWeight={800} fill="#14532d">{g.name}</text>
              <text x={x} y={y + 12} fontSize={10} fontWeight={700} fill="#3f6212">{n.toLocaleString()}</text>
            </g>
          )
        })}
      </svg>
      {/* 범례 */}
      <div className="mt-2 flex items-center justify-end gap-1.5 text-[10px] font-semibold text-muted-foreground">
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
