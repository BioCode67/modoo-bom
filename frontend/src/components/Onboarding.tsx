import { useRef } from 'react'
import { motion } from 'framer-motion'
import { MessageCircle, FileCheck2, BellRing, Sparkles, X } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { SproutLogo } from '@/ui/SproutLogo'
import { useModalFocus } from '@/hooks/useModalFocus'
import { detectBrowserLang } from '@/components/LangSuggest'

// 기능 나열이 아니라 '새싹이가 나를 어떻게 도와주는지'를 1인칭으로 — 에이전트 루프(파악→실행→관찰)와 맞춤.
const HELPS = [
  { icon: MessageCircle, tint: 'text-sprout-700 bg-sprout-100', title: '편하게 한마디만 해주세요', desc: '“72세 혼자 사는데 소득이 적어요”처럼요. 제가 5,300여 개 복지에서 딱 맞는 걸 찾아 쉬운 말로 알려드려요. (한국어·영어·베트남어 등 여러 언어로 물어보셔도 돼요.)' },
  { icon: FileCheck2, tint: 'text-amber-700 bg-amber-100', title: '찾은 다음이 진짜예요', desc: '필요한 서류 발급부터 신청서 작성까지 제가 함께 준비해요. 설치 없이 웹에서 바로요. 본인 확인만 직접 하시면 됩니다.' },
  { icon: BellRing, tint: 'text-rose-600 bg-rose-100', title: '받은 뒤에도 계속 챙겨요', desc: '신청 마감과 갱신 시기를 제가 계속 지켜보고, 놓치지 않게 먼저 알려드려요. 급한 위기 상황이면 긴급복지로 바로 안내해요.' },
]

/** 첫 방문 1회 — 새싹이(에이전트)가 직접 인사하며 '무엇을 대신 해주는지' 소개(진입장벽 완화) */
export function Onboarding() {
  const { onboarded, setOnboarded, setView, uiLang, langSuggested } = useAppStore()
  const panelRef = useRef<HTMLDivElement>(null)
  // 외국인 배려(발견된 UX 결함 수정):
  //  ① 이미 자국어를 쓰면(비 ko) 한국어 온보딩은 오히려 방해 → 생략
  //  ② 브라우저가 외국어인데 아직 언어 제안을 안 봤으면 → 언어 배너를 먼저(한국어 모달이 배너를 가리지 않게)
  const deferForLang = uiLang !== 'ko' || (!langSuggested && !!detectBrowserLang())
  useModalFocus(panelRef, !onboarded && !deferForLang, setOnboarded)

  if (onboarded || deferForLang) return null

  return (
    <div className="modal-overlay" onClick={setOnboarded}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        className="card-cute w-full max-w-md max-h-[90vh] overflow-auto nice-scroll p-6"
        onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="새싹이 인사"
        ref={panelRef} tabIndex={-1}
      >
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2.5">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-sprout-100">
              <SproutLogo withFace className="h-9 w-9" />
            </span>
            <div>
              <p className="text-[11px] font-extrabold text-sprout-700">새싹이 · 복지 에이전트</p>
              {/* 모바일(좁은 폭)에선 text-base 로 — text-lg면 🌱까지 한 줄에 안 들어가 '요'가 어색하게 넘어갔다 */}
              <p className="font-extrabold text-base sm:text-lg leading-tight">안녕하세요, 저 새싹이예요 🌱</p>
            </div>
          </div>
          <button onClick={setOnboarded} aria-label="닫기" className="rounded-full p-2 hover:bg-muted"><X className="h-5 w-5" /></button>
        </div>

        <p className="mt-3 text-sm text-foreground/90 leading-relaxed">
          몰라서 못 받는 복지가 없도록, <b>찾는 것부터 신청·관리까지</b> 제가 대신 챙겨드릴게요. 이렇게요 👇
        </p>

        <ul className="mt-4 space-y-3">
          {HELPS.map(({ icon: Icon, title, desc, tint }) => (
            <li key={title} className="flex items-start gap-3">
              <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${tint}`}><Icon className="h-5 w-5" /></span>
              <div>
                <p className="font-bold text-sm">{title}</p>
                <p className="text-xs text-muted-foreground leading-relaxed">{desc}</p>
              </div>
            </li>
          ))}
        </ul>

        <div className="mt-5 rounded-2xl bg-sprout-50 px-4 py-3 text-xs text-sprout-700">
          🔒 알려주신 정보는 서버로 보내지 않고 <b>내 기기 안에서만</b> 처리해요. 회원가입도 필요 없어요.
        </div>

        {/* 모바일(좁은 폭)에선 세로 스택 — 나란히 두면 '새싹이랑 시작하기'가 반폭에 안 맞아 '시 작하기'로 어색하게 줄바꿈됐다.
            데스크탑(sm+)은 나란히. 라벨은 whitespace-nowrap 로 단어 중간 줄바꿈 방지. */}
        <div className="mt-4 flex flex-col sm:flex-row gap-2">
          <button onClick={() => { setOnboarded(); setView('analyze') }} className="btn-primary flex-1 justify-center whitespace-nowrap order-1 sm:order-2"><Sparkles className="h-4 w-4" /> 새싹이랑 시작하기</button>
          <button onClick={setOnboarded} className="btn-secondary flex-1 justify-center whitespace-nowrap order-2 sm:order-1">둘러볼게요</button>
        </div>
      </motion.div>
    </div>
  )
}
