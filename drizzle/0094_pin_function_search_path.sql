-- Supabase's advisor (lint 0011, function_search_path_mutable): a function that does not pin its
-- search_path resolves the names in its body against whatever path the caller has set. Pin them.
-- The trigger functions name tables and enum types without a schema, so they keep `public`, with
-- pg_temp last so a temporary table cannot stand in for a real one. app.shell_counts already
-- qualifies every name and gets an empty path. Bodies are unchanged; the deployed code is unaffected.
ALTER FUNCTION app.shell_counts(uuid) SET search_path = '';--> statement-breakpoint
ALTER FUNCTION public.audit_log_reject_change() SET search_path = public, pg_temp;--> statement-breakpoint
ALTER FUNCTION public.goal_check_in_reject_change() SET search_path = public, pg_temp;--> statement-breakpoint
ALTER FUNCTION public.kpi_score_reject_change() SET search_path = public, pg_temp;--> statement-breakpoint
ALTER FUNCTION public.kb_page_version_reject_change() SET search_path = public, pg_temp;--> statement-breakpoint
ALTER FUNCTION public.kb_acknowledgement_reject_change() SET search_path = public, pg_temp;--> statement-breakpoint
ALTER FUNCTION public.payroll_run_reject_locked_change() SET search_path = public, pg_temp;--> statement-breakpoint
ALTER FUNCTION public.payroll_run_child_reject_locked_change() SET search_path = public, pg_temp;--> statement-breakpoint
ALTER FUNCTION public.payroll_run_event_reject_change() SET search_path = public, pg_temp;--> statement-breakpoint
ALTER FUNCTION public.payslip_query_message_reject_change() SET search_path = public, pg_temp;--> statement-breakpoint
ALTER FUNCTION public.payroll_cash_payment_reject_locked_change() SET search_path = public, pg_temp;--> statement-breakpoint
ALTER FUNCTION public.bonus_run_event_reject_change() SET search_path = public, pg_temp;--> statement-breakpoint
ALTER FUNCTION public.bonus_run_reject_paid_change() SET search_path = public, pg_temp;--> statement-breakpoint
ALTER FUNCTION public.bonus_run_line_reject_paid_change() SET search_path = public, pg_temp;--> statement-breakpoint
ALTER FUNCTION public.org_unit_path_set() SET search_path = public, pg_temp;--> statement-breakpoint
ALTER FUNCTION public.person_placement_set() SET search_path = public, pg_temp;--> statement-breakpoint
ALTER FUNCTION public.org_unit_path_cascade() SET search_path = public, pg_temp;
