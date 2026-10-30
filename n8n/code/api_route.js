// Admin API panel: user dikenali dari cookie sesi (hasil login Instagram), semua data dibatasi ke akunnya sendiri.
const helpers = this.helpers;
const req = $('Webhook API').first().json;
const body = req.body || {};
const action = String(body.action || '');
const p = body.payload || {};

const settings = {};
for (const it of $('Baca Settings').all()) if (it.json.key) settings[it.json.key] = it.json.value ?? '';
const G = 'https://graph.instagram.com/' + (settings.graph_version || 'v23.0');

const session = $('Cari Sesi').first().json;
const sessionValid = !!(session && session.token && (!session.expires_at || new Date(session.expires_at) > new Date()));
const acc = sessionValid ? $('Baca Akun').all().map(i => i.json).find(a => String(a.ig_user_id) === String(session.ig_user_id)) : null;

const reply = (route, response, extra) => [{ json: Object.assign({ route, response, account_id: acc ? String(acc.ig_user_id) : '' }, extra || {}) }];
const fail = (error, status) => reply('direct', { ok: false, error }, { status: status || 400 });
const updateAccount = (fields, response) => reply('account_update', response, { fields: Object.assign({
  ig_user_id: acc.ig_user_id, username: acc.username, name: acc.name, avatar: acc.avatar, access_token: acc.access_token,
  token_expires_at: acc.token_expires_at || null, token_refresh_error: acc.token_refresh_error || '',
  ai_enabled: acc.ai_enabled !== false, ai_persona: acc.ai_persona || '',
}, fields) });

async function ig(method, path, qs) {
  try {
    const res = await helpers.httpRequest({
      method, url: path.startsWith('http') ? path : G + path, qs: Object.assign({}, qs || {}, { access_token: acc.access_token }),
      json: true, ignoreHttpStatusErrors: true, returnFullResponse: true, timeout: 20000,
    });
    const b = res.body || {};
    if (res.statusCode >= 400 || b.error) return { ok: false, error: (b.error && b.error.message) || ('HTTP ' + res.statusCode) };
    return { ok: true, body: b };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

const publicAccount = () => ({
  ig_user_id: String(acc.ig_user_id),
  username: acc.username || '',
  name: acc.name || '',
  avatar: acc.avatar || '',
  token_expires_at: acc.token_expires_at || '',
  token_refresh_error: acc.token_refresh_error || '',
  ai_enabled: acc.ai_enabled !== false,
  ai_persona: acc.ai_persona || '',
  connected_at: acc.connected_at || '',
});

if (!acc) return reply('deny', { ok: false, error: 'Silakan masuk dengan Instagram' });

switch (action) {
  case 'auth.me':
    return reply('direct', { ok: true, account: publicAccount() });

  case 'auth.logout':
    return reply('logout', { ok: true }, { token: session.token });

  case 'settings.save': {
    const fields = {};
    if (typeof p.ai_enabled === 'boolean') fields.ai_enabled = p.ai_enabled;
    if (typeof p.ai_persona === 'string') fields.ai_persona = p.ai_persona.trim().slice(0, 2000);
    if (!Object.keys(fields).length) return fail('Tidak ada yang diubah');
    return updateAccount(fields, { ok: true });
  }

  case 'ig.test': {
    const me = await ig('GET', '/me', { fields: 'user_id,username,name,profile_picture_url,followers_count,media_count' });
    if (!me.ok) return fail('Koneksi Instagram bermasalah: ' + me.error + '. Coba masuk ulang dengan Instagram.');
    const subs = await ig('GET', '/me/subscribed_apps');
    return updateAccount(
      { username: me.body.username || acc.username, name: me.body.name || acc.name, avatar: me.body.profile_picture_url || acc.avatar },
      { ok: true, profile: me.body, subscriptions: subs.ok ? subs.body.data || [] : null },
    );
  }

  case 'ig.media': {
    const r = await ig('GET', '/me/media', {
      fields: 'id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,comments_count,like_count',
      limit: Math.min(Number(p.limit) || 30, 50),
    });
    if (!r.ok) return fail(r.error);
    return reply('direct', { ok: true, media: r.body.data || [] });
  }

  case 'ig.subscribe': {
    const r = await ig('POST', '/me/subscribed_apps', { subscribed_fields: 'comments,messages,messaging_postbacks' });
    if (!r.ok) return fail(r.error);
    return reply('direct', { ok: true });
  }

  case 'rules.list':
    return reply('rules_list', null);

  case 'rules.save': {
    const r = p.rule || {};
    if (!String(r.name || '').trim()) return fail('Nama automasi wajib diisi');
    const channel = r.channel === 'dm' ? 'dm' : 'comment';
    const match = ['contains', 'exact', 'any'].includes(r.match_mode) ? r.match_mode : 'contains';
    if (match !== 'any' && !String(r.keywords || '').trim()) return fail('Isi minimal satu keyword, atau pilih "Semua"');
    return [{ json: {
      route: 'rules_save',
      account_id: String(acc.ig_user_id),
      row_id: Number(r.id) > 0 ? Number(r.id) : -1,
      name: String(r.name).trim().slice(0, 120),
      active: r.active !== false,
      channel,
      post_ids: String(r.post_ids || '*').trim() || '*',
      keywords: String(r.keywords || '').trim(),
      match_mode: match,
      comment_replies: String(r.comment_replies || '').trim(),
      dm_message: String(r.dm_message || '').trim(),
      dm_button_title: String(r.dm_button_title || '').trim().slice(0, 20),
      dm_content: String(r.dm_content || '').trim(),
      followup_enabled: !!r.followup_enabled,
      followup_delay_min: Math.max(1, Math.min(1380, Number(r.followup_delay_min) || 60)),
      followup_message: String(r.followup_message || '').trim(),
      ai_fallback: !!r.ai_fallback,
      ai_context: String(r.ai_context || '').trim(),
    } }];
  }

  case 'rules.delete':
    if (!(Number(p.id) > 0)) return fail('id tidak valid');
    return reply('rules_delete', null, { row_id: Number(p.id) });

  case 'events.list':
    return reply('events_list', null, { limit: Math.min(Number(p.limit) || 200, 500) });

  case 'followups.list':
    return reply('followups_list', null);

  case 'logs.clear':
    return reply('logs_clear', null);

  default:
    return fail('Aksi tidak dikenal: ' + action);
}
