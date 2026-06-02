// GhostCoach — Authentication helpers
// Requires: config.js, supabase-client.js

const GCAuth = {

  // Sign up with email + password.
  // Supabase sends a confirmation email. User must click before they can log in.
  async signUp(email, password, plan) {
    const { data, error } = await gcSupabase.auth.signUp({
      email,
      password,
      options: {
        // Redirect here after clicking the confirmation link in the email
        emailRedirectTo: window.location.origin + '/payment/',
        // Record the chosen plan on the account — read later by onboarding + n8n S1
        data: { plan: plan || 'builder' }
      }
    });
    if (error) throw error;
    return data;
  },

  // Sign in with email + password
  async signIn(email, password) {
    const { data, error } = await gcSupabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  },

  // Sign in with magic link (passwordless)
  async signInWithMagicLink(email) {
    const { error } = await gcSupabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin + '/payment/' }
    });
    if (error) throw error;
  },

  // Send a password-reset email. Supabase emails a recovery link that
  // brings the user to /reset-password/ where they can set a new password.
  async resetPassword(email) {
    const { error } = await gcSupabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + '/reset-password/'
    });
    if (error) throw error;
  },

  // Update the current user's password. Called from /reset-password/ after
  // the recovery link has established a session.
  async updatePassword(newPassword) {
    const { error } = await gcSupabase.auth.updateUser({ password: newPassword });
    if (error) throw error;
  },

  // Sign out
  async signOut() {
    const { error } = await gcSupabase.auth.signOut();
    if (error) throw error;
    window.location.href = '/';
  },

  // Get current session (null if not logged in)
  async getSession() {
    const { data: { session } } = await gcSupabase.auth.getSession();
    return session;
  },

  // Get current user (null if not logged in)
  async getUser() {
    const { data: { user } } = await gcSupabase.auth.getUser();
    return user;
  },

  // Redirect to login if not authenticated. Call at top of protected pages.
  async requireAuth(redirectTo = '/login/') {
    const session = await this.getSession();
    if (!session) {
      window.location.href = redirectTo;
      return null;
    }
    return session;
  },

  // Redirect to dashboard if already logged in. Call on login/signup pages.
  async redirectIfLoggedIn(redirectTo = '/payment/') {
    const session = await this.getSession();
    if (session) window.location.href = redirectTo;
  },

  // Listen for auth state changes (login, logout, token refresh)
  onAuthChange(callback) {
    gcSupabase.auth.onAuthStateChange((event, session) => {
      callback(event, session);
    });
  },

  // Get the access token for authenticated API calls
  async getToken() {
    const session = await this.getSession();
    return session?.access_token ?? null;
  }
};
