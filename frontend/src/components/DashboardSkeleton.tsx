/**
 * 분석 중 표시되는 Dashboard 미리보기 스켈레톤
 * 사용자가 결과가 어떻게 나올지 미리 볼 수 있도록
 */
import { cn } from '@/lib/utils'

function Bone({ className }: { className?: string }) {
  return <div className={cn('skeleton', className)} />
}

export function DashboardSkeleton({ progress = 0 }: { progress?: number }) {
  return (
    <div className="space-y-6 animate-fade-in">
      {/* 히어로 스켈레톤 */}
      <div className="rounded-2xl bg-gradient-to-br from-blue-600/20 via-blue-600/10 to-indigo-700/20 border border-blue-200 p-6">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <Bone className="h-8 w-8 rounded-xl" />
            <div className="space-y-1.5">
              <Bone className="h-3 w-16 rounded" />
              <Bone className="h-3.5 w-24 rounded" />
            </div>
          </div>
          <Bone className="h-7 w-20 rounded-full" />
        </div>

        <div className="mb-5">
          <Bone className="h-9 w-52 rounded-lg mb-2" />
          <Bone className="h-4 w-72 rounded" />
        </div>

        <div className="grid grid-cols-4 gap-2.5">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="rounded-xl bg-white/10 p-3">
              <Bone className="h-4 w-4 mx-auto mb-2 rounded" />
              <Bone className="h-6 w-8 mx-auto mb-1 rounded" />
              <Bone className="h-3 w-12 mx-auto rounded" />
            </div>
          ))}
        </div>

        {/* 진행 상태 배너 */}
        <div className="mt-4 rounded-xl bg-white/10 px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-2.5 w-2.5 rounded-full bg-yellow-300 animate-pulse" />
            <span className="text-white/80 text-sm">AI 분석 진행 중...</span>
          </div>
          <span className="text-yellow-300 font-bold text-lg">{progress}%</span>
        </div>
      </div>

      {/* AI 안내 스켈레톤 */}
      <div className="rounded-2xl border border-blue-100 bg-blue-50/30 p-4">
        <div className="flex items-center gap-2 mb-3">
          <Bone className="h-5 w-5 rounded-full" />
          <Bone className="h-4 w-28 rounded" />
        </div>
        <div className="space-y-2">
          <Bone className="h-3.5 w-full rounded" />
          <Bone className="h-3.5 w-5/6 rounded" />
          <Bone className="h-3.5 w-4/5 rounded" />
        </div>
      </div>

      {/* 탭 스켈레톤 */}
      <div className="flex gap-1 rounded-xl bg-muted/60 p-1">
        {[...Array(5)].map((_, i) => (
          <div key={i} className={cn('flex-1 rounded-lg py-2 px-3', i === 0 ? 'bg-white shadow-sm' : '')}>
            <Bone className="h-3 w-full rounded mx-auto" />
          </div>
        ))}
      </div>

      {/* 포트폴리오 탭 콘텐츠 스켈레톤 */}
      <div className="space-y-4">
        {/* 우선순위 분포 */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { color: 'from-red-50 to-red-100 border-red-100' },
            { color: 'from-amber-50 to-amber-100 border-amber-100' },
            { color: 'from-emerald-50 to-emerald-100 border-emerald-100' },
          ].map((s, i) => (
            <div key={i} className={cn('rounded-2xl border bg-gradient-to-br p-4', s.color)}>
              <Bone className="h-8 w-8 rounded mb-2" />
              <Bone className="h-1.5 w-full rounded-full mb-2" />
              <Bone className="h-3 w-16 rounded" />
            </div>
          ))}
        </div>

        {/* 추천 정책 스켈레톤 */}
        <div className="rounded-2xl border bg-white p-4 shadow-sm space-y-3">
          <div className="flex items-center gap-2 mb-2">
            <Bone className="h-4 w-4 rounded" />
            <Bone className="h-4 w-32 rounded" />
          </div>
          {[...Array(3)].map((_, i) => (
            <div key={i} className="flex gap-3">
              <Bone className="h-6 w-6 rounded-full shrink-0" />
              <div className="flex-1 space-y-1.5">
                <Bone className="h-4 w-3/4 rounded" />
                <Bone className="h-3 w-full rounded" />
              </div>
            </div>
          ))}
        </div>

        {/* 분석 팁 */}
        <div className="rounded-2xl bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-100 p-4">
          <p className="text-sm font-semibold text-blue-800 mb-2">분석이 완료되면 이런 내용을 확인할 수 있어요</p>
          <ul className="space-y-1.5">
            {['수혜 가능한 정책 목록과 자격 확신도', '예상 월 수령 금액 산출', '필요 서류 자동 발급 결과', '신청 기한 및 방법 안내'].map((tip) => (
              <li key={tip} className="flex items-center gap-2 text-xs text-blue-600">
                <div className="h-1.5 w-1.5 rounded-full bg-blue-400 shrink-0" />
                {tip}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
