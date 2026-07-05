/**
 * 경량 UI 다국어 — 정책 상세·신청 키트의 'UI 골격'만 검증된 정적 사전으로 번역한다.
 * 정책 본문(제도명·금액·자격)은 한국어를 유지하고 통역 배너를 붙인다(기계번역·환각 방지 = 정직성 원칙).
 * 지원 언어는 aiAnswer.ts/detectLang.ts와 1:1 정합(ko + en·vi·zh·ja·th·ru·ar).
 */
export type UiLang = 'ko' | 'en' | 'vi' | 'zh' | 'ja' | 'th' | 'ru' | 'ar'
export const UI_LANGS: UiLang[] = ['ko', 'en', 'vi', 'zh', 'ja', 'th', 'ru', 'ar']
export function isUiLang(x: string | undefined): x is UiLang {
  return !!x && (UI_LANGS as string[]).includes(x)
}
/** 아랍어는 우→좌. 배너 등 방향 지정용. */
export const RTL: UiLang[] = ['ar']

type Key =
  | 'benefit' | 'target' | 'eligibility' | 'howToApply' | 'applyKit' | 'requiredDocs'
  | 'related' | 'aiSimilar' | 'serviceInfo' | 'trust' | 'visitPrint'
  | 'save' | 'saved' | 'goApply' | 'issue'
  | 'flowTitle' | 'stepRecommend' | 'stepInfo' | 'stepDocs' | 'stepAuth' | 'stepSubmit'
  | 'byAuto' | 'byGuide' | 'byYou' | 'banner'

const DICT: Record<UiLang, Record<Key, string>> = {
  ko: {
    benefit: '혜택 내용', target: '지원 대상', eligibility: '자격 요건', howToApply: '신청 방법',
    applyKit: '신청 키트', requiredDocs: '필요 서류', related: '함께 보면 좋은 복지', aiSimilar: 'AI로 비슷한 복지',
    serviceInfo: '서비스 안내', trust: '출처 · 신뢰 근거', visitPrint: '주민센터 방문용으로 큰 글씨 인쇄',
    save: '관심', saved: '저장됨', goApply: '공식 사이트에서 신청', issue: '발급',
    flowTitle: '신청은 이렇게 진행돼요', stepRecommend: '맞춤 추천 완료', stepInfo: '신청서 정보 준비',
    stepDocs: '서류 준비', stepAuth: '간편인증 (본인)', stepSubmit: '최종 제출 (본인)',
    byAuto: '자동', byGuide: '안내', byYou: '본인',
    banner: '제도명·내용은 한국어예요. 통역이 필요하면 ☎1577-1366(다누리콜) 또는 ☎129로 도움받을 수 있어요.',
  },
  en: {
    benefit: 'Benefit', target: 'Who is eligible', eligibility: 'Requirements', howToApply: 'How to apply',
    applyKit: 'Apply kit', requiredDocs: 'Required documents', related: 'Related welfare', aiSimilar: 'AI-similar welfare',
    serviceInfo: 'Service info', trust: 'Source · trust', visitPrint: 'Print large-print for a community-center visit',
    save: 'Save', saved: 'Saved', goApply: 'Apply on the official site', issue: 'Get',
    flowTitle: 'How the application works', stepRecommend: 'Matched for you', stepInfo: 'Prepare your info',
    stepDocs: 'Prepare documents', stepAuth: 'Identity verification (you)', stepSubmit: 'Final submit (you)',
    byAuto: 'Auto', byGuide: 'Guide', byYou: 'You',
    banner: 'Program names and details are in Korean. For an interpreter, call ☎1577-1366 (Danuri) or ☎129.',
  },
  vi: {
    benefit: 'Quyền lợi', target: 'Đối tượng', eligibility: 'Điều kiện', howToApply: 'Cách đăng ký',
    applyKit: 'Bộ đăng ký', requiredDocs: 'Giấy tờ cần thiết', related: 'Phúc lợi liên quan', aiSimilar: 'Phúc lợi tương tự (AI)',
    serviceInfo: 'Thông tin dịch vụ', trust: 'Nguồn · độ tin cậy', visitPrint: 'In chữ lớn để đến trung tâm hành chính',
    save: 'Lưu', saved: 'Đã lưu', goApply: 'Đăng ký trên trang chính thức', issue: 'Cấp',
    flowTitle: 'Quy trình đăng ký', stepRecommend: 'Đã gợi ý cho bạn', stepInfo: 'Chuẩn bị thông tin',
    stepDocs: 'Chuẩn bị giấy tờ', stepAuth: 'Xác thực danh tính (bạn)', stepSubmit: 'Nộp cuối cùng (bạn)',
    byAuto: 'Tự động', byGuide: 'Hướng dẫn', byYou: 'Bạn',
    banner: 'Tên và nội dung chương trình bằng tiếng Hàn. Cần thông dịch, gọi ☎1577-1366 (Danuri) hoặc ☎129.',
  },
  zh: {
    benefit: '福利内容', target: '申请对象', eligibility: '申请条件', howToApply: '申请方法',
    applyKit: '申请工具', requiredDocs: '所需材料', related: '相关福利', aiSimilar: 'AI 相似福利',
    serviceInfo: '服务说明', trust: '来源 · 可信度', visitPrint: '打印大字版以便前往社区中心',
    save: '收藏', saved: '已收藏', goApply: '在官方网站申请', issue: '开具',
    flowTitle: '申请流程', stepRecommend: '已为您匹配', stepInfo: '准备信息',
    stepDocs: '准备材料', stepAuth: '身份认证（本人）', stepSubmit: '最终提交（本人）',
    byAuto: '自动', byGuide: '指引', byYou: '本人',
    banner: '项目名称与内容为韩文。需要翻译请拨打 ☎1577-1366（Danuri）或 ☎129。',
  },
  ja: {
    benefit: '給付内容', target: '対象者', eligibility: '要件', howToApply: '申請方法',
    applyKit: '申請キット', requiredDocs: '必要書類', related: '関連する福祉', aiSimilar: 'AIで似た福祉',
    serviceInfo: 'サービス案内', trust: '出典 · 信頼', visitPrint: '住民センター訪問用に大きな文字で印刷',
    save: '保存', saved: '保存済み', goApply: '公式サイトで申請', issue: '発行',
    flowTitle: '申請の流れ', stepRecommend: 'あなたに合わせて選定', stepInfo: '情報の準備',
    stepDocs: '書類の準備', stepAuth: '本人認証（本人）', stepSubmit: '最終提出（本人）',
    byAuto: '自動', byGuide: '案内', byYou: '本人',
    banner: '制度名・内容は韓国語です。通訳が必要なら ☎1577-1366（タヌリ）または ☎129 へ。',
  },
  th: {
    benefit: 'สิทธิประโยชน์', target: 'ผู้มีสิทธิ', eligibility: 'เงื่อนไข', howToApply: 'วิธีสมัคร',
    applyKit: 'ชุดสมัคร', requiredDocs: 'เอกสารที่ต้องใช้', related: 'สวัสดิการที่เกี่ยวข้อง', aiSimilar: 'สวัสดิการคล้ายกัน (AI)',
    serviceInfo: 'ข้อมูลบริการ', trust: 'แหล่งที่มา · ความน่าเชื่อถือ', visitPrint: 'พิมพ์ตัวอักษรใหญ่เพื่อไปที่ศูนย์ชุมชน',
    save: 'บันทึก', saved: 'บันทึกแล้ว', goApply: 'สมัครที่เว็บไซต์ทางการ', issue: 'ออกเอกสาร',
    flowTitle: 'ขั้นตอนการสมัคร', stepRecommend: 'จับคู่ให้คุณแล้ว', stepInfo: 'เตรียมข้อมูล',
    stepDocs: 'เตรียมเอกสาร', stepAuth: 'ยืนยันตัวตน (คุณ)', stepSubmit: 'ส่งขั้นสุดท้าย (คุณ)',
    byAuto: 'อัตโนมัติ', byGuide: 'แนะนำ', byYou: 'คุณ',
    banner: 'ชื่อและรายละเอียดโครงการเป็นภาษาเกาหลี ต้องการล่ามโทร ☎1577-1366 (Danuri) หรือ ☎129',
  },
  ru: {
    benefit: 'Льгота', target: 'Кому положено', eligibility: 'Условия', howToApply: 'Как подать',
    applyKit: 'Набор для подачи', requiredDocs: 'Необходимые документы', related: 'Похожие льготы', aiSimilar: 'Похожее (AI)',
    serviceInfo: 'О программе', trust: 'Источник · доверие', visitPrint: 'Печать крупным шрифтом для визита в центр',
    save: 'Сохранить', saved: 'Сохранено', goApply: 'Подать на официальном сайте', issue: 'Получить',
    flowTitle: 'Как проходит подача', stepRecommend: 'Подобрано для вас', stepInfo: 'Подготовьте данные',
    stepDocs: 'Подготовьте документы', stepAuth: 'Подтверждение личности (вы)', stepSubmit: 'Финальная подача (вы)',
    byAuto: 'Авто', byGuide: 'Подсказка', byYou: 'Вы',
    banner: 'Названия и детали программ на корейском. Для переводчика звоните ☎1577-1366 (Danuri) или ☎129.',
  },
  ar: {
    benefit: 'المزايا', target: 'من يستحق', eligibility: 'الشروط', howToApply: 'كيفية التقديم',
    applyKit: 'حزمة التقديم', requiredDocs: 'المستندات المطلوبة', related: 'رعاية ذات صلة', aiSimilar: 'مشابه بالذكاء الاصطناعي',
    serviceInfo: 'معلومات الخدمة', trust: 'المصدر · الموثوقية', visitPrint: 'طباعة بخط كبير لزيارة المركز',
    save: 'حفظ', saved: 'محفوظ', goApply: 'قدّم على الموقع الرسمي', issue: 'إصدار',
    flowTitle: 'كيف يتم التقديم', stepRecommend: 'تمت المطابقة لك', stepInfo: 'جهّز معلوماتك',
    stepDocs: 'جهّز المستندات', stepAuth: 'التحقق من الهوية (أنت)', stepSubmit: 'التقديم النهائي (أنت)',
    byAuto: 'تلقائي', byGuide: 'إرشاد', byYou: 'أنت',
    banner: 'أسماء البرامج وتفاصيلها بالكورية. للمترجم اتصل بـ ☎1577-1366 (دانوري) أو ☎129.',
  },
}

/** UI 문자열 번역. 없는 키·언어는 영어→한국어로 폴백. */
export function t(lang: UiLang, key: Key): string {
  return DICT[lang]?.[key] ?? DICT.en[key] ?? DICT.ko[key]
}
