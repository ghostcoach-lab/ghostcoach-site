# S3 text blocks and fallback wording — review only

The fixture contains the proposed parser code, not a claim that it is published.
Only Parse Summary Response and Parse Scoring Response change: join string-valued text blocks, skip other blocks, then retain the existing JSON parsing/scoring. Summary parse failure becomes "Session complete. | No summary was saved for this session." No retry is added. Opener-only handling is deferred.

## Where the wording appears

- S3 Build Recap Email splits the summary into bullets, so the fallback is emailed.
- js/pages/session-complete.js renders the stored summary as bullets.
- js/pages/account.js selects summary but does not render it; its continuity line uses action_committed.
- S4 Build Digest Prompt includes nonempty summaries from the three recent completed normal sessions within 30 days. The fallback can enter its input; digest output is model-generated, so verbatim display is not guaranteed.
- marcus-chat renderSessionHistory includes saved summaries in subsequent coaching context.

Existing stored summaries and already-sent emails are unchanged. No backfill is included.

## Later publication, requiring separate approval

1. Fetch a fresh private workflow snapshot. Use prepareS3TextBlocks from scripts/n8n/s3-text-blocks.mjs on the matching activeVersion, never the draft. It is an offline transformer and makes no network calls.
2. Compare the entire candidate with that published snapshot: only the two parser jsCode fields may differ. Preserve unrelated draft changes and private credentials. If the source parser has changed, review the diff before continuing.
3. Obtain approval for publishing that exact candidate. Back up the previous published version privately, publish, then read back the two nodes and verify all other nodes/connections/settings.
4. Any live test needs explicit authorization; use one test account, not a workflow rerun. Roll back by republishing the saved prior version if necessary. Publication does not repair old sessions.

S4 insertion order and opener-only handling remain deferred.
