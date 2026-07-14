import { detectLang } from './detectLang'
import { parseMonthly, formatWon, formatWonIntl, isCashBenefit, isWageReplacement } from './format'

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
  const top: string[] = []
  for (const it of items) {
    if (top.length >= 3) break
    const nm = (it.name || '').replace(/\s/g, '')
    if (!nm || seen.has(nm)) continue
    seen.add(nm)
    top.push(it.name)
  }
  // '현금성 최대'는 반드시 현금성 항목만 — 재가급여(서비스 한도)·바우처·감면·고용주 지원을
  // parseMonthly만으로 합치면 개인 현금소득처럼 과장된다(정직성 게이트 isCashBenefit 재사용).
  // 임금대체급여(육아휴직급여 등)도 제외 — '일을 그만두고 받는' 임금 대체금이라 순증 현금지원이 아니다
  // (sumCashMonthly와 동일 기준). 이를 빼지 않으면 '월 최대 250만원' 같은 헤드라인이 과장된다(감사 확정).
  const cashMax = Math.max(0, ...items.slice(0, 12).map((it) =>
    (isCashBenefit(it.benefit, it.name) && !isWageReplacement(`${it.benefit} ${it.name}`)) ? parseMonthly(it.benefit) : 0))
  const d = detectLang(query)
  const code = d?.code || 'ko'
  const list = top.join(', ')
  const won = cashMax > 0 ? formatWon(cashMax) : ''

  // 질의 언어로 답한다(외국인·다문화 사각지대) — 규칙 템플릿이라 환각 없음.
  // 정책명은 한국어 유지(실제 신청 시스템·기관이 한국어) + 다누리콜센터 ☎1577-1366(13개국어 통역)·☎129 안내.
  // ⚠️ 다누리는 아랍어 미지원 → 아랍어는 ☎129만 안내(거짓 통역 약속 금지, i18nLite 배너와 정합).
  // ⚠️ 현금 최대액은 '검색된 복지 전체' 기준(명시 3건이 아닐 수 있음) → 문구에 범위를 명확히(과장 방지).
  if (code !== 'ko') {
    const wonIntl = cashMax > 0 ? formatWonIntl(cashMax) : '' // 외국어엔 '만원' 대신 ₩+천단위(명확)
    const T: Record<string, (l: string, w: string) => string> = {
      en: (l, w) => `These welfare programs match you best: ${l}.${w ? ` Among matches, cash support up to ${w}/month.` : ''} (Program names are in Korean — call ☎1577-1366 (Danuri, interpreters) or ☎129 for help.)`,
      vi: (l, w) => `Các chế độ phúc lợi phù hợp nhất với bạn: ${l}.${w ? ` Trong số đó, hỗ trợ tiền mặt tối đa ${w}/tháng.` : ''} (Tên chương trình bằng tiếng Hàn — gọi ☎1577-1366 (Danuri, thông dịch) hoặc ☎129.)`,
      zh: (l, w) => `最适合您的福利项目：${l}。${w ? `其中每月最高现金支持 ${w}。` : ''}（项目名称为韩文 — 可拨打 ☎1577-1366（Danuri 翻译）或 ☎129。）`,
      ja: (l, w) => `あなたに最も合う福祉制度：${l}。${w ? `うち現金支援は月最大 ${w}。` : ''}（制度名は韓国語です — ☎1577-1366（タヌリ・通訳）または ☎129 へ。）`,
      th: (l, w) => `สวัสดิการที่เหมาะกับคุณที่สุด: ${l}${w ? ` ในจำนวนนี้ เงินช่วยเหลือสูงสุด ${w}/เดือน` : ''} (ชื่อโครงการเป็นภาษาเกาหลี — โทร ☎1577-1366 (Danuri ล่าม) หรือ ☎129)`,
      ru: (l, w) => `Наиболее подходящие вам программы: ${l}.${w ? ` Из них денежная поддержка до ${w}/мес.` : ''} (Названия на корейском — звоните ☎1577-1366 (Danuri, переводчик) или ☎129.)`,
      ar: (l, w) => `أنسب برامج الرعاية لك: ${l}.${w ? ` من بينها دعم نقدي حتى ${w}/شهر.` : ''} (الأسماء بالكورية — اتصل بـ ☎129 للمساعدة.)`,
    }
    const t = T[code] || T.en
    return t(list, wonIntl)
  }
  const amt = won ? ` 검색된 복지 중 현금성 지원은 월 최대 ${won}이에요.` : ''
  return `이런 복지가 가장 잘 맞아요: ${list}.${amt}`
}
