/**
 * 경량 언어 감지 — 유니코드 스크립트 기반(모델 불필요, 즉시).
 * AI 다국어 의미 검색에서 "🇻🇳 Tiếng Việt 감지" 처럼 입력 언어를 즉시 보여주기 위한 용도.
 * 정밀 NLP가 아니라 문자 집합 휴리스틱 — 데모/UX 표시에 충분.
 */
export interface DetectedLang {
  code: string
  label: string
  flag: string
}

// 베트남어 '고유' 문자만 — à á è é ì í ò ó ù ú ý(스페인·이탈리아·프랑스어), â ê ô(프랑스·포르투갈어),
// ã õ(포르투갈어) 같은 공통 분음부호를 넣으면 'Estoy embarazada' 같은 스페인어가 베트남어로 오인돼
// uiLang이 'vi'로 잘못 전환·영속된다(15차 감사). 훅·점·복합성조·ơưăđ는 베트남어 전용이라 안전.
const VIET = /[ăđơưĩũỹảạẻẹỉịỏọủụỷỵằắẳẵặầấẩẫậềếểễệồốổỗộờớởỡợừứửữự]/i

const LANGS: Record<string, { label: string; flag: string }> = {
  ko: { label: '한국어', flag: '🇰🇷' },
  en: { label: 'English', flag: '🇬🇧' },
  vi: { label: 'Tiếng Việt', flag: '🇻🇳' },
  zh: { label: '中文', flag: '🇨🇳' },
  ja: { label: '日本語', flag: '🇯🇵' },
  th: { label: 'ไทย', flag: '🇹🇭' },
  ru: { label: 'Русский', flag: '🇷🇺' },
  ar: { label: 'العربية', flag: '🇸🇦' },
}

/** 입력 문자열의 대표 언어를 감지. 판별 불가/공백이면 null. */
export function detectLang(text: string): DetectedLang | null {
  const s = (text || '').trim()
  if (!s) return null

  let ko = 0, kana = 0, han = 0, thai = 0, cyr = 0, arab = 0, latin = 0
  for (const ch of s) {
    const c = ch.codePointAt(0) || 0
    if ((c >= 0xac00 && c <= 0xd7a3) || (c >= 0x1100 && c <= 0x11ff) || (c >= 0x3130 && c <= 0x318f)) ko++
    else if ((c >= 0x3040 && c <= 0x309f) || (c >= 0x30a0 && c <= 0x30ff)) kana++
    else if (c >= 0x4e00 && c <= 0x9fff) han++
    else if (c >= 0x0e00 && c <= 0x0e7f) thai++
    else if (c >= 0x0400 && c <= 0x04ff) cyr++
    else if (c >= 0x0600 && c <= 0x06ff) arab++
    else if ((c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || (c >= 0xc0 && c <= 0x1ef9)) latin++
  }

  const pick = (code: string): DetectedLang => ({ code, ...LANGS[code] })
  if (ko > 0) return pick('ko')
  if (kana > 0) return pick('ja')
  if (thai > 0) return pick('th')
  if (cyr > 0) return pick('ru')
  if (arab > 0) return pick('ar')
  if (han > 0) return pick('zh') // 가나·한글 없이 한자만 → 중국어로 간주
  if (latin > 0) return VIET.test(s) ? pick('vi') : pick('en')
  return null
}

/**
 * UI 표시 언어 결정 — detectLang보다 **보수적**이고, 항상 확정값('ko' 포함)을 돌려준다.
 * detectLang을 UI 전체 언어 전환(영속 상태)의 근거로 쓰면 한국어 사용자의 오타·영문 약어
 * ('LH','EITC','dkssud' 등) 한 글자에 정책 상세·신청키트가 통째로 외국어로 뒤집힌다.
 * 그래서:
 *  - 라틴 계열(en·vi)은 오발동 위험이 커 **확신 게이트**(라틴 4자 이상 AND (2단어 이상 OR 6자 이상))를 통과할 때만 채택.
 *  - 비라틴 스크립트(일·태·러·아·중)는 한국어 사용자가 실수로 칠 일이 거의 없어 그대로 신뢰.
 *  - 빈 문자열·판별 불가·한국어면 'ko'로 **복귀**(외국어 고착 방지 — 검색어를 지우면 기본 언어로 되돌아옴).
 */
export function detectUiLang(text: string): string {
  const s = (text || '').trim()
  if (!s) return 'ko'
  const d = detectLang(s)
  if (!d || d.code === 'ko') return 'ko'
  if (d.code === 'vi') {
    // 베트남어 성조 문자(à·ế·ợ…)는 한국어 사용자가 실수로 칠 수 없는 강신호 → 라틴 4자면 단일어도 채택.
    const latin = (s.match(/[A-Za-zÀ-ỹ]/g) || []).length
    if (latin < 4) return 'ko'
  } else if (d.code === 'en') {
    // 평범한 라틴은 IME 오프 한/영 오타('dkssud','wldnjs' 등 6자 이상 단일어)와 구분 불가.
    // 그래서 영어 UI 전환은 '2단어 이상'일 때만 허용한다(단일 영단어는 검색은 되지만 UI는 ko 유지).
    const latin = (s.match(/[A-Za-z]/g) || []).length
    const words = s.split(/\s+/).filter(Boolean).length
    if (latin < 4 || words < 2) return 'ko'
  }
  return d.code
}
