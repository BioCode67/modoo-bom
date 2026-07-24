/**
 * 복지 상담 전화번호 디렉터리 — '어디로 전화하죠?'에 바로 답한다(어르신·저자력 사용자에 특히 유용).
 * 전부 공개된 대표 상담 번호. 번호는 바뀔 수 있어 UI에 '변경될 수 있어요' 고지를 함께 둔다.
 *
 * 순수 데이터 + 키워드 필터. tel: 링크로 모바일에서 바로 누를 수 있게 한다.
 */

export interface Hotline {
  name: string
  tel: string       // tel: 링크용(하이픈 유지, 사람이 읽기 쉬움)
  desc: string
  category: string  // 필터·매칭용
  urgent?: boolean  // 24시간 위기 대응
}

// 대표·안정적인 번호만 큐레이션(자주 바뀌지 않는 것). 129를 맨 앞(복지 전반 관문).
export const HOTLINES: Hotline[] = [
  { name: '보건복지상담센터', tel: '129', desc: '복지 전반·긴급복지 상담(24시간)', category: '복지 전반 긴급', urgent: true },
  { name: '국민연금공단', tel: '1355', desc: '국민연금·기초연금 문의', category: '연금 노인' },
  { name: '국민건강보험공단', tel: '1577-1000', desc: '건강보험·노인장기요양 문의', category: '건강보험 의료 요양' },
  { name: '고용노동부 고객상담', tel: '1350', desc: '실업급여·고용보험·노동 상담', category: '고용 실업 일자리 노동' },
  { name: '근로복지공단', tel: '1588-0075', desc: '산재보험·근로복지 상담', category: '고용 산재 노동' },
  { name: '서민금융콜센터', tel: '1397', desc: '서민금융·채무조정·대출 상담', category: '금융 대출 빚 채무' },
  { name: '주거복지(LH 마이홈)', tel: '1600-1004', desc: '임대주택·주거지원 상담', category: '주거 주택 월세 임대' },
  { name: '장애인고용공단', tel: '1588-1519', desc: '장애인 고용·직업재활', category: '장애 고용 일자리' },
  { name: '다누리콜센터', tel: '1577-1366', desc: '다문화가족 상담(13개 언어·24시간)', category: '다문화 외국인 이주', urgent: true },
  { name: '노인보호전문기관', tel: '1577-1389', desc: '노인학대 신고·상담', category: '노인 학대 위기', urgent: true },
  { name: '여성긴급전화', tel: '1366', desc: '가정폭력·성폭력·스토킹(24시간)', category: '여성 폭력 위기 학대', urgent: true },
  { name: '청소년상담전화', tel: '1388', desc: '청소년 위기·상담(24시간)', category: '청소년 아동 위기', urgent: true },
  { name: '자살예방상담', tel: '109', desc: '정신건강·자살예방(24시간)', category: '정신건강 위기 우울', urgent: true },
]

/**
 * 키워드로 관련 상담처를 고른다(카테고리·이름·설명 매칭). 키워드 없으면 대표 순서 그대로.
 * 위기(urgent) 항목은 위기 키워드일 때 우선 노출된다.
 */
export function hotlinesFor(keyword = '', limit = 6): Hotline[] {
  const k = (keyword || '').trim()
  if (!k) return HOTLINES.slice(0, limit)
  const hit = HOTLINES.filter((h) => {
    const hay = `${h.name} ${h.desc} ${h.category}`
    return hay.includes(k) || k.split(/\s+/).some((w) => w.length >= 2 && hay.includes(w))
  })
  return (hit.length ? hit : HOTLINES).slice(0, limit)
}
