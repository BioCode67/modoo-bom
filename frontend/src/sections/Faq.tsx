import { SectionHeading } from '@/ui/SectionHeading'

const FAQS = [
  { q: '정말 무료인가요?', a: '네! 모두봄은 복지 사각지대를 줄이기 위한 공익 서비스로, 회원가입도 비용도 없이 누구나 무료로 이용할 수 있어요.' },
  { q: '개인정보는 안전한가요?', a: '입력 정보와 분석은 기본적으로 내 기기(브라우저)에서만 처리·저장됩니다. 로그인하면 "나의 복지" 신청현황만 본인 계정의 보안 클라우드(Supabase, 본인만 접근)로 동기화돼 다른 기기에서도 이어볼 수 있어요. 언제든 삭제할 수 있고, 주민등록번호 같은 민감정보는 저장하지 않아요.' },
  { q: '분석 결과가 정확한가요?', a: '전국 5,000여 개 복지 서비스(중앙부처·지자체)의 자격 기준을 바탕으로 받을 가능성이 높은 혜택을 안내해요. 다만 최종 수급 여부는 주민센터(☎129 보건복지상담)·복지로(bokjiro.go.kr)에서 꼭 확인해 주세요.' },
  { q: '서류 자동발급이 진짜 되나요?', a: '정부24·건강보험공단·고용24의 실제 발급 페이지로 안내하고, 백엔드 연결 시 자동화 발급도 지원해요. 본인인증은 직접 진행하셔야 해요.' },
  { q: '어떤 복지가 포함되나요?', a: '기초연금, 부모급여, 아동수당, 청년 지원, 장애인 연금·활동지원, 실업급여, 주거·의료급여, 한부모 지원 등 중앙부처·지자체 5,000여 종을 다룹니다.' },
  { q: '한국어가 서툰데 쓸 수 있나요?', a: '네. 자국어(영어·베트남어 등 7개 언어)로 한 문장만 적으면 AI가 뜻으로 복지를 찾아줘요. 정책 상세에는 자국어 안내와 🪪 창구 도움 카드(주민센터 직원에게 보여주는 큰 한국어 문장 + 통역 연락처)가 함께 나와, 말이 안 통해도 신청을 시작할 수 있어요.' },
  { q: '어르신 혼자서도 할 수 있나요?', a: "큰글씨·고대비·음성으로 묻고 읽어주기까지 지원해요. 결과는 📋 '글로 복사' 한 번으로 자녀 카톡에 보내 도움을 받을 수 있고, 주민센터 방문용 큰 글씨 인쇄물과 신청 사유서 초안도 대신 만들어드려요." },
]

export function Faq() {
  return (
    <section className="section-pad bg-white/60">
      <div className="page-container max-w-3xl">
        <SectionHeading eyebrow="자주 묻는 질문" title="궁금한 점이 있으신가요?" />
        <div className="mt-10 space-y-3">
          {FAQS.map(({ q, a }, i) => (
            <details key={i} className="group card-cute overflow-hidden">
              <summary className="flex items-center justify-between gap-4 cursor-pointer px-5 py-4 font-bold list-none hover:bg-sprout-50/50 transition-colors">
                <span className="flex items-center gap-2">
                  <span className="text-sprout-700">Q.</span> {q}
                </span>
                <span className="text-sprout-400 group-open:rotate-180 transition-transform text-xl leading-none shrink-0">⌄</span>
              </summary>
              <div className="px-5 pb-4 text-sm text-muted-foreground leading-relaxed dotted-divider pt-3">{a}</div>
            </details>
          ))}
        </div>

        <div className="mt-8 card-cute p-6 bg-gradient-to-r from-sprout-50 to-sky2-50 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="text-center sm:text-left">
            <p className="font-bold text-lg">더 자세한 상담이 필요하세요?</p>
            <p className="text-sm text-muted-foreground mt-0.5">전국 복지 무료 상담 전화와 복지로에서 도움을 받으실 수 있어요.</p>
          </div>
          <div className="flex gap-2 shrink-0">
            <a href="tel:129" className="btn-warm !py-2.5">☎ 129 상담</a>
            <a href="https://www.bokjiro.go.kr" target="_blank" rel="noopener noreferrer" className="btn-secondary !py-2.5">복지로</a>
          </div>
        </div>
      </div>
    </section>
  )
}
