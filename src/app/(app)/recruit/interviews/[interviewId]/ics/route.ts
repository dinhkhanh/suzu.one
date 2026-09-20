import { getCurrentUser } from "@/modules/platform/auth/session";
import { icsForInterview } from "@/modules/recruit/interviews";

/**
 * The calendar file for one interview (FR-REC-06). This is the part of scheduling that works with
 * no integration whatsoever: the recruiter or the interviewer downloads it and their own calendar —
 * Google, Outlook, Apple, whatever they use — takes it.
 *
 * It is a route and not an action because the answer is a file, and because a browser has to be
 * able to follow it as a plain link. The guard is `icsForInterview`, which is `getInterviewView`
 * underneath: whoever may open the interview may download it, and everybody else gets the same
 * 404 as an interview that does not exist.
 */
export async function GET(_request: Request, context: RouteContext<"/recruit/interviews/[interviewId]/ics">) {
  const user = await getCurrentUser();
  if (!user) return new Response("Not found", { status: 404 });

  const { interviewId } = await context.params;
  const file = await icsForInterview({ principal: user.principal, personId: user.person.id }, interviewId);
  if (!file) return new Response("Not found", { status: 404 });

  return new Response(file.body, {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      // The name is ASCII by construction (`icsFileName`), so no RFC 5987 encoding is needed.
      "content-disposition": `attachment; filename="${file.fileName}"`,
      // It carries a candidate's name: never in a shared cache, never on disk longer than it must be.
      "cache-control": "private, no-store",
    },
  });
}
