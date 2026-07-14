import { useState } from 'react'
import { FileText, Copy, Check, Printer, ChevronDown } from 'lucide-react'
import type { UserProfile, EligiblePolicy } from '@/lib/welfare-engine'
import type { Policy } from '@/data/policies'
import { generateApplyLetter, generateProxyLetter, generatePhoneScript } from '@/lib/applyLetter'
import { cn } from '@/lib/utils'

type DocMode = 'letter' | 'proxy' | 'phone'

/**
 * 신청 사유서 도우미 — 긴급복지·위기지원·장학·민간재단 신청 시 필요한 '신청 사유/상황 설명'을
 * 프로필 신호로 정중한 초안(규칙 기반·환각 0)으로 만들어 복사·인쇄하게 한다. 어르신·외국인·저학력층의
 * 최대 장벽('무엇을 어떻게 써야 할지')을 해소. 초안이며 확인·수정 후 사용하도록 안내한다.
 */
export function ApplyLetterHelper({ profile, policy }: { profile: UserProfile | null; policy: Policy | EligiblePolicy }) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<DocMode>('letter')
  // 모드별로 편집분을 따로 보존 — 탭을 오가도 사용자가 고친 내용을 덮어쓰지 않는다(데이터 손실 방지)
  const [texts, setTexts] = useState<Record<DocMode, string>>({ letter: '', proxy: '', phone: '' })
  const [copied, setCopied] = useState(false)
  if (!profile) return null

  const gen = (m: DocMode) =>
    m === 'proxy' ? generateProxyLetter(profile, policy)
    : m === 'phone' ? generatePhoneScript(profile, policy)
    : generateApplyLetter(profile, policy)
  const text = texts[mode]
  const setText = (v: string) => setTexts((t) => ({ ...t, [mode]: v }))
  const ensure = (m: DocMode) => setTexts((t) => (t[m] ? t : { ...t, [m]: gen(m) }))
  const toggle = () => {
    if (!open) ensure(mode)
    setOpen((o) => !o)
  }
  const switchMode = (m: DocMode) => { ensure(m); setMode(m) }
  const copy = () => {
    navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }).catch(() => { /* 미지원 무시 */ })
  }
  const print = () => {
    const w = window.open('', '_blank', 'width=640,height=840')
    if (!w) {
      // 모바일 팝업 차단 시 — 무반응 대신 클립보드 복사로 폴백해 사용자가 막다른 길에 빠지지 않게
      copy()
      alert('인쇄 창이 차단됐어요. 내용을 복사해드렸으니 메모장 등에 붙여 넣어 인쇄하세요.')
      return
    }
    const safe = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const docTitle = mode === 'proxy' ? '위임장' : mode === 'phone' ? '전화 대본' : '신청 사유서'
    w.document.write(
      `<title>${docTitle}</title><pre style="font-family:'Pretendard','Malgun Gothic',sans-serif;font-size:16px;line-height:2;white-space:pre-wrap;padding:40px;color:#111;">${safe}</pre>`,
    )
    w.document.close(); w.focus(); setTimeout(() => w.print(), 200)
  }

  return (
    <div className="mt-2 rounded-xl border border-sky2-200 bg-sky2-50/50">
      <button onClick={toggle} aria-expanded={open} className="flex w-full items-center gap-2 px-3 py-2.5 text-left">
        <FileText className="h-4 w-4 shrink-0 text-sky2-600" />
        {/* 부제 sky2-600은 sky2-50/50 위 3.9:1(AA 미달, 18차) → 700 승격 */}
        <span className="flex-1 text-sm font-bold text-sky2-800">📝 신청 서류 대신 써드려요 <span className="font-normal text-sky2-700">— 사유서·위임장·전화 대본</span></span>
        <ChevronDown className={cn('h-4 w-4 text-sky2-600 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="px-3 pb-3">
          {/* 문서 종류 — 사유서/위임장/전화대본. flex-wrap+nowrap: 큰글씨·좁은 화면에서 칩이
              음절 중간에서 꺾이지 않고 칩 단위로 줄바꿈(18차) */}
          <div className="mb-2 flex flex-wrap gap-1.5">
            {([['letter', '신청 사유서'], ['proxy', '위임장(대신 신청)'], ['phone', '📞 전화 대본']] as [DocMode, string][]).map(([m, label]) => (
              <button
                key={m}
                onClick={() => switchMode(m)}
                aria-pressed={mode === m}
                className={cn('chip text-xs transition-colors whitespace-nowrap', mode === m ? 'bg-sky2-700 text-white' : 'bg-white border border-sky2-200 text-sky2-700 hover:bg-sky2-50')}
              >
                {label}
              </button>
            ))}
          </div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={9}
            aria-label="신청 사유서 초안"
            className="w-full resize-y rounded-lg border border-sky2-200 bg-white p-3 text-[13px] leading-relaxed text-foreground focus-ring"
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            ※ <b>초안이에요</b> — 사실과 맞는지 확인하고 상황에 맞게 고쳐서 쓰세요. 입력하신 상황만 문장으로 옮겼어요(지어낸 내용 없음).
            {/* opacity-80이 전역 대비 승격을 우회해 3.8:1(AA 미달, 18차) → 불투명 유지 */}
            <span className="block">This is a Korean application letter (drafts only) — check it, then submit to the office as is.</span>
          </p>
          <div className="mt-2 flex gap-2">
            <button onClick={copy} className="btn-primary !py-2 text-xs">
              {copied ? <><Check className="h-4 w-4" /> 복사됐어요</> : <><Copy className="h-4 w-4" /> 복사</>}
            </button>
            <button onClick={print} className="btn-secondary !py-2 text-xs"><Printer className="h-4 w-4" /> 인쇄</button>
          </div>
        </div>
      )}
    </div>
  )
}
