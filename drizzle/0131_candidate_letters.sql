-- R4-D: the candidate hears from us (REC-04), and can leave the talent pool (FR-REC-13).
--
--   · email_outbox.attachments — an interview's .ics and an offer letter ride along with the
--     candidate's letter; emptied once the email is sent, skipped or given up on.
--   · candidate.locale — the language the candidate's letters are written in.
--   · candidate.privacy_token_hash — the hash of the link to their own privacy page.
--
-- And the three new automatic letters (acknowledgement, interview with its time, cancellation), as
-- the seed has them, so they go out from the first deploy rather than waiting for somebody to run
-- the seed. Only in a database that already holds wordings, and only for codes it does not have: a
-- fresh database gets the whole set from the seed.
ALTER TABLE "email_outbox" ADD COLUMN "attachments" jsonb;--> statement-breakpoint
ALTER TABLE "candidate" ADD COLUMN "locale" text;--> statement-breakpoint
ALTER TABLE "candidate" ADD COLUMN "privacy_token_hash" text;--> statement-breakpoint
CREATE INDEX "candidate_privacy_token_idx" ON "candidate" USING btree ("privacy_token_hash");--> statement-breakpoint
INSERT INTO "recruit_email_template" ("code", "name", "kind", "subject", "body", "subject_en", "body_en")
SELECT v."code", v."name", v."kind", v."subject", v."body", v."subject_en", v."body_en"
FROM (VALUES
  ($t$ACK_APPLICATION$t$, $t$Xác nhận đã nhận hồ sơ$t$, $t$acknowledge$t$, $t$Chúng tôi đã nhận hồ sơ ứng tuyển vị trí {{job_title}} — {{company_name}}$t$, $t$Chào {{candidate_name}},

Cảm ơn bạn đã ứng tuyển vị trí {{job_title}} tại {{company_name}}. Chúng tôi đã nhận được hồ sơ của bạn.

Bộ phận tuyển dụng sẽ xem hồ sơ và liên hệ với bạn nếu hồ sơ phù hợp với các bước tiếp theo. Bạn không cần làm gì thêm lúc này.

Bạn có thể xem chúng tôi đang lưu những gì về bạn, và rút khỏi danh sách ứng viên tiềm năng bất cứ lúc nào, tại:
{{privacy_url}}

Trân trọng,
{{company_name}}$t$, $t$We have received your application for {{job_title}} — {{company_name}}$t$, $t$Hello {{candidate_name}},

Thank you for applying for the {{job_title}} role at {{company_name}}. Your application has reached us.

Our recruitment team will review it and get in touch if it fits the next steps. There is nothing more you need to do for now.

You can see what we keep about you, and leave our talent pool at any time, here:
{{privacy_url}}

Best regards,
{{company_name}}$t$),
  ($t$INTERVIEW_SCHEDULED$t$, $t$Lịch phỏng vấn (kèm thời gian)$t$, $t$invite$t$, $t$Lịch phỏng vấn vị trí {{job_title}} — {{company_name}}$t$, $t$Chào {{candidate_name}},

Chúng tôi xin mời bạn tham gia buổi phỏng vấn cho vị trí {{job_title}} tại {{company_name}}.

Thời gian: {{interview_time}}
Địa điểm: {{interview_place}}
Ghi chú: {{interview_notes}}

Lịch hẹn được gửi kèm email này (tệp .ics) để bạn thêm vào lịch của mình. Nếu thời gian này chưa thuận tiện, bạn cứ trả lời email này để chúng tôi sắp xếp lại.

Trân trọng,
{{sender_name}}
{{company_name}}$t$, $t$Your interview for {{job_title}} — {{company_name}}$t$, $t$Hello {{candidate_name}},

We would like to invite you to an interview for the {{job_title}} role at {{company_name}}.

When: {{interview_time}}
Where: {{interview_place}}
Note: {{interview_notes}}

A calendar invitation (.ics) is attached so you can add it to your calendar. If the time does not suit you, just reply to this message and we will find another.

Best regards,
{{sender_name}}
{{company_name}}$t$),
  ($t$INTERVIEW_CANCELLED$t$, $t$Huỷ lịch phỏng vấn$t$, $t$general$t$, $t$Huỷ lịch phỏng vấn vị trí {{job_title}} — {{company_name}}$t$, $t$Chào {{candidate_name}},

Buổi phỏng vấn vị trí {{job_title}} vào {{interview_time}} đã được huỷ. Chúng tôi xin lỗi vì sự thay đổi này.

Chúng tôi sẽ liên hệ lại với bạn về các bước tiếp theo.

Trân trọng,
{{sender_name}}
{{company_name}}$t$, $t$Interview cancelled — {{job_title}} at {{company_name}}$t$, $t$Hello {{candidate_name}},

The interview for the {{job_title}} role on {{interview_time}} has been cancelled. We are sorry for the change.

We will be in touch about the next steps.

Best regards,
{{sender_name}}
{{company_name}}$t$)
) AS v("code", "name", "kind", "subject", "body", "subject_en", "body_en")
WHERE EXISTS (SELECT 1 FROM "recruit_email_template")
  AND NOT EXISTS (SELECT 1 FROM "recruit_email_template" t WHERE t."code" = v."code");
