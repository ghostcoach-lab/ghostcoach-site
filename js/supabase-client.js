// GhostCoach — Supabase client singleton
// Requires: config.js loaded before this file
// Uses the Supabase CDN build (added via <script> tag in HTML)

const supabase = window.supabase.createClient(GC.SUPABASE_URL, GC.SUPABASE_ANON);
