import { latestAudit, type LatestAuditRow, renderAuditBlock } from "./audit-block.ts";
import { renderMarcusChatPrompt } from "./prompt.ts";

export interface AuthenticatedUser {
  userId: string;
}

interface MarcusMessage {
  role: "user" | "assistant";
  content: string;
}

interface MarcusProfile {
  firstname?: string | null;
  product?: string | null;
  stage?: string | null;
  goal_90_day?: string | null;
  goal_progress?: string | number | null;
}

interface MarcusChatBody {
  messages: MarcusMessage[];
  profile?: MarcusProfile;
  session_id: string;
}

interface ModelResponse {
  content?: Array<{ type?: string; text?: string }>;
}

export interface RecentSessionRow {
  session_number: number;
  summary: string | null;
  action_committed: string | null;
  created_at: string | null;
  is_pricing_audit: boolean;
}

export interface MarcusChatDependencies {
  authenticate(request: Request): Promise<AuthenticatedUser | null>;
  readRecentSessions(userId: string): Promise<RecentSessionRow[]>;
  readAudits(userId: string): Promise<LatestAuditRow[]>;
  loadPromptTemplate(): string | undefined;
  createMessage(params: {
    model: string;
    max_tokens: number;
    system: string;
    messages: MarcusMessage[];
  }): Promise<ModelResponse>;
  hashPrompt(prompt: string): Promise<string>;
  now(): Date;
  log(...args: unknown[]): void;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: corsHeaders });
}

export function preflight(): Response {
  return new Response("ok", { headers: corsHeaders });
}

export function internalError(error: unknown): Response {
  return json({ error: error instanceof Error ? error.message : String(error) }, 500);
}

export const MARCUS_OPENING_TURN =
  "(New session starting. Greet me and ask your one diagnostic question, per your instructions.)";

function renderSessionHistory(sessions: RecentSessionRow[]): string {
  const coachingSessions = sessions.filter((session) => session.is_pricing_audit === false);
  if (coachingSessions.length === 0) return "";
  const lines = coachingSessions.map((session) => {
    const date = session.created_at?.split("T")[0] ?? "recent";
    const summary = session.summary ?? "No summary available";
    const action = session.action_committed
      ? ` Action committed: ${session.action_committed}.`
      : "";
    return `Session ${session.session_number} (${date}): ${summary}.${action}`;
  });
  return `\n\nPREVIOUS SESSIONS (most recent first):\n${lines.join("\n")}`;
}

export function createMarcusChatHandler(
  dependencies: MarcusChatDependencies,
): (request: Request) => Promise<Response> {
  return async (request: Request) => {
    if (request.method === "OPTIONS") {
      return preflight();
    }

    try {
      const user = await dependencies.authenticate(request);
      if (!user) return json({ error: "Unauthorised" }, 401);

      const body = await request.json() as MarcusChatBody;
      const template = dependencies.loadPromptTemplate();
      if (!template?.trim()) {
        const message = "MARCUS_CHAT_PROMPT_TEMPLATE is missing or blank";
        dependencies.log("marcus-chat: configuration", message);
        return json({ error: message }, 500);
      }
      const recentSessions = await dependencies.readRecentSessions(user.userId);
      // A failed audit read never blocks coaching: log it and carry on without the block.
      let auditBlock = "";
      try {
        auditBlock = renderAuditBlock(
          latestAudit(await dependencies.readAudits(user.userId)),
          dependencies.now(),
        );
      } catch (error) {
        dependencies.log("marcus-chat: audit", error instanceof Error ? error.message : String(error));
      }
      const system = renderMarcusChatPrompt(template, {
        first_name: body.profile?.firstname ?? "the founder",
        product: body.profile?.product ?? "unknown",
        stage: body.profile?.stage ?? "unknown",
        goal_90_day: body.profile?.goal_90_day ?? "not set yet",
        goal_progress: body.profile?.goal_progress ?? 0,
        session_history: renderSessionHistory(recentSessions),
        audit_block: auditBlock,
      });
      const promptHash = await dependencies.hashPrompt(system);
      dependencies.log("marcus-chat: prompt", {
        sha256: promptHash,
        audit_block: auditBlock !== "",
      });
      const messages = body.messages.length === 0
        ? [{ role: "user" as const, content: MARCUS_OPENING_TURN }]
        : body.messages[0]?.role !== "user"
        ? [{ role: "user" as const, content: MARCUS_OPENING_TURN }, ...body.messages]
        : body.messages;
      const result = await dependencies.createMessage({
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        system,
        messages,
      });
      const reply = result.content?.[0]?.text ?? "I had trouble responding. Try again.";
      return json({ reply });
    } catch (error) {
      return internalError(error);
    }
  };
}
