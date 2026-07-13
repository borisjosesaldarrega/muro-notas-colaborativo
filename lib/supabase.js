'use strict';

require('dotenv').config({ quiet: true });

const { createClient } = require('@supabase/supabase-js');

const browserSafeKeys = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'];
const privateKeys = ['SUPABASE_SECRET_KEY', 'SUPABASE_DB_PASSWORD', 'SUPABASE_ACCESS_TOKEN', 'DATABASE_URL'];

function readConfig(env = process.env) {
  return {
    url: String(env.NEXT_PUBLIC_SUPABASE_URL || '').trim(),
    publishableKey: String(env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '').trim(),
    secretKey: String(env.SUPABASE_SECRET_KEY || '').trim(),
    projectRef: String(env.SUPABASE_PROJECT_REF || '').trim()
  };
}

function clientOptions(accessToken = '') {
  const options = {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  };
  if (accessToken) options.global = { headers: { Authorization: `Bearer ${accessToken}` } };
  return options;
}

function createSupabaseServices(env = process.env) {
  const config = readConfig(env);
  const publicConfigured = Boolean(config.url && config.publishableKey);
  const adminConfigured = Boolean(publicConfigured && config.secretKey);
  const publicClient = publicConfigured ? createClient(config.url, config.publishableKey, clientOptions()) : null;
  const adminClient = adminConfigured ? createClient(config.url, config.secretKey, clientOptions()) : null;
  return {
    config,
    publicConfigured,
    adminConfigured,
    publicClient,
    adminClient,
    createUserClient(accessToken) {
      if (!publicConfigured) return null;
      return createClient(config.url, config.publishableKey, clientOptions(accessToken));
    },
    browserConfig() {
      return publicConfigured ? { url: config.url, publishableKey: config.publishableKey } : null;
    }
  };
}

function environmentStatus(env = process.env) {
  const missingPublic = browserSafeKeys.filter((key) => !String(env[key] || '').trim());
  const missingPrivate = privateKeys.filter((key) => !String(env[key] || '').trim());
  return { missingPublic, missingPrivate };
}

module.exports = { browserSafeKeys, createSupabaseServices, environmentStatus, privateKeys, readConfig };
