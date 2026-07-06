import { useState } from 'react'
import { Copy, Check, Pencil } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { buildPrefill, prefillText } from '@/lib/prefill'
import { cn } from '@/lib/utils'

/**
 * 신청 키트 — 내 정보 미리채움(복사) + 인라인 입력/수정.
 * 프로필+연락처에서 비민감 항목을 정리해 공식 신청서에 바로 붙여넣게 해준다.
 * 백엔드 없는 배포본에서도 이름/생년월일/휴대폰/통신사를 바로 입력할 수 있다.
 * ⚠️ 주민등록번호 등 민감정보는 저장/표시하지 않는다.
 */
const CARRIERS: { v: string; l: string }[] = [
  { v: 'SKT', l: 'SKT' }, { v: 'KT', l: 'KT' }, { v: 'LGU+', l: 'LG U+' },
  { v: 'SKM', l: 'SKT알뜰' }, { v: 'KTM', l: 'KT알뜰' }, { v: 'LGM', l: 'LG알뜰' },
]

export function ApplyKit() {
  const { profile, rpaInfo, setRpaInfo, setView } = useAppStore()
  const fields = buildPrefill(profile, rpaInfo)
  const [copied, setCopied] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  // 순차 복사 커서 — 정부 폼은 필드별 input이라 탭을 오갈 때마다 '다음 값'을 한 번에 집어가게(모바일 왕복 최소화)
  const [seq, setSeq] = useState(0)

  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(key)
      setTimeout(() => setCopied(null), 1500)
    } catch { /* 클립보드 미지원 환경은 조용히 무시 */ }
  }

  // 입력/수정 모드 (또는 채울 정보가 아직 없을 때)
  if (editing || fields.length === 0) {
    return (
      <div className="rounded-2xl bg-sprout-50/70 border border-sprout-100 p-3">
        <p className="text-xs font-bold text-sprout-700 mb-2">신청서에 쓸 내 정보 입력</p>
        <div className="space-y-2">
          <input value={rpaInfo.name || ''} onChange={(e) => setRpaInfo({ name: e.target.value })} placeholder="이름" className="input-cute" />
          <input value={rpaInfo.birth_date || ''} onChange={(e) => setRpaInfo({ birth_date: e.target.value })} placeholder="생년월일 (예: 1953-11-01)" inputMode="numeric" className="input-cute" />
          <input value={rpaInfo.phone || ''} onChange={(e) => setRpaInfo({ phone: e.target.value })} placeholder="휴대폰 (예: 010-1234-5678)" inputMode="tel" className="input-cute" />
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="통신사">
            {CARRIERS.map((c) => (
              <button
                key={c.v}
                onClick={() => setRpaInfo({ carrier: rpaInfo.carrier === c.v ? '' : c.v })}
                aria-pressed={rpaInfo.carrier === c.v}
                className={cn('rounded-lg border-2 px-2.5 py-1 text-xs font-semibold transition-colors',
                  rpaInfo.carrier === c.v ? 'bg-sprout-500 border-sprout-500 text-white' : 'bg-white border-sprout-100 text-muted-foreground hover:border-sprout-200')}
              >{c.l}</button>
            ))}
          </div>
          <button onClick={() => setEditing(false)} className="btn-secondary !py-1.5 text-xs w-full justify-center">완료</button>
        </div>
        <button onClick={() => setView('analyze')} className="mt-2 text-xs text-sprout-700 hover:underline">+ 가구·소득 등 자세히 입력(프로필)</button>
        <p className="mt-1 text-[11px] text-muted-foreground/70">🔒 화면을 닫으면 지워져요(안전을 위해 기기에 저장하지 않아요). 주민등록번호는 입력하지 마세요.</p>
      </div>
    )
  }

  return (
    <div className="rounded-2xl bg-sprout-50/70 border border-sprout-100 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-bold text-sprout-700">공식 신청서에 붙여넣으세요</p>
        <div className="flex items-center gap-2.5 shrink-0">
          <button onClick={() => setEditing(true)} className="text-xs font-semibold text-muted-foreground inline-flex items-center gap-1 hover:underline">
            <Pencil className="h-3 w-3" /> 수정
          </button>
          <button onClick={() => copy('__all', prefillText(fields))} className="text-xs font-semibold text-sprout-700 inline-flex items-center gap-1 hover:underline">
            {copied === '__all' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} 전체 복사
          </button>
        </div>
      </div>
      {/* ⚡ 순차 복사 — 신청서 칸을 옮길 때마다 한 번씩 눌러 다음 값을 가져가기(모바일 탭 왕복을 필드당 1탭으로) */}
      {fields.length > 1 && (
        <button
          onClick={() => { const f = fields[seq % fields.length]; copy(f.label, f.value); setSeq(seq + 1) }}
          className="btn-secondary w-full mt-2 !py-1.5 text-xs justify-center"
        >
          ⚡ 다음 값 복사: <b>{fields[seq % fields.length].label}</b>
        </button>
      )}
      <ul className="mt-2 space-y-1">
        {fields.map((x, i) => (
          <li key={x.label} className={cn('flex items-center gap-2 text-sm rounded-lg px-1 -mx-1', i === seq % fields.length && 'bg-sprout-100/60')}>
            <span className="w-16 shrink-0 text-xs font-semibold text-muted-foreground">{x.label}</span>
            <span className="flex-1 truncate text-foreground/90">{x.value}</span>
            {/* 정부 폼이 자주 요구하는 대체 형식(YYYYMMDD·하이픈 없는 번호) 한 탭 복사 */}
            {x.alt && (
              <button onClick={() => copy(`${x.label}·간단`, x.alt!)} aria-label={`${x.label} 하이픈 없이 복사`}
                className="shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold text-sprout-700 border border-sprout-200 hover:bg-sprout-100">
                {copied === `${x.label}·간단` ? '복사됨' : '붙임표 없이'}
              </button>
            )}
            <button onClick={() => copy(x.label, x.value)} aria-label={`${x.label} 복사`} className="shrink-0 rounded-md p-1 hover:bg-sprout-100 text-sprout-700">
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
