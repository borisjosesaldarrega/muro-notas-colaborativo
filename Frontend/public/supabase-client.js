'use strict';

window.muroSupabaseReady = fetch('/api/supabase/config', { credentials: 'same-origin' })
  .then(async (response) => {
    if (!response.ok) return null;
    const config = await response.json();
    if (!config?.url || !config?.publishableKey || !window.supabase?.createClient) return null;
    window.muroSupabase = window.supabase.createClient(config.url, config.publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    return window.muroSupabase;
  })
  .catch(() => null);
