import type { Policy } from '@/data/policies'
import type { UserProfile, AnalysisResult } from '@/lib/welfare-engine'
import { checkPolicy, getEligiblePolicies } from '@/lib/welfare-engine'
import { getCatalog } from '@/data/catalog'
import { searchPolicies } from '@/lib/search'
import { parseMonthly, formatWon } from '@/lib/format'
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
  const m = parseMonthly(p.benefit)
  const amt = m > 0 ? ` (월 ${formatWon(m)}까지)` : ''
  return `• ${p.name}${amt}${note ? ` — ${note}` : ` — ${applyLink(p.application).label}`}`
}

/** 챗을 열 때 현재 상태를 먼저 브리핑(능동성) */
export function greetingReply(profile: UserProfile | null, trackedCount: number): AgentReply {
  if (!profile && trackedCount === 0) {
    return {
      text: '안녕하세요! 복지 도우미예요 🌱\n제가 상황에 맞는 복지를 찾아드릴게요. "내가 뭐 받을 수 있어?"처럼 편하게 물어보시거나, 정밀 분석을 해보셔도 좋아요.',
      cta: { view: 'analyze', label: '내 복지 분석하기' },
    }
  }
  const name = profile?.name || '회원'
  const who = profile ? `(${HH(profile)}) ` : ''
  const bits: string[] = []
  if (profile) bits.push('프로필을 알고 있어서 바로 맞춤 답을 드릴 수 있어요')
  if (trackedCount > 0) bits.push(`담아두신 복지 ${trackedCount}건도 지켜보고 있어요`)
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
  return {
    text: `${profile.name || '회원'}님(${HH(profile)}) 기준으로 지금 챙기면 좋은 복지예요 👇\n${body}\n\n마음에 드는 걸 바로 담아두면 제가 마감·서류까지 챙겨드릴게요.`,
    policies: top,
    cta: { view: 'my', label: '담아둔 복지 관리' },
  }
}

/** 키워드/생활어 검색 — 프로필이 있으면 각 정책에 개인화 자격 코멘트를 붙인다 */
function searchReply(query: string, profile: UserProfile | null): AgentReply {
  const found = searchPolicies(getCatalog(), query).slice(0, 3)
  if (found.length === 0) {
    return {
      text: `'${query}'에 딱 맞는 걸 바로 못 찾았어요. 😅 상황을 알려주시면(예: "62살 혼자 살아요") 더 정확히 찾아드릴게요. 급하면 ☎129 무료 상담도 좋아요.`,
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

const SAVE_RE = /담(아|어|을|기|아줘|아둬|아주|아 줘)|저장|추가|찜|관심\s*목록|넣어/
const ORD: Record<string, number> = { 첫: 0, 1: 0, 하나: 0, 두: 1, 2: 1, 둘: 1, 세: 2, 3: 2, 셋: 2, 네: 3, 4: 3, 넷: 3 }

/**
 * 대화 맥락 기억 — 직전에 보여준 복지들(context)을 "그거/첫번째/다 담아줘"처럼 가리키는 저장 의도를 해석.
 * 반환: 담을 정책 목록(없으면 null=저장 의도 아님). 실제 저장(toggleSaved)은 호출부(스토어)에서 수행.
 */
export function matchSaveIntent(raw: string, context: Policy[]): Policy[] | null {
  if (!context.length || !SAVE_RE.test(raw)) return null
  const t = raw.replace(/\s/g, '')
  if (/(다|전부|모두|전체|모든|다들)담|담.*(다|전부|모두)|이것들|그것들|다넣/.test(t)) return context
  const ord = t.match(/(첫|두|세|네|하나|둘|셋|넷|[1-4])(번째|째|번)?/)
  if (ord && ORD[ord[1]] !== undefined && context[ORD[ord[1]]]) return [context[ORD[ord[1]]]]
  const byName = context.filter((p) => t.includes(p.name.replace(/\s/g, '')))
  if (byName.length) return byName
  if (/(그거|이거|저거|그것|이것|그걸|이걸)/.test(t) || context.length === 1) return [context[0]]
  return context // 밋밋한 "담아줘" + 여러 개 → 보여준 것 전부
}

/** 메인 진입점 — 자유문장을 의도로 나눠 개인화·행동형으로 응답 */
export function agentReply(raw: string, ctx: { profile: UserProfile | null; result: AnalysisResult | null }): AgentReply {
  const q = raw.trim()
  if (!q) return { text: '' }
  if (GREET_RE.test(q)) return greetingReply(ctx.profile, 0)
  if (ELIG_RE.test(q)) return eligibilityReply(ctx.profile, ctx.result)
  return searchReply(q, ctx.profile)
}
