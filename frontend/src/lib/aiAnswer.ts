import { detectUiLang } from './detectLang'
import { parseMonthly, formatWon, formatWonIntl, isCashBenefit } from './format'

export interface AiAnswerItem {
  name: string
  benefit: string
}

/**
 * AI 답변 요약 문장 생성 — 환각 없이 검색결과 기반.
 * 대표 3건(이름 중복 제거) + 현금성 최대 금액 + (외국어면) 입력 언어 이해 안내.
 * items는 유사도 상위 순으로 정렬돼 있다고 가정.
 */
export function buildAiAnswer(items: AiAnswerItem[], query: string): string {
  if (!items || items.length === 0) return ''
  const seen = new Set<string>()
  const topItems: AiAnswerItem[] = []
  for (const it of items) {
    if (topItems.length >= 3) break
    const nm = (it.name || '').replace(/\s/g, '')
    if (!nm || seen.has(nm)) continue
    seen.add(nm)
    topItems.push(it)
  }
  const top = topItems.map((it) => it.name)
  // '현금성 최대'는 (1) 현금성 항목만 — 재가급여(서비스 한도)·바우처·감면·고용주 지원을 parseMonthly만으로
  //  합치면 개인 현금소득처럼 과장됨(정직성 게이트 isCashBenefit) (2) '이름이 제시된 대표 3건'에서만 —
  //  목록에 없는 하위 정책(예: 검색 7위 긴급복지)의 금액을 대표 3건 옆에 붙여 오귀속하지 않게(감사).
  const cashMax = Math.max(0, ...topItems.map((it) => (isCashBenefit(it.benefit, it.name) ? parseMonthly(it.benefit) : 0)))
  // 답변 언어는 보수적 detectUiLang — 한국어 사용자의 짧은 영문 약어('EITC','LH')에 답변·카드가
  //  통째로 외국어로 뒤집히지 않게(Explore의 UI 언어 판정과 동일 기준으로 일관성 확보).
  const code = detectUiLang(query)
  const list = top.join(', ')
  const won = cashMax > 0 ? formatWon(cashMax) : ''

  // 질의 언어로 답한다(외국인·다문화 사각지대) — 규칙 템플릿이라 환각 없음.
  // 정책명은 한국어 유지(실제 신청 시스템·기관이 한국어) + 통역 지원되는 ☎129 안내.
  if (code !== 'ko') {
    const wonIntl = cashMax > 0 ? formatWonIntl(cashMax) : '' // 외국어엔 '만원' 대신 ₩+천단위(명확)
    const T: Record<string, (l: string, w: string) => string> = {
      en: (l, w) => `These welfare programs match you best: ${l}.${w ? ` Cash support up to ${w}/month.` : ''} (Program names are in Korean — call ☎129 Danuri/Welfare hotline for interpreter help.)`,
      vi: (l, w) => `Các chế độ phúc lợi phù hợp nhất với bạn: ${l}.${w ? ` Hỗ trợ tiền mặt tối đa ${w}/tháng.` : ''} (Tên chương trình bằng tiếng Hàn — gọi ☎129 để được hỗ trợ thông dịch.)`,
      zh: (l, w) => `最适合您的福利项目：${l}。${w ? `每月最高现金支持 ${w}。` : ''}（项目名称为韩文 — 可拨打 ☎129 获得翻译协助。）`,
      ja: (l, w) => `あなたに最も合う福祉制度：${l}。${w ? `現金支援は月最大 ${w}。` : ''}（制度名は韓国語です — ☎129 で通訳サポートを受けられます。）`,
      th: (l, w) => `สวัสดิการที่เหมาะกับคุณที่สุด: ${l}${w ? ` เงินช่วยเหลือสูงสุด ${w}/เดือน` : ''} (ชื่อโครงการเป็นภาษาเกาหลี — โทร ☎129 เพื่อขอล่ามช่วยเหลือ)`,
      ru: (l, w) => `Наиболее подходящие вам программы: ${l}.${w ? ` Денежная поддержка до ${w}/мес.` : ''} (Названия на корейском — звоните ☎129, есть переводчик.)`,
      ar: (l, w) => `أنسب برامج الرعاية لك: ${l}.${w ? ` دعم نقدي حتى ${w}/شهر.` : ''} (الأسماء بالكورية — اتصل بـ ☎129 للمساعدة بالترجمة.)`,
    }
    const t = T[code] || T.en
    return t(list, wonIntl)
  }
  const amt = won ? ` 현금성 지원은 월 최대 ${won}이에요.` : ''
  return `이런 복지가 가장 잘 맞아요: ${list}.${amt}`
}
