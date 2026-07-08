import { Languages, X } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import type { UiLang } from '@/lib/i18nLite'
import { isUiLang, RTL } from '@/lib/i18nLite'

/**
 * 첫 방문 브라우저 언어 감지 → 자국어 사용 제안(외국인 착지 이탈 방지).
 * 정직성: uiLang은 '상세·신청키트 UI 골격 + AI 답변'만 그 언어로 바꾼다(홈/탐색 본문은 한국어 유지).
 * 그래서 '전체 번역'이 아니라 '당신의 언어 사용(Use)'으로만 안내한다(과장 금지).
 * 나그 금지: 한 번 보이면(전환하든 닫든) langSuggested로 다시 안 띄운다.
 */

// 감지 문구는 '그 언어'로 — 자국어로 읽혀야 전환 의미가 있다. 지원 UI 언어(ko 제외)만.
const SUGGEST: Record<Exclude<UiLang, 'ko'>, { hint: string; use: string }> = {
  en: { hint: 'This app supports English (policy details & apply steps).', use: 'Use English' },
  vi: { hint: 'Ứng dụng hỗ trợ tiếng Việt (chi tiết & các bước đăng ký).', use: 'Dùng tiếng Việt' },
  zh: { hint: '本应用支持中文（福利详情与申请步骤）。', use: '使用中文' },
  ja: { hint: 'このアプリは日本語に対応（詳細・申請手順）。', use: '日本語を使う' },
  th: { hint: 'แอปนี้รองรับภาษาไทย (รายละเอียดและขั้นตอนสมัคร)', use: 'ใช้ภาษาไทย' },
  ru: { hint: 'Приложение поддерживает русский (детали и шаги подачи).', use: 'Русский' },
  ar: { hint: 'يدعم التطبيق العربية (تفاصيل الرعاية وخطوات التقديم).', use: 'استخدم العربية' },
}

/** navigator.language('vi-VN'·'zh-CN'·'en-US'…) → 지원 UiLang. 미지원이면 null. */
function detectBrowserLang(): Exclude<UiLang, 'ko'> | null {
  const langs = typeof navigator !== 'undefined' ? navigator.languages || [navigator.language] : []
  for (const raw of langs) {
    const base = (raw || '').toLowerCase().split('-')[0]
    if (base === 'ko') return null // 한국어 사용자는 제안 불필요(기본이 한국어)
    if (base && base !== 'ko' && isUiLang(base) && base in SUGGEST) return base as Exclude<UiLang, 'ko'>
  }
  return null
}

export function LangSuggest() {
  const uiLang = useAppStore((s) => s.uiLang)
  const langSuggested = useAppStore((s) => s.langSuggested)
  const setUiLang = useAppStore((s) => s.setUiLang)
  const dismiss = useAppStore((s) => s.dismissLangSuggest)

  // 이미 자국어를 쓰거나(비 ko), 이미 한 번 안내했으면 노출 안 함(나그 금지)
  if (uiLang !== 'ko' || langSuggested) return null
  const target = detectBrowserLang()
  if (!target) return null
  const s = SUGGEST[target]
  const rtl = RTL.includes(target)

  return (
    <div dir={rtl ? 'rtl' : 'ltr'}
      className="no-print sticky top-0 z-40 flex items-center gap-2 border-b border-sky2-200 bg-sky2-50 px-4 py-2 text-sm text-sky2-900">
      <Languages className="h-4 w-4 shrink-0 text-sky2-600" />
      <span className="flex-1">{s.hint}</span>
      <button
        onClick={() => { setUiLang(target); dismiss() }}
        className="shrink-0 rounded-full bg-sky2-600 px-3 py-1 text-xs font-bold text-white hover:bg-sky2-700 transition-colors"
      >
        {s.use}
      </button>
      <button onClick={dismiss} aria-label="dismiss" className="shrink-0 rounded-full p-1 text-sky2-500 hover:bg-sky2-100">
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}
