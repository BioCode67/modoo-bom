import type { Policy } from '@/data/policies'
import type { UserProfile, AnalysisResult } from '@/lib/welfare-engine'
import type { TrackedItem } from '@/store/useAppStore'
import { checkPolicy, getEligiblePolicies } from '@/lib/welfare-engine'
import { getCatalog, getPolicyMap } from '@/data/catalog'
import { searchPolicies } from '@/lib/search'
import { buildActionFeed } from '@/lib/monitoring'
import { parseMonthly, formatWon, isCashBenefit } from '@/lib/format'
import { applyLink } from '@/lib/officialLinks'

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
}

const HH = (p: UserProfile) => [p.age > 0 ? `${p.age}세` : '', p.household_type].filter(Boolean).join('·')

function line(p: Policy, note?: string): string {
  // 현금성 지원만 '월 N' 배지 — 서비스한도·감면·바우처·대출을 현금처럼 표기하지 않는다(정직성, 다른 표시면과 동일 게이트)
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

/** '서류 뭐 필요해?' — 담아둔 복지들의 필요 서류를 빈도순 요약 + 서류센터 연결(행동) */
export function docsReply(tracked: TrackedItem[]): AgentReply {
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
  return {
    text: `담아두신 복지 ${tracked.length}건에 필요한 서류를 모아봤어요 👇
${lines}

'나의 복지 → 서류 준비 도우미'에서 발급처로 바로 이어드려요. 정부24 서류는 설치 없이 **전자증명서(전자문서지갑)**로 발급하면, 복지로·주민센터에 **종이 없이 전자제출**까지 돼요(본인인증만 직접).`,
    cta: { view: 'my', label: '서류 준비 도우미 열기' },
  }
}

/** '신청 어떻게 해?' — 신청 절차를 즉시 안내하고 신청 흐름으로 연결(행동). */
export function applyReply(tracked: TrackedItem[]): AgentReply {
  if (!tracked.length) {
    return {
      text: '먼저 받을 복지를 찾아 담아두시면, 각 복지의 신청 방법과 공식 신청 페이지로 바로 안내해 드려요.',
      cta: { view: 'analyze', label: '내 복지 분석하기' },
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
  const ord = t.match(/(첫|두|세|네|하나|둘|셋|넷|[1-4])(번째|째|번)?/)
  if (ord && ORD[ord[1]] !== undefined && context[ORD[ord[1]]]) return [context[ORD[ord[1]]]]
  const byName = context.filter((p) => t.includes(p.name.replace(/\s/g, '')))
  if (byName.length) return byName
  if (explicitOnly) return null // 폴백 컨텍스트에선 명시적 지시 없으면 저장하지 않음
  if (/(그거|이거|저거|그것|이것|그걸|이걸)/.test(t) || context.length === 1) return [context[0]]
  return context // 밋밋한 "담아줘" + 여러 개(직접 보여준 목록) → 보여준 것 전부
}

/** 로컬(행동·개인화) 의도인가 — 이 의도들은 클라우드 LLM이 있어도 로컬 에이전트가 처리한다
 *  (담기·서류·자격은 스토어/프로필과 결합된 '행동'이라 LLM보다 정확·즉시). */
export function isLocalIntent(raw: string): boolean {
  const q = raw.trim()
  return GREET_RE.test(q) || DOCS_RE.test(q) || APPLY_RE.test(q) || ELIG_RE.test(q)
}

/** 메인 진입점 — 자유문장을 의도로 나눠 개인화·행동형으로 응답 */
export function agentReply(raw: string, ctx: { profile: UserProfile | null; result: AnalysisResult | null; tracked?: TrackedItem[] }): AgentReply {
  const q = raw.trim()
  if (!q) return { text: '' }
  if (GREET_RE.test(q)) return greetingReply(ctx.profile, [])
  if (DOCS_RE.test(q)) return docsReply(ctx.tracked ?? [])
  if (APPLY_RE.test(q)) return applyReply(ctx.tracked ?? [])
  if (ELIG_RE.test(q)) return eligibilityReply(ctx.profile, ctx.result)
  return searchReply(q, ctx.profile)
}
