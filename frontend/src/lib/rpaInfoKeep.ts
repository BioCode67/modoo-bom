/**
 * 인증정보 폼 '이 탭에서는 기억' 옵트인 (sessionStorage).
 *
 * 왜 필요한가 — rpaInfo(실명·생년월일·휴대폰)는 프라이버시 설계상 persist에서 제외돼
 * 새로고침 한 번에 비워진다(공용 PC에서 디스크 잔류 방지). 그런데 발표·상담 중 실수로
 * F5를 누르면 그 자리에서 전부 재입력해야 하는 실사용 불편이 있다.
 *
 * 왜 sessionStorage인가 — 기본 설계를 깨지 않는 옵트인 중간지대:
 *  - 탭을 닫으면 브라우저가 자동 삭제(다음 사용자·다른 탭으로 전달되지 않음)
 *  - 기본 OFF — 켠 사람에게만, 켠 탭에서만 동작
 *  - '다음 분 상담 시작'은 데이터와 옵트인 플래그를 함께 지운다(clearKept)
 *  ⚠️ sessionStorage도 브라우저 세션 복원을 위해 일시적으로 디스크를 거칠 수 있다 —
 *     그래서 켰을 때의 안내 문구는 '디스크에 저장 안 함'이 아니라
 *     '이 탭에만 잠시 보관(탭 닫으면 삭제)'로 사실대로 표기한다(RpaInfoForm).
 */

const FLAG_KEY = 'modoobom-rpainfo-keep'
const DATA_KEY = 'modoobom-rpainfo-session'

/** 보관 대상 필드 — 스토어 rpaInfo와 동일 키(문자열만). 이 외 키·타입은 로드 시 버린다. */
export type KeptRpaInfo = {
  name?: string
  birth_date?: string
  phone?: string
  carrier?: string
  sido?: string
  sigungu?: string
  auth_provider?: string
}
const FIELDS: (keyof KeptRpaInfo)[] = ['name', 'birth_date', 'phone', 'carrier', 'sido', 'sigungu', 'auth_provider']

function ss(): Storage | null {
  try {
    return typeof sessionStorage !== 'undefined' ? sessionStorage : null
  } catch {
    return null // 일부 브라우저 프라이버시 모드에서 접근 자체가 throw
  }
}

/** 이 탭에서 '기억하기'가 켜져 있는가 */
export function isKeepOn(): boolean {
  return ss()?.getItem(FLAG_KEY) === '1'
}

/** 옵트인 토글 — 켜면 현재 정보를 즉시 보관, 끄면 보관분을 즉시 삭제(흔적 미잔류) */
export function setKeepOn(on: boolean, info?: KeptRpaInfo): void {
  const s = ss()
  if (!s) return
  try {
    if (on) {
      s.setItem(FLAG_KEY, '1')
      if (info) saveKept(info)
    } else {
      s.removeItem(FLAG_KEY)
      s.removeItem(DATA_KEY)
    }
  } catch { /* 저장 불가(용량·프라이버시 모드)여도 폼 동작엔 지장 없음 */ }
}

/** 입력 변경 반영 — 옵트인 상태에서만 저장(OFF면 no-op, 흔적을 만들지 않는다) */
export function saveKept(info: KeptRpaInfo): void {
  const s = ss()
  if (!s || s.getItem(FLAG_KEY) !== '1') return
  const clean: KeptRpaInfo = {}
  for (const k of FIELDS) {
    const v = info[k]
    if (typeof v === 'string') clean[k] = v
  }
  try {
    s.setItem(DATA_KEY, JSON.stringify(clean))
  } catch { /* ditto */ }
}

/** 보관분 로드 — 알려진 문자열 필드만 통과(손상 JSON·이물 키·비문자열은 조용히 버림) */
export function loadKept(): KeptRpaInfo | null {
  const s = ss()
  if (!s || s.getItem(FLAG_KEY) !== '1') return null
  const raw = s.getItem(DATA_KEY)
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    const out: KeptRpaInfo = {}
    for (const k of FIELDS) {
      const v = (parsed as Record<string, unknown>)[k]
      if (typeof v === 'string') out[k] = v
    }
    return Object.keys(out).length ? out : null
  } catch {
    return null
  }
}

/** 전체 삭제(데이터+옵트인 플래그) — '다음 분 상담 시작'의 개인정보 초기화 경로에서 호출 */
export function clearKept(): void {
  const s = ss()
  if (!s) return
  try {
    s.removeItem(FLAG_KEY)
    s.removeItem(DATA_KEY)
  } catch { /* ditto */ }
}
