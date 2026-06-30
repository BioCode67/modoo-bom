import type { UserProfile } from './welfare-engine'

/**
 * 공식 신청서 '미리채움' — 프로필+연락처에서 신청서에 붙여넣을 비민감 항목을 만든다.
 * ⚠️ 주민등록번호 등 민감 고유식별정보는 절대 포함하지 않는다(앱이 저장하지도 않음).
 */
export interface PrefillField { label: string; value: string }
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
  const push = (label: string, value: string | undefined | null) => {
    if (value && String(value).trim()) f.push({ label, value: String(value).trim() })
  }

  push('이름', rpa?.name || profile?.name)
  push('생년월일', fmtBirth(rpa?.birth_date))
  if (profile && profile.age > 0) push('나이', `만 ${profile.age}세`)
  push('휴대폰', fmtPhone(rpa?.phone))
  if (rpa?.carrier) push('통신사', CARRIER_LABEL[rpa.carrier] || rpa.carrier)
  push('거주지', profile?.region)
  push('가구 형태', profile?.household_type)
  if (profile && profile.income_percentile > 0) push('소득 수준', `기준 중위소득 약 ${profile.income_percentile}% 이하`)
  if (profile?.disability) push('장애', `등록 장애${profile.disability_grade ? ` (${profile.disability_grade})` : ''}`)
  if (profile?.has_children && profile.children_ages.length > 0) {
    push('자녀', `${profile.children_ages.length}명 (만 ${profile.children_ages.join(', ')}세)`)
  }
  if (profile?.is_pregnant) push('임신', '임신 중')
  return f
}

/** '전체 복사'용 텍스트 */
export function prefillText(fields: PrefillField[]): string {
  return fields.map((x) => `${x.label}: ${x.value}`).join('\n')
}
