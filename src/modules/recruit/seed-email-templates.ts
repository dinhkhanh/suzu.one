// The wordings a recruiter starts from (FR-REC-05). Seeded, not hard-coded: these are drafts that
// HR will rewrite, and the point of putting them in a table is that rewriting them is not a deploy.
//
// Both languages on every row, because the recipient is outside the company and their language is
// a property of *them*. **No figure in any of them** — see `engine/email-template.ts`.
import type { RecruitEmailKind } from "./enums";

export type EmailTemplateSeed = { code: string; name: string; kind: RecruitEmailKind; subject: string; body: string; subjectEn: string; bodyEn: string };

export const EMAIL_TEMPLATE_SEED: readonly EmailTemplateSeed[] = [
  {
    code: "INVITE_INTERVIEW",
    name: "Mời phỏng vấn",
    kind: "invite",
    subject: "Mời phỏng vấn vị trí {{job_title}} — {{company_name}}",
    body: `Chào {{candidate_name}},

Cảm ơn bạn đã ứng tuyển vị trí {{job_title}} tại {{company_name}}. Chúng tôi rất ấn tượng với hồ sơ của bạn và muốn mời bạn tham gia buổi trao đổi ở bước {{stage_name}}.

Chúng tôi sẽ gửi bạn thông tin thời gian và hình thức trao đổi trong email tiếp theo. Nếu có khung giờ nào thuận tiện hơn, bạn cứ trả lời email này để chúng tôi sắp xếp.

Trân trọng,
{{sender_name}}
{{company_name}}`,
    subjectEn: "Interview invitation — {{job_title}} at {{company_name}}",
    bodyEn: `Hello {{candidate_name}},

Thank you for applying for the {{job_title}} role at {{company_name}}. We liked your application and would like to invite you to the {{stage_name}} stage.

We will send the time and the format in a follow-up email. If another time suits you better, just reply to this message and we will arrange it.

Best regards,
{{sender_name}}
{{company_name}}`,
  },
  {
    code: "REJECT_AFTER_REVIEW",
    name: "Từ chối sau khi xem hồ sơ",
    kind: "reject",
    // Says no clearly, thanks them properly, and offers the one thing that is actually useful.
    subject: "Kết quả ứng tuyển vị trí {{job_title}} — {{company_name}}",
    body: `Chào {{candidate_name}},

Cảm ơn bạn đã dành thời gian ứng tuyển vị trí {{job_title}} tại {{company_name}} và đã trao đổi cùng chúng tôi.

Sau khi cân nhắc, lần này chúng tôi chọn một ứng viên khác phù hợp hơn với yêu cầu của vị trí. Quyết định này không làm giảm giá trị những gì bạn đã chia sẻ với chúng tôi.

Nếu bạn đồng ý để chúng tôi lưu hồ sơ, chúng tôi sẽ liên hệ khi có vị trí phù hợp hơn. Các vị trí đang tuyển luôn được cập nhật tại {{careers_url}}.

Chúc bạn nhiều may mắn,
{{sender_name}}
{{company_name}}`,
    subjectEn: "Your application for {{job_title}} — {{company_name}}",
    bodyEn: `Hello {{candidate_name}},

Thank you for taking the time to apply for the {{job_title}} role at {{company_name}} and for speaking with us.

After careful consideration we have decided to go forward with another candidate whose experience is a closer fit for this particular role. That takes nothing away from what you brought to the conversation.

If you are happy for us to keep your details, we will be in touch when something closer comes up. Our open roles are always listed at {{careers_url}}.

With best wishes,
{{sender_name}}
{{company_name}}`,
  },
  {
    code: "OFFER_NOTE",
    name: "Thư báo đề nghị tuyển dụng",
    kind: "offer",
    // Deliberately carries no figure: the amount is in the offer letter, which is a tiered
    // document generated for this candidate, not a wording anybody may edit.
    subject: "Đề nghị tuyển dụng vị trí {{job_title}} — {{company_name}}",
    body: `Chào {{candidate_name}},

Chúng tôi rất vui được mời bạn gia nhập {{company_name}} ở vị trí {{job_title}}.

Thư đề nghị tuyển dụng với đầy đủ điều khoản được gửi kèm email này. Mời bạn đọc kỹ và phản hồi cho chúng tôi biết quyết định của bạn.

Nếu có bất kỳ điều gì bạn muốn trao đổi thêm trước khi quyết định, bạn cứ trả lời email này.

Trân trọng,
{{sender_name}}
{{company_name}}`,
    subjectEn: "Offer for the {{job_title}} role — {{company_name}}",
    bodyEn: `Hello {{candidate_name}},

We are delighted to offer you the {{job_title}} role at {{company_name}}.

The offer letter with the full terms is attached to this email. Please read it and let us know your decision.

If there is anything you would like to discuss before you decide, just reply to this message.

Best regards,
{{sender_name}}
{{company_name}}`,
  },
];
