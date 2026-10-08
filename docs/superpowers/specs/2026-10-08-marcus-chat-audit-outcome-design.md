# Audit outcome in regular Marcus sessions

Status: draft for client review, 2026-10-08. Tracked in #38 (tickets #40, #41, #42). Nothing here reaches production until the client has
reviewed this spec and approved each production step separately.

## Problem Statement

A founder finishes a Pricing audit and gets a Verdict: raise, hold or restructure, usually with a
number and an act-by date. In their next regular coaching session, Marcus knows nothing about it.
He can't ask whether they raised the price, he may give advice that contradicts the Verdict, and
the audit feels disconnected from the coaching it is meant to feed.

Two further problems sit underneath:

- Regular sessions get their context from the `marcus-chat` Edge Function, which exists only in the
  live project. It is not versioned, so it can't be reviewed, tested or rolled back from the repo.
  Its Marcus prompt is written inline in the source, so the source can't be committed to this
  public repo as it stands.
- Audit sessions are stored in the same `sessions` table and take a number from the same
  per-user `session_number` sequence. Regular sessions must never treat an audit as coaching
  history. Today that holds only by accident: audit rows have no summary, and the history query
  skips rows without one.

## Solution

`marcus-chat` moves into the repo, with its prompt template moved into a Supabase secret, unchanged
in wording. The function then adds a separate **audit context block** to the prompt for founders
who have completed at least one Pricing audit: the latest Verdict action, the number (or "no
number"), the completion date and the act-by date, with a flag when that date has passed. It never
includes the Verdict's reasoning text. Founders without an audit get exactly the prompt they get
today, byte for byte.

History loading excludes audit sessions explicitly, by their `is_pricing_audit` flag. Stored session
numbers are kept as they are, gaps included, so a founder's history may read "Session 4 … Session 6"
when Session 5 was an audit. This matches the numbers on the account page.

The change ships with a rollback: the exact deployed source, kept privately outside the repo, can be
redeployed at any time.

## User Stories

1. As a founder who completed a Pricing audit, I want Marcus to know my latest Verdict action, so
   that his coaching builds on it instead of ignoring it.
2. As a founder whose Verdict included a number, I want Marcus to know that number, so that he can
   ask whether I applied it.
3. As a founder whose restructure Verdict had no number, I want Marcus to see "no number" rather
   than a blank or an invented figure, so that he doesn't make one up.
4. As a founder, I want Marcus to know when I completed the audit, so that he can judge how recent
   the advice is.
5. As a founder, I want Marcus to know my act-by date, so that he can hold me to it.
6. As a founder whose act-by date has passed, I want Marcus to know it has passed, so that he can
   ask whether I acted on the Verdict.
7. As a founder with several audits, I want Marcus to see only the latest one, so that old Verdicts
   don't confuse the coaching.
8. As a founder, I want my audit's reasoning text kept out of regular sessions, so that Marcus works
   from the decision and not a long rationale.
9. As a founder who never did an audit, I want my sessions to behave exactly as before, so that the
   change is invisible to me.
10. As a founder, I want my audit conversations kept out of my coaching history, so that Marcus
    doesn't summarise an audit as if it were a coaching session.
11. As a founder whose very first session was a Pricing audit, I want my first regular session to
    behave as a first session, so that Marcus doesn't refer to coaching history I don't have.
12. As a founder, I want the session numbers Marcus mentions to match the ones on my account page,
    so that "in session 4" means the same thing to both of us.
13. As a founder with audits between my coaching sessions, I want Marcus to accept gaps in the
    numbering, so that a skipped number doesn't read as missing data.
14. As a founder, I want Marcus's replies to keep the same tone, rules and model as today, so that
    this change doesn't alter how he coaches.
15. As a founder, I want sign-in failures to behave as today, so that the chat page's error handling
    still works.
16. As the client, I want `marcus-chat` versioned in the repo, so that changes are reviewed, tested
    and reversible.
17. As the client, I want the Marcus prompt kept out of the public repo, so that it isn't published.
18. As the client, I want the prompt stored in a Supabase secret that only the founder account sets,
    so that no extra roles or access are needed.
19. As the client, I want proof that the prompt is unchanged, so that I can trust the move didn't
    alter Marcus.
20. As the client, I want that proof based on hashes only, so that the prompt text never appears in
    logs.
21. As the client, I want any wording that tells Marcus how to use the audit block shown to me before
    it ships, so that no prompt change goes out unreviewed.
22. As the client, I want the function to fail loudly when the prompt secret is missing or empty, so
    that Marcus never runs on a stale or built-in prompt.
23. As the client, I want a founder's name or product text that looks like a placeholder or contains
    `$` sequences to appear exactly as typed, so that user text can never alter the prompt.
24. As the client, I want the exact deployed source kept privately as the rollback, so that I can
    restore the old behaviour in one step.
25. As the client, I want the deployment checked against the recorded version right before deploying,
    so that the rollback copy is known to be current.
26. As the client, I want a written rollback note in the repo, so that anyone can reverse the change
    without the developer.
27. As the client, I want the PR to state how session numbering was handled, including the
    audit-first founder, so that I can check it against my requirement.
28. As the client, I want repo tests and fixtures to use a dummy template, so that the real prompt
    never lands in the public repo.
29. As the client, I want live QA on a QA account with cleanup by exact ID, so that no real founder's
    audit is touched.
30. As a developer, I want the request handling written as a pure, injectable handler, so that I can
    test it under Node without a live Supabase or Anthropic.
31. As a developer, I want tests for no audit, raise, hold, restructure without a number, a passed
    act-by date and audit sessions excluded from history, so that each rule is pinned down.
32. As a developer, I want the date logic driven by an injected clock, so that "passed" can be tested
    on, before and after the act-by day.

## Implementation Decisions

**Module shape** (follows the existing `marcus-audit-chat` and `pricing-audit-eligibility`
pattern):

- A pure **handler factory** that receives its dependencies: authenticate the caller, read recent
  coaching history, read the latest audit, read the prompt template, call Anthropic, the current
  time, and a logger. Tested under Node with fakes.
- A small **config reader** for the secret and settings, through the shared settings helpers.
- A **prompt renderer**, a pure function from (template, values) to the rendered prompt. It is the
  only place placeholders are filled.
- An **audit block builder**, a pure function from (latest audit row or none, today) to the block
  text or an empty string.
- A thin **Deno entry** that wires these to the Supabase client, `Deno.env` and `fetch`.

**Behaviour preserved from the deployed function** (deployment 20). The new function must match it
in everything this spec doesn't change:

- Authentication: the caller's bearer token is checked with the service-role client; failure is
  `401 { "error": "Unauthorised" }`. The function's gateway JWT setting stays as it is live; read
  it before deploying and record it in the function config.
- Request body `{ messages, profile, session_id }`, success `200 { "reply": "..." }`, other failures
  `500 { "error": "..." }`, the same CORS headers and `OPTIONS` handling.
- The opening-turn behaviour: an empty message list, or one that doesn't start with a user turn,
  gets the same fixed opening user turn in front. That turn stays in code. It is not part of the
  system prompt.
- Model, `max_tokens` and Anthropic API version unchanged.
- History: the last 3 of the caller's sessions with `processing_status = complete` and a non-null
  summary, newest `created_at` first, rendered in the same line format. Profile defaults unchanged,
  including that they apply only to missing values (`??` semantics, so an empty string stays
  empty).

**History filter.** The history query adds `is_pricing_audit = false` (the column is
`boolean not null default false`). The summary condition stays as it is. A dedicated test covers an
audit row that *has* a summary and proves it is still excluded.

**Session numbers.** The `session_number` trigger is not changed. The deployed code uses
`session_number` only as a label on history lines, and no logic depends on it. The "Session 2+" rule
in the prompt depends on whether history exists, and Marcus is never told the current session's
number. So:

- Stored numbers are shown as they are, gaps included.
- A founder whose only earlier session is an audit has no coaching history after the filter, so
  their first regular session gets no history block and behaves as a first session. They still get
  the audit block, because that is separate from history. A test covers this case.
- The PR states this handling.

**Prompt template in a secret.**

- Secret name: `MARCUS_CHAT_PROMPT_TEMPLATE`. The founder account sets it; no role changes.
- Content: the deployed prompt's wording, unchanged, with each interpolation replaced by a named
  placeholder: first name, product, stage, 90-day goal, goal progress, session history, and a new
  audit block placeholder directly after session history. The client receives the exact secret
  content privately and reviews the placeholder list as part of it.
- Rendering happens in **one pass**: a single scan of the template that swaps each known placeholder
  for its value. Values are inserted literally. The renderer never uses a replacement form that
  interprets `$` sequences, and inserted text is never scanned again. A value such as `$&`,
  `$1` or `{{product}}` comes out exactly as typed. An unknown placeholder in the template is a
  configuration error.
- A missing or blank secret makes the function fail with `500` and a log line naming the problem.
  There is no fallback prompt in code.
- The template is identical for every caller. The rendered prompt is not, so prompt caching is not
  added in this change.

**Hash parity.** The proof that the move changed nothing:

- Offline, before deploy: a private script, kept outside the repo, renders the prompt for a fixed
  set of founder shapes twice, once with the deployed code's logic and once with the new renderer and
  the real template. The shapes are: no goal, no past sessions, three past sessions with long
  summaries, quotes and unusual characters in the name, and `$&` / `{{product}}` in a field. Every
  pair must have the same SHA-256. Only hashes are recorded.
- In the repo: the same parity test runs against a **dummy template** that uses every placeholder,
  comparing the new renderer with a reference implementation of the deployed logic.
- Live: the function logs one line per call with the SHA-256 of the rendered system prompt and
  whether an audit block was included, never the text. Live QA compares that hash with the offline
  hash for the same QA request.

**Audit block.**

- Source: the caller's newest `pricing_audits` row by `completed_at`, read with the service-role
  client filtered to the authenticated user ID. Only `verdict_action`, `verdict_number`,
  `completed_at` and `verdict_deadline` are read. Never `verdict_reasoning` or `baseline`.
- No audit row: the block is an empty string, and the rendered prompt is byte-identical to today's.
- Number: shown as stored; null or blank renders as "no number".
- Completed date: the UTC date of `completed_at`.
- Act-by date: `verdict_deadline` as stored. It counts as **passed** when today's UTC date is after
  it (on the day itself it has not passed). Computed in code from the injected clock, never left to
  the model. A null deadline renders as "no act-by date".
- The block is data with a short plain label. **Proposed wording, pending client approval:**

  ```
  LATEST PRICING AUDIT (completed 2026-10-03):
  Verdict: raise
  Number: $49/month
  Act by: 2026-11-02 (passed)
  ```

  "(passed)" appears only when the date has passed. Adding any instruction telling Marcus how to use
  the block counts as a prompt change. That instruction is shown to the client verbatim first, and
  ships only once approved.
- A failed audit read logs an error line and the session continues without the block, so a
  database hiccup never blocks coaching. This mirrors the deployed history read, which treats a
  failed query as no history. That behaviour is preserved, and this spec does not change it.

**Repository contents.** The committed function contains no prompt text. Tests and fixtures use the
dummy template only. A runbook in the operations docs covers the secret, the deploy order, the hash
check and the rollback.

**Deploy order.**

1. The client receives the rollback copy privately (a private channel or one-time link, never plain
   email) and the exact secret content. Its SHA-256 is recorded in local notes.
2. The client sets `MARCUS_CHAT_PROMPT_TEMPLATE` while the old function is still live. The old
   function ignores it.
3. Right before deploying, confirm the live function is still deployment 20. If it has changed,
   stop and take a fresh copy.
4. Deploy (separately approved).
5. Live QA, then the hash comparison.

Rollback: redeploy the saved copy. The secret can stay.

## Testing Decisions

Good tests here check behaviour through the handler's public interface: the request in, and the
Anthropic request body and HTTP response out. Assertions are on the rendered system prompt and
messages, not on internal calls. Prior art: the `marcus-audit-chat` and `pricing-audit-eligibility`
handler tests, run under Node with fakes.

- **Audit block:** no audit (prompt equals the no-audit render), raise with a number, hold,
  restructure without a number, act-by date before, on and after today, a null deadline, and two
  audits (only the newest by `completed_at` is used), and a failed audit read (block omitted, error
  logged, reply still returned). The reasoning text never appears.
- **History:** an audit session with a summary is excluded; the audit-first founder gets no history
  block but does get the audit block; gaps in stored numbers are shown as stored.
- **Renderer:** single pass, literal `$&`, `$1`, `{{product}}` and quotes in values, every
  placeholder filled, an unknown placeholder rejected, `??` default semantics preserved.
- **Parity:** the dummy-template parity test across the founder shapes above.
- **Configuration:** missing and blank secret return 500 with a log line and make no Anthropic call.
- **Preserved behaviour:** 401 on a bad token, the opening-turn insertion, model and token settings
  unchanged.
- **Live QA** on a QA account (separately approved): a session with no audit and one with the QA
  account's existing audit, comparing logged hashes. Cleanup removes only rows the test created, by
  exact ID. Existing audit rows are never touched.

## Out of Scope

- Changing Marcus's prompt wording, model, token limits or coaching rules.
- Changing the `session_number` trigger or renumbering sessions.
- Showing audit data anywhere other than the regular-session prompt.
- The audit conversation itself (`marcus-audit-chat`) and the completion function.
- Any frontend change. The chat page's request and response contract stays the same.
- Hardening the function beyond what this spec names; other observations go to local notes.
- Prompt caching for regular sessions.

## Further Notes

- The proposed audit block wording above needs the client's explicit approval before
  implementation finishes. Any added usage instruction needs the same.
- The Pricing audit release flag is still off, so in production only the QA accounts have audit
  rows today. The block reaches real founders only as audits start.
- Deploying the function and setting the secret are production steps, each approved separately.
