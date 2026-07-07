import { ShieldCheck } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'

const CARRIERS = ['SKT', 'KT', 'LGU+', 'SKM', 'KTM', 'LGM']

/**
 * 에이전트 자동입력용 추가정보 입력(선택).
 * 본인인증 폼 자동 작성에만 쓰이며, 서버 전송 없이 내 기기(localStorage)에만 저장.
 */
export function RpaInfoForm() {
  const { rpaInfo, setRpaInfo } = useAppStore()
  return (
    <div className="mt-3 rounded-xl bg-white border border-sprout-100 p-3 space-y-2 scroll-mt-24">
      <p className="text-[11px] font-bold flex items-center gap-1 text-muted-foreground">
        <ShieldCheck className="h-3.5 w-3.5 text-sprout-500" /> 자동입력 추가정보 (선택 · 내 기기에만 저장)
      </p>
      <p className="text-[11px] text-sprout-700 leading-relaxed">
        실명·생년월일·휴대폰을 넣어두면 서류 발급 때 <b>본인인증 화면까지 자동으로 채워드려요</b> — 폰에서 ‘인증 허용’만 누르면 끝이에요.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <input
          value={rpaInfo.name ?? ''}
          onChange={(e) => setRpaInfo({ name: e.target.value })}
          placeholder="실명 (본인인증용)"
          className="rounded-lg border border-sprout-100 px-2.5 py-1.5 text-xs focus-ring"
          aria-label="실명"
        />
        <input
          value={rpaInfo.birth_date}
          onChange={(e) => setRpaInfo({ birth_date: e.target.value })}
          placeholder="생년월일 (예: 19600101)"
          inputMode="numeric"
          className="rounded-lg border border-sprout-100 px-2.5 py-1.5 text-xs focus-ring"
          aria-label="생년월일"
        />
        <input
          value={rpaInfo.phone}
          onChange={(e) => setRpaInfo({ phone: e.target.value })}
          placeholder="휴대폰 (01012345678)"
          inputMode="numeric"
          className="rounded-lg border border-sprout-100 px-2.5 py-1.5 text-xs focus-ring"
          aria-label="휴대폰 번호"
        />
        {/* 주민등록상 주소 — 회원정보 주소와 다르면 발급 폼에서 자동으로 이 주소로 정정 */}
        <input
          value={rpaInfo.sido ?? ''}
          onChange={(e) => setRpaInfo({ sido: e.target.value })}
          placeholder="시도 (예: 경상북도)"
          className="rounded-lg border border-sprout-100 px-2.5 py-1.5 text-xs focus-ring"
          aria-label="주민등록상 시도"
        />
        <input
          value={rpaInfo.sigungu ?? ''}
          onChange={(e) => setRpaInfo({ sigungu: e.target.value })}
          placeholder="시군구 (예: 경산시)"
          className="rounded-lg border border-sprout-100 px-2.5 py-1.5 text-xs focus-ring"
          aria-label="주민등록상 시군구"
        />
      </div>
      <div className="flex flex-wrap gap-1">
        {CARRIERS.map((c) => (
          <button
            key={c}
            onClick={() => setRpaInfo({ carrier: rpaInfo.carrier === c ? '' : c })}
            className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold border transition-colors ${
              rpaInfo.carrier === c ? 'bg-sprout-700 border-sprout-700 text-white' : 'bg-white border-sprout-100 text-muted-foreground hover:border-sprout-200'
            }`}
          >
            {c}
          </button>
        ))}
      </div>
    </div>
  )
}
