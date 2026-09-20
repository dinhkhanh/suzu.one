// A bilingual HR glossary, and the question variants it produces. Pure — a data table and two
// small functions over it.
//
// WHY IT EXISTS. The handbook is written in Vietnamese; half the company asks in English. Both
// halves of retrieval are word-based — the candidate set comes from a Postgres full-text match on
// the question's words, and the ranking is a lexical score over the passage text — so an English
// question about Vietnamese pages shares nothing with them and scores zero. (The vector half does
// not save it: without an embeddings key the vectors are feature-hashed bags of words, which is
// lexical by another name, and even a real multilingual model is only as good as the model.)
// Week 1's evaluation measured exactly this: Vietnamese 94%, English 3 of 9.
//
// So a question is turned into VARIANTS: the words as asked, and the same words with every phrase
// this table knows swapped for its counterpart. Retrieval unions their search terms; ranking scores
// a passage against each variant and keeps the best. Nothing is ever appended to a question — an
// unmatched foreign word would be counted as a missed term and would push a good passage below the
// answering threshold, which is how a naive "add the translation" makes Vietnamese worse.
//
// The table is deliberately small and concrete: the vocabulary of a Vietnamese HR handbook, not a
// dictionary. A wrong pair here quietly sends questions to the wrong page, so a pair is added only
// when both sides would appear in the same paragraph.
import { words } from "./question";

/** One concept, said both ways. Each side is a list of phrases; the first is the canonical one. */
export type GlossaryEntry = { en: string[]; vi: string[] };

export const GLOSSARY: readonly GlossaryEntry[] = [
  // Leave
  { en: ["annual leave", "paid leave", "holiday entitlement", "vacation"], vi: ["nghỉ phép năm", "phép năm", "nghỉ phép"] },
  { en: ["leave balance", "leave days left", "remaining leave"], vi: ["ngày phép còn lại", "số ngày phép"] },
  { en: ["sick leave"], vi: ["nghỉ ốm", "nghỉ bệnh"] },
  { en: ["maternity leave"], vi: ["nghỉ thai sản", "thai sản"] },
  { en: ["unpaid leave"], vi: ["nghỉ không lương"] },
  { en: ["public holiday", "public holidays", "bank holiday"], vi: ["ngày lễ", "nghỉ lễ", "lễ tết"] },
  { en: ["seniority"], vi: ["thâm niên"] },
  // Time and attendance
  { en: ["working hours", "office hours", "work schedule"], vi: ["giờ làm việc"] },
  { en: ["check in", "clock in", "attendance"], vi: ["chấm công"] },
  { en: ["late", "lateness", "arriving late"], vi: ["đi muộn", "đi trễ"] },
  { en: ["leaving early"], vi: ["về sớm"] },
  { en: ["overtime", "ot"], vi: ["làm thêm giờ", "tăng ca", "làm thêm"] },
  { en: ["night shift", "night work"], vi: ["làm đêm", "ca đêm"] },
  { en: ["lunch break", "break"], vi: ["nghỉ trưa"] },
  { en: ["remote work", "work from home", "working from home", "wfh"], vi: ["làm việc từ xa", "làm việc tại nhà"] },
  { en: ["business trip"], vi: ["công tác"] },
  { en: ["timesheet"], vi: ["bảng công", "bảng chấm công"] },
  // Pay
  { en: ["salary", "pay", "wage"], vi: ["lương", "tiền lương"] },
  { en: ["payslip", "pay slip", "pay stub"], vi: ["phiếu lương", "bảng lương"] },
  { en: ["payday", "pay day", "pay date"], vi: ["ngày trả lương", "kỳ lương"] },
  { en: ["net pay", "take home pay"], vi: ["lương thực nhận", "thực lĩnh"] },
  { en: ["gross salary"], vi: ["lương gộp", "tổng thu nhập"] },
  { en: ["allowance"], vi: ["phụ cấp"] },
  { en: ["bonus"], vi: ["thưởng", "tiền thưởng"] },
  { en: ["thirteenth month salary", "13th month salary"], vi: ["lương tháng 13"] },
  { en: ["deduction"], vi: ["khấu trừ"] },
  { en: ["personal income tax", "income tax", "pit"], vi: ["thuế thu nhập cá nhân", "thuế tncn"] },
  { en: ["dependant", "dependent"], vi: ["người phụ thuộc"] },
  { en: ["advance", "salary advance"], vi: ["tạm ứng", "ứng lương"] },
  // Insurance
  { en: ["social insurance"], vi: ["bảo hiểm xã hội"] },
  { en: ["health insurance"], vi: ["bảo hiểm y tế"] },
  { en: ["unemployment insurance"], vi: ["bảo hiểm thất nghiệp"] },
  { en: ["insurance contribution", "contribution rate"], vi: ["mức đóng bảo hiểm", "tỷ lệ đóng"] },
  { en: ["trade union", "union dues"], vi: ["công đoàn", "phí công đoàn"] },
  // Employment
  { en: ["probation", "probationary period", "trial period"], vi: ["thử việc"] },
  { en: ["labour contract", "employment contract", "contract"], vi: ["hợp đồng lao động", "hợp đồng"] },
  { en: ["contract renewal"], vi: ["gia hạn hợp đồng", "tái ký hợp đồng"] },
  { en: ["resignation", "resign", "quitting"], vi: ["nghỉ việc", "thôi việc", "xin nghỉ việc"] },
  { en: ["notice period"], vi: ["thời gian báo trước", "báo trước"] },
  { en: ["handover"], vi: ["bàn giao"] },
  { en: ["onboarding", "new joiner", "first day"], vi: ["tiếp nhận nhân viên mới", "nhân viên mới", "ngày đầu"] },
  { en: ["job title", "position"], vi: ["chức danh", "vị trí"] },
  { en: ["line manager", "manager", "supervisor"], vi: ["quản lý trực tiếp", "trưởng nhóm", "quản lý"] },
  { en: ["department head"], vi: ["trưởng phòng", "trưởng bộ phận"] },
  { en: ["approve", "approval", "approver", "who approves"], vi: ["duyệt", "phê duyệt", "người duyệt", "ai duyệt"] },
  // Conduct, discipline, security
  { en: ["code of conduct"], vi: ["quy tắc ứng xử"] },
  { en: ["internal labour rules", "work rules"], vi: ["nội quy lao động", "nội quy"] },
  { en: ["discipline", "disciplinary"], vi: ["kỷ luật"] },
  { en: ["harassment"], vi: ["quấy rối"] },
  { en: ["confidentiality", "information security"], vi: ["bảo mật thông tin", "bảo mật"] },
  { en: ["dress code"], vi: ["trang phục"] },
  // Money out
  { en: ["expenses", "expense claim", "reimbursement"], vi: ["thanh toán chi phí", "hoàn ứng", "chi phí"] },
  { en: ["per diem", "travel allowance"], vi: ["công tác phí"] },
  { en: ["invoice", "receipt"], vi: ["hóa đơn", "chứng từ"] },
  // Equipment and tools
  { en: ["laptop", "equipment", "device"], vi: ["thiết bị", "máy tính"] },
  { en: ["asset", "company property"], vi: ["tài sản", "tài sản công ty"] },
  { en: ["file naming", "folder structure"], vi: ["đặt tên tệp", "sắp xếp tệp"] },
  // Performance
  { en: ["performance review", "appraisal"], vi: ["đánh giá hiệu quả", "đánh giá"] },
  { en: ["goal", "objective", "okr"], vi: ["mục tiêu"] },
  { en: ["kpi"], vi: ["chỉ số kpi", "kpi"] },
  // Recruitment
  { en: ["referral", "refer a friend"], vi: ["giới thiệu ứng viên", "giới thiệu"] },
  { en: ["interview"], vi: ["phỏng vấn"] },
  { en: ["candidate", "applicant"], vi: ["ứng viên"] },
  // ── General office vocabulary ──────────────────────────────────────────────────────────────
  // A handbook question is rarely made of HR terms alone: "Who is allowed to operate the flycam?"
  // turns on "operate", and "What is the rule about public AI tools and client data?" on four
  // ordinary words. Without these the phrases above fire on one word out of six and the passage
  // stays below the answering threshold. Single words only, and only ones whose Vietnamese is not
  // ambiguous in an office context.
  { en: ["remote", "off site"], vi: ["từ xa", "ngoài văn phòng"] },
  { en: ["company"], vi: ["công ty"] },
  { en: ["employee", "staff"], vi: ["nhân viên"] },
  { en: ["client", "customer"], vi: ["khách hàng"] },
  { en: ["guest", "visitor"], vi: ["khách"] },
  { en: ["rule", "regulation", "policy"], vi: ["quy định", "quy tắc"] },
  { en: ["process", "procedure"], vi: ["quy trình"] },
  { en: ["form", "application"], vi: ["đơn"] },
  { en: ["request"], vi: ["yêu cầu"] },
  { en: ["report"], vi: ["báo cáo"] },
  { en: ["meeting"], vi: ["cuộc họp", "họp"] },
  { en: ["email"], vi: ["thư điện tử", "email"] },
  { en: ["account"], vi: ["tài khoản"] },
  { en: ["password"], vi: ["mật khẩu"] },
  { en: ["app", "application software"], vi: ["ứng dụng"] },
  { en: ["install"], vi: ["cài đặt"] },
  { en: ["phone", "mobile"], vi: ["điện thoại"] },
  { en: ["computer"], vi: ["máy tính"] },
  { en: ["card"], vi: ["thẻ"] },
  { en: ["file"], vi: ["tệp", "file"] },
  { en: ["folder", "directory"], vi: ["thư mục"] },
  { en: ["name", "naming", "title"], vi: ["tên", "đặt tên"] },
  { en: ["project"], vi: ["dự án"] },
  { en: ["team", "group"], vi: ["nhóm"] },
  { en: ["department"], vi: ["phòng ban", "bộ phận"] },
  { en: ["office"], vi: ["văn phòng"] },
  { en: ["tool"], vi: ["công cụ"] },
  { en: ["data"], vi: ["dữ liệu"] },
  { en: ["information"], vi: ["thông tin"] },
  { en: ["public"], vi: ["công cộng"] },
  { en: ["share", "sharing"], vi: ["chia sẻ"] },
  { en: ["send"], vi: ["gửi"] },
  { en: ["save", "store"], vi: ["lưu"] },
  { en: ["check", "review"], vi: ["kiểm tra"] },
  { en: ["operate", "use", "using"], vi: ["vận hành", "sử dụng", "dùng"] },
  { en: ["allowed", "permitted", "may"], vi: ["được phép", "được"] },
  { en: ["forbidden", "prohibited", "not allowed"], vi: ["không được", "cấm"] },
  { en: ["responsible", "in charge"], vi: ["phụ trách", "chịu trách nhiệm"] },
  { en: ["assigned"], vi: ["phân công"] },
  { en: ["deadline", "due date"], vi: ["hạn", "thời hạn"] },
  { en: ["day", "days"], vi: ["ngày"] },
  { en: ["month", "monthly"], vi: ["tháng"] },
  { en: ["year", "annual", "yearly"], vi: ["năm"] },
  { en: ["week", "weekly"], vi: ["tuần"] },
  { en: ["hour", "hours"], vi: ["giờ"] },
  { en: ["minute", "minutes"], vi: ["phút"] },
  { en: ["money", "amount"], vi: ["tiền", "số tiền"] },
  { en: ["rate", "percentage"], vi: ["tỷ lệ", "mức"] },
  { en: ["video"], vi: ["video"] },
  { en: ["shoot", "shooting", "filming", "set"], vi: ["quay", "hiện trường"] },
  { en: ["edit", "editing"], vi: ["dựng"] },
  { en: ["colour", "color", "grading"], vi: ["màu"] },
  { en: ["brief"], vi: ["brief", "yêu cầu"] },
  { en: ["light", "lighting"], vi: ["ánh sáng"] },
  { en: ["equipment room", "storeroom"], vi: ["kho"] },
  { en: ["sign", "signature"], vi: ["ký"] },
  { en: ["fine", "penalty"], vi: ["phạt"] },
  { en: ["warning"], vi: ["cảnh cáo", "nhắc nhở"] },
  { en: ["training"], vi: ["đào tạo"] },
];

/**
 * English endings stripped before the table is consulted, so "remotely", "meetings" and "naming"
 * find "remote", "meeting" and "name". Applied only when the stripped form is in the table, so a
 * word that merely ends in these letters ("address", "class") is left alone. Vietnamese needs
 * none of this: it does not inflect.
 */
const EN_SUFFIXES = ["'s", "s", "es", "ies", "ing", "ed", "ly", "er"] as const;

type PhraseMap = Map<string, { length: number; replacement: string[]; to: Language }>;

export type Language = "vi" | "en";

// Vietnamese words that survive being typed without accents and are not English words. Enough to
// tell "Nghi phep bao nhieu ngay?" from "How many leave days?" without a language model.
const VIETNAMESE_MARKERS = new Set([
  "khong", "duoc", "phai", "nguoi", "nhan", "vien", "cong", "ty", "lam", "viec", "nghi", "phep",
  "luong", "ngay", "thang", "nam", "gio", "bao", "nhieu", "the", "nao", "gi", "cua", "cho", "voi",
  "trong", "khi", "thi", "ma", "neu", "hoac", "minh", "toi", "quy", "dinh", "tinh", "tien", "muon",
  "xin", "hop", "dong", "bao_hiem", "hiem", "xa", "hoi", "tra", "tinh", "chi", "anh", "chuyen",
]);

/**
 * The language a question is asked in. Vietnamese diacritics settle it outright; otherwise the
 * question is Vietnamese if it uses more Vietnamese markers than English words. Only used to pick
 * which way to translate — a wrong guess costs a variant, never an answer, because the question as
 * asked is always one of the variants.
 */
export function languageOf(question: string): Language {
  if (/[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i.test(question.normalize("NFC"))) return "vi";
  const asked = words(question);
  const vietnamese = asked.filter((word) => VIETNAMESE_MARKERS.has(word)).length;
  return vietnamese > 0 && vietnamese * 3 >= asked.length ? "vi" : "en";
}

/** "annual leave" → ["annual", "leave"], accent-stripped, so the table and a question agree. */
const phraseWords = (phrase: string): string[] => words(phrase);

function buildMap(): PhraseMap {
  const map: PhraseMap = new Map();
  const add = (from: string, to: readonly string[], toLanguage: Language) => {
    const source = phraseWords(from);
    if (source.length === 0) return;
    const key = `${toLanguage}:${source.join(" ")}`;
    // The canonical counterpart, plus its synonyms: a passage may use any of them, and the lexical
    // score only asks that the words be present, so offering all of them can only help coverage.
    const replacement = [...new Set(to.flatMap(phraseWords))];
    // A phrase claimed by two entries ("contract", "name") keeps the first: the table is ordered
    // from the specific to the general, and a longer match wins before this is ever consulted.
    if (!map.has(key)) map.set(key, { length: source.length, replacement, to: toLanguage });
  };
  for (const entry of GLOSSARY) {
    for (const english of entry.en) add(english, entry.vi, "vi");
    for (const vietnamese of entry.vi) add(vietnamese, entry.en, "en");
  }
  return map;
}

let cached: PhraseMap | undefined;
const phraseMap = (): PhraseMap => (cached ??= buildMap());

/** The longest phrase in the table — how far ahead the scan has to look. */
const MAX_PHRASE_WORDS = 4;

/** "meetings" → "meeting" when, and only when, the shorter form is in the table. */
function lookup(map: PhraseMap, key: string, to: Language, span: number): { length: number; replacement: string[] } | undefined {
  const exact = map.get(`${to}:${key}`);
  if (exact && exact.length === span) return exact;
  if (to !== "vi") return undefined; // Only English inflects; the Vietnamese side is looked up as written.
  const lastSpace = key.lastIndexOf(" ");
  const head = lastSpace < 0 ? "" : key.slice(0, lastSpace + 1);
  const last = key.slice(lastSpace + 1);
  for (const suffix of EN_SUFFIXES) {
    if (!last.endsWith(suffix) || last.length - suffix.length < 3) continue;
    const stem = `${head}${last.slice(0, -suffix.length)}`;
    const found = map.get(`${to}:${stem}`);
    if (found && found.length === span) return found;
    // "ies" → "y" ("policies" → "policy"), "ing"/"ed" after a doubled or dropped "e".
    for (const rebuilt of [`${stem}y`, `${stem}e`]) {
      const guess = map.get(`${to}:${rebuilt}`);
      if (guess && guess.length === span) return guess;
    }
  }
  return undefined;
}

/**
 * Every phrase the table knows, swapped for its counterpart in `to`; longest match first, left to
 * right. Words it does not know are kept as they were, so a question that is half technical still
 * keeps its own vocabulary ("flycam" is not in the table and stays "flycam" — which is exactly
 * the word that finds the page).
 */
export function translateWords(source: readonly string[], to: Language): { words: string[]; matched: number } {
  const map = phraseMap();
  const out: string[] = [];
  let matched = 0;
  for (let at = 0; at < source.length; ) {
    let hit: { length: number; replacement: string[] } | undefined;
    for (let span = Math.min(MAX_PHRASE_WORDS, source.length - at); span >= 1; span--) {
      hit = lookup(map, source.slice(at, at + span).join(" "), to, span);
      if (hit) break;
    }
    if (hit) {
      out.push(...hit.replacement);
      at += hit.length;
      matched++;
    } else {
      out.push(source[at]);
      at += 1;
    }
  }
  return { words: out, matched };
}

/**
 * The forms of a question that retrieval and ranking consider. Always the question as asked, first;
 * then the same question in the other language when the glossary had anything to say about it.
 * Never more than two, and never a mixture of the two languages in one variant — see the note at
 * the top of the file.
 */
export function questionVariants(question: string): string[] {
  const asked = words(question);
  if (asked.length === 0) return [question];
  const to: Language = languageOf(question) === "vi" ? "en" : "vi";
  const { words: translated, matched } = translateWords(asked, to);
  if (matched === 0) return [question];
  const other = translated.join(" ");
  return other === asked.join(" ") ? [question] : [question, other];
}
