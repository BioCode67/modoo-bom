import type { Policy } from '@/data/policies'
import type { EligiblePolicy, UserProfile } from '@/lib/welfare-engine'
import { deadlineHint } from '@/lib/deadline'

/**
 * 신청 골든타임 — '자격이 있느냐'가 아니라 '언제 신청해야 한 푼도 안 잃느냐'를 답한다.
 * 한국 복지는 대부분 신청주의(신청한 달부터 지급, 지난 달치는 소멸)라, 자격이 있어도 타이밍을
 * 놓치면 돈을 잃는다. 이 프로필에 '지금 시간이 중요한' 상황만 골라 서두를 이유를 짚어 준다.
 *
 * 정직성 원칙(모두봄 핵심):
 *  - 특정 일수·정액을 사실로 단정하지 않는다('일정 기간 안에'·'생일 무렵부터'처럼 하지). 정확한 기한은
 *    '주민센터·복지로 확인'으로 넘긴다 — 규정이 바뀌어도 오정보가 되지 않게.
 *  - 개인화 트리거(신생아·65세 임박·기한 신호)에만 발동해 일반적 '빨리 신청하세요' 잔소리를 만들지 않는다.
 *  - 금액을 재계산하지 않는다(손실 위험은 '놓칠 수 있어요'로만 표현).
 */

export type TimingKind = 'retroactive' | 'preapply' | 'deadline'

export interface TimingAlert {
  kind: TimingKind
  title: string
  detail: string          // 하드 일수 단정 없이 '일정 기간·확인' 프레이밍
  lossRisk: string        // 놓치면 무엇을 잃나(금액 재계산 없이)
  policyNames: string[]   // 관련 적격 정책명(있으면)
  urgency: 'high' | 'medium'
}

// 소급 대상(출생 직후 신청 시 지난 달치까지 소급 가능) 대표 복지 — 이름 신호로만 매칭
const RETRO_NAMES = ['아동수당', '부모급여', '첫만남', '영아수당', '양육수당']
// 사전신청 가능(자격이 생기기 전에 미리) 대표 복지
const PREAPPLY_NAMES = ['기초연금']

function nameHit(pol: Policy, names: string[]): boolean {
  const n = (pol.name || '').replace(/\s/g, '')
  return names.some((k) => n.includes(k))
}

/** 신생아·출산 신호 — children_ages(0~1세)나 생애이벤트로만 판단(무가드 접근 금지). */
function hasNewborn(p: UserProfile): boolean {
  const young = (p.children_ages || []).some((a) => a <= 1)
  const ev = (p.life_events || []).some((e) => /출산|임신|출생|신생아/.test(e))
  return (p.has_children && young) || ev
}

/**
 * 이 프로필에 '지금 시간이 중요한' 신청 타이밍 알림만 골라 반환한다.
 * 흐름:
 *  ① 소급 — 신생아 + 출생 관련 복지 적격이면 '출생 직후 신청 시 소급 가능'(기한 확인 하지).
 *  ② 사전신청 — 만 65세 임박(63~64세)이면 기초연금 사전신청 안내(적격 여부 무관 — 준비 신호).
 *  ③ 기한 — 적격 복지 중 신청 기한 신호(deadlineHint)가 있는 것을 모아 경고.
 *  ④ urgency(high 먼저)로 정렬. 걸리는 게 없으면 빈 배열(잔소리 안 함).
 */
export function applyTiming(profile: UserProfile | null, eligible: EligiblePolicy[] = []): TimingAlert[] {
  const alerts: TimingAlert[] = []
  const elig = eligible || []
  const p = profile

  // ① 소급(신생아)
  if (p && hasNewborn(p)) {
    const hits = elig.filter((e) => nameHit(e, RETRO_NAMES)).map((e) => e.name)
    if (hits.length) {
      alerts.push({
        kind: 'retroactive',
        title: '지금 서두르면 지난 달치까지 받을 수 있어요',
        detail:
          '아동수당·부모급여·첫만남이용권 등은 출생 신고 후 일정 기간 안에 신청하면 태어난 달까지 소급해 받을 수 있어요. ' +
          '기간이 지나면 소급이 안 될 수 있으니, 정확한 기한은 주민센터·복지로에서 바로 확인하세요.',
        lossRisk: '신청이 늦으면 소급 기간이 지나 지난 달치를 못 받을 수 있어요.',
        policyNames: hits,
        urgency: 'high',
      })
    }
  }

  // ② 사전신청(65세 임박) — 적격 목록에 없어도 '미리 준비' 신호라 나이만으로 안내
  if (p && p.age >= 63 && p.age < 65) {
    const hits = elig.filter((e) => nameHit(e, PREAPPLY_NAMES)).map((e) => e.name)
    alerts.push({
      kind: 'preapply',
      title: '만 65세가 가까워요 — 미리 신청해 둘 수 있어요',
      detail:
        '기초연금은 만 65세 생일 무렵부터 미리 신청해 둘 수 있어요. 미리 신청하면 자격이 생기는 달부터 바로 받을 수 있어 공백이 없어요. ' +
        '정확한 신청 시기는 주민센터에서 확인하세요.',
      lossRisk: '생일이 지나 뒤늦게 신청하면 그 사이의 달을 놓칠 수 있어요.',
      policyNames: hits,
      urgency: 'medium',
    })
  }

  // ③ 신청 기한(적격 복지의 마감 신호)
  const deadlines: { name: string; label: string; urgent: boolean }[] = []
  const seen = new Set<string>()
  for (const e of elig) {
    const d = deadlineHint(e)
    if (d && !seen.has(e.name)) {
      seen.add(e.name)
      deadlines.push({ name: e.name, label: d.label, urgent: d.urgent })
    }
  }
  if (deadlines.length) {
    const urgent = deadlines.some((d) => d.urgent)
    alerts.push({
      kind: 'deadline',
      title: '신청 기한이 있는 복지가 있어요',
      detail: deadlines.slice(0, 4).map((d) => `${d.name} — ${d.label}`).join(' / '),
      lossRisk: '기한이 지나면 이번 회차 신청이 어려울 수 있어요.',
      policyNames: deadlines.map((d) => d.name),
      urgency: urgent ? 'high' : 'medium',
    })
  }

  return alerts.sort((a, b) => (a.urgency === b.urgency ? 0 : a.urgency === 'high' ? -1 : 1))
}
