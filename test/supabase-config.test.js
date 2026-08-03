'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createSupabaseServices, environmentStatus } = require('../lib/supabase');
const { SupabaseStore } = require('../lib/supabase-store');

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

test('separa INSERT y UPDATE para respetar las politicas RLS', async () => {
  const calls = [];
  const result = { error: null };
  const chain = {
    eq(column, value) {
      calls.push({ operation: 'eq', column, value });
      return chain;
    },
    then(resolve, reject) {
      return Promise.resolve(result).then(resolve, reject);
    }
  };
  const client = {
    from(table) {
      return {
        insert(row) {
          calls.push({ operation: 'insert', table, row });
          return Promise.resolve(result);
        },
        update(row) {
          calls.push({ operation: 'update', table, row });
          return chain;
        }
      };
    }
  };
  const store = new SupabaseStore({ createUserClient: () => client });
  const wall = { id: 'wall-1', name: 'Ideas', description: '', ownerId: 'user-1', updatedAt: Date.now() };

  await store.createWall(wall, 'user-token');
  await store.updateWall({ ...wall, name: 'Ideas actualizadas' }, 'user-token');

  assert.equal(calls[0].operation, 'insert');
  assert.equal(calls[0].table, 'muro_walls');
  assert.equal(calls[1].operation, 'update');
  assert.equal(calls[1].row.owner_id, undefined);
  assert.deepEqual(calls[2], { operation: 'eq', column: 'id', value: 'wall-1' });
});
