import { RPA_SUPPORTED_DOCS, localRpaDocs } from '@/lib/officialLinks'

/**
 * 발급 서류 표기 정규화 — 정책 데이터의 표기 변형을 '자동발급 정식 문서명'으로 해석한다.
 *
 * 왜 필요한가(실측): 카탈로그 required_docs에는 '자녀 주민등록등본'·'한부모 확인서'처럼
 * 지원 서류의 표기 변형이 섞여 있다. 프론트의 느슨한 매칭(docIn 포함관계)은 이런 이름을
 * '지원됨'으로 보여주지만, 백엔드(manager._SUPPORTED_DOCS)는 '정확한 이름'만 받아
 * 400/여정 탈락이 났다(잠재 결함). 발급 요청·카드 키를 정식명으로 정규화해 해소한다.
 *
 * 2단계 구분(정직성 — 다른 문서를 같은 문서인 척하지 않는다):
 *  · 정식명 해석(issuableCanonical): '같은 문서'가 확실한 경우만 — 포함관계 변형
 *    ('자녀 주민등록등본'⊃'주민등록등본') + 확실한 별칭('한부모 확인서'='한부모가족 증명서').
 *    → 자동발급 체인·단건 발급에 그대로 편입(카드에 원 표기를 함께 표시).
 *  · 대체 제안(substituteIssuableDoc): '다른 문서지만 통상 그걸로 충족되는' 경우 —
 *    힌트로만 안내하고 자동 편입하지 않는다(제출처가 다른 서류를 요구할 수 있음).
 */

const norm = (s: string) => (s || '').replace(/\s/g, '')

/** 같은 문서의 확실한 별칭 → 자동발급 정식명 (양쪽 포함관계가 성립하지 않는 표기만 등재) */
const EXACT_ALIASES: Record<string, string> = {
  [norm('한부모 확인서')]: '한부모가족 증명서',
  [norm('한부모가족확인서')]: '한부모가족 증명서',
  [norm('수급자 증명서')]: '기초생활수급자 증명서',
  [norm('납세증명서(국세)')]: '국세 납세증명서',
  [norm('출입국사실증명')]: '출입국에 관한 사실증명',
}

/** 다른 문서지만 통상 대체 가능한 발급물 — 힌트 전용(자동 편입 금지). 키는 포함 매칭. */
const SUBSTITUTES: [string, string][] = [
  [norm('수급자 확인서'), '기초생활수급자 증명서'],
  [norm('수급·대상 확인서'), '기초생활수급자 증명서'],
  [norm('장애인등록증'), '장애인증명서'],
  [norm('소득확인서류'), '소득금액증명'],
  [norm('소득 증빙'), '소득금액증명'],
  [norm('소득·재산 확인서'), '소득금액증명'],
]

/**
 * 자동발급 정식 문서명 해석. 지원 문서면 그 정식명을, 확실한 별칭이면 대응 정식명을,
 * 아니면 null. channel: 'local'=데스크탑앱 15종 · 'ext'=확장 13종 · 미지정=합집합.
 */
export function issuableCanonical(name: string, channel?: 'ext' | 'local'): string | null {
  const n = norm(name)
  if (!n) return null
  // 'local'은 동적 목록(localRpaDocs) — 프로브 실측으로 확장(β)된 서류도 정식명 해석·자동첨부 대상이 된다
  const list = channel === 'local' ? localRpaDocs() : channel === 'ext' ? RPA_SUPPORTED_DOCS
    : [...new Set([...localRpaDocs(), ...RPA_SUPPORTED_DOCS])]
  // 포함관계 변형('자녀 주민등록등본') — 가장 긴 정식명 우선(초본⊂등본 같은 중첩 오매칭 방지)
  const contained = list.filter((s) => n.includes(norm(s)) || norm(s).includes(n))
    .sort((a, b) => norm(b).length - norm(a).length)
  if (contained.length) return contained[0]
  const alias = EXACT_ALIASES[n]
  if (alias && list.some((s) => norm(s) === norm(alias))) return alias
  return null
}

/** 대체 발급물 제안 — 정식명 해석이 안 되는 이름에만. 반환된 문서는 '힌트'로만 쓸 것. */
export function substituteIssuableDoc(name: string): string | null {
  const n = norm(name)
  if (!n || issuableCanonical(name)) return null
  for (const [key, canon] of SUBSTITUTES) {
    if (n.includes(key)) return canon
  }
  return null
}
