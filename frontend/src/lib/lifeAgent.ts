import { getEligiblePolicies, type UserProfile, type EligiblePolicy } from '@/lib/welfare-engine'
import { parseMonthly } from '@/lib/format'

/**
 * 선제적 생애 타임라인 에이전트.
 *
 * simulateFuture 가 "만약 ~하면"의 가정형 시나리오라면, 이 에이전트는 사용자의 실제 나이·자녀
 * 나이를 기준으로 **앞으로 확정적으로 도래하는 생애 임계점**(만 65세, 자녀 취학 등)에서
 * 어떤 복지가 새로 열리고(gain) 어떤 복지가 종료되는지(loss)를 시간순으로 예측한다.
 * → 반응형(질문-응답)을 넘어, 미래를 미리 챙겨주는 능동형 에이전트.
 *
 * 판정은 전부 클라이언트 복지 엔진(getEligiblePolicies)의 결과를 diff 하므로 규칙과 100% 일치한다.
 * 개인정보는 브라우저 안에서만 계산되고 서버로 가지 않는다.
 */
export interface TimelineEvent {
  year: number            // 지금부터 몇 년 후
  whenLabel: string       // "내년쯤", "약 N년 후"
  trigger: string         // 생애 임계점 설명
  emoji: string
  gained: EligiblePolicy[] // 새로 열리는 복지
  lost: EligiblePolicy[]   // 종료되는 복지
  monthlyDelta: number     // 순 월 변화액(+열림 −종료)
  prep: string             // 미리 준비할 것
}

function agedProfile(p: UserProfile, y: number): UserProfile {
  return { ...p, age: p.age + y, children_ages: (p.children_ages || []).map((a) => a + y) }
}

// 해당 연도(y년 후)에 넘어가는 생애 임계점을 찾는다. 엔진 임계값(60·65·19·35, 자녀 2·9·18)과 정렬.
function triggerAt(p: UserProfile, y: number): { trigger: string; emoji: string; prep: string } | null {
  const prevAge = p.age + y - 1
  const age = p.age + y
  const crosses = (th: number) => prevAge < th && age >= th
  if (crosses(65)) return { trigger: '만 65세가 되는 해', emoji: '🎂', prep: '기초연금은 만 65세 생일이 속한 달의 한 달 전부터 신청할 수 있어요. 신분증·통장을 준비해 두세요.' }
  if (crosses(60)) return { trigger: '만 60세가 되는 해', emoji: '🌳', prep: '노인 일자리·경로 우대 등 준비를 시작할 시기예요.' }
  if (crosses(35)) return { trigger: '만 35세가 되는 해', emoji: '⏳', prep: '청년 대상 복지 일부가 종료돼요. 지금 받을 수 있는 청년 혜택(청년도약계좌 등)을 미리 챙기세요.' }
  if (crosses(19)) return { trigger: '만 19세가 되는 해', emoji: '🧑', prep: '청년 대상 복지가 새로 열려요.' }

  const kids = p.children_ages || []
  for (const a0 of kids) {
    const prev = a0 + y - 1
    const now = a0 + y
    const kc = (th: number) => prev < th && now >= th
    if (kc(2)) return { trigger: '자녀가 만 2세가 되는 해', emoji: '🍼', prep: '부모급여가 줄고 어린이집 보육료로 전환돼요. 어린이집 대기 신청을 미리 해두세요.' }
    if (kc(9)) return { trigger: '자녀가 만 9세가 되는 해', emoji: '📚', prep: '아동수당(만 8세까지)이 종료돼요. 교육급여·방과후 돌봄으로 전환을 준비하세요.' }
    if (kc(18)) return { trigger: '자녀가 만 18세가 되는 해', emoji: '🎓', prep: '아동·청소년 지원이 종료되고, 자녀가 청년 대상 복지를 받을 수 있게 돼요.' }
  }
  return null
}

export function predictTimeline(profile: UserProfile, horizonYears = 6): TimelineEvent[] {
  const base = getEligiblePolicies(profile)
  const baseIds = new Set(base.map((p) => p.id))
  const seenGain = new Set<string>()
  const seenLoss = new Set<string>()
  const events: TimelineEvent[] = []

  for (let y = 1; y <= horizonYears; y++) {
    const t = triggerAt(profile, y)
    if (!t) continue
    const future = getEligiblePolicies(agedProfile(profile, y))
    const futureIds = new Set(future.map((p) => p.id))

    const gained = future.filter((p) => !baseIds.has(p.id) && !seenGain.has(p.id))
    const lost = base.filter((p) => !futureIds.has(p.id) && !seenLoss.has(p.id))
    gained.forEach((p) => seenGain.add(p.id))
    lost.forEach((p) => seenLoss.add(p.id))
    if (gained.length === 0 && lost.length === 0) continue

    const gain = gained.reduce((s, p) => s + parseMonthly(p.benefit), 0)
    const loss = lost.reduce((s, p) => s + parseMonthly(p.benefit), 0)
    events.push({
      year: y,
      whenLabel: y === 1 ? '내년쯤' : `약 ${y}년 후`,
      trigger: t.trigger,
      emoji: t.emoji,
      gained: gained.slice(0, 5),
      lost: lost.slice(0, 5),
      monthlyDelta: gain - loss,
      prep: t.prep,
    })
  }
  return events
}
