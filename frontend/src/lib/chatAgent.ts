import type { Policy } from '@/data/policies'
import type { UserProfile, AnalysisResult } from '@/lib/welfare-engine'
import type { TrackedItem } from '@/store/useAppStore'
import { checkPolicy, getEligiblePolicies } from '@/lib/welfare-engine'
import { getCatalog, getPolicyMap } from '@/data/catalog'
import { searchPolicies } from '@/lib/search'
import { buildActionFeed } from '@/lib/monitoring'
import { parseMonthly, formatWon, isCashBenefit } from '@/lib/format'
import { medianIncome, BENEFIT_THRESHOLDS } from '@/lib/medianIncome'
import { rankPolicies } from '@/lib/priority'
import { applyLink } from '@/lib/officialLinks'
import { MYTH_RULES, pickEvidence } from '@/lib/misconceptions'
import { scanProfileGaps } from '@/lib/profileGaps'
import { applyTiming } from '@/lib/applyTiming'
import { getInsights } from '@/lib/insights'
import { quickWins } from '@/lib/quickWins'
import { hotlinesFor } from '@/lib/hotlines'

/**
 * 챗 에이전트 두뇌 — 검색봇을 넘어 '나를 알고, 대신 행동하는' 에이전트로.
 * 저장된 프로필/분석결과를 바탕으로 개인화 답변하고, 답변 속 복지를 바로 담기/분석/탐색으로 잇는다.
 * LLM 없이 기존 규칙 엔진(checkPolicy·getEligiblePolicies·searchPolicies)만 사용 — 서버 미전송·환각 없음.
 */
export interface AgentReply {
  text: string
  /** 답변에서 참조한 정책 — UI가 '담기/상세' 행동 칩을 붙인다 */
  policies?: Policy[]
  /** 이어서 하면 좋은 다음 행동(뷰 이동) */
  cta?: { view: 'analyze' | 'explore' | 'my'; label: string }
  /** 💬→🖨 CTA가 뷰 이동에 더해 이 서류의 자동발급을 시작해야 함(데스크탑 에이전트 연결 시에만 설정) */
  issueDoc?: string
  /** 💬→🚀 CTA가 원클릭 연쇄(전부 자동발급)를 시작해야 함(데스크탑 에이전트 연결 시에만 설정) */
  issueAll?: boolean
  /** 💬→🚀 오토파일럿 — 'run'=담기→연쇄 발급→신청 준비 실행, 'analyze'=결과가 없어 분석부터 안내 */
  autopilot?: 'run' | 'analyze'
}

const HH = (p: UserProfile) => [p.age > 0 ? `${p.age}세` : '', p.household_type].filter(Boolean).join('·')

function line(p: Policy, note?: string): string {
  // ⚠️ 현금성만 금액 표기 — 서비스 한도(재가급여 '월 251만원 한도')·바우처를 "월 N까지" 현금처럼 적으면
  //   같은 정책의 카드·상세·비교와 모순되고 비현금을 현금으로 과장한다(다른 모든 표시부와 동일 게이트, 감사 F1)
  const m = isCashBenefit(p.benefit, `${p.name} ${p.category}`) ? parseMonthly(p.benefit) : 0
  const amt = m > 0 ? ` (월 ${formatWon(m)}까지)` : ''
  return `• ${p.name}${amt}${note ? ` — ${note}` : ` — ${applyLink(p.application).label}`}`
}

/** 챗을 열 때 현재 상태를 먼저 브리핑(능동성) — 급한 마감·서류가 있으면 그것부터 짚어준다 */
export function greetingReply(profile: UserProfile | null, tracked: TrackedItem[], docDone: Record<string, number> = {}): AgentReply {
  const count = tracked.length
  // 능동적 개입: 담아둔 복지 중 지금 급한(마감·신청준비완료·갱신임박) 항목을 먼저 보고
  // (docDone — 서류 도우미 '발급 완료' 기억까지 합산해야 '신청 준비 완료' 승격이 다른 화면과 일치)
  const urgent = buildActionFeed(tracked, getPolicyMap(), docDone).filter((f) => f.alert.level === 'high')
  if (urgent.length) {
    const name = profile?.name || '회원'
    const top = urgent.slice(0, 2).map((f) => `• ${f.policy?.name ?? '복지'} — ${f.alert.text}`).join('\n')
    return {
      text: `${name}님, 지금 급히 챙길 게 ${urgent.length}건 있어요 🔔\n${top}\n\n담아두신 복지를 계속 지켜보고 있어요. 바로 확인해 보실래요?`,
      cta: { view: 'my', label: '지금 챙기기' },
    }
  }
  if (!profile && count === 0) {
    return {
      text: '안녕하세요! 복지 도우미예요 🌱\n제가 상황에 맞는 복지를 찾아드릴게요. "내가 뭐 받을 수 있어?"처럼 편하게 물어보시거나, 정밀 분석을 해보셔도 좋아요.',
      cta: { view: 'analyze', label: '내 복지 분석하기' },
    }
  }
  const name = profile?.name || '회원'
  const who = profile ? `(${HH(profile)}) ` : ''
  const bits: string[] = []
  if (profile) bits.push('프로필을 알고 있어서 바로 맞춤 답을 드릴 수 있어요')
  if (count > 0) bits.push(`담아두신 복지 ${count}건도 지켜보고 있어요`)
  return {
    text: `${name}님 ${who}반가워요! 🌱\n${bits.join('. ')}. 무엇이 궁금하세요? "내가 받을 수 있는 거 알려줘"라고 하시면 정리해 드릴게요.`,
    cta: profile ? { view: 'my', label: '나의 복지 보기' } : { view: 'analyze', label: '내 복지 분석하기' },
  }
}

const ELIG_RE = /(내가|나).*(받|대상|자격|해당)|받을\s*수\s*있|자격|대상.*되|혜택.*뭐|뭐.*받|추천|어떤.*복지|맞는.*복지/
// 소득 기준(얼마까지 벌어도 되나) 질문 — 자격(ELIG)보다 먼저 잡아 소득 상한표로 답한다.
const INCOME_RE = /(소득|수입|중위소득|소득인정액)\s*(기준|얼마|상한|조건|제한|컷|커트라인|몇\s*%|퍼센트|되)|얼마(까지|나)?\s*(벌|버는|버시|소득|수입)|(벌어도|벌면|버는데)\s*(되|받|자격|대상)/
// 우선순위(뭐부터 신청?) 질문 — 자격(ELIG)보다 먼저 잡아 점수순 추천으로 답한다.
const PRIORITY_RE = /우선\s*순위|뭐\s*부터|무엇\s*부터|어떤\s*(것|거)\s*(부터|먼저)|먼저\s*(신청|해야|챙|받)|신청\s*순서|가장\s*급한|제일\s*(중요|급)/
const GREET_RE = /^(안녕|하이|hello|hi|반가|ㅎㅇ)/i

/** 저장된 분석결과/프로필로 '내가 받을 수 있는' 질문에 개인화 답변 */
function eligibilityReply(profile: UserProfile | null, result: AnalysisResult | null): AgentReply {
  if (!profile) {
    return {
      text: '먼저 간단한 프로필만 알려주시면 정확히 골라드릴 수 있어요. 1분이면 돼요! (나이·가구·소득 몇 가지)',
      cta: { view: 'analyze', label: '내 복지 분석하기' },
    }
  }
  const elig = (result?.eligible_policies?.length ? result.eligible_policies : getEligiblePolicies(profile))
  const top = elig.slice(0, 3)
  if (top.length === 0) {
    return {
      text: `${profile.name || '회원'}님 조건으로 딱 떨어지는 걸 아직 못 찾았어요. 상황을 조금 더 반영해 정밀 분석을 해볼까요?`,
      cta: { view: 'analyze', label: '정밀 분석하기' },
    }
  }
  const body = top.map((p) => line(p, p.reason)).join('\n')
  // 민간재단(심사·선발형)은 top3에 안 들어도 존재를 알려준다 — 장학·의료비 사각지대 발견성
  const prvCount = elig.filter((p) => p.id.startsWith('PRV-')).length
  const prvNote = prvCount > 0 ? `\n💝 이 외에 민간재단 지원(장학·의료비 등) ${prvCount}건도 관련돼요 — 분석 결과의 '민간재단 지원' 섹션을 확인하세요.` : ''
  return {
    text: `${profile.name || '회원'}님(${HH(profile)}) 기준으로 지금 챙기면 좋은 복지예요 👇\n${body}${prvNote}\n\n마음에 드는 걸 바로 담아두면 제가 마감·서류까지 챙겨드릴게요.`,
    policies: top,
    cta: { view: 'my', label: '담아둔 복지 관리' },
  }
}

/** 키워드/생활어 검색 — 프로필이 있으면 각 정책에 개인화 자격 코멘트를 붙인다 */
function searchReply(query: string, profile: UserProfile | null): AgentReply {
  const found = searchPolicies(getCatalog(), query).slice(0, 3)
  if (found.length === 0) {
    return {
      text: `음, '${query}'는 제 전문 분야(복지·지원금)에선 딱 맞는 걸 못 찾았어요. 😅 저는 복지 전문 에이전트라 그쪽은 자신 있어요! 상황을 알려주시면(예: "62살 혼자 살아요") 받을 수 있는 걸 바로 찾아드릴게요. 급하면 ☎129 무료 상담도 좋아요.`,
      cta: { view: 'analyze', label: '내 복지 분석하기' },
    }
  }
  const body = found
    .map((p) => {
      if (profile) {
        const r = checkPolicy(p, profile)
        return line(p, r.eligible ? `✅ ${r.reason}` : '조건 확인 필요')
      }
      return line(p)
    })
    .join('\n')
  const tail = profile ? '\n\n✅는 회원님 조건에 맞을 가능성이 높은 거예요. 담아두면 계속 챙겨드릴게요.' : '\n\n프로필을 알려주시면 회원님께 맞는지까지 짚어드려요.'
  return {
    text: `이런 복지가 있어요! 👇\n${body}${tail}`,
    policies: found,
    cta: profile ? undefined : { view: 'analyze', label: '내 복지 분석하기' },
  }
}

// '서류 뭐 필요해?' 뿐 아니라 '서류 어떻게 발급해?/발급 방법' 같은 발급 방법 질문도 로컬 즉답(느린 클라우드 X)
const DOCS_RE = /(서류|준비물|구비).*(뭐|무엇|필요|어떤|알려|준비)|무슨\s*서류|필요.*서류|발급.*(어떻게|방법|어디|받|하|해)|어떻게.*발급|서류.*발급|전자증명|전자발급/
// '신청 어떻게 해?/신청 방법/어디서 신청' — 신청 절차 안내는 로컬 에이전트가 즉시 답한다.
const APPLY_RE = /신청.*(어떻게|방법|어디|하고|하려|할\s*수|해야|가능|절차|접수)|어떻게.*신청|어디서.*신청|신청하고\s*싶|접수.*방법/

/** '서류 뭐 필요해?' — 담아둔 복지들의 필요 서류를 빈도순 요약 + 서류센터 연결(행동).
 *  agentOn(데스크탑 에이전트 연결)일 땐 자동발급 경로를 우선 안내(웹 문구는 전자증명서 경로 유지). */
export function docsReply(tracked: TrackedItem[], agentOn = false): AgentReply {
  if (!tracked.length) {
    return {
      text: '아직 담아둔 복지가 없어요. 먼저 분석으로 받을 복지를 찾아 담아두시면, 필요한 서류를 제가 모아서 챙겨드릴게요.',
      cta: { view: 'analyze', label: '내 복지 분석하기' },
    }
  }
  const map = getPolicyMap()
  const freq = new Map<string, number>()
  for (const t of tracked) for (const d of map[t.policyId]?.required_docs ?? []) freq.set(d, (freq.get(d) ?? 0) + 1)
  const top = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
  if (!top.length) {
    return { text: '담아두신 복지는 별도 서류 없이 신청 가능한 것들이에요. 상세에서 신청 방법을 확인하세요.', cta: { view: 'my', label: '나의 복지 보기' } }
  }
  const lines = top.map(([d, n]) => `• ${d}${n > 1 ? ` (${n}곳에서 필요)` : ''}`).join('\n')
  const how = agentOn
    ? `지금 이 앱에서는 정부24 서류를 **자동 발급**할 수 있어요 — '나의 복지 → 서류 준비 도우미'의 [🚀 전부 자동발급]이 한 번 인증으로 순서대로 발급하고, 신청 양식 자동첨부까지 이어져요(📱 인증 승인만 직접). 이미 서류함에 있는 유효한 서류는 알아서 건너뛰고 **부족한 것만** 발급해요 — 발급물은 [📦 묶음 받기]로 ZIP 한 파일로도 챙길 수 있어요.`
    : `'나의 복지 → 서류 준비 도우미'에서 발급처로 바로 이어드려요. 정부24 서류는 설치 없이 **전자증명서(전자문서지갑)**로 발급하면, 복지로·주민센터에 **종이 없이 전자제출**까지 돼요(본인인증만 직접).`
  return {
    text: `담아두신 복지 ${tracked.length}건에 필요한 서류를 모아봤어요 👇
${lines}

${how}`,
    cta: { view: 'my', label: '서류 준비 도우미 열기' },
  }
}

/** '신청 어떻게 해?' — 신청 절차를 즉시 안내하고 신청 흐름으로 연결(행동).
 *  agentOn이면 이 앱의 실제 자동화(발급→자동첨부→제출 직전 정지)를 정확히 안내. */
export function applyReply(tracked: TrackedItem[], agentOn = false): AgentReply {
  if (!tracked.length) {
    return {
      text: '먼저 받을 복지를 찾아 담아두시면, 각 복지의 신청 방법과 공식 신청 페이지로 바로 안내해 드려요.',
      cta: { view: 'analyze', label: '내 복지 분석하기' },
    }
  }
  if (agentOn) {
    return {
      text: `담아두신 복지 ${tracked.length}건, 이 앱에서는 신청까지 에이전트가 대신 진행해요 👇
• '나의 복지 → 서류 준비 도우미'의 [🚀 전부 자동발급]을 누르면 서류 발급 → 복지로 신청 양식 작성 → 방금 발급한 서류 **자동 첨부**까지 한 흐름으로 진행돼요.
• 개별 복지는 상세의 '에이전트 자동 신청'으로도 시작할 수 있어요.
• 📱 카카오 인증 승인과 **최종 제출**만 직접 하시면 됩니다(제출 직전에 멈춰요 — 안전장치).`,
      cta: { view: 'my', label: '나의 복지에서 신청하기' },
    }
  }
  return {
    text: `담아두신 복지 ${tracked.length}건, 신청까지 제가 도와드릴게요 👇
• 각 복지 상세의 '신청 키트'에서 내 정보를 자동 복사하고 공식 신청 페이지(복지로 등)로 바로 이동해요.
• 서류 첨부가 필요하면 정부24에서 **전자증명서(전자문서지갑)**로 발급 → 복지로에서 종이·첨부 없이 전자제출돼요.
• 본인인증·최종 제출만 직접 하시면 됩니다. (데스크탑 앱을 쓰시면 양식 작성까지 자동으로 채워드려요.)`,
    cta: { view: 'my', label: '나의 복지에서 신청하기' },
  }
}

// 💬→🖨 "등본 발급해줘/떼줘" — 서류를 '지목'하고 발급을 '요청'하는 실행 의도(방법 질문 DOCS_RE와 구분).
//   생활어 축약(등본·초본 등)도 정식 발급명으로 해석 — 지원 서류가 실제로 지목된 경우에만 발동(오발동 방지).
const ISSUE_VERB_RE = /(발급|떼|띠|뽑|출력)(아|어|해|받)?\s*(줘|주세요|주라|줄래|봐|자|버려|해줘|하고\s*싶|받고\s*싶|해야|할래|할게)|발급\s*(부탁|고고|ㄱ)|(떼|뽑)고\s*싶/
const ISSUE_SHORT_ALIASES: Record<string, string> = {
  등본: '주민등록등본', 초본: '주민등록초본', 가족관계: '가족관계증명서', 가족증명: '가족관계증명서',
  소득증명: '소득금액증명', 소득금액: '소득금액증명', 수급자증명: '기초생활수급자 증명서',
  한부모증명: '한부모가족 증명서', 병적: '병적증명서', 출입국사실: '출입국에 관한 사실증명',
}

/**
 * "등본 발급해줘" 실행 의도 해석 — 발급 동사 + 지원 서류명(정식명 또는 생활어 축약)이 함께 있을 때만
 * 그 서류의 정식 발급명을 반환(없으면 null = 실행 의도 아님 → 기존 방법 안내로 폴백).
 * 실제 발급 시작·인증정보 가드는 서류 도우미의 기존 경로가 수행한다(여기는 해석만 — 부작용 없음).
 */
export function matchIssueIntent(raw: string, supportedDocs: string[]): string | null {
  const t = raw.replace(/\s/g, '')
  if (!ISSUE_VERB_RE.test(raw) && !/발급해/.test(t)) return null
  // ① 정식 발급명 직접 지목(공백 무시) — 긴 이름 우선(예: '주민등록등본'이 '등본'보다 먼저)
  const direct = [...supportedDocs].sort((a, b) => b.length - a.length)
    .find((d) => t.includes(d.replace(/\s/g, '')))
  if (direct) return direct
  // ② 생활어 축약 — 해석된 정식명이 지원 목록에 있을 때만(β 해제 등으로 빠진 서류를 안내하지 않게)
  for (const [short, full] of Object.entries(ISSUE_SHORT_ALIASES)) {
    if (t.includes(short) && supportedDocs.includes(full)) return full
  }
  return null
}

/**
 * "서류 전부 발급해줘" — 원클릭 연쇄(부족분만·한 번 인증) 전체를 시작하는 실행 의도.
 * 발급 '요청 동사'가 함께 있을 때만 true — "발급 다 됐어?"(상태 질문)는 잡지 않는다.
 */
export function matchIssueAllIntent(raw: string): boolean {
  const t = raw.replace(/\s/g, '')
  return /(서류|필요한거|필요서류)?(전부|다|모두|몽땅|한꺼번에|한번에)(자동)?발급(해|시작|좀|부탁|고|해줘|해주)/.test(t)
    || /(전부|다|모두|몽땅)(떼|뽑)(아|어)?(줘|주세요|주라)/.test(t)
    || /발급(전부|다|모두)(해|해줘|해주|시작)/.test(t)
}

/** "전부 발급해줘" 응답 — CTA 한 번이면 원클릭 연쇄([🚀 전부 자동발급])가 그대로 시작된다. */
export function issueAllReply(): AgentReply {
  return {
    text: `담아두신 복지의 필요 서류를 **한 번 인증으로 연쇄 자동발급**할게요 — 서류함에 있는 유효한 서류는 건너뛰고 부족한 것만 발급해요. 아래 버튼으로 시작하세요(실명·생년월일·휴대폰이 비어 있으면 입력칸으로 안내 · 📱 인증 승인만 직접). 담은 복지가 없으면 지원 서류 목록에서 골라 시작할 수 있게 열어드려요.`,
    cta: { view: 'my', label: '🚀 전부 자동발급 시작' },
    issueAll: true,
  }
}

/**
 * "알아서 다 해줘" — 오토파일럿(추천 전부 담기→연쇄 발급→신청 준비) 실행 의도.
 * '알아서/끝까지/신청까지' 같은 위임 표현 + 실행 요청이 함께 있을 때만 — "전부 발급해줘"(연쇄)와는
 * 분리(그쪽은 발급 동사 필수), "신청까지 해주나요?" 질문에도 오토파일럿 안내가 곧 정답이라 잡는다.
 */
export function matchAutopilotIntent(raw: string): boolean {
  const t = raw.replace(/\s/g, '')
  if (/오토파일럿/.test(t)) return true
  return /(알아서|끝까지|신청까지)(전부|다|모두)?(해줘|해주|해봐|진행|처리)/.test(t)
    || /(전부|다|모두)알아서/.test(t)
}

/** 오토파일럿 응답 — 결과가 있으면 실행 CTA, 없으면 정직하게 '분석 먼저' 경로 안내. */
export function autopilotReply(ready: boolean): AgentReply {
  if (ready) {
    return {
      text: '제가 이어서 진행할게요 — 분석 결과의 추천 복지를 전부 담고, 부족한 서류 연쇄 자동발급과 신청 준비까지 한 흐름으로 해요. 📱 본인인증과 최종 제출 확인만 직접 해주시면 돼요.',
      cta: { view: 'my', label: '🚀 오토파일럿 시작' },
      autopilot: 'run',
    }
  }
  return {
    text: '먼저 상황을 알아야 정확히 도와드릴 수 있어요 — 복지 찾기에서 한 문장(예: "72세 혼자 사는데 소득이 적어요")으로 분석하면, 결과 화면의 🚀 오토파일럿 버튼 하나로 담기부터 서류 발급·신청 준비까지 이어서 해드려요.',
    cta: { view: 'analyze', label: '복지 찾기로 이동' },
    autopilot: 'analyze',
  }
}

/** "등본 발급해줘" 응답 — CTA 한 번이면 나의 복지로 이동해 그 서류의 자동발급이 바로 시작된다. */
export function issueReply(doc: string): AgentReply {
  return {
    text: `「${doc}」 자동발급을 시작할 준비가 됐어요. 아래 버튼을 누르면 서류 도우미로 이동해 바로 발급을 시작해요 — 실명·생년월일·휴대폰이 아직 비어 있으면 입력칸으로 안내해 드리고, 📱 카카오/PASS 인증 승인만 직접 해주시면 됩니다. 발급물은 🗂 서류함에 저장되고 신청 때 자동첨부돼요.`,
    cta: { view: 'my', label: `${doc} 자동발급 시작` },
    issueDoc: doc,
  }
}

const SAVE_RE = /담(아|어|을|기|아줘|아둬|아주|아 줘)|저장|추가|찜|관심\s*목록|넣어/
// 조회 의도 — "관심목록 보여줘/찜 목록 알려줘/저장된 거 뭐야"는 저장이 아니라 '보기' 요청.
// SAVE_RE 단독 판정 시 조회 문장이 전체 저장으로 오인되던 결함(감사 실측) 차단.
const VIEW_RE = /보여|알려|확인|볼래|뭐(야|가|지|있)|목록\s*(좀)?$|현황|얼마나/
const ORD: Record<string, number> = { 첫: 0, 1: 0, 하나: 0, 두: 1, 2: 1, 둘: 1, 세: 2, 3: 2, 셋: 2, 네: 3, 4: 3, 넷: 3 }

/**
 * 대화 맥락 기억 — 직전에 보여준 복지들(context)을 "그거/첫번째/다 담아줘"처럼 가리키는 저장 의도를 해석.
 * 반환: 담을 정책 목록(없으면 null=저장 의도 아님). 실제 저장(toggleSaved)은 호출부(스토어)에서 수행.
 * @param explicitOnly 챗에 직접 보여준 목록이 아닌 폴백 컨텍스트(분석 결과 전체)일 때 true —
 *   전체 지시어("다/전부")·서수·정책명처럼 **명시적** 지시가 있을 때만 저장(밋밋한 "담아줘"로 37건 무단 저장 방지).
 */
export function matchSaveIntent(raw: string, context: Policy[], explicitOnly = false): Policy[] | null {
  if (!context.length || !SAVE_RE.test(raw)) return null
  if (VIEW_RE.test(raw)) return null // 조회("보여줘·알려줘·뭐야")는 저장 아님
  const t = raw.replace(/\s/g, '')
  if (/(다|전부|모두|전체|모든|다들)담|담.*(다|전부|모두)|이것들|그것들|다넣/.test(t)) return context
  // 'N개/N가지/N건'은 '개수'(앞에서 N건) — 서수(N번째)보다 먼저 판정해 "3개 담아줘"가 '3번째 하나'로 오해되지 않게(감사)
  const cnt = t.match(/([1-9])(개|가지|건)/)
  if (cnt) return context.slice(0, parseInt(cnt[1], 10))
  // 한글 수사 개수('두 개/세 개/한 개')도 개수로 — 서수(N번째)보다 먼저 판정(안 그러면 '두 개'가
  //   '2번째 하나'로 오인됨). 반드시 세는말(개·가지·건)이 붙을 때만 → '65세 …'의 '세'는 여기 안 걸린다.
  const KCNT: Record<string, number> = { 한: 1, 하나: 1, 두: 2, 둘: 2, 세: 3, 셋: 3, 네: 4, 넷: 4 }
  const kcnt = t.match(/(하나|둘|셋|넷|한|두|세|네)(개|가지|건)/)
  if (kcnt && KCNT[kcnt[1]] !== undefined) return context.slice(0, KCNT[kcnt[1]])
  const ord = t.match(/(첫|두|세|네|하나|둘|셋|넷|[1-4])(번째|째|번)?/)
  if (ord && ORD[ord[1]] !== undefined && context[ORD[ord[1]]]) return [context[ORD[ord[1]]]]
  const byName = context.filter((p) => t.includes(p.name.replace(/\s/g, '')))
  if (byName.length) return byName
  if (explicitOnly) return null // 폴백 컨텍스트에선 명시적 지시 없으면 저장하지 않음
  if (/(그거|이거|저거|그것|이것|그걸|이걸)/.test(t) || context.length === 1) return [context[0]]
  return context // 밋밋한 "담아줘" + 여러 개(직접 보여준 목록) → 보여준 것 전부
}

// ── 오해 진단 인텐트 — '틀린 확신'으로 포기하려는 말에 구조 규칙으로 바로잡는다 ──
// 통념 신호(무엇을 오해하나) + 포기/의심 신호(DOUBT)가 함께 있을 때만 발동해 단순 언급 오발동을 막는다.
const MYTH_HINTS: { id: string; re: RegExp }[] = [
  { id: 'asset', re: /재산|집이? ?있|차가? ?있|저축|모아둔|가진 ?게|땅이? ?있/ },
  { id: 'dependant', re: /자식|자녀|부양 ?의무|가족.*소득|아들|딸/ },
  { id: 'work', re: /일하면|취직|근로|돈 ?벌면|일 ?시작|알바|소득이 ?생기/ },
  { id: 'reapply', re: /떨어졌|탈락|반려|거절|한 ?번.*안/ },
  { id: 'disability-mild', re: /경증|가벼운 ?장애|[456] ?급/ },
  { id: 'foreigner', re: /외국인|이주민|귀화|다문화/ },
  { id: 'single', re: /1인 ?가구|혼자 ?살|혼자 ?사는|독거/ },
  { id: 'middle-income', re: /중산층|소득이 ?높|많이 ?벌|중간 ?소득|잘 ?살|어중간/ },
  // 태도 장벽(마음가짐) — 자격이 아니라 '복잡해서/건강해서 안 한다'
  { id: 'complex', re: /복잡|어려워|어렵|막막|엄두|귀찮|모르겠/ },
  { id: 'healthy', re: /건강|멀쩡|아프지|병\s*없|아픈\s*데\s*없/ },
]
const DOUBT_RE = /못 ?받|못 ?하|안 ?될|안 ?돼|안 ?되|안 ?하|자격.*(안|없|미달)|해당\s*(사항\s*)?(안|없)|어차피|소용없|끊|잘려|중단|끝이|되겠|될까|안 ?나오|힘들|어려|포기|엄두|막막|귀찮|필요\s*없|받을 ?(게|거|수) ?없|대상\s*(이\s*)?아니/

/** 오해(통념) 발화인지 — 통념 대상 규칙 id를 돌려준다(아니면 null). 포기/의심 신호가 있어야만 잡는다. */
export function matchMisconceptionIntent(raw: string): string | null {
  const t = raw || ''
  if (!DOUBT_RE.test(t)) return null
  for (const h of MYTH_HINTS) if (h.re.test(t)) return h.id
  return null
}

/** 규칙 id로 오해를 바로잡는 답 — truth(정직성 라벨 포함)+적격 정책 원문 근거를 붙인다(자격 재판정 없음). */
function misconceptionReply(ruleId: string, result: AnalysisResult | null): AgentReply {
  const rule = MYTH_RULES.find((r) => r.id === ruleId)
  if (!rule) return searchReply('', null) // 방어: 규칙 못 찾으면 검색 폴백
  const eligible = result?.eligible_policies ?? []
  const ev = pickEvidence(rule, eligible)
  const map = getPolicyMap()
  const policies = ev.ids.map((id) => map[id]).filter(Boolean) as Policy[]
  const evLine = ev.ids.length ? `\n\n근거가 되는 복지 · ${ev.text}` : `\n\n${ev.text}`
  const tail = result ? '' : '\n\n정확히 확인하려면 간단한 분석을 먼저 해보세요.'
  return {
    text: `${rule.truth}${evLine}${tail}`,
    policies,
    cta: result ? undefined : { view: 'analyze', label: '내 자격 분석해보기' },
  }
}

// ── 숨은 자격 인텐트 — '놓친 거 없어?'에 프로필 공백을 되물어 준다 ──
const GAP_RE = /놓친|빠뜨|빠진 ?거|누락|안 ?물어|더 ?받을 ?수 ?있|또 ?받을 ?수|추가로 ?받을|숨은 ?자격|내가 ?모르는|더 ?없(나|어|을|는)/

/** 프로필 공백을 임팩트순으로 되묻는다(해당되면 열리는 복지 수·월 증가 추정). 사실 단정 없이 '혹시?'로. */
function gapReply(profile: UserProfile | null): AgentReply {
  if (!profile) return { text: '아직 분석 전이라 놓친 자격을 짚어드리기 어려워요. 간단한 분석을 먼저 해볼까요?', cta: { view: 'analyze', label: '분석 시작' } }
  const gaps = scanProfileGaps(profile, { limit: 3 })
  if (!gaps.length) return { text: '지금 입력하신 정보로는 크게 놓친 항목이 보이지 않아요. 상황이 바뀌면 언제든 다시 분석해 주세요.' }
  const lines = gaps.map((g) => {
    const money = g.monthlyDelta > 0 ? `, 월 최대 +${formatWon(g.monthlyDelta)}` : ''
    return `• ${g.question}\n  (해당되면 +${g.newCount}개${money})`
  }).join('\n')
  return {
    text: `혹시 이런 상황이신가요? 해당되면 받을 복지가 늘어요.\n${lines}\n\n※ 추정이에요 — 해당되시면 프로필에 반영해 다시 분석해 보세요.`,
    cta: { view: 'analyze', label: '프로필 고쳐 다시 분석' },
  }
}

// ── 신청 골든타임 인텐트 — '언제 신청해야 손해 안 봐?'에 시간이 중요한 알림을 짚어 준다 ──
// '어떻게 신청'(방법)과 구분되게 타이밍 특화어에만 발동(APPLY_RE보다 먼저 검사).
const TIMING_RE = /골든\s*타임|소급|미리\s*신청|사전\s*신청|언제\s*(까지\s*)?신청|신청\s*시기|신청\s*기한|기한\s*(이|은)?\s*언제|지금\s*안\s*하면|늦으면|서둘러|서둘러야|타이밍/

/** 신청 타이밍 답 — 이 사람에게 시간이 급한 항목(소급·사전신청·기한)을 짚고, 없으면 신청주의 원칙을 안내. */
function timingReply(profile: UserProfile | null, result: AnalysisResult | null): AgentReply {
  const alerts = applyTiming(profile, result?.eligible_policies ?? [])
  if (!alerts.length) {
    return {
      text: '복지는 대부분 신청한 달부터 지급되고 지난 달치는 소멸돼요. 받을 수 있는 게 있으면 이번 달 안에 신청하는 게 좋아요. 지금 특별히 시간이 급한 항목은 보이지 않네요.',
      cta: result ? undefined : { view: 'analyze', label: '내 자격 분석해보기' },
    }
  }
  const lines = alerts.map((a) => `• ${a.title}\n  놓치면 — ${a.lossRisk}`).join('\n')
  return {
    text: `신청 타이밍, 이건 서두르세요 ⏰\n${lines}\n\n정확한 기한은 주민센터·복지로에서 확인하세요.`,
    cta: result ? { view: 'my', label: '담은 복지 신청 준비' } : { view: 'analyze', label: '내 자격 분석해보기' },
  }
}

// ── 지금 바로 되는 것 인텐트 — '앉은 자리에서 온라인으로 끝나는' 복지만 골라 안내 ──
const QUICKWIN_RE = /지금 ?바로|당장 ?(되|신청|가능)|앉은 ?자리|바로 ?되는|바로 ?신청|온라인으로만|집에서 ?(되|신청)|쉬운 ?것부터/

/** 온라인 즉시 완결 가능 복지(quickWins)를 안내 — 신청 마찰이 가장 낮은 것부터. */
function quickWinReply(result: AnalysisResult | null): AgentReply {
  const eligible = result?.eligible_policies ?? []
  const wins = quickWins(eligible)
  if (!wins.length) {
    return {
      text: '지금 이 자리에서 온라인으로 바로 끝나는 복지는 눈에 띄지 않네요. 그래도 담아두시면 서류·신청을 순서대로 도와드릴게요.',
      cta: result ? { view: 'my', label: '나의 복지에서 준비' } : { view: 'analyze', label: '먼저 분석하기' },
    }
  }
  const lines = wins.slice(0, 5).map((w) => `• ${w.policy.name}${w.noDocs ? ' — 서류 없이 바로' : ' — 방문 없이 준비 가능'}`).join('\n')
  return {
    text: `앉은 자리에서 온라인으로 바로 신청할 수 있는 복지예요(${wins.length}개).\n${lines}\n\n복지로에서 로그인 후 신청하시면 돼요.`,
    policies: wins.slice(0, 5).map((w) => w.policy as Policy),
    cta: { view: 'my', label: '담아서 신청 준비' },
  }
}

// ── 상담 전화 인텐트 — '어디로 전화하죠?'에 대표 상담 번호를 바로(어르신·저자력 사용자 우선) ──
const HOTLINE_RE = /전화번호|상담\s*전화|전화\s*상담|콜센터|상담\s*센터|핫라인|어디\s*(에|로)?\s*(전화|연락)|문의\s*(전화|처)|전화\s*어디/

/** 상황 키워드로 관련 상담 번호를 안내(없으면 대표 목록). 번호는 바뀔 수 있음을 고지. */
function hotlineReply(raw: string): AgentReply {
  const list = hotlinesFor(raw, 6)
  const lines = list.map((h) => `• ${h.tel} — ${h.name}${h.urgent ? ' (24시간)' : ''}: ${h.desc}`).join('\n')
  return {
    text: `상담 전화번호를 안내해 드릴게요(번호는 바뀔 수 있어요).\n${lines}\n\n어디에 해당하는지 모르시면 129(보건복지상담센터)로 먼저 전화하시면 안내받을 수 있어요.`,
  }
}

// ── 종합 조언 인텐트 — '내 상황 정리해줘'에 스마트 인사이트(타이밍·오해·숨은자격·신선도)를 한눈에 ──
const ADVICE_RE = /정리해|요약해|종합|한눈에|내 ?상황|조언|어떻게 ?해야|뭐 ?부터|뭐 ?하면|짚어|브리핑/

/** 여러 인사이트 엔진을 합쳐 우선순위로 조언한다(getInsights 아그리게이터 재사용 — 규칙 중복 없음). */
function adviceReply(profile: UserProfile | null, result: AnalysisResult | null): AgentReply {
  if (!profile || !result) {
    return { text: '먼저 간단한 분석을 하면 상황을 종합해 조언해 드릴 수 있어요.', cta: { view: 'analyze', label: '분석 시작' } }
  }
  const insights = getInsights(profile, result.eligible_policies ?? [], { limit: 4 })
  if (!insights.length) {
    return { text: `${profile.name || '회원'}님, 지금은 특별히 급히 짚어드릴 게 없어요. 담은 복지의 서류·신청을 차근히 준비하시면 돼요.`, cta: { view: 'my', label: '나의 복지 보기' } }
  }
  const lines = insights.map((i) => `${i.emoji} ${i.title}\n  ${i.detail}`).join('\n')
  return {
    text: `${profile.name || '회원'}님 상황을 종합하면 이 순서로 챙기시면 좋아요.\n${lines}`,
    cta: { view: 'my', label: '나의 복지에서 이어가기' },
  }
}

/** 소득 기준(급여별 소득인정액 상한) 안내 — medianIncome 공식값으로 가구원수별 월 상한을 표로. */
export function incomeThresholdReply(): AgentReply {
  const sizes = [1, 2, 3, 4]
  const lines = BENEFIT_THRESHOLDS.map((b) => {
    const amts = sizes.map((s) => `${s}인 ${formatWon(Math.floor((medianIncome(s) * b.pct) / 100))}`).join(' · ')
    return `• ${b.label}(중위 ${b.pct}%): ${amts}`
  })
  return {
    text: `복지 자격은 대부분 ‘소득인정액’(월 소득 + 재산을 소득으로 환산한 값)이 기준 중위소득의 몇 % 이하냐로 정해져요. 2026년 기준 급여별 소득인정액 월 상한이에요:\n${lines.join('\n')}\n\n근로·사업소득은 30% 공제 후 반영되고 재산도 소득으로 환산돼요. 재산까지 넣은 정확한 계산은 ‘탐색 > 기초생활보장 계산기 > 재산까지 넣어 정밀 계산’에서 할 수 있어요.`,
    cta: { view: 'explore', label: '소득인정액 계산하기' },
  }
}

/** 우선순위 안내 — 담은(없으면 분석결과) 복지를 점수순으로 '먼저 챙기세요' */
export function priorityReply(result: AnalysisResult | null, tracked: TrackedItem[]): AgentReply {
  const map = getPolicyMap()
  const pool = tracked.length
    ? tracked.map((t) => map[t.policyId]).filter((p): p is Policy => !!p)
    : (result?.eligible_policies ?? [])
  const ranked = rankPolicies(pool).slice(0, 3)
  if (ranked.length === 0) {
    return { text: '먼저 어떤 복지가 되는지 분석해볼까요? 담아둔 복지가 있으면 금액·시급성·확실성으로 신청 순서를 매겨드려요.', cta: { view: 'analyze', label: '내 복지 분석' } }
  }
  const lines = ranked.map((r, i) => `${i + 1}. ${r.policy.name} (${r.score}점 · 신청 ${['쉬움', '보통', '어려움'][['easy', 'medium', 'hard'].indexOf(r.difficulty)]})`)
  return {
    text: `이 순서로 챙기시길 추천해요 (금액·시급성·자격 확실성·신청 편의 종합):\n${lines.join('\n')}\n\n‘나의 복지’에서 항목별 점수 근거도 볼 수 있어요.`,
    policies: ranked.map((r) => r.policy as Policy),
    cta: { view: 'my', label: '우선순위 자세히' },
  }
}

/** 로컬(행동·개인화) 의도인가 — 이 의도들은 클라우드 LLM이 있어도 로컬 에이전트가 처리한다
 *  (담기·서류·자격·소득기준·우선순위·오해교정·숨은자격·신청타이밍·종합조언은 스토어/프로필/규칙과
 *   결합돼 LLM보다 정확·즉시·무환각). */
export function isLocalIntent(raw: string): boolean {
  const q = raw.trim()
  return GREET_RE.test(q) || DOCS_RE.test(q) || APPLY_RE.test(q) || INCOME_RE.test(q) || PRIORITY_RE.test(q) || ELIG_RE.test(q)
    || TIMING_RE.test(q) || GAP_RE.test(q) || ADVICE_RE.test(q) || QUICKWIN_RE.test(q) || HOTLINE_RE.test(q) || matchMisconceptionIntent(q) !== null
}

/** 메인 진입점 — 자유문장을 의도로 나눠 개인화·행동형으로 응답 */
export function agentReply(raw: string, ctx: { profile: UserProfile | null; result: AnalysisResult | null; tracked?: TrackedItem[]; agentOn?: boolean; issueDocs?: string[] }): AgentReply {
  const q = raw.trim()
  if (!q) return { text: '' }
  if (GREET_RE.test(q)) return greetingReply(ctx.profile, [])
  // 🚀 "알아서 다 해줘"(오토파일럿)는 발급 지목보다 먼저 — 위임 의도가 가장 넓은 실행 요청.
  if (ctx.agentOn && matchAutopilotIntent(q)) {
    return autopilotReply(!!ctx.result?.eligible_policies?.some((p) => p.id.startsWith('POL-')))
  }
  // 💬→🖨 실행 의도("등본 발급해줘")는 방법 질문(DOCS_RE)보다 먼저 — 서류가 지목된 경우에만 발동.
  //   데스크탑 에이전트가 연결됐을 때만(웹은 기존 전자증명서 경로 안내 유지).
  if (ctx.agentOn && ctx.issueDocs?.length) {
    if (matchIssueAllIntent(q)) return issueAllReply() // '전부'가 단건 지목보다 우선(둘 다 있으면 연쇄)
    const doc = matchIssueIntent(q, ctx.issueDocs)
    if (doc) return issueReply(doc)
  }
  // 우선순위('뭐부터 신청?')는 방법(APPLY '신청 해야')·자격(ELIG)보다 먼저 — 순서 신호가 가장 구체적.
  if (PRIORITY_RE.test(q)) return priorityReply(ctx.result, ctx.tracked ?? [])
  if (DOCS_RE.test(q)) return docsReply(ctx.tracked ?? [], ctx.agentOn ?? false)
  // 신청 '타이밍'(언제·소급·미리)은 '방법'(어떻게·어디서)보다 먼저 — APPLY_RE에 가로채이지 않게.
  if (TIMING_RE.test(q)) return timingReply(ctx.profile, ctx.result)
  if (APPLY_RE.test(q)) return applyReply(ctx.tracked ?? [], ctx.agentOn ?? false)
  // 소득 기준 질문은 자격(ELIG)보다 먼저 — '얼마까지 벌어도 받아요?'를 상한표로 답한다.
  if (INCOME_RE.test(q)) return incomeThresholdReply()
  if (ELIG_RE.test(q)) return eligibilityReply(ctx.profile, ctx.result)
  // 오해 바로잡기('재산 있어서 안 될 것 같아요')·숨은 자격('놓친 거 없어?') — 검색 폴백보다 먼저,
  // 단 좁게 게이트해(포기·의심 신호+통념 / 명시적 '놓침' 표현) 일반 검색 질의를 가로채지 않는다.
  const myth = matchMisconceptionIntent(q)
  if (myth) return misconceptionReply(myth, ctx.result)
  if (GAP_RE.test(q)) return gapReply(ctx.profile)
  // 지금 바로 되는 것 — '온라인 즉시' 완결 가능 복지(마찰 최소)
  if (QUICKWIN_RE.test(q)) return quickWinReply(ctx.result)
  // 상담 전화 — '어디로 전화?'에 대표 번호(어르신·저자력 우선)
  if (HOTLINE_RE.test(q)) return hotlineReply(q)
  // 종합 조언('정리해줘'·'뭐부터') — 개별 인텐트가 안 걸린 넓은 요청을 인사이트로 한눈에(검색 폴백 직전)
  if (ADVICE_RE.test(q)) return adviceReply(ctx.profile, ctx.result)
  return searchReply(q, ctx.profile)
}
