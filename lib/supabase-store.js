'use strict';

function throwIf(error, context) {
  if (error) throw new Error(`${context}: ${error.message}`);
}

class SupabaseStore {
  constructor(services) {
    this.services = services;
    this.public = services.publicClient;
    this.admin = services.adminClient;
  }

  userClient(accessToken) {
    const client = this.services.createUserClient(accessToken);
    if (!client || !accessToken) throw new Error('user_session_required');
    return client;
  }

  async checkPublicConnection() {
    if (!this.public) return { ok: false, reason: 'missing_public_environment' };
    try {
      const response = await fetch(`${this.services.config.url}/auth/v1/settings`, {
        headers: { apikey: this.services.config.publishableKey }
      });
      return response.ok ? { ok: true } : { ok: false, reason: 'public_client_error' };
    } catch {
      return { ok: false, reason: 'public_client_error' };
    }
  }

  async checkAdminConnection() {
    if (!this.admin) return { ok: false, reason: 'missing_secret_environment' };
    const { error } = await this.admin.auth.admin.listUsers({ page: 1, perPage: 1 });
    return error ? { ok: false, reason: 'admin_client_error' } : { ok: true };
  }

  async loadState() {
    const [profilesResult, settingsResult, wallsResult, membersResult, notesResult] = await Promise.all([
      this.admin.from('muro_profiles').select('id,name,email,role,avatar,created_at'),
      this.admin.from('muro_user_settings').select('user_id,theme,confirm_delete,compact_notes,notifications'),
      this.admin.from('muro_walls').select('id,name,description,owner_id,created_at,updated_at'),
      this.admin.from('muro_wall_members').select('wall_id,user_id,role'),
      this.admin.from('muro_notes').select('id,wall_id,text,color,x,y,author_id,author_name,created_at,updated_at')
    ]);
    throwIf(profilesResult.error, 'profiles');
    throwIf(settingsResult.error, 'user_settings');
    throwIf(wallsResult.error, 'walls');
    throwIf(membersResult.error, 'wall_members');
    throwIf(notesResult.error, 'notes');

    const settings = new Map((settingsResult.data || []).map((row) => [row.user_id, row]));
    const users = (profilesResult.data || []).map((row) => {
      const preference = settings.get(row.id) || {};
      return {
        id: row.id,
        name: row.name,
        email: row.email,
        role: row.role,
        avatar: row.avatar || '',
        createdAt: Date.parse(row.created_at),
        settings: {
          theme: preference.theme || 'light',
          confirmDelete: preference.confirm_delete ?? true,
          compactNotes: preference.compact_notes ?? false,
          notifications: preference.notifications ?? true
        }
      };
    });
    const membersByWall = new Map();
    for (const row of membersResult.data || []) {
      if (!membersByWall.has(row.wall_id)) membersByWall.set(row.wall_id, {});
      membersByWall.get(row.wall_id)[row.user_id] = row.role;
    }
    const notesByWall = new Map();
    for (const row of notesResult.data || []) {
      if (!notesByWall.has(row.wall_id)) notesByWall.set(row.wall_id, []);
      notesByWall.get(row.wall_id).push({
        id: row.id,
        texto: row.text,
        color: row.color,
        x: Number(row.x),
        y: Number(row.y),
        autor: row.author_name,
        authorId: row.author_id,
        updatedAt: Date.parse(row.updated_at)
      });
    }
    const walls = (wallsResult.data || []).map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description || '',
      ownerId: row.owner_id,
      members: membersByWall.get(row.id) || {},
      notes: notesByWall.get(row.id) || [],
      createdAt: Date.parse(row.created_at),
      updatedAt: Date.parse(row.updated_at)
    }));
    return { users, walls };
  }

  async getUser(id) {
    const [profileResult, settingsResult] = await Promise.all([
      this.admin.from('muro_profiles').select('id,name,email,role,avatar,created_at').eq('id', id).single(),
      this.admin.from('muro_user_settings').select('theme,confirm_delete,compact_notes,notifications').eq('user_id', id).single()
    ]);
    throwIf(profileResult.error, 'profile');
    throwIf(settingsResult.error, 'settings');
    const profile = profileResult.data;
    const settings = settingsResult.data;
    return {
      id: profile.id,
      name: profile.name,
      email: profile.email,
      role: profile.role,
      avatar: profile.avatar || '',
      createdAt: Date.parse(profile.created_at),
      settings: {
        theme: settings.theme,
        confirmDelete: settings.confirm_delete,
        compactNotes: settings.compact_notes,
        notifications: settings.notifications
      }
    };
  }

  async register({ name, email, password }) {
    const { data: created, error: createError } = await this.admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name }
    });
    throwIf(createError, 'auth_register');
    try {
      const { data: login, error: loginError } = await this.public.auth.signInWithPassword({ email, password });
      throwIf(loginError, 'auth_login');
      return { token: login.session.access_token, user: await this.getUser(created.user.id) };
    } catch (error) {
      await this.admin.auth.admin.deleteUser(created.user.id);
      throw error;
    }
  }

  async login({ email, password }) {
    const { data, error } = await this.public.auth.signInWithPassword({ email, password });
    throwIf(error, 'auth_login');
    return { token: data.session.access_token, user: await this.getUser(data.user.id) };
  }

  async recover(email, redirectTo) {
    const { error } = await this.public.auth.resetPasswordForEmail(email, { redirectTo });
    throwIf(error, 'auth_recover');
  }

  async restore(token) {
    const client = this.services.createUserClient(token);
    const { data, error } = await client.auth.getUser(token);
    throwIf(error, 'auth_restore');
    return { token, user: await this.getUser(data.user.id) };
  }

  async changePassword(user, currentPassword, newPassword) {
    const { error: loginError } = await this.public.auth.signInWithPassword({ email: user.email, password: currentPassword });
    throwIf(loginError, 'current_password');
    const { error } = await this.admin.auth.admin.updateUserById(user.id, { password: newPassword });
    throwIf(error, 'password_update');
  }

  async deleteUser(id) {
    const { error } = await this.admin.auth.admin.deleteUser(id);
    throwIf(error, 'user_delete');
  }

  async saveProfile(user, accessToken) {
    const { error } = await this.userClient(accessToken).from('muro_profiles').update({ name: user.name, avatar: user.avatar, updated_at: new Date().toISOString() }).eq('id', user.id);
    throwIf(error, 'profile_update');
  }

  async saveSettings(user, accessToken) {
    const { error } = await this.userClient(accessToken).from('muro_user_settings').update({
      theme: user.settings.theme,
      confirm_delete: user.settings.confirmDelete,
      compact_notes: user.settings.compactNotes,
      notifications: user.settings.notifications,
      updated_at: new Date().toISOString()
    }).eq('user_id', user.id);
    throwIf(error, 'settings_update');
  }

  async saveWall(wall, accessToken) {
    const { error } = await this.userClient(accessToken).from('muro_walls').upsert({
      id: wall.id,
      name: wall.name,
      description: wall.description,
      owner_id: wall.ownerId,
      updated_at: new Date(wall.updatedAt).toISOString()
    });
    throwIf(error, 'wall_save');
  }

  async deleteWall(id, accessToken) {
    const { error } = await this.userClient(accessToken).from('muro_walls').delete().eq('id', id);
    throwIf(error, 'wall_delete');
  }

  async saveMember(wallId, userId, role, accessToken) {
    const { error } = await this.userClient(accessToken).from('muro_wall_members').upsert({ wall_id: wallId, user_id: userId, role });
    throwIf(error, 'member_save');
  }

  async deleteMember(wallId, userId, accessToken) {
    const { error } = await this.userClient(accessToken).from('muro_wall_members').delete().eq('wall_id', wallId).eq('user_id', userId);
    throwIf(error, 'member_delete');
  }

  async saveNote(wallId, note, accessToken) {
    const { error } = await this.userClient(accessToken).from('muro_notes').upsert({
      id: note.id,
      wall_id: wallId,
      text: note.texto,
      color: note.color,
      x: note.x,
      y: note.y,
      author_id: note.authorId || null,
      author_name: note.autor,
      updated_at: new Date(note.updatedAt).toISOString()
    });
    throwIf(error, 'note_save');
  }

  async deleteNote(id, accessToken) {
    const { error } = await this.userClient(accessToken).from('muro_notes').delete().eq('id', id);
    throwIf(error, 'note_delete');
  }

  async clearNotes(wallId) {
    const { error } = await this.admin.from('muro_notes').delete().eq('wall_id', wallId);
    throwIf(error, 'notes_clear');
  }

  async saveRole(user) {
    const { error } = await this.admin.from('muro_profiles').update({ role: user.role, updated_at: new Date().toISOString() }).eq('id', user.id);
    throwIf(error, 'role_update');
  }
}

module.exports = { SupabaseStore };
