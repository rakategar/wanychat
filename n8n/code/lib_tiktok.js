// ---- lib_tiktok.js (disisipkan build.py lewat //#include) ----
// TikTok API for Business: Accounts API (akun TikTok yang mengizinkan Wanychat). Butuh `settings` + `helpers`.
// Token akses berlaku 24 jam, refresh token 1 tahun. Semua respons: { code: 0, message, data }.
const TT_API = 'https://business-api.tiktok.com/open_api/v1.3';
const TT_SCOPES = 'user.info.basic,user.info.username,user.info.stats,user.info.profile,user.account.type,user.insights,video.list,video.insights,comment.list,comment.list.manage';
// Izin posting diminta terpisah (tombol "Izinkan posting"): scope yang belum disetujui di app TikTok tidak memblokir koneksi biasa
const TT_PUBLISH_SCOPE = 'video.publish';
const ttReady = () => !!(settings.tiktok_app_id && settings.tiktok_secret);
const ttRedirect = () => String(settings.tiktok_redirect_url || (String(settings.public_url || '').replace(/\/$/, '') + '/webhook/wany-tiktok-login'));

async function ttCall(method, path, opts) {
  opts = opts || {};
  try {
    const res = await helpers.httpRequest({
      method, url: TT_API + path, qs: opts.qs, body: opts.body, json: true,
      headers: Object.assign({ 'content-type': 'application/json' }, opts.token ? { 'Access-Token': opts.token } : {}),
      ignoreHttpStatusErrors: true, returnFullResponse: true, timeout: 20000,
    });
    let b = res.body;
    if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = { message: b.slice(0, 200) }; } }
    b = b || {};
    if (res.statusCode >= 400 || Number(b.code) !== 0) {
      return { ok: false, code: Number(b.code) || res.statusCode, error: String(b.message || ('HTTP ' + res.statusCode)).slice(0, 300) };
    }
    return { ok: true, data: b.data || {} };
  } catch (err) {
    return { ok: false, code: -1, error: err.message };
  }
}
const ttAuthBody = (extra) => Object.assign({ client_id: settings.tiktok_app_id, client_secret: settings.tiktok_secret }, extra);
// Kolom token dari respons oauth2/token atau refresh_token
function ttTokenFields(d) {
  const now = Date.now();
  return {
    access_token: d.access_token,
    token_expires_at: new Date(now + (Number(d.expires_in) || 86400) * 1000).toISOString(),
    refresh_token: d.refresh_token || '',
    refresh_expires_at: new Date(now + (Number(d.refresh_token_expires_in) || 31536000) * 1000).toISOString(),
    token_refresh_error: '',
  };
}
const ttExchange = (code) => ttCall('POST', '/tt_user/oauth2/token/', { body: ttAuthBody({ grant_type: 'authorization_code', auth_code: code, redirect_uri: ttRedirect() }) });
const ttRefresh = (refreshToken) => ttCall('POST', '/tt_user/oauth2/refresh_token/', { body: ttAuthBody({ grant_type: 'refresh_token', refresh_token: refreshToken }) });
const ttRevoke = (token) => ttCall('POST', '/tt_user/oauth2/revoke/', { body: ttAuthBody({ access_token: token }) });

const TT_PROFILE_FIELDS = ['username', 'display_name', 'profile_image', 'followers_count', 'following_count', 'total_likes', 'videos_count', 'is_business_account'];
const ttProfile = (openId, token) => ttCall('GET', '/business/get/', { token, qs: { business_id: openId, fields: JSON.stringify(TT_PROFILE_FIELDS) } });
const ttVideos = (openId, token, cursor) => ttCall('GET', '/business/video/list/', { token, qs: Object.assign({
  business_id: openId, max_count: 20,
  fields: JSON.stringify(['item_id', 'create_time', 'thumbnail_url', 'share_url', 'caption', 'video_views', 'likes', 'comments', 'shares']),
}, cursor ? { cursor } : {}) });
const ttComments = (openId, token, videoId, cursor) => ttCall('GET', '/business/comment/list/', { token, qs: Object.assign({
  business_id: openId, video_id: videoId, max_count: 30, sort_field: 'create_time', sort_order: 'desc', status: 'ALL',
}, cursor ? { cursor } : {}) });
const ttReplyComment = (openId, token, videoId, commentId, text) => ttCall('POST', '/business/comment/reply/create/', { token, body: { business_id: openId, video_id: videoId, comment_id: commentId, text } });
const ttHide = (openId, token, videoId, commentId, hide) => ttCall('POST', '/business/comment/hide/', { token, body: { business_id: openId, video_id: videoId, comment_id: commentId, action: hide ? 'HIDE' : 'UNHIDE' } });

// Baris lengkap wany_tt_accounts (upsert menimpa semua kolom)
const TT_FIELDS = ['open_id', 'username', 'display_name', 'avatar', 'access_token', 'token_expires_at', 'refresh_token',
  'refresh_expires_at', 'token_refresh_error', 'owner_id', 'connected_at', 'scope'];
function ttRow(a, fields) {
  const r = {};
  for (const k of TT_FIELDS) r[k] = a && a[k] !== undefined && a[k] !== null ? a[k] : '';
  for (const k of ['token_expires_at', 'refresh_expires_at', 'connected_at']) r[k] = r[k] || null;
  return Object.assign(r, fields || {});
}
const ttPublic = (a) => ({
  open_id: String(a.open_id), username: a.username || '', display_name: a.display_name || '', avatar: a.avatar || '',
  connected_at: a.connected_at || '', token_refresh_error: a.token_refresh_error || '',
});
// ---- akhir lib_tiktok.js ----
