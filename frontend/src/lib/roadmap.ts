// 복지 신청 로드맵 — 담아둔 복지를 '무엇을, 어떤 순서로' 신청할지 실행 계획으로 묶는다.
// 앱의 철학(찾기 → 행동)에서 '행동'을 한 화면으로 정리: 마감 임박 → 서류 준비 → 온라인 신청 → 방문 신청.
// 순수 함수 · 외부 상태 의존 없음(시간·서류보유 등은 옵션으로 주입) → vitest로 단단히 잠근다.
import type { Policy } from '@/data/policies'
import type { EligiblePolicy } from '@/lib/welfare-engine'
import { deadlineHint } from '@/lib/deadline'
import { parseMonthly, isCashBenefit, formatWon } from '@/lib/format'

/** 신청 채널 — 정책의 application 문구에서 추론(온라인/방문/둘 다). */
export type ApplyChannel = 'online' | 'visit' | 'mixed'

/** 로드맵 단계(표시 순서와 동일). */
export type RoadmapPhase = 'urgent' | 'docs' | 'online' | 'visit'

export const PHASE_ORDER: RoadmapPhase[] = ['urgent', 'docs', 'online', 'visit']

export const PHASE_META: Record<RoadmapPhase, { title: string; hint: string; emoji: string }> = {
  urgent: { title: '지금 바로 (마감 임박)', hint: '신청 기한이 짧아 가장 먼저 챙기세요', emoji: '⏰' },
  docs: { title: '서류부터 준비', hint: '필요한 서류를 갖추면 신청할 수 있어요', emoji: '📄' },
  online: { title: '온라인 신청', hint: '복지로·정부24에서 바로 신청할 수 있어요', emoji: '💻' },
  visit: { title: '주민센터 방문 신청', hint: '가까운 행정복지센터에서 신청해요', emoji: '🏢' },
}

export interface RoadmapStep {
  policyId: string
  name: string
  category: string
  phase: RoadmapPhase
  /** 월 현금지원 추정액(원). 현금성이 아니거나 월 단위가 아니면 0. */
  monthly: number
  isCash: boolean
  deadline: { label: string; urgent: boolean } | null
  channel: ApplyChannel
  department: string
  contact?: string
  /** 이 정책에 필요한 서류(원본 라벨). */
  requiredDocs: string[]
  /** 아직 준비 안 된 서류(체크 안 됨 + 보유 안 함). */
  missingDocs: string[]
  /** 온라인 신청 링크(옵션 resolveUrl로 해석됨). */
  applyUrl?: string
  /** 전체 로드맵에서의 순번(1부터). */
  order: number
  /** 이 순서에 놓인 이유(사람이 읽을 한 줄). */
  rationale: string
}

export interface RoadmapDoc {
  name: string
  /** 이 서류를 필요로 하는 정책 수. */
  count: number
  done: boolean
}

export interface RoadmapSummary {
  /** 현금성·월단위 지원만 보수적으로 합산(원). 결과화면과 동일한 과장 없는 기준. */
  totalMonthlyCash: number
  stepCount: number
  urgentCount: number
  onlineCount: number
  visitCount: number
  /** 담은 복지 전체에 필요한 서류(중복 제거) — 한 번 떼면 여러 신청에 재사용. */
  allDocs: RoadmapDoc[]
  docProgress: { total: number; done: number }
}

export interface Roadmap {
  steps: RoadmapStep[]
  byPhase: Record<RoadmapPhase, RoadmapStep[]>
  summary: RoadmapSummary
}

export interface RoadmapInput {
  policy: Policy | EligiblePolicy
  /** 이 정책에 대해 사용자가 '준비 완료'로 체크한 서류. */
  checkedDocs?: string[]
}

export interface RoadmapOptions {
  /** 전역적으로 이미 보유·발급한 서류인지(예: 발급 완료된 등본은 모든 신청에 재사용). */
  hasDoc?: (doc: string) => boolean
  /** 정책의 온라인 신청 링크 해석기(없으면 링크 없음). */
  resolveUrl?: (p: Policy) => string | undefined
}

const normDoc = (d: string): string => (d || '').replace(/\s+/g, '')

/** application 문구에서 신청 채널을 추론. 온라인 신호와 방문 신호를 함께 보고 판정. */
export function applyChannel(application: string): ApplyChannel {
  const t = application || ''
  const online = /복지로|정부24|정부 ?24|온라인|누리집|홈페이지|www\.|https?:|\bapp\b|앱에서|모바일/.test(t)
  const visit = /방문|주민센터|행정복지센터|읍[·.]?면[·.]?동|주소지|현장|우편|팩스/.test(t)
  if (online && visit) return 'mixed'
  if (online) return 'online'
  if (visit) return 'visit'
  // 신호가 전혀 없으면 방문으로 보수 처리(온라인이라 단정하지 않음).
  return 'visit'
}

/** 온라인 신청이 가능한 채널인가(online·mixed). 방문 전용이면 false. */
export function isOnlineApplicable(channel: ApplyChannel): boolean {
  return channel === 'online' || channel === 'mixed'
}

/** 단계 결정: 마감 임박(최우선) → 미비 서류 있음 → 온라인 가능 → 방문. */
function phaseOf(urgent: boolean, missingCount: number, channel: ApplyChannel): RoadmapPhase {
  if (urgent) return 'urgent'
  if (missingCount > 0) return 'docs'
  if (isOnlineApplicable(channel)) return 'online'
  return 'visit'
}

function rationaleOf(phase: RoadmapPhase, step: { deadline: RoadmapStep['deadline']; missingDocs: string[]; channel: ApplyChannel }): string {
  if (phase === 'urgent') return step.deadline ? `${step.deadline.label} — 먼저 신청하세요` : '기한이 짧아 우선 신청'
  if (phase === 'docs') return `서류 ${step.missingDocs.length}종을 준비하면 신청할 수 있어요`
  if (phase === 'online') return step.channel === 'mixed' ? '복지로 온라인 또는 방문으로 신청' : '복지로·정부24에서 바로 신청'
  return '주민센터(행정복지센터) 방문 신청'
}

/**
 * 담은 복지 목록으로 신청 로드맵을 만든다.
 * - 각 정책을 단계(마감/서류/온라인/방문)로 분류하고, 단계 순 → 금액 큰 순 → 이름 순으로 정렬.
 * - 서류는 정책 간 중복을 제거해 '한 번 떼면 재사용'을 보여준다.
 */
export function buildRoadmap(inputs: RoadmapInput[], opts: RoadmapOptions = {}): Roadmap {
  const hasDoc = opts.hasDoc ?? (() => false)

  const rawSteps: RoadmapStep[] = (inputs || []).filter((i) => i && i.policy).map((inp) => {
    const p = inp.policy
    const checked = new Set((inp.checkedDocs ?? []).map(normDoc))
    const requiredDocs = Array.isArray(p.required_docs) ? p.required_docs : []
    const missingDocs = requiredDocs.filter((d) => !checked.has(normDoc(d)) && !hasDoc(d))

    const dh = deadlineHint(p)
    const channel = applyChannel(p.application || '')
    const cash = isCashBenefit(p.benefit || '')
    const monthly = cash ? parseMonthly(p.benefit || '') : 0
    const phase = phaseOf(!!dh?.urgent, missingDocs.length, channel)

    const step: RoadmapStep = {
      policyId: p.id,
      name: p.name,
      category: p.category,
      phase,
      monthly,
      isCash: cash,
      deadline: dh,
      channel,
      department: p.department || '',
      contact: p.contact,
      requiredDocs,
      missingDocs,
      applyUrl: isOnlineApplicable(channel) ? opts.resolveUrl?.(p) : undefined,
      order: 0,
      rationale: '',
    }
    step.rationale = rationaleOf(phase, step)
    return step
  })

  // 정렬: 단계 순 → 월 현금액 큰 순 → 이름
  rawSteps.sort((a, b) => {
    const pa = PHASE_ORDER.indexOf(a.phase)
    const pb = PHASE_ORDER.indexOf(b.phase)
    if (pa !== pb) return pa - pb
    if (b.monthly !== a.monthly) return b.monthly - a.monthly
    return a.name.localeCompare(b.name, 'ko')
  })
  rawSteps.forEach((s, i) => { s.order = i + 1 })

  const byPhase: Record<RoadmapPhase, RoadmapStep[]> = { urgent: [], docs: [], online: [], visit: [] }
  for (const s of rawSteps) byPhase[s.phase].push(s)

  // 서류 종합(중복 제거) — 같은 서류를 여러 정책이 요구하면 한 번만, count로 재사용 정도를 보여준다.
  const docAgg = new Map<string, { name: string; count: number; done: boolean }>()
  for (const inp of inputs || []) {
    if (!inp || !inp.policy) continue
    const checked = new Set((inp.checkedDocs ?? []).map(normDoc))
    for (const d of inp.policy.required_docs ?? []) {
      const key = normDoc(d)
      if (!key) continue
      const prev = docAgg.get(key)
      // done: 어디서든 이미 보유/체크했으면 완료(한 서류는 여러 신청에 재사용).
      const doneHere = hasDoc(d) || checked.has(key)
      if (prev) { prev.count += 1; prev.done = prev.done || doneHere }
      else docAgg.set(key, { name: d, count: 1, done: doneHere })
    }
  }
  const allDocs = [...docAgg.values()].sort((a, b) => (b.count - a.count) || a.name.localeCompare(b.name, 'ko'))
  const docDone = allDocs.filter((d) => d.done).length

  const summary: RoadmapSummary = {
    totalMonthlyCash: rawSteps.reduce((sum, s) => sum + (s.isCash && s.monthly > 0 ? s.monthly : 0), 0),
    stepCount: rawSteps.length,
    urgentCount: byPhase.urgent.length,
    onlineCount: byPhase.online.length,
    visitCount: byPhase.visit.length,
    allDocs,
    docProgress: { total: allDocs.length, done: docDone },
  }

  return { steps: rawSteps, byPhase, summary }
}

/**
 * 로드맵을 사람이 읽는 평문으로 — 인쇄·클립보드 복사·주민센터 지참용.
 * 순수 함수라 컴포넌트와 무관하게 테스트로 잠근다.
 */
export function roadmapToText(roadmap: Roadmap): string {
  const lines: string[] = ['[복지 신청 로드맵]', '']
  for (const phase of PHASE_ORDER) {
    const steps = roadmap.byPhase[phase]
    if (!steps.length) continue
    lines.push(`■ ${PHASE_META[phase].title}`)
    for (const s of steps) {
      const bits: string[] = []
      if (s.isCash && s.monthly > 0) bits.push(`월 ${formatWon(s.monthly)}`)
      if (s.deadline) bits.push(s.deadline.label)
      if (s.department) bits.push(s.department)
      lines.push(` ${s.order}. ${s.name}${bits.length ? ' — ' + bits.join(' · ') : ''}`)
      lines.push(s.missingDocs.length ? `    · 준비할 서류: ${s.missingDocs.join(', ')}` : '    · 서류 준비 완료')
      if (s.applyUrl) lines.push(`    · 신청: ${s.applyUrl}`)
    }
    lines.push('')
  }
  const { summary } = roadmap
  if (summary.allDocs.length) {
    const docs = summary.allDocs.map((d) => (d.count > 1 ? `${d.name}(${d.count}건)` : d.name)).join(', ')
    lines.push(`필요 서류 종합: ${docs}`)
  }
  if (summary.totalMonthlyCash > 0) {
    lines.push(`월 예상 현금지원 합계: ${formatWon(summary.totalMonthlyCash)} (이론상 최대·중복수급 미반영)`)
  }
  return lines.join('\n').trim()
}
