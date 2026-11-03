# Marcus text-block handling — rollout proposal

Review only. No deployment is authorized by this PR.

The shared readTextBlocks helper extracts string-valued text blocks in order and skips others. The audit readTextReply helper delegates extraction to it and retains its stop-reason validation and trimming. Marcus uses the extraction helper directly: adopting the entire audit validator would additionally reject max_tokens responses, which is outside this change. Marcus retains its fallback when no text is available. Empty extracted text also uses that fallback; whitespace and nonempty incomplete replies remain unchanged.

## Approval window and deployment procedure

1. After review/merge, agree an explicit deployment window with Arjan for marcus-chat only. Re-read deployed source/version and current main, including the separately reviewed key-selection PR #76. Merge alone is not deployment approval.
2. Compare the exact deployable bundle against production. The last inspected live version was v33 with a single index.ts implementation, while the repo uses entry/handler modules and a prompt-template configuration. Do not blindly deploy main: reconcile those differences first. For a narrowly scoped rollout, prepare a private bundle based on the then-current live source, import the shared extractor, and replace only its first-block reply read. Keep the existing prompt, keys, auth, model, token budget and dependencies unchanged; do not put the private prompt in Git. Present the complete sanitized diff and bundle identity for approval. If a repo-based rollout is preferred, every additional difference/config prerequisite needs separate review.
3. Run Marcus handler regressions, audit helper consumer tests, and Deno checks on the exact candidate. Preserve a private rollback bundle and JWT verification setting.
4. During the approved window deploy only the approved marcus-chat bundle. Read back and compare it. Run one agreed authenticated test-account message and verify a normal reply, auth rejection and error rates; no S3 workflow reruns. Synthetic thinking/no-text cases are exercised offline, not by changing production model settings.
5. If errors or fallback rates regress, restore the previous exact bundle and settings, verify readback, and report the result. No database migration or data backfill is involved.

Arjan must approve the window and exact rollout before deployment.
