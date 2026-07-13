'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createSupabaseServices, environmentStatus } = require('../lib/supabase');

test('expone al navegador solo la configuración pública de Supabase', () => {
  const env = {
    NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'public-test-key',
    SUPABASE_SECRET_KEY: 'private-secret',
    SUPABASE_DB_PASSWORD: 'private-password',
    SUPABASE_ACCESS_TOKEN: 'private-token',
    DATABASE_URL: 'postgresql://private'
  };

  const services = createSupabaseServices(env);
  assert.deepEqual(services.browserConfig(), {
    url: env.NEXT_PUBLIC_SUPABASE_URL,
    publishableKey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  });
  assert.equal(JSON.stringify(services.browserConfig()).includes('private'), false);
  assert.deepEqual(environmentStatus(env), { missingPublic: [], missingPrivate: [] });
});
