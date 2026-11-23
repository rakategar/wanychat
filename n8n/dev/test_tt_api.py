#!/usr/bin/env python3
"""Audit API automasi TikTok terhadap n8n LOKAL: rule TikTok (simpan/validasi/hapus), isolasi antar user,
log aktivitas per akun TikTok, dan satu putaran workflow "TikTok Automasi" dengan token palsu.

  python3 dev/test_tt_api.py

Akun TikTok uji disisipkan langsung ke wany_tt_accounts (OAuth TikTok asli tidak bisa di localhost) lalu dilepas di akhir.
"""
import json
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).parent.parent))
from test_auth import check, registered, results, rid  # noqa: E402
from mcp import Client as Mcp  # noqa: E402

CFG = json.loads((Path(__file__).parent.parent / 'targets.json').read_text())['local']
mcp = Mcp('local')


def add_tt(open_id, owner):
    exp = (datetime.now(timezone.utc) + timedelta(hours=20)).isoformat()
    mcp.call('add_data_table_rows', {'dataTableId': CFG['tables']['tt_accounts'], 'projectId': CFG['projectId'], 'rows': [{
        'open_id': open_id, 'username': 'uji_' + open_id[-4:], 'display_name': 'Uji', 'avatar': '', 'access_token': 'palsu-' + rid(),
        'token_expires_at': exp, 'refresh_token': 'palsu', 'refresh_expires_at': exp, 'token_refresh_error': '',
        'owner_id': owner, 'connected_at': datetime.now(timezone.utc).isoformat()}]})


def main():
    a, _ = registered('TT A')
    b, _ = registered('TT B')
    ua = a.api('auth.me')[1]['user']['uid']
    ub = b.api('auth.me')[1]['user']['uid']
    ta, tb = '-000uji' + rid(10), '-000uji' + rid(10)
    add_tt(ta, ua)
    add_tt(tb, ub)

    print('Akun TikTok di auth.me')
    s, d = a.api('auth.me')
    check('akun TikTok uji terbaca di grup A', s == 200 and (d.get('tiktok') or {}).get('open_id') == ta, d)
    tts = [x for x in d.get('accounts', []) if x['type'] == 'tiktok']
    check('slot paket: TikTok aktif (Gratis 1 akun, tanpa IG)', tts and tts[0]['active'] is True, tts)

    print('Rule TikTok')
    t = {'type': 'tiktok'}
    s, d = a.api('rules.list', t)
    check('rules.list TikTok awalnya kosong', s == 200 and d.get('rules') == [], d)
    s, d = a.api('rules.save', dict(t, rule={'name': 'Spam', 'match_mode': 'any', 'hide_comment': True}))
    check('sembunyikan + "Semua" ditolak', s == 400 and 'keyword' in d.get('error', ''), d)
    s, d = a.api('rules.save', dict(t, rule={'name': 'Kosong', 'keywords': 'harga'}))
    check('rule tanpa aksi ditolak', s == 400 and 'variasi balasan' in d.get('error', ''), d)
    s, d = a.api('rules.save', dict(t, rule={'name': 'Panjang', 'keywords': 'harga', 'comment_replies': 'x' * 151}))
    check('balasan > 150 karakter ditolak', s == 400 and '150' in d.get('error', ''), d)
    s, d = a.api('rules.save', dict(t, rule={'name': 'AI', 'keywords': 'harga', 'ai_fallback': True}))
    check('balasan AI di paket Gratis tanpa kredit ditolak', s == 400 and 'Kreator' in d.get('error', ''), d)
    s, d = a.api('rules.save', dict(t, rule={'name': 'Harga', 'keywords': 'harga, berapa', 'comment_replies': 'Cek DM ya {username}\nInfo di bio kak',
                                              'post_ids': '*', 'dm_message': 'tidak boleh tersimpan', 'followup_enabled': True}))
    r1 = d.get('rule') or {}
    check('rule balasan tersimpan sebagai channel tiktok milik open_id', s == 200 and r1.get('channel') == 'tiktok' and r1.get('account_id') == ta
          and r1.get('dm_message') == '' and r1.get('followup_enabled') is False and r1.get('hide_comment') is False, d)
    s, d = a.api('rules.save', dict(t, rule={'name': 'Judi', 'keywords': 'slot, judi', 'hide_comment': True, 'comment_replies': 'abaikan',
                                              'ai_fallback': True, 'post_ids': '7001,abc,7002'}))
    r2 = d.get('rule') or {}
    check('rule sembunyikan: balasan & AI dikosongkan, id video disaring', s == 200 and r2.get('hide_comment') is True and r2.get('comment_replies') == ''
          and r2.get('ai_fallback') is False and r2.get('post_ids') == '*', d)
    s, d = a.api('rules.save', dict(t, rule={'name': 'Video', 'keywords': 'promo', 'comment_replies': 'ok', 'post_ids': '7300000000000000001,7300000000000000002'}))
    check('video tertentu tersimpan', s == 200 and (d.get('rule') or {}).get('post_ids') == '7300000000000000001,7300000000000000002', d)
    s, d = a.api('rules.save', dict(t, rule={'name': 'Keempat', 'keywords': 'x', 'comment_replies': 'ok'}))
    check('batas 3 automasi per akun (Gratis)', s == 400 and 'maksimal 3' in d.get('error', ''), d)
    s, d = a.api('rules.list', t)
    check('rules.list TikTok = 3 rule', s == 200 and len(d.get('rules', [])) == 3, d)
    s, d = a.api('rules.list')
    check('rule TikTok tidak bocor ke daftar Instagram', s == 200 and d.get('rules') == [], d)
    s, d = a.api('rules.save', dict(t, rule=dict(r1, name='Harga (ubah)', active=False)))
    check('ubah rule (id sama) tidak menambah baris', s == 200 and (d.get('rule') or {}).get('name') == 'Harga (ubah)' and len(a.api('rules.list', t)[1]['rules']) == 3, d)

    print('Isolasi antar user')
    s, d = b.api('rules.list', t)
    check('user B tidak melihat rule A', s == 200 and d.get('rules') == [], d)
    s, d = b.api('rules.save', dict(t, rule=dict(r1, name='bajak')))
    check('user B tidak bisa mengubah rule A', s == 404, d)
    b.api('rules.delete', dict(t, id=r1['id']))
    check('user B tidak bisa menghapus rule A', any(x['id'] == r1['id'] for x in a.api('rules.list', t)[1]['rules']))
    s, d = b.api('events.list', t)
    check('events TikTok B kosong', s == 200 and d.get('events') == [], d)

    print('Putaran automasi (token palsu)')
    # Rule pertama dinonaktifkan di atas; rule "Judi" & "Video" masih aktif -> akun A ikut diperiksa
    res = mcp.call('execute_workflow', {'workflowId': 'WanyTikTokAuto01', 'executionMode': 'production'})
    ev = []
    for _ in range(30):
        time.sleep(1)
        ev = a.api('events.list', t)[1].get('events') or []
        if ev:
            break
    check('token palsu -> error koneksi tercatat di log akun TikTok A', any(e['type'] == 'tt_error' and e['status'] == 'error' for e in ev), (res, ev))
    check('log TikTok tidak masuk log user B', not b.api('events.list', t)[1].get('events'), '')
    s, d = a.api('events.list')
    check('log Instagram A tetap kosong', s == 200 and d.get('events') == [], d)

    print('Hapus & bersihkan')
    s, d = a.api('rules.delete', dict(t, id=r1['id']))
    check('hapus rule TikTok', s == 200 and not any(x['id'] == r1['id'] for x in a.api('rules.list', t)[1]['rules']), d)
    s, d = a.api('logs.clear', t)
    check('hapus log TikTok', s == 200 and a.api('events.list', t)[1].get('events') == [], d)
    a.api('rules.save', dict(t, rule={'name': 'Sisa', 'keywords': 'halo', 'comment_replies': 'hai'}))
    for c, oid in ((a, ta), (b, tb)):
        s, d = c.api('accounts.unlink', {'type': 'tiktok', 'id': oid})
    check('lepas akun TikTok', s == 200 and d.get('ok'), d)
    s, d = a.api('rules.list', t)
    check('setelah akun dilepas, rule TikTok tidak bisa dibaca', s == 200 and d.get('rules') == [], d)
    # akun TikTok yang sama ditautkan user B: rule & log milik A tidak ikut
    add_tt(ta, ub)
    b.api('accounts.switch', {'type': 'tiktok', 'id': ta})
    s, d = b.api('rules.list', t)
    check('tautan ulang oleh user lain tidak mewarisi rule pemilik lama', s == 200 and d.get('rules') == [], d)
    s, d = b.api('events.list', t)
    check('... dan tidak mewarisi log pemilik lama', s == 200 and d.get('events') == [], d)
    b.api('accounts.unlink', {'type': 'tiktok', 'id': ta})

    ok = sum(1 for _, r in results if r)
    print('\n%d/%d uji lolos' % (ok, len(results)))
    sys.exit(0 if ok == len(results) else 1)


if __name__ == '__main__':
    main()
