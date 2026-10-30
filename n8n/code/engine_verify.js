// Verifikasi webhook dari Meta: balas hub.challenge jika verify token cocok
const q = $('Webhook IG Verify').first().json.query || {};
let expected = '';
for (const it of $('Baca Settings Verify').all()) if (it.json.key === 'verify_token') expected = it.json.value || '';
const ok = q['hub.mode'] === 'subscribe' && !!expected && q['hub.verify_token'] === expected;
return [{ json: { ok, body: ok ? String(q['hub.challenge'] || '') : 'verify token salah' } }];
