import { docLink, isRpaSupported, LOCAL_RPA_DOCS, RPA_SUPPORTED_DOCS, applyLink, isApplyAutomatable } from '@/lib/officialLinks'
import { bestApplyUrl, isBokjiroApplyable } from '@/lib/quickApply'

/**
 * webAgent — 자연어 목표 한 문장을 '무엇을·어떤 경로로' 처리할지 구조화 계획으로 바꾸는 순수 플래너.
 *
 * 백엔드(backend/webagent)의 스마트 웹 에이전트와 같은 계약을 프론트에서 공유한다.
 * 실제 브라우저 구동은 데스크탑/백엔드 흐름(DocumentCenter·AgentSubmitButton)이 담당하고,
 * 여기서는 목표를 분류해 (발급/신청·빠른경로/에이전트·자동가능여부·공식 폴백 링크)를 정한다.
 * 챗·통화 인텐트 라우팅과 자동화 노출 판단에 쓰인다.
 *
 * 순수 함수(부작용·네트워크 없음) — 백엔드 연결 여부는 인자로 주입해 테스트·게이팅을 단순하게 유지한다.
 * 정직성: 자동 실행을 장담하지 않는다. 데스크탑 미연결이면 공식 링크로 안내한다.
 */

export type WebAgentKind = 'issue_doc' | 'apply_welfare' | 'unknown'
export type WebAgentEngine = 'deterministic' | 'agent' | 'none'
export type WebAgentStatus = 'route' | 'agent' | 'fallback'

export interface WebAgentPlan {
  goal: string
  kind: WebAgentKind
  engine: WebAgentEngine
  status: WebAgentStatus
  docHint?: string        // 인식된 서류명(정규화)
  automatable: boolean    // 데스크탑/백엔드가 있으면 자동화 가능한 목표인가
  fallbackUrl: string     // 자동 불가/미연결 시 안내할 공식 경로
  message: string
}

// 발급/신청 의도 동사
const ISSUE_VERBS = /발급|떼|출력|뽑아|프린트|발부/
const APPLY_VERBS = /신청|접수|넣어|지원받|받고\s*싶/

// 서류 별칭 → 정규 서류명(공백 무시). officialLinks.docLink 의 별칭 논리와 정부24/로컬 지원목록을 반영.
// 더 구체적인 것(세목별·자격득실)을 앞에 둬 광범위 규칙보다 먼저 잡히게 한다.
const DOC_ALIASES: [RegExp, string][] = [
  [/주민등록등본|등본/, '주민등록등본'],
  [/주민등록초본|초본/, '주민등록초본'],
  [/가족관계/, '가족관계증명서'],
  [/장애인.*증명|장애인등록|장애인증명/, '장애인증명서'],
  [/자격득실|건강보험.*자격/, '건강보험 자격득실확인서'],
  [/건강보험료.*납부|보험료.*납부/, '건강보험료 납부확인서'],
  [/소득금액|소득.*증명/, '소득금액증명'],
  [/지방세.*세목별|세목별.*과세/, '지방세 세목별 과세증명서'],
  [/지방세.*(납세|과세|납부)/, '지방세 납세증명서'],
  [/국세.*납세|납세증명/, '국세 납세증명서'],
  [/기초생활|수급자/, '기초생활수급자 증명서'],
  [/한부모/, '한부모가족 증명서'],
  [/출입국/, '출입국에 관한 사실증명'],
  [/병적/, '병적증명서'],
  [/고용보험|피보험자격/, '고용보험 피보험자격 이력내역서'],
  [/국민연금.*가입/, '국민연금 가입자 증명서'],
]

/** 목표 문장에서 알려진 서류명을 뽑는다(없으면 undefined). */
export function detectDoc(goal: string): string | undefined {
  const g = (goal || '').replace(/\s/g, '')
  for (const [re, canonical] of DOC_ALIASES) {
    if (re.test(g)) return canonical
  }
  // 별칭에 없더라도 지원목록 이름이 통째로 들어있으면 채택(방어)
  for (const name of [...LOCAL_RPA_DOCS, ...RPA_SUPPORTED_DOCS]) {
    if (g.includes(name.replace(/\s/g, ''))) return name
  }
  return undefined
}

/**
 * 자연어 목표 → 구조화 계획. 백엔드 webagent 의 라우팅과 같은 정신:
 *   아는 서류 → 결정적 빠른경로(route) · 처음 보는/복잡 → 에이전트(agent) · 그 외 → 정직한 폴백(fallback)
 */
export function planWebAgent(rawGoal: string): WebAgentPlan {
  const goal = (rawGoal || '').trim()
  if (!goal) {
    return {
      goal, kind: 'unknown', engine: 'none', status: 'fallback', automatable: false,
      fallbackUrl: 'https://www.gov.kr',
      message: '어떤 서류를 떼거나 어떤 복지를 신청할지 한 문장으로 알려주세요.',
    }
  }

  const doc = detectDoc(goal)
  const wantsApply = APPLY_VERBS.test(goal)
  const wantsIssue = ISSUE_VERBS.test(goal) || (!!doc && !wantsApply)

  // ① 서류 발급
  if (doc && wantsIssue) {
    const det = isRpaSupported(doc)
    const link = docLink(doc)
    return {
      goal, kind: 'issue_doc',
      engine: det ? 'deterministic' : 'agent',
      status: det ? 'route' : 'agent',
      docHint: doc, automatable: true, fallbackUrl: link.url,
      message: det
        ? `'${doc}'은 검증된 빠른 경로로 발급할 수 있어요(본인인증·출력은 직접).`
        : `'${doc}'은 화면을 읽어 발급을 시도해요(처음 보는 서류).`,
    }
  }

  // ② 복지 신청
  if (wantsApply) {
    const link = applyLink(goal)
    const url = bestApplyUrl(goal, goal) || link.url
    const auto = isApplyAutomatable(goal) || isBokjiroApplyable(url, goal)
    return {
      goal, kind: 'apply_welfare', engine: auto ? 'agent' : 'none',
      status: auto ? 'agent' : 'fallback',
      automatable: auto, fallbackUrl: url,
      message: auto
        ? '신청 양식 작성까지 도와드릴 수 있어요(본인인증·최종 제출은 직접).'
        : '공식 신청 페이지로 안내할게요.',
    }
  }

  // ③ 발급 의도인데 처음 보는 서류 → 에이전트가 화면을 읽어 시도
  if (wantsIssue) {
    return {
      goal, kind: 'issue_doc', engine: 'agent', status: 'agent', automatable: true,
      fallbackUrl: 'https://www.gov.kr',
      message: '처음 보는 서류라 화면을 읽어 발급을 시도해요(공식 사이트로도 안내 가능).',
    }
  }

  // ④ 분류 불가 → 정직한 폴백
  return {
    goal, kind: 'unknown', engine: 'none', status: 'fallback', automatable: false,
    fallbackUrl: 'https://www.gov.kr',
    message: '어떤 서류·신청인지 조금 더 구체적으로 알려주시면 도와드릴게요.',
  }
}

/**
 * 계획 + 백엔드 연결여부 → 사용자에게 보여줄 한 줄 안내(정직성 게이팅).
 * 자동화 가능한 목표라도 데스크탑이 없으면 공식 링크로만 안내한다.
 */
export function describeWebAgent(plan: WebAgentPlan, backendConnected: boolean): string {
  if (!plan.automatable) return plan.message
  if (backendConnected) {
    return plan.engine === 'deterministic'
      ? `${plan.message} 지금 바로 자동으로 진행할게요.`
      : `${plan.message} 지금 에이전트가 이어서 진행할게요.`
  }
  return '데스크탑 앱을 연결하면 자동으로 진행돼요. 지금은 공식 사이트 링크로 안내할게요.'
}
