'use strict';

window.muroSupabaseReady = Promise.resolve(window.MURO_SUPABASE_CONFIG)
  .then((config) => {
    if (!config?.url || !config?.publishableKey || !window.supabase?.createClient) return null;
    window.muroSupabase = window.supabase.createClient(config.url, config.publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    return window.muroSupabase;
  })
  .catch(() => null);
