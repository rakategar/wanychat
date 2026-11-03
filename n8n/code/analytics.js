// Analitik lead (paket Bisnis): dihitung dari log events akun ini dalam rentang 7/30/90 hari terakhir.
// Lead = orang yang menunjukkan minat: komentar cocok keyword, menekan tombol DM, atau mengirim DM.
const days = Number($('Proses Permintaan').first().json.days) || 30;
const now = Date.now();
const since = now - days * 86400000;
const WIB = 7 * 3600 * 1000;
const dayKey = (t) => new Date(t + WIB).toISOString().slice(0, 10);

const events = $input.all().map(i => i.json)
  .filter(e => e && e.id && e.type && new Date(e.createdAt).getTime() >= since)
  .map(e => Object.assign({}, e, { t: new Date(e.createdAt).getTime() }))
  .sort((a, b) => a.t - b.t);

const ok = (e) => e.status === 'ok' || !e.status;
const SCORE = { comment_in: 1, private_reply: 2, dm_in: 2, button_tap: 3 };

// Tombol DM tidak membawa media_id: kaitkan ke postingan dari private reply terakhir ke orang yang sama
const lastMedia = {};
const posts = {};
const rules = {};
const leads = {};
const daily = {};
const hours = Array.from({ length: 7 }, () => Array(24).fill(0));
const words = {};
const STOP = new Set('yang dan di ke dari ini itu aku saya kak ka ya ga gak nggak mau bisa ada untuk dong deh sih nih kok juga udah sudah apa berapa gimana min admin the and you'.split(' '));
const totals = { comments: 0, matched: 0, dms: 0, taps: 0, followups: 0, ai: 0, dm_in: 0, errors: 0, quota: 0 };

const post = (id) => (posts[id] = posts[id] || { media_id: id, comments: 0, commenters: new Set(), matched: 0, dms: 0, taps: 0, ai: 0, leads: new Set() });
const rule = (e) => (rules[e.rule_id] = rules[e.rule_id] || { rule_id: e.rule_id, name: e.rule_name || '', matched: 0, dms: 0, taps: 0, followups: 0, ai: 0 });
const day = (t) => (daily[dayKey(t)] = daily[dayKey(t)] || { comments: 0, leads: new Set(), dms: 0, taps: 0 });
function lead(e, media) {
  if (!e.ig_user_id) return;
  const l = leads[e.ig_user_id] = leads[e.ig_user_id] || { ig_user_id: e.ig_user_id, username: '', score: 0, comments: 0, taps: 0, dms_in: 0, posts: new Set(), first_at: e.t, last_at: e.t, last_text: '' };
  if (e.username) l.username = e.username;
  l.score += SCORE[e.type] || 0;
  l.last_at = Math.max(l.last_at, e.t);
  if (media) l.posts.add(media);
  if (e.type === 'comment_in' || e.type === 'dm_in') l.last_text = String(e.text || '').slice(0, 140);
}

for (const e of events) {
  if (e.status === 'error') totals.errors++;
  switch (e.type) {
    case 'comment_in': {
      totals.comments++;
      const p = post(e.media_id || 'unknown');
      p.comments++; p.commenters.add(e.ig_user_id);
      day(e.t).comments++;
      const d = new Date(e.t + WIB);
      hours[d.getUTCDay()][d.getUTCHours()]++;
      for (const w of String(e.text || '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/)) {
        if (w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w)) words[w] = (words[w] || 0) + 1;
      }
      lead(e, e.media_id);
      leads[e.ig_user_id] && leads[e.ig_user_id].comments++;
      break;
    }
    case 'private_reply': {
      // Komentar cocok automasi -> DM pertama (lead)
      totals.matched++;
      const p = post(e.media_id || 'unknown');
      p.matched++;
      const r = rule(e); r.matched++;
      if (ok(e)) { totals.dms++; p.dms++; r.dms++; day(e.t).dms++; }
      p.leads.add(e.ig_user_id);
      lastMedia[e.ig_user_id] = e.media_id;
      day(e.t).leads.add(e.ig_user_id);
      lead(e, e.media_id);
      if (leads[e.ig_user_id]) leads[e.ig_user_id].matched = true;
      break;
    }
    case 'button_tap': {
      totals.taps++;
      const media = lastMedia[e.ig_user_id];
      if (media) { post(media).taps++; post(media).leads.add(e.ig_user_id); }
      if (e.rule_id) rule(e).taps++;
      day(e.t).taps++;
      day(e.t).leads.add(e.ig_user_id);
      lead(e, media);
      leads[e.ig_user_id] && leads[e.ig_user_id].taps++;
      break;
    }
    case 'dm_in':
      totals.dm_in++;
      day(e.t).leads.add(e.ig_user_id);
      lead(e, lastMedia[e.ig_user_id]);
      leads[e.ig_user_id] && leads[e.ig_user_id].dms_in++;
      break;
    case 'dm_out':
      if (ok(e)) { totals.dms++; day(e.t).dms++; if (e.rule_id) rule(e).dms++; }
      break;
    case 'followup':
      if (ok(e)) { totals.followups++; if (e.rule_id) rule(e).followups++; }
      break;
    case 'ai_reply':
      if (ok(e)) { totals.ai++; if (e.media_id) post(e.media_id).ai++; if (e.rule_id) rule(e).ai++; }
      break;
    case 'quota':
      totals.quota++;
      break;
  }
}

const leadList = Object.values(leads).filter(l => l.matched || l.taps || l.dms_in);
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
const series = [];
for (let t = since; t <= now + 3600000; t += 86400000) {
  const k = dayKey(t);
  if (series.length && series[series.length - 1].date === k) continue;
  const d = daily[k] || { comments: 0, leads: new Set(), dms: 0, taps: 0 };
  series.push({ date: k, comments: d.comments, leads: d.leads.size, dms: d.dms, taps: d.taps });
}

const response = {
  ok: true, days, since: new Date(since).toISOString(), events: events.length, truncated: $input.all().length >= 20000,
  totals: Object.assign(totals, {
    leads: leadList.length, commenters: new Set(events.filter(e => e.type === 'comment_in').map(e => e.ig_user_id)).size,
    match_rate: pct(totals.matched, totals.comments), tap_rate: pct(totals.taps, totals.dms),
  }),
  funnel: [
    { key: 'comments', label: 'Komentar masuk', value: totals.comments },
    { key: 'matched', label: 'Cocok automasi', value: totals.matched },
    { key: 'dms', label: 'DM terkirim', value: totals.dms },
    { key: 'taps', label: 'Tombol ditekan', value: totals.taps },
    { key: 'followups', label: 'Follow-up terkirim', value: totals.followups },
  ],
  series,
  posts: Object.values(posts).filter(p => p.media_id !== 'unknown')
    .map(p => ({ media_id: p.media_id, comments: p.comments, commenters: p.commenters.size, matched: p.matched, dms: p.dms, taps: p.taps, ai: p.ai,
      leads: p.leads.size, tap_rate: pct(p.taps, p.dms) }))
    .sort((a, b) => b.leads - a.leads || b.comments - a.comments).slice(0, 50),
  rules: Object.values(rules).filter(r => r.rule_id).map(r => Object.assign(r, { tap_rate: pct(r.taps, r.dms) }))
    .sort((a, b) => b.matched - a.matched).slice(0, 50),
  hours,
  words: Object.entries(words).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([word, count]) => ({ word, count })),
  leads: leadList.sort((a, b) => b.score - a.score || b.last_at - a.last_at).slice(0, 200).map(l => ({
    ig_user_id: l.ig_user_id, username: l.username, score: l.score, comments: l.comments, taps: l.taps, dms_in: l.dms_in,
    posts: [...l.posts].filter(Boolean), first_at: new Date(l.first_at).toISOString(), last_at: new Date(l.last_at).toISOString(), last_text: l.last_text,
  })),
};
return [{ json: { response } }];
