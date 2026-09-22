-- The app frame's counts, again (0076), now that review chains (FR-PJM-50) put a version in front of
-- the stage's reviewer rather than the task's, and that hand-offs (FR-PJM-40) and blockers
-- (FR-PJM-28) can wait on a person too. The result gains two columns, so the function is dropped
-- and made anew: the code already deployed reads its columns by name and ignores the new ones.
-- Each part mirrors a service function (countUnread, countInbox, countMyOpenTasks,
-- countReviewsWaitingFor, listPendingHandoffsFor, listBlockersWaitingOn, recruitModuleOpen,
-- interviewsModuleOpen); a test keeps them in step.
DROP FUNCTION IF EXISTS app.shell_counts(uuid);--> statement-breakpoint
CREATE FUNCTION app.shell_counts(p_person uuid)
RETURNS TABLE (unread integer, inbox integer, open_tasks integer, reviews integer, handoffs integer, blockers integer, on_hiring_team boolean, interviewer boolean)
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
    -- A single-step review waits for the task's reviewer; a version in a chain for its stage's.
    (SELECT count(*)::int
       FROM public.work_task w
       JOIN public.task t ON t.id = w.task_id
       JOIN public.work_deliverable d ON d.task_id = t.id AND d.decision = 'pending'
      WHERE ((d.chain_id IS NULL AND w.reviewer_person_id = p_person) OR (d.chain_id IS NOT NULL AND d.stage_reviewer_person_id = p_person))
        AND w.review_status = 'submitted' AND t.kind = 'work' AND t.deleted_at IS NULL),
    -- Cross-team work is answered in the receiving team's triage, not by a person.
    (SELECT count(*)::int
       FROM public.work_handoff h
       JOIN public.task t ON t.id = h.task_id AND t.deleted_at IS NULL
       JOIN public.work_task w ON w.task_id = t.id
      WHERE h.to_person_id = p_person AND h.status = 'pending' AND h.kind <> 'cross_team'),
    (SELECT count(*)::int
       FROM public.work_blocker b
       JOIN public.task t ON t.id = b.task_id AND t.deleted_at IS NULL
       JOIN public.work_task w ON w.task_id = t.id
      WHERE b.needed_person_id = p_person AND b.resolved_at IS NULL),
    EXISTS (SELECT 1 FROM public.job_opening_member m WHERE m.person_id = p_person),
    EXISTS (SELECT 1 FROM public.interview_interviewer i WHERE i.person_id = p_person)
$$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.shell_counts(uuid) FROM PUBLIC;
