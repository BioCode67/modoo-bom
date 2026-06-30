import type { UserProfile } from './welfare-engine'
import { sidoOf } from './welfare-engine'

/**
 * 자연어 한 문장 → 프로필 신호 추출(LLM 없이 규칙 기반, 비용 0).
 * 위저드 없이도 "72세 혼자 사는데 소득 적어요" 같은 문장으로 즉시 분석하기 위함.
 * 완벽한 NLU가 아니라 흔한 한국어 표현을 폭넓게 잡는 휴리스틱 — 신호 없으면 기본값.
 */
const BASE: UserProfile = {
  name: '', age: 30, gender: 'other', region: '', household_type: '',
  income_percentile: 80, disability: false, disability_grade: '',
  employment_status: '', has_children: false, children_ages: [],
  is_pregnant: false, life_events: [],
}

export function parseProfileFromText(text: string): UserProfile {
  const t = (text || '').replace(/\s+/g, ' ').trim()
  const p: UserProfile = { ...BASE, life_events: [] }
  if (!t) return p

  // ── 나이 ── (단, "5살 아이"처럼 자녀를 가리키는 N살/세는 부모 나이로 잡지 않음)
  const exact = t.match(/(\d{1,3})\s*(?:세|살)(?!\s*(?:아이|자녀|아들|딸|아기|아동|손주|손자|손녀))/)
  const decade = t.match(/(\d0)\s*대/)
  if (exact) p.age = parseInt(exact[1], 10)
  else if (decade) p.age = parseInt(decade[1], 10) + 5
  else if (/노인|어르신|고령|할머니|할아버지|경로/.test(t)) p.age = 70
  else if (/청년|대학생|취준|사회초년/.test(t)) p.age = 27
  else if (/청소년|중학생|고등학생|10대/.test(t)) p.age = 16

  // ── 가구 형태 (뒤일수록 우선) ──
  if (/혼자|독거|1인|일인|홀로|혼자\s*살/.test(t)) p.household_type = '1인가구'
  if (/신혼/.test(t)) p.household_type = '신혼부부'
  if (/다자녀|아이.*(셋|3|세 명)|자녀.*(셋|3명)/.test(t)) p.household_type = '다자녀가구'
  if (/다문화|결혼이민|외국인.*(배우자|결혼)/.test(t)) p.household_type = '다문화가족'
  if (/한부모|미혼모|미혼부|혼자.*키우|홀로.*키우|이혼.*아이/.test(t)) p.household_type = '한부모가족'
  if (/조손|손주.*키우|할머니.*키우/.test(t)) p.household_type = '조손가구'

  // ── 소득 ──
  if (/기초생활|기초수급|수급자|생계급여|기초\s*수급/.test(t)) p.income_percentile = 28
  else if (/차상위/.test(t)) p.income_percentile = 45
  else if (/저소득|소득.*(없|적|낮)|형편.*(어렵|힘들)|생활.*(어렵|힘들)|돈.*(없|부족)|가난|빈곤/.test(t)) p.income_percentile = 40
  else if (/고소득|소득.*많|여유.*있|잘\s*사/.test(t)) p.income_percentile = 130

  // ── 장애 ──
  if (/장애/.test(t)) {
    p.disability = true
    p.disability_grade = /중증|심한|1급|2급|3급/.test(t) ? '1급' : '4급'
    p.life_events.push('장애진단')
  }

  // ── 임신·자녀 ──
  if (/임신|임산부|만삭|출산\s*예정|곧\s*출산/.test(t)) { p.is_pregnant = true; p.life_events.push('출산') }
  const kids = [...t.matchAll(/(\d{1,2})\s*(살|세)\s*(아이|자녀|아들|딸|아기)/g)]
  if (kids.length) { p.has_children = true; p.children_ages = kids.map((m) => parseInt(m[1], 10)) }
  else if (/아이|자녀|아들|딸|육아|아기|영유아|어린이집|유치원/.test(t)) {
    p.has_children = true
    if (/신생아|갓난|0\s*살|돌\s*전/.test(t)) p.children_ages = [0]
    else if (!p.children_ages.length) p.children_ages = [3]
  }
  if (/출산|아기.*낳|애.*낳/.test(t) && !p.life_events.includes('출산')) p.life_events.push('출산')

  // ── 고용 ──
  if (/실직|실업|퇴사|해고|잘렸|일자리.*(잃|없)|직장.*잃/.test(t)) {
    p.employment_status = 'unemployed'
    if (!p.life_events.includes('실직')) p.life_events.push('실직')
  } else if (/구직|취준|취업.*준비|일\s*구하|일자리.*찾|구직활동/.test(t)) {
    p.employment_status = 'unemployed'
  }

  // ── 지역(시·도) ──
  const sido = sidoOf(t)
  if (sido) p.region = sido

  // ── 성별 ──
  if (/임신|임산부|산모|미혼모|할머니|어머니|엄마|아내|여성|여자|딸/.test(t)) p.gender = 'female'
  else if (/할아버지|아버지|아빠|남편|남성|남자|아들/.test(t)) p.gender = 'male'

  return p
}
