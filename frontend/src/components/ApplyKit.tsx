import { useState } from 'react'
import { Copy, Check, ClipboardList } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { buildPrefill, prefillText } from '@/lib/prefill'

/**
 * 신청 키트 — 내 정보 미리채움(복사).
 * 프로필+연락처에서 비민감 항목을 정리해 공식 신청서에 바로 붙여넣게 해준다.
 * 민감정보(주민번호)는 다루지 않으며, 입력 정보가 없으면 입력 유도를 보여준다.
 */
export function ApplyKit() {
  const { profile, rpaInfo, setView } = useAppStore()
  const fields = buildPrefill(profile, rpaInfo)
  const [copied, setCopied] = useState<string | null>(null)

  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(key)
      setTimeout(() => setCopied(null), 1500)
    } catch { /* 클립보드 미지원 환경은 조용히 무시 */ }
  }

  if (fields.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-sprout-200 p-4 text-center">
        <ClipboardList className="mx-auto h-6 w-6 text-sprout-400" />
        <p className="mt-1.5 text-sm text-muted-foreground">
          프로필을 입력하면 신청서에 바로 쓸 <b className="text-foreground">내 정보</b>를 자동으로 정리해 드려요.
        </p>
        <button onClick={() => setView('analyze')} className="btn-secondary !py-1.5 !px-3 text-xs mt-2.5">
          내 정보 입력하기
        </button>
      </div>
    )
  }

  return (
    <div className="rounded-2xl bg-sprout-50/70 border border-sprout-100 p-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold text-sprout-700">공식 신청서에 붙여넣으세요</p>
        <button
          onClick={() => copy('__all', prefillText(fields))}
          className="text-xs font-semibold text-sprout-600 inline-flex items-center gap-1 hover:underline"
        >
          {copied === '__all' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} 전체 복사
        </button>
      </div>
      <ul className="mt-2 space-y-1">
        {fields.map((x) => (
          <li key={x.label} className="flex items-center gap-2 text-sm">
            <span className="w-16 shrink-0 text-xs font-semibold text-muted-foreground">{x.label}</span>
            <span className="flex-1 truncate text-foreground/90">{x.value}</span>
            <button
              onClick={() => copy(x.label, x.value)}
              aria-label={`${x.label} 복사`}
              className="shrink-0 rounded-md p-1 hover:bg-sprout-100 text-sprout-600"
            >
              {copied === x.label ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] text-muted-foreground/70">
        🔒 주민등록번호 등 민감정보는 저장하지 않아요. 공식 사이트에서 본인이 입력하세요.
      </p>
    </div>
  )
}
