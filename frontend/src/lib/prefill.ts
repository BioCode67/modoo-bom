import { disabilityLabel, type UserProfile } from './welfare-engine'

/**
 * 공식 신청서 '미리채움' — 프로필+연락처에서 신청서에 붙여넣을 비민감 항목을 만든다.
 * ⚠️ 주민등록번호 등 민감 고유식별정보는 절대 포함하지 않는다(앱이 저장하지도 않음).
 */
export interface PrefillField {
  label: string
  value: string
  /** 정부 폼이 자주 요구하는 대체 형식(예: 생년월일 YYYYMMDD·휴대폰 하이픈 없이) — 있으면 보조 복사 버튼 노출 */
  alt?: string
}
export interface RpaInfo { name?: string; birth_date?: string; phone?: string; carrier?: string }

const CARRIER_LABEL: Record<string, string> = {
  SKT: 'SKT', KT: 'KT', 'LGU+': 'LG U+', SKM: 'SKT 알뜰폰', KTM: 'KT 알뜰폰', LGM: 'LG 알뜰폰',
}

function fmtBirth(b?: string): string {
  if (!b) return ''
  const d = b.replace(/[^0-9]/g, '')
  return d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : b
}
function fmtPhone(p?: string): string {
  if (!p) return ''
  const d = p.replace(/[^0-9]/g, '')
  return d.length === 11 ? `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}` : p
}

/** 비민감 신청 정보 목록 생성(값 있는 항목만). */
export function buildPrefill(profile: UserProfile | null, rpa?: RpaInfo): PrefillField[] {
  const f: PrefillField[] = []
  const push = (label: string, value: string | undefined | null, alt?: string) => {
    if (value && String(value).trim()) f.push({ label, value: String(value).trim(), ...(alt ? { alt } : {}) })
  }

  push('이름', rpa?.name || profile?.name)
  // 정부 폼은 YYYYMMDD·하이픈 없는 번호를 요구하는 곳이 흔하다 — 대체 형식을 함께 준비
  const birth = fmtBirth(rpa?.birth_date)
  push('생년월일', birth, birth.replace(/-/g, '') !== birth ? birth.replace(/-/g, '') : undefined)
  if (profile && profile.age > 0) push('나이', `만 ${profile.age}세`)
  const phone = fmtPhone(rpa?.phone)
  push('휴대폰', phone, phone.replace(/-/g, '') !== phone ? phone.replace(/-/g, '') : undefined)
  if (rpa?.carrier) push('통신사', CARRIER_LABEL[rpa.carrier] || rpa.carrier)
  push('거주지', profile?.region)
  push('가구 형태', profile?.household_type)
  if (profile && profile.income_percentile > 0) push('소득 수준', `기준 중위소득 약 ${profile.income_percentile}% 이하`)
  if (profile?.disability) push('장애', disabilityLabel(profile.disability_grade))
  const kids = profile?.children_ages || [] // 재수화된 레거시 프로필에 children_ages가 없을 수 있어 방어(다른 소비자와 동일 패턴)
  if (profile?.has_children && kids.length > 0) {
    push('자녀', `${kids.length}명 (만 ${kids.join(', ')}세)`)
  }
  if (profile?.is_pregnant) push('임신', '임신 중')
  return f
}

/** '전체 복사'용 텍스트 */
export function prefillText(fields: PrefillField[]): string {
  return fields.map((x) => `${x.label}: ${x.value}`).join('\n')
}
