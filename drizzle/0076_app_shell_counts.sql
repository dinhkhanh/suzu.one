-- Read-side functions live in their own schema, which Supabase's API (PostgREST) does not expose and
-- which nobody but the owner — the role the app and migrations connect as — may use.
CREATE SCHEMA IF NOT EXISTS app;--> statement-breakpoint
REVOKE ALL ON SCHEMA app FROM PUBLIC;--> statement-breakpoint

-- Everything the app frame shows for the signed-in person, in one round trip: the four badges of
-- the sidebar and the two memberships that decide whether recruitment entries appear. Each part
-- mirrors a service function (countUnread, countInbox, countMyOpenTasks, countReviewsWaitingFor,
-- recruitModuleOpen, interviewsModuleOpen); a test keeps them in step.
CREATE OR REPLACE FUNCTION app.shell_counts(p_person uuid)
RETURNS TABLE (unread integer, inbox integer, open_tasks integer, reviews integer, on_hiring_team boolean, interviewer boolean)
LANGUAGE sql STABLE
AS $$
  SELECT
    (SELECT count(*)::int FROM public.notification n WHERE n.recipient_person_id = p_person AND n.read_at IS NULL),
    (SELECT count(*)::int
       FROM public.approval_assignee a
       JOIN public.approval_step s ON s.id = a.step_id
       JOIN public.approval_request r ON r.id = a.request_id
      WHERE a.approver_person_id = p_person AND a.status = 'pending' AND s.status = 'pending' AND r.status = 'pending'),
    (SELECT count(*)::int FROM public.task t WHERE t.assignee_person_id = p_person AND t.deleted_at IS NULL AND t.status IN ('todo', 'in_progress')),
    (SELECT count(*)::int
       FROM public.work_task w
       JOIN public.task t ON t.id = w.task_id
       JOIN public.work_deliverable d ON d.task_id = t.id AND d.decision = 'pending'
      WHERE w.reviewer_person_id = p_person AND w.review_status = 'submitted' AND t.kind = 'work' AND t.deleted_at IS NULL),
    EXISTS (SELECT 1 FROM public.job_opening_member m WHERE m.person_id = p_person),
    EXISTS (SELECT 1 FROM public.interview_interviewer i WHERE i.person_id = p_person)
$$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.shell_counts(uuid) FROM PUBLIC;
