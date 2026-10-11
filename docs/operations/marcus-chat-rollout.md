# marcus-chat rollout

> **DRAFT for review (ticket #42).** Nothing here has been run. It takes the versioned
> `marcus-chat` (#40, PR #49) and the latest Pricing audit block (#41, PR #52) live.

`marcus-chat` serves every normal Marcus session. The deployed version builds its prompt from text
in its own code. The versioned one reads the same wording from the `MARCUS_CHAT_PROMPT_TEMPLATE`
secret, and adds a short data block with the founder's latest Pricing audit. Behaviour is in the
spec on #38.

0. [Private preparation](#0-private-preparation) (no production change)
1. [The client sets the secret](#1-the-client-sets-the-secret)
2. [Pre-deploy check](#2-pre-deploy-check) (read-only)
3. [Deploy `marcus-chat`](#3-deploy-marcus-chat)
4. [Live QA](#4-live-qa)
5. [The client's check in a regular session](#5-the-clients-check-in-a-regular-session)

## Rules for every step

- **One approval per step.** Steps 1, 3 and 4 change production, and each needs an approval that
  names it. An approval for one step does not cover the next.
- **The client opens the window.** Steps 1 to 4 wait until the client says the production window is
  clear.
- **Every customer is affected at once.** The deploy changes the prompt path of every normal
  session, and the Pricing audit is live, so any founder with a completed audit gets the block
  straight away. Deploy in a quiet window. Avoid 07:00 `Europe/Amsterdam` (S13's daily run) and
  Monday 07:00.
- **Stop on a failed check.** Roll back that step and do not continue.
- **The prompt is never printed.** The real template, the rendered prompt and the deployed source
  never go into the repo, an issue, a PR, a log you share or chat output. Only SHA-256 hashes are
  recorded.
- **Secrets and evidence.** The rollback copy, the template, keys, JWTs and production IDs stay in
  `%LOCALAPPDATA%\GhostCoach\private-backups\`. Evidence (hashes, versions, row counts) goes in a
  dated local QA document, not in a GitHub issue.

Tools: Supabase CLI `2.117.0` (`npx -y supabase@2.117.0 …`), Node 22, PowerShell. The project ref
is `<project ref>`.

## Before you start

- #49 and #52 are merged to `main`, and the reviewed commit is checked out. Record its SHA.
- The CI is Netlify only. Run the tests locally on this exact commit:

  ```powershell
  node --experimental-strip-types --test tests/functions/*.test.ts
  npx -y deno check supabase/functions/marcus-chat/index.ts
  ```

- `supabase/config.toml` has `verify_jwt = false` for `marcus-chat`. That is the live setting, kept
  as it is: the function checks the caller's token itself and answers `401 {"error":"Unauthorised"}`.

## 0. Private preparation

No production change. Everything here stays in the private folder.

- **Rollback copy.** The deployed source, saved privately, with its SHA-256 in local notes.
- **Secret content.** The deployed prompt's wording, unchanged, with each interpolation replaced by
  its placeholder: `{{first_name}}`, `{{product}}`, `{{stage}}`, `{{goal_90_day}}`,
  `{{goal_progress}}`, `{{session_history}}`, and `{{audit_block}}` directly after
  `{{session_history}}`. Record its SHA-256.
- **Offline parity.** A private script, kept outside the repo, renders the prompt for each founder
  shape twice: with the deployed code's logic, and with the repo's renderer and the secret content.
  Shapes: no goal, no past sessions, three past sessions with long summaries, quotes and unusual
  characters in the name, and `$&` / `{{product}}` in a field. With no audit, every pair must have
  the same SHA-256. Record only the hashes.
- **To the client, privately** (a private channel or a one-time link, never plain email): the
  rollback copy and the exact secret content, with both SHA-256 hashes. The client reviews the
  placeholder list.

## 1. The client sets the secret

The client's account sets `MARCUS_CHAT_PROMPT_TEMPLATE` to the exact secret content. The deployed
function ignores it, so nothing changes for customers.

**Verification** (read-only)

- `npx -y supabase@2.117.0 secrets list --project-ref <project ref>` lists the name. Never print
  its value.
- The client confirms the SHA-256 of what was pasted matches the recorded hash.

**Rollback:** unset the secret. The deployed function does not read it.

## 2. Pre-deploy check

Read-only. Right before step 3.

- `functions list` shows `marcus-chat` at the recorded deployment, with JWT verification off.
- Download the live source **into a scratch folder outside the repo** (the download writes
  `supabase/functions/marcus-chat/` under the current folder, which would overwrite the repo's
  files). Its SHA-256 must match the rollback copy. If it differs, stop: someone changed the live
  function, and a fresh rollback copy and parity run are needed.
- The function's recent logs show successful calls, so its keys are valid. (Opening the chat page to
  check would insert a pending `sessions` row, so read the logs instead.)
- Record the time, the version and the hash in the dated QA document.

## 3. Deploy `marcus-chat`

**Pre-check**

- Steps 1 and 2 passed. The tests and the Deno check pass on the recorded commit.
- The window is quiet and the client has approved this step.

**Change**

```powershell
npx -y supabase@2.117.0 functions deploy marcus-chat --project-ref <project ref>
```

**Verification**

- `functions list` shows a new version, active, JWT verification still off.
- A `POST` with no `Authorization` header gets `401 {"error":"Unauthorised"}`.
- The function logs show no `marcus-chat: configuration` line. That line means the secret is
  missing or blank, and every session would get `500`: roll back at once.
- For 15 minutes, watch the logs for `500`s and `marcus-chat: audit` errors. Each normal call logs
  one `marcus-chat: prompt` line with a hash and an `audit_block` flag, and never the prompt text.
- `marcus-audit-chat`, `pricing-audit-complete` and `pricing-audit-eligibility` have the same
  versions as before.

**Rollback**

Redeploy the rollback copy from a scratch folder outside the repo, with JWT verification off as it
was live:

```powershell
npx -y supabase@2.117.0 functions deploy marcus-chat --project-ref <project ref> --no-verify-jwt
```

Then confirm that `functions list` shows the new version, and that the downloaded source hashes to
the rollback copy. The secret can stay.

## 4. Live QA

Proves on production that the deployed renderer matches the offline render, with and without an
audit. `marcus-chat` writes no rows. It only reads history and the latest audit, so the run leaves
no data behind beyond the QA sign-ins, which it signs out.

**Pre-check** (read-only)

- Pick a QA account with no `pricing_audits` row, and a QA account with an existing audit. If no QA
  account has an audit, stop: creating one is a separate approved step.
- Record, for both accounts, the counts and md5 hashes of their `sessions` and `pricing_audits` rows
  and their `users` row.

**Run**

For each account: sign in, then call `marcus-chat` once with a fixed body (`messages: []`, a fixed
QA `profile`, a new `session_id`). Each call costs one AI reply. Sign out.

Then, privately, render the same request offline with the repo's renderer and the secret content,
using the account's current history and audit.

**Verification**

- Each call returns `200` with a reply.
- The logged `marcus-chat: prompt` hash equals the offline hash for that request.
- `audit_block` is `false` for the account with no audit, and `true` for the account with an audit.
- The account with no audit has the same hash as the deployed code's render of the same request
  (the parity script), so the prompt without an audit is byte-identical to before.
- The before and after counts and hashes match. No existing audit row changed.

**Rollback:** roll back step 3 if a hash or a flag is wrong.

## 5. The client's check in a regular session

The client opens a regular Marcus session on an account with a completed audit and asks about it
(for example, "what did my audit say?"). This decides whether Marcus needs an instruction on how to
use the block. Any such instruction is a prompt change: its exact wording goes to the client first
and ships only once approved, as a new secret value. No code change is needed.

## Session numbers

The `session_number` trigger is not changed. Stored numbers are shown as they are, gaps included.
History excludes audit sessions by `is_pricing_audit`, so a founder whose only earlier session is an
audit gets no history block. Their first regular session behaves as a first session, but they still
get the audit block.
