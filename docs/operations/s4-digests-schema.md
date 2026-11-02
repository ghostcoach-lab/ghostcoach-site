# S4 digest records

The `public.digests` table was created in the dashboard and is not covered by a repository
migration. This note records the production schema inspected on 2026-11-02; it is documentation,
not a migration or a replacement for a fresh schema check before making changes.

| Column | Type | Nullable | Default |
| --- | --- | --- | --- |
| `id` | `uuid` | No | `gen_random_uuid()` |
| `user_id` | `uuid` | No | None |
| `sent_at` | `timestamp with time zone` | No | `now()` |
| `actions` | `jsonb` | No | None |
| `sessions_included` | `uuid[]` | No | Empty UUID array |
| `plan_at_send` | `public.plan_type` | No | None |
| `variant` | `text` | Yes | None |

`id` is the primary key. `user_id` references `public.users(id)` with `ON DELETE CASCADE`.
The `idx_digests_user_sent` index covers `(user_id, sent_at DESC)`. Row-level security is enabled.

S4 passes each user's `plan` through the loop and inserts it as `plan_at_send`. A missing plan
must remain visible as an insert failure rather than silently excluding that user.
