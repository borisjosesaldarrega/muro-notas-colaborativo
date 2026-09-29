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
      this.admin.from('muro_usuarios').select('id,nombre,correo,rol,avatar,creado_en'),
      this.admin.from('muro_configuraciones_usuario').select('usuario_id,tema,confirmar_eliminacion,notas_compactas,notificaciones'),
      this.admin.from('muro_salas').select('id,nombre,descripcion,propietario_id,creado_en,actualizado_en'),
      this.admin.from('muro_sala_miembros').select('sala_id,usuario_id,rol'),
      this.admin.from('muro_notas').select('id,sala_id,titulo,contenido,color,posicion_x,posicion_y,autor_id,nombre_autor,creado_en,actualizado_en')
    ]);
    throwIf(profilesResult.error, 'profiles');
    throwIf(settingsResult.error, 'user_settings');
    throwIf(wallsResult.error, 'walls');
    throwIf(membersResult.error, 'wall_members');
    throwIf(notesResult.error, 'notes');

    const settings = new Map((settingsResult.data || []).map((row) => [row.usuario_id, row]));
    const users = (profilesResult.data || []).map((row) => {
      const preference = settings.get(row.id) || {};
      return {
        id: row.id,
        titulo: row.titulo,
        name: row.nombre,
        email: row.correo,
        role: row.rol,
        avatar: row.avatar || '',
        createdAt: Date.parse(row.creado_en),
        settings: {
          theme: preference.tema || 'light',
          confirmDelete: preference.confirmar_eliminacion ?? true,
          compactNotes: preference.notas_compactas ?? false,
          notifications: preference.notificaciones ?? true
        }
      };
    });
    const membersByWall = new Map();
    for (const row of membersResult.data || []) {
      if (!membersByWall.has(row.sala_id)) membersByWall.set(row.sala_id, {});
      membersByWall.get(row.sala_id)[row.usuario_id] = row.rol;
    }
    const notesByWall = new Map();
    for (const row of notesResult.data || []) {
      if (!notesByWall.has(row.sala_id)) notesByWall.set(row.sala_id, []);
      notesByWall.get(row.sala_id).push({
        id: row.id,
        texto: row.contenido,
        color: row.color,
        x: Number(row.posicion_x),
        y: Number(row.posicion_y),
        autor: row.nombre_autor,
        authorId: row.autor_id,
        updatedAt: Date.parse(row.actualizado_en)
      });
    }
    const walls = (wallsResult.data || []).map((row) => ({
      id: row.id,
      name: row.nombre,
      description: row.descripcion || '',
      ownerId: row.propietario_id,
      members: membersByWall.get(row.id) || {},
      notes: notesByWall.get(row.id) || [],
      createdAt: Date.parse(row.creado_en),
      updatedAt: Date.parse(row.actualizado_en)
    }));
    return { users, walls };
  }

  async getUser(id) {
    const [profileResult, settingsResult] = await Promise.all([
      this.admin.from('muro_usuarios').select('id,nombre,correo,rol,avatar,creado_en').eq('id', id).single(),
      this.admin.from('muro_configuraciones_usuario').select('tema,confirmar_eliminacion,notas_compactas,notificaciones').eq('usuario_id', id).single()
    ]);
    throwIf(profileResult.error, 'profile');
    throwIf(settingsResult.error, 'settings');
    const profile = profileResult.data;
    const settings = settingsResult.data;
    return {
      id: profile.id,
      name: profile.nombre,
      email: profile.correo,
      role: profile.rol,
      avatar: profile.avatar || '',
      createdAt: Date.parse(profile.creado_en),
      settings: {
        theme: settings.tema,
        confirmDelete: settings.confirmar_eliminacion,
        compactNotes: settings.notas_compactas,
        notifications: settings.notificaciones
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
    const { data, error } = await this.public.auth.getUser(token);
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
    const { error } = await this.userClient(accessToken).from('muro_usuarios').update({ nombre: user.name, avatar: user.avatar, actualizado_en: new Date().toISOString() }).eq('id', user.id);
    throwIf(error, 'profile_update');
  }

  async saveSettings(user, accessToken) {
    const { error } = await this.userClient(accessToken).from('muro_configuraciones_usuario').update({
      tema: user.settings.theme,
      confirmar_eliminacion: user.settings.confirmDelete,
      notas_compactas: user.settings.compactNotes,
      notificaciones: user.settings.notifications,
      actualizado_en: new Date().toISOString()
    }).eq('usuario_id', user.id);
    throwIf(error, 'settings_update');
  }

  wallRow(wall) {
    return {
      id: wall.id,
      nombre: wall.name,
      descripcion: wall.description,
      propietario_id: wall.ownerId,
      actualizado_en: new Date(wall.updatedAt).toISOString()
    };
  }

  async createWall(wall, accessToken) {
    const { error } = await this.userClient(accessToken).from('muro_salas').insert(this.wallRow(wall));
    throwIf(error, 'wall_create');
  }

  async updateWall(wall, accessToken) {
    const row = this.wallRow(wall);
    delete row.id;
    delete row.propietario_id;
    const { error } = await this.userClient(accessToken).from('muro_salas').update(row).eq('id', wall.id);
    throwIf(error, 'wall_save');
  }

  async deleteWall(id, accessToken) {
    const { error } = await this.userClient(accessToken).from('muro_salas').delete().eq('id', id);
    throwIf(error, 'wall_delete');
  }

  async createMember(wallId, userId, role, accessToken) {
    const { error } = await this.userClient(accessToken).from('muro_sala_miembros').insert({ sala_id: wallId, usuario_id: userId, rol: role });
    throwIf(error, 'member_save');
  }

  async updateMember(wallId, userId, role, accessToken) {
    const { error } = await this.userClient(accessToken).from('muro_sala_miembros').update({ rol: role }).eq('sala_id', wallId).eq('usuario_id', userId);
    throwIf(error, 'member_update');
  }

  async deleteMember(wallId, userId, accessToken) {
    const { error } = await this.userClient(accessToken).from('muro_sala_miembros').delete().eq('sala_id', wallId).eq('usuario_id', userId);
    throwIf(error, 'member_delete');
  }

  noteRow(wallId, note) {
    return {
      id: note.id,
      sala_id: wallId,
      titulo: note.titulo || note.texto.slice(0, 80),
      contenido: note.texto,
      color: note.color,
      posicion_x: note.x,
      posicion_y: note.y,
      autor_id: note.authorId || null,
      nombre_autor: note.autor,
      actualizado_en: new Date(note.updatedAt).toISOString()
    };
  }

  async createNote(wallId, note, accessToken) {
    const { error } = await this.userClient(accessToken).from('muro_notas').insert(this.noteRow(wallId, note));
    throwIf(error, 'note_create');
  }

  async updateNote(wallId, note, accessToken) {
    const row = this.noteRow(wallId, note);
    delete row.id;
    delete row.sala_id;
    delete row.autor_id;
    const { error } = await this.userClient(accessToken).from('muro_notas').update(row).eq('id', note.id).eq('sala_id', wallId);
    throwIf(error, 'note_save');
  }

  async deleteNote(id, accessToken) {
    const { error } = await this.userClient(accessToken).from('muro_notas').delete().eq('id', id);
    throwIf(error, 'note_delete');
  }

  async clearNotes(wallId) {
    const { error } = await this.admin.from('muro_notas').delete().eq('sala_id', wallId);
    throwIf(error, 'notes_clear');
  }

  async saveRole(user) {
    const { error } = await this.admin.from('muro_usuarios').update({ rol: user.role, actualizado_en: new Date().toISOString() }).eq('id', user.id);
    throwIf(error, 'role_update');
  }
}

module.exports = { SupabaseStore };
