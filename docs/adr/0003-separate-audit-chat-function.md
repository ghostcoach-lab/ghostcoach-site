# Audits use a separate chat function, not an audit mode in marcus-chat

The client deliverable says to connect the audit to "the existing Edge Function proxy". We add a new, versioned `marcus-audit-chat` Edge Function instead of adding an audit mode to the live `marcus-chat`. `marcus-chat` exists only in production, is unversioned, and serves every normal session, so changing it would put normal chat at risk. The new function keeps the same pattern: a server-held Anthropic key and a JWT-identified caller. It builds the audit system prompt on the server, injects the customer's two most recent prior audits, and enforces its own limits: an eligibility re-check on every call and stateless caps on message count and transcript length. A per-user rate limit is deferred.

The audit prompt is founder IP and this repository is public, so the prompt is read from a Supabase secret and never committed. The function fails closed when the secret is empty.
