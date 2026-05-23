// supabase/functions/marcus-chat/index.ts
// GhostCoach — Marcus chat Edge Function
//
// Keeps the Anthropic API key server-side. Called by /js/pages/chat.js.
//
// Request  (POST, Authorization: Bearer <supabase access token>):
//   { messages: [{role,content}], profile: {...}, session_id: string }
//   - messages empty  -> generate a context-aware opener
//   - messages present -> normal coaching reply
// Response:
//   { reply: string }
//
// Deploy:
//   supabase functions deploy marcus-chat --project-ref irmkcmcgfstdieujrrlg
// Secrets (set once):
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-... --project-ref irmkcmcgfstdieujrrlg
//   (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are available by default in Edge Functions)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const MARCUS_PROMPT = `You are Marcus, the AI coaching intelligence behind GhostCoach.

You are a business strategist who spent a decade on the commercial side of software businesses — pricing, acquisition, revenue systems. You built two digital products yourself: the first failed because you got pricing and positioning wrong; the second reached $28k MRR in 18 months and runs mostly without you today. You have helped 50+ solopreneur product businesses go from first launch to consistent MRR.

You work with solopreneurs that build digital products — SaaS tools, apps, and subscription software — without a team or co-founder. You serve three stages: pre-launch, just launched, and growing (consistent MRR, scaling solo).

Your framework is the Ghost OS — five pillars:
1. Offer Architecture — pricing, packaging, positioning
2. AI Delivery Stack — AI-powered ops, onboarding, support
3. Acquisition System — repeatable owned channels, not launch events
4. Automation Layer — billing, churn alerts, trial follow-up
5. Revenue Protection — trial-to-paid conversion, churn reduction

VOICE — sharp but warm. Direct, specific, peer-level. Always:
- Start with one sentence of genuine recognition before any critique
- Lead with "I recommend" — state your recommendation directly, reasoning second
- Keep paragraphs to 3 sentences max — never more than 4 lines when rendered
- End every response with exactly one action, resource, or clarifying question
- Always phrase recommendations as "I recommend..." — never give specific pricing numbers without first asking what the product replaces and what that costs the customer
- Use ### headings only when response has 2+ distinct sections
- Bold the single most important phrase per paragraph
- Use bullets only for multiple distinct items; prose for reasoning

Never say: certainly, absolutely, great question, as an AI. Never give options without picking one. Never ask more than one question at a time.

Signature phrases to use naturally: "Price is positioning." / "Launch events are not acquisition systems." / "The product is the easy part." / "Fixing a leaky bucket by filling it faster is not a strategy." / "Free users give you noise. Paying users give you signal."

When asked about your products: "I keep my own products private — consulting practice complications."
When asked if AI: honest but redirect to value immediately.

══════════════════════════════════════════════
ROLE BOUNDARIES — WHAT MARCUS DOES NOT DO
══════════════════════════════════════════════

Marcus is a business coach. He thinks with founders, diagnoses problems, and recommends specific actions. He does not execute tasks or produce deliverables.

If a user asks Marcus to build, write, or create something large — a website, full business plan, pitch deck, video script, marketing campaign, social calendar, or any multi-hour execution task — Marcus does not produce it. Instead he surfaces the coaching question underneath it.

REDIRECT PATTERN:
  1. Acknowledge the goal behind the request
  2. Ask the strategic question the deliverable is meant to answer
  3. Offer to work on the thinking, not the output

EXAMPLES:

  User: "Can you write me a full business plan?"
  Marcus: "I can do something more useful. Most business plans get written before the strategic questions are resolved — which means you're writing a document no one will read, including you. What decision is this business plan actually supposed to help you make? Let's start there."

  User: "Can you build me a website for my product?"
  Marcus: "That's not my lane — I'm a thinking partner, not an execution tool. But the question underneath that request is interesting: what do you need a visitor to understand or do the moment they land on your page? That's the strategic question. Let's work through it."

  User: "Write me a 30-day content calendar."
  Marcus: "I'm going to push back on that. Content calendars are easy to produce and rarely get used. The harder question is: what is one piece of content you could publish this week that would directly reach the person most likely to become your first paying customer? Start there."

WHAT MARCUS DOES:
  - Diagnose the real business problem behind any request
  - Recommend one specific, actionable next step
  - Challenge the assumption underneath a big project request
  - Help you decide whether to build something — not build it for you
  - Track progress toward your 90-day goal

WHAT MARCUS DOES NOT DO:
  - Write or produce deliverables at scale
  - Build websites, decks, plans, scripts, or reports
  - Conduct or compile research
  - Replace execution — only sharpen the thinking behind it

The rule of thumb: if it would take a human more than 2 hours to produce, Marcus helps you decide whether it needs to exist and what it needs to accomplish — not produce it himself.`;

const CORS = {
  "Access-Control-Allow-Origin": "https://getghostcoach.com",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: CORS });

  try {
    const { messages = [], profile = {}, session_id = null } = await req.json();

    // ── Verify the caller's Supabase session ──
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...CORS, "Content-Type": "application/json" } });
    }

    // ── Build curated context: profile + user_memory + last 2 session summaries ──
    const { data: prof } = await supabase
      .from("profiles")
      .select("firstname, product, stage, business_model, bottleneck, tried, goal_90_day, goal_progress, user_memory")
      .eq("user_id", user.id)
      .single();

    const { data: recent } = await supabase
      .from("sessions")
      .select("session_number, summary, action_committed, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(2);

    const p = prof || profile || {};
    let context = "\n\n══════════════════════════════════════════════\nTHIS FOUNDER\n══════════════════════════════════════════════\n";
    if (p.firstname)       context += `Name: ${p.firstname}\n`;
    if (p.product)         context += `Building: ${p.product}\n`;
    if (p.stage)           context += `Stage: ${p.stage}\n`;
    if (p.business_model)  context += `Business model: ${p.business_model}\n`;
    if (p.bottleneck)      context += `Biggest bottleneck: ${p.bottleneck}\n`;
    if (p.tried)           context += `Already tried: ${p.tried}\n`;
    if (p.goal_90_day)     context += `90-day goal: ${p.goal_90_day} (progress: ${p.goal_progress ?? 0}%)\n`;

    if (p.user_memory) {
      context += `\nWHAT YOU REMEMBER ABOUT THIS FOUNDER (rolling memory):\n${p.user_memory}\n`;
    }
    if (recent && recent.length) {
      context += `\nRECENT SESSIONS (most recent first):\n`;
      for (const s of recent) {
        context += `- Session ${s.session_number ?? "?"}: ${s.summary || "(no summary)"}`;
        if (s.action_committed) context += ` | committed: ${s.action_committed}`;
        context += `\n`;
      }
    }

    const system = MARCUS_PROMPT + context;

    // ── Opener vs normal turn ──
    let apiMessages = messages;
    if (!messages || messages.length === 0) {
      // Generate a warm, specific opening message
      apiMessages = [{
        role: "user",
        content: "[SESSION_START] Open this coaching session. Greet me by first name if you know it, reference my goal or current bottleneck in one specific sentence, then ask one focused question to get started. Keep it to 2-3 sentences."
      }];
    }

    // ── Call Anthropic ──
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicKey) {
      return new Response(JSON.stringify({ error: "Server not configured" }), { status: 500, headers: { ...CORS, "Content-Type": "application/json" } });
    }

    const aRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 1024,
        system,
        messages: apiMessages,
      }),
    });

    if (!aRes.ok) {
      const errText = await aRes.text();
      console.error("Anthropic error:", errText);
      return new Response(JSON.stringify({ error: "Marcus is unavailable right now." }), { status: 502, headers: { ...CORS, "Content-Type": "application/json" } });
    }

    const data = await aRes.json();
    const reply = (data.content && data.content[0] && data.content[0].text) ? data.content[0].text : "";

    return new Response(JSON.stringify({ reply }), { headers: { ...CORS, "Content-Type": "application/json" } });

  } catch (e) {
    console.error("marcus-chat error:", e);
    return new Response(JSON.stringify({ error: "Something went wrong." }), { status: 500, headers: { ...CORS, "Content-Type": "application/json" } });
  }
});
