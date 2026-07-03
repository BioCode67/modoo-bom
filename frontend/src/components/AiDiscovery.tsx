import { useState } from 'react'
import { Sparkles, Loader2 } from 'lucide-react'
import type { Policy } from '@/data/policies'
import type { EligiblePolicy, UserProfile } from '@/lib/welfare-engine'
import { incomeCeiling, sidoOf } from '@/lib/welfare-engine'
import type { SemanticHit } from '@/lib/semanticSearch'
import { PolicyCard } from '@/components/PolicyCard'

/**
 * 🧠 AI 의미 발견 — 사용자가 이미 자격 있는 정책들과 '의미가 가까운' 숨은 복지를
 * 전체 5천여 건에서 온디바이스 임베딩으로 찾아준다(AI 모델 다운로드 불필요, 서버 전송 없음).
 * 키워드 규칙이 놓치는 지역·유사 복지를 보강 → '전부 찾아준다'는 목표에 근접.
 */
export function AiDiscovery({
  eligible,
  profile,
  onOpen,
}: {
  eligible: EligiblePolicy[]
  profile: UserProfile
  onOpen: (p: Policy | EligiblePolicy) => void
}) {
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [hits, setHits] = useState<SemanticHit[]>([])

  // 시드 = 자격 있는 상위 정책(정밀 우선). 이미 화면에 나온 이름은 제외 집합에.
  const seedIds = eligible.slice(0, 16).map((e) => e.id)
  const excludeNames = new Set(eligible.map((e) => e.name.replace(/\s/g, '')))
  const userSido = sidoOf(profile.region)

  const run = async () => {
    setState('loading')
    try {
      const { semanticDiscover } = await import('@/lib/semanticSearch')
      const found = await semanticDiscover(seedIds, {
        topK: 9,
        excludeNames,
        keep: (p) => {
          // 지자체(LOC)는 사용자 시·도와 다르면 제외(지역 입력 시). 소득 상한 초과도 제외.
          if (p.id.startsWith('LOC-') && userSido) {
            const ps = sidoOf(p.target)
            if (ps && ps !== userSido) return false
          }
          const ceil = incomeCeiling(`${p.eligibility} ${p.target} ${p.name}`)
          if (ceil !== null && profile.income_percentile > ceil) return false
          return true
        },
      })
      setHits(found)
      setState('done')
    } catch {
      setState('error')
    }
  }

  return (
    <div className="mt-8">
      <div className="rounded-2xl border-2 border-dashed border-violet-200 bg-violet-50/40 p-4">
        <div className="flex items-start gap-3">
          <span className="text-xl">🧠</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-extrabold">AI가 의미로 찾는 숨은 복지</p>
            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
              지금 받을 수 있는 복지와 <b>의미가 비슷한 정책</b>을 전국 5천여 건에서 AI가 직접 찾아드려요.
              키워드로는 놓치기 쉬운 <b>우리 동네·유사 복지</b>까지요. <b>내 브라우저 안에서</b> 계산해요(서버 전송 없음).
            </p>
            {state === 'idle' && (
              <button onClick={run} className="btn-primary !py-2 !px-4 text-sm mt-2">
                <Sparkles className="h-4 w-4" /> AI로 더 찾기
              </button>
            )}
            {state === 'loading' && (
              <p className="mt-2 inline-flex items-center gap-2 text-sm font-semibold text-violet-700">
                <Loader2 className="h-4 w-4 animate-spin" /> AI가 5천여 건을 의미로 훑는 중…
              </p>
            )}
            {state === 'error' && (
              <p className="mt-2 text-sm text-rose-600">지금은 AI 검색을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.</p>
            )}
            {state === 'done' && hits.length === 0 && (
              <p className="mt-2 text-sm text-muted-foreground">이미 위에서 핵심 복지를 대부분 찾았어요. 추가로 발견된 숨은 복지는 없네요. 👍</p>
            )}
          </div>
        </div>
      </div>

      {state === 'done' && hits.length > 0 && (
        <>
          <p className="mt-4 mb-2 text-sm font-semibold text-muted-foreground">
            AI가 의미로 찾은 관련 복지 <span className="text-violet-600 font-bold">{hits.length}</span>건 — 자격은 각 정책 상세·문의처에서 확인하세요.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {hits.map((h, i) => (
              <PolicyCard key={h.policy.id} policy={h.policy} index={i} onOpen={onOpen} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
