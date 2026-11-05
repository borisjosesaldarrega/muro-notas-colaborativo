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

  async sessionResult(session, userId) {
    if (!session?.access_token || !userId) throw new Error('auth_session_invalid');
    return {
      token: session.access_token,
      refreshToken: session.refresh_token || '',
      expiresAt: Number(session.expires_at || 0) * 1000,
      user: await this.getUser(userId)
    };
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
      this.admin.from('muro_salas').select('id,nombre,descripcion,color,propietario_id,creado_en,actualizado_en'),
      this.admin.from('muro_sala_miembros').select('sala_id,usuario_id,rol'),
      this.admin.from('muro_notas').select('id,sala_id,titulo,contenido,color,posicion_x,posicion_y,autor_id,nombre_autor,editado_por_id,nombre_editor,creado_en,actualizado_en')
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
        editor: row.nombre_editor || '',
        editorId: row.editado_por_id || null,
        updatedAt: Date.parse(row.actualizado_en)
      });
    }
    const walls = (wallsResult.data || []).map((row) => ({
      id: row.id,
      name: row.nombre,
      description: row.descripcion || '',
      color: row.color || 'amarillo',
      ownerId: row.propietario_id,
      members: membersByWall.get(row.id) || {},
      notes: notesByWall.get(row.id) || [],
      createdAt: Date.parse(row.creado_en),
      updatedAt: Date.parse(row.actualizado_en)
    }));
    return { users, walls };
  }

  async ping() {
    const { error } = await this.admin.from('muro_usuarios').select('id', { head: true, count: 'exact' });
    throwIf(error, 'health_ping');
    return true;
  }

  async getUser(id) {
    const [profileResult, settingsResult, authResult] = await Promise.all([
      this.admin.from('muro_usuarios').select('id,nombre,correo,rol,avatar,creado_en').eq('id', id).single(),
      this.admin.from('muro_configuraciones_usuario').select('tema,confirmar_eliminacion,notas_compactas,notificaciones').eq('usuario_id', id).single(),
      this.admin.auth.admin.getUserById(id)
    ]);
    throwIf(profileResult.error, 'profile');
    throwIf(settingsResult.error, 'settings');
    throwIf(authResult.error, 'auth_user');
    const bannedUntil = authResult.data?.user?.banned_until;
    if (bannedUntil && Date.parse(bannedUntil) > Date.now()) throw new Error('account_suspended');
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

  async register({ name, email, password, redirectTo }) {
    const { data, error } = await this.public.auth.signUp({
      email,
      password,
      options: { data: { name }, emailRedirectTo: redirectTo }
    });
    throwIf(error, 'auth_register');
    if (data.session) {
      if (data.user?.id) await this.admin.auth.admin.deleteUser(data.user.id);
      throw new Error('auth_email_confirmation_disabled');
    }
    return { requiresConfirmation: true, email };
  }

  async verifySignup({ email, token }) {
    const { data, error } = await this.public.auth.verifyOtp({ email, token, type: 'email' });
    throwIf(error, 'auth_verify');
    if (!data.session || !data.user?.email_confirmed_at) throw new Error('auth_email_not_confirmed');
    return this.sessionResult(data.session, data.user.id);
  }

  async verifyRecovery({ email, token }) {
    const { data, error } = await this.public.auth.verifyOtp({ email, token, type: 'recovery' });
    throwIf(error, 'auth_recovery_verify');
    if (!data.session?.access_token || !data.user?.id) throw new Error('auth_recovery_invalid');
    return { token: data.session.access_token };
  }

  async completeRecovery(token, password) {
    const { data, error } = await this.public.auth.getUser(token);
    throwIf(error, 'auth_recovery_session');
    if (!data.user?.id) throw new Error('auth_recovery_invalid');
    const { error: updateError } = await this.admin.auth.admin.updateUserById(data.user.id, { password });
    throwIf(updateError, 'auth_recovery_password');
  }

  async resendSignup(email, redirectTo) {
    const { error } = await this.public.auth.resend({ type: 'signup', email, options: { emailRedirectTo: redirectTo } });
    throwIf(error, 'auth_resend');
  }

  async login({ email, password }) {
    const { data, error } = await this.public.auth.signInWithPassword({ email, password });
    throwIf(error, 'auth_login');
    return this.sessionResult(data.session, data.user.id);
  }

  async recover(email, redirectTo) {
    const { error } = await this.public.auth.resetPasswordForEmail(email, { redirectTo });
    throwIf(error, 'auth_recover');
  }

  async refreshSession(refreshToken) {
    if (!refreshToken) throw new Error('auth_refresh_missing');
    const { data, error } = await this.public.auth.refreshSession({ refresh_token: refreshToken });
    throwIf(error, 'auth_refresh');
    return this.sessionResult(data.session, data.user?.id);
  }

  async restore(token, refreshToken = '') {
    const { data, error } = await this.public.auth.getUser(token);
    if (error || !data.user?.id) return this.refreshSession(refreshToken);
    return {
      token,
      refreshToken,
      expiresAt: refreshToken ? Date.now() + 5 * 60 * 1000 : 0,
      user: await this.getUser(data.user.id)
    };
  }

  async changePassword(user, currentPassword, newPassword) {
    const { error: loginError } = await this.public.auth.signInWithPassword({ email: user.email, password: currentPassword });
    throwIf(loginError, 'current_password');
    const { error } = await this.admin.auth.admin.updateUserById(user.id, { password: newPassword });
    throwIf(error, 'password_update');
  }

  async changeEmail(user, currentPassword, newEmail) {
    const { error: loginError } = await this.public.auth.signInWithPassword({ email: user.email, password: currentPassword });
    throwIf(loginError, 'current_password');
    const { error } = await this.admin.auth.admin.updateUserById(user.id, { email: newEmail, email_confirm: true });
    throwIf(error, 'email_update');
    const { error: profileError } = await this.admin.from('muro_usuarios').update({ correo: newEmail, actualizado_en: new Date().toISOString() }).eq('id', user.id);
    throwIf(profileError, 'profile_email_update');
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
      color: wall.color || 'amarillo',
      propietario_id: wall.ownerId,
      actualizado_en: new Date(wall.updatedAt).toISOString()
    };
  }

  async createWall(wall, accessToken) {
    const { data, error } = await this.userClient(accessToken).rpc('muro_crear_sala', {
      nombre_nuevo: wall.name,
      descripcion_nueva: wall.description,
      color_nuevo: wall.color || 'amarillo'
    });
    throwIf(error, 'wall_create');
    return data;
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
    const { error } = await this.userClient(accessToken).rpc('muro_cambiar_permiso_miembro', {
      sala_objetivo: wallId, usuario_objetivo: userId, rol_nuevo: role
    });
    throwIf(error, 'member_update');
  }

  async deleteMember(wallId, userId, accessToken) {
    const { error } = await this.userClient(accessToken).rpc('muro_revocar_miembro', {
      sala_objetivo: wallId, usuario_objetivo: userId
    });
    throwIf(error, 'member_delete');
  }

  async createInvitation(invitation, accessToken) {
    const { data, error } = await this.userClient(accessToken).rpc('muro_crear_invitacion_codigo', {
      sala_objetivo: invitation.wallId, rol_objetivo: invitation.role,
      token_hash_nuevo: invitation.tokenHash, codigo_hash_nuevo: invitation.codeHash, codigo_visible_nuevo: invitation.code,
      vence_en_nuevo: new Date(invitation.expiresAt).toISOString()
    });
    throwIf(error, 'invitation_create'); return data;
  }

  async listInvitations(accessToken) {
    const { data, error } = await this.userClient(accessToken).rpc('muro_listar_invitaciones');
    throwIf(error, 'invitations_list'); return data || [];
  }

  async answerInvitation(secretHash, answer, accessToken) {
    const { data, error } = await this.userClient(accessToken).rpc('muro_responder_invitacion', { secreto_hash: secretHash, respuesta: answer });
    throwIf(error, 'invitation_answer'); return data;
  }

  async previewInvitation(secretHash, accessToken) {
    const { data, error } = await this.userClient(accessToken).rpc('muro_inspeccionar_invitacion', { secreto_hash: secretHash });
    throwIf(error, 'invitation_preview'); return data;
  }

  async cancelInvitation(id, accessToken) {
    const { error } = await this.userClient(accessToken).rpc('muro_cancelar_invitacion', { invitacion_objetivo: id });
    throwIf(error, 'invitation_cancel');
  }

  async resendInvitation(invitation, accessToken) {
    const { data, error } = await this.userClient(accessToken).rpc('muro_reenviar_invitacion', {
      invitacion_objetivo: invitation.id, token_hash_nuevo: invitation.tokenHash,
      codigo_hash_nuevo: invitation.codeHash, codigo_visible_nuevo: invitation.code,
      vence_en_nuevo: new Date(invitation.expiresAt).toISOString()
    });
    throwIf(error, 'invitation_resend'); return data;
  }

  async createReport(report, accessToken) {
    const { data, error } = await this.userClient(accessToken).rpc('muro_crear_reporte', {
      motivo_nuevo: report.reason, detalle_nuevo: report.detail,
      sala_objetivo: report.wallId || null, nota_objetivo: report.noteId || null
    });
    throwIf(error, 'report_create'); return data;
  }

  async listOwnReports(accessToken) {
    const { data, error } = await this.userClient(accessToken).rpc('muro_mis_reportes');
    throwIf(error, 'reports_list'); return data || [];
  }

  async listAdminReports(accessToken) {
    const { data, error } = await this.userClient(accessToken).rpc('muro_reportes_administracion');
    throwIf(error, 'admin_reports_list'); return data || [];
  }

  async reportUser(report, accessToken) {
    const { data, error } = await this.userClient(accessToken).rpc('muro_reportar_usuario', {
      usuario_objetivo: report.reportedUserId,
      sala_objetivo: report.wallId,
      motivo_nuevo: report.reason,
      detalle_nuevo: report.detail
    });
    throwIf(error, 'user_report_create'); return data;
  }

  async listAdminUsers() {
    const [profilesResult, authResult, sanctionsResult] = await Promise.all([
      this.admin.from('muro_usuarios').select('id,nombre,correo,rol,avatar,creado_en'),
      this.admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
      this.admin.from('muro_sanciones').select('usuario_id,tipo,mensaje,suspension_hasta,creado_en').order('creado_en', { ascending: false })
    ]);
    throwIf(profilesResult.error, 'admin_users');
    throwIf(authResult.error, 'admin_auth_users');
    throwIf(sanctionsResult.error, 'admin_sanctions');
    const authUsers = new Map((authResult.data?.users || []).map((user) => [user.id, user]));
    const sanctions = sanctionsResult.data || [];
    return (profilesResult.data || []).map((profile) => {
      const authUser = authUsers.get(profile.id);
      const userSanctions = sanctions.filter((item) => item.usuario_id === profile.id);
      const bannedUntil = authUser?.banned_until || null;
      return {
        id: profile.id,
        name: profile.nombre,
        email: profile.correo,
        role: profile.rol,
        avatar: profile.avatar || '',
        createdAt: Date.parse(profile.creado_en),
        status: bannedUntil && Date.parse(bannedUntil) > Date.now() ? 'suspendido' : 'activo',
        bannedUntil: bannedUntil ? Date.parse(bannedUntil) : null,
        sanctions: userSanctions.map((item) => ({
          type: item.tipo,
          message: item.mensaje,
          suspendedUntil: item.suspension_hasta ? Date.parse(item.suspension_hasta) : null,
          createdAt: Date.parse(item.creado_en)
        }))
      };
    });
  }

  async disciplineUser({ userId, reportId, action, message, adminId }) {
    const duration = action === 'suspender_24h' ? '24h' : action === 'suspender_7d' ? '168h' : null;
    const type = action === 'advertir' ? 'advertencia'
      : duration ? 'suspension'
        : action === 'reactivar' ? 'reactivacion' : 'eliminacion';
    const suspendedUntil = duration ? new Date(Date.now() + (action === 'suspender_24h' ? 24 : 168) * 60 * 60 * 1000).toISOString() : null;

    if (duration) {
      const { error } = await this.admin.auth.admin.updateUserById(userId, { ban_duration: duration });
      throwIf(error, 'user_suspend');
    } else if (action === 'reactivar') {
      const { error } = await this.admin.auth.admin.updateUserById(userId, { ban_duration: 'none' });
      throwIf(error, 'user_reactivate');
    }

    const { error: sanctionError } = await this.admin.from('muro_sanciones').insert({
      usuario_id: userId,
      reporte_id: reportId || null,
      tipo: type,
      mensaje: message,
      suspension_hasta: suspendedUntil,
      creado_por: adminId
    });
    throwIf(sanctionError, 'sanction_create');

    if (action === 'eliminar') {
      const { error } = await this.admin.auth.admin.deleteUser(userId);
      throwIf(error, 'user_delete');
    }
    return { type, suspendedUntil: suspendedUntil ? Date.parse(suspendedUntil) : null };
  }

  async takeReport(id, accessToken) {
    const { error } = await this.userClient(accessToken).rpc('muro_tomar_reporte', { reporte_objetivo: id });
    throwIf(error, 'report_take');
  }

  async answerReport(id, status, answer, accessToken) {
    const { data, error } = await this.userClient(accessToken).rpc('muro_responder_reporte', { reporte_objetivo: id, estado_nuevo: status, respuesta_nueva: answer });
    throwIf(error, 'report_answer'); return data;
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
    const row = {
      titulo: note.titulo || note.texto.slice(0, 80),
      contenido: note.texto,
      color: note.color,
      posicion_x: note.x,
      posicion_y: note.y,
      actualizado_en: new Date(note.updatedAt).toISOString()
    };
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
