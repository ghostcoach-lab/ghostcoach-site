// GhostCoach — Supabase client singleton
// Requires: config.js loaded before this file
// Uses the Supabase CDN build (added via <script> tag in HTML)

// Expose as window.gcSupabase to avoid conflict with the CDN's own 'supabase' global
window.gcSupabase = window.supabase.createClient(GC.SUPABASE_URL, GC.SUPABASE_ANON);
