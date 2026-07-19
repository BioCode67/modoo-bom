import { detectUiLang } from './detectLang'

/**
 * 📞 통화 상담 다국어 — 외국인·다문화 가정을 위한 통화 UI 문자열과 라우팅 판단(순수 함수).
 *
 * 원칙:
 * - 한국어 규칙 두뇌(agentReply)는 외국어를 이해하지 못한다 → 외국어 발화는 날조 답변 대신
 *   검증된 경로인 '온디바이스 다국어 AI 의미 검색'(탐색)으로 정직하게 넘긴다(QuickAsk와 동일 선례).
 * - 음성 인식은 시작 전에 언어를 알아야 한다(Web Speech recognition.lang) → 통화 화면에
 *   언어 선택을 두고, 글로 외국어를 입력하면 마이크 언어도 자동으로 따라가게 한다.
 * - 번역 품질을 과장하지 않는다: 여기 문자열은 하드코딩된 4개 언어 고정 문구뿐이고,
 *   실제 다국어 매칭·답변은 탐색의 AI 검색(임베딩 교차검색 + 온디바이스 번역)이 담당한다.
 */
export interface VoiceStrings {
  /** 언어 선택 표시명(자국어) */
  label: string
  flag: string
  /** Web Speech 음성 인식용 BCP-47 태그 */
  sttTag: string
  /** 언어 전환 직후 들려주는 인사(이 언어로 말해도 된다는 확인) */
  greeting: string
  /** 외국어 질의 → AI 의미 검색으로 넘길 때의 안내 */
  routeReply: string
  routeCta: string
  /** 마이크 버튼·입력창 */
  micIdle: string
  micListening: string
  placeholder: string
  /** 헤더 상태줄 */
  statusIdle: string
  statusListening: string
  statusThinking: string
  statusSpeaking: string
}

export const VOICE_LANGS: Record<string, VoiceStrings> = {
  ko: {
    label: '한국어', flag: '🇰🇷', sttTag: 'ko-KR',
    greeting: '안녕하세요! 편하게 말씀해 주세요.',
    routeReply: '', routeCta: '', // 한국어는 규칙 두뇌가 직접 답함(라우팅 없음)
    micIdle: '누르고 말씀하세요',
    micListening: '말씀이 끝나면 잠시 기다려 주세요',
    placeholder: '말 대신 입력하기 (예: 기초연금 알려줘)',
    statusIdle: '아래 버튼을 누르고 말씀하세요',
    statusListening: '🎤 듣고 있어요 — 편하게 말씀하세요',
    statusThinking: '생각하고 있어요…',
    statusSpeaking: '🔊 읽어드리는 중',
  },
  en: {
    label: 'English', flag: '🇬🇧', sttTag: 'en-US',
    greeting: 'Hello! You can ask me about Korean welfare benefits in English.',
    routeReply:
      'Good question! I will look it up with on-device AI meaning search — it understands your language and matches Korean welfare programs. Tap the button below to see the results.',
    routeCta: 'See matching programs',
    micIdle: 'Press and speak',
    micListening: 'Listening — pause when you finish',
    placeholder: 'Type instead (e.g. housing support)',
    statusIdle: 'Press the button below and speak',
    statusListening: '🎤 Listening…',
    statusThinking: 'Thinking…',
    statusSpeaking: '🔊 Reading aloud',
  },
  vi: {
    label: 'Tiếng Việt', flag: '🇻🇳', sttTag: 'vi-VN',
    greeting: 'Xin chào! Bạn có thể hỏi về phúc lợi Hàn Quốc bằng tiếng Việt.',
    routeReply:
      'Câu hỏi hay! Tôi sẽ tìm bằng AI tìm kiếm theo nghĩa (chạy ngay trên máy) — AI hiểu tiếng Việt và tìm các chương trình phúc lợi Hàn Quốc phù hợp. Nhấn nút bên dưới để xem kết quả.',
    routeCta: 'Xem kết quả phù hợp',
    micIdle: 'Nhấn và nói',
    micListening: 'Đang nghe — nói xong hãy chờ một chút',
    placeholder: 'Hoặc gõ câu hỏi (vd: hỗ trợ nhà ở)',
    statusIdle: 'Nhấn nút bên dưới và nói',
    statusListening: '🎤 Đang nghe…',
    statusThinking: 'Đang suy nghĩ…',
    statusSpeaking: '🔊 Đang đọc',
  },
  zh: {
    label: '中文', flag: '🇨🇳', sttTag: 'zh-CN',
    greeting: '您好！您可以用中文咨询韩国的福利政策。',
    routeReply:
      '好问题！我会用设备端 AI 语义搜索来查找 — 它能理解中文并匹配韩国的福利项目。点击下面的按钮查看结果。',
    routeCta: '查看匹配的福利',
    micIdle: '按下后说话',
    micListening: '正在听 — 说完请稍等',
    placeholder: '也可以打字（例：住房补贴）',
    statusIdle: '按下面的按钮说话',
    statusListening: '🎤 正在听…',
    statusThinking: '思考中…',
    statusSpeaking: '🔊 朗读中',
  },
}

/** 통화 UI 문자열 — 미지원 코드는 한국어로 폴백(빈 문자열 노출 방지). */
export function voiceStrings(code: string): VoiceStrings {
  return VOICE_LANGS[code] || VOICE_LANGS.ko
}

/**
 * 발화의 라우팅 언어 판정 — detectUiLang의 보수 게이트를 그대로 사용해
 * 한국어 사용자의 영문 약어·한/영 오타('LH', 'dkssud')가 외국어 상담으로 오발동하지 않게 한다.
 * 반환: 'ko'(규칙 두뇌 직접 응답) 또는 외국어 코드(AI 의미 검색 라우팅).
 */
export function voiceRouteLang(text: string): string {
  return detectUiLang(text)
}

/**
 * 외국어 라우팅 안내문 — 4개 언어는 자국어, 그 밖의 감지 언어(th·ru·ar·ja 등)는
 * 영어 안내로 폴백(질의 자체는 원문 그대로 AI 검색에 전달되므로 검색 품질은 무손상).
 */
export function routeReplyFor(code: string): { text: string; cta: string; speakLang: string } {
  const s = VOICE_LANGS[code]
  if (s && s.routeReply) return { text: s.routeReply, cta: s.routeCta, speakLang: code }
  return { text: VOICE_LANGS.en.routeReply, cta: VOICE_LANGS.en.routeCta, speakLang: 'en' }
}
