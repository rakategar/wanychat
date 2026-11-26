#!/usr/bin/env python3
"""Uji ujung-ke-ujung posting multi-platform terhadap n8n LOKAL + bucket tiruan (dev/s3mock.mjs) + mailcatcher.

  node dev/mailcatcher.mjs & node dev/s3mock.mjs &
  python3 dev/test_post_api.py

Alur nyata: daftar akun -> akun IG/TikTok uji (token palsu) -> media.start -> PUT ke bucket lewat URL bertanda tangan
-> media.finish (n8n membaca file dari bucket) -> post.create -> worker antrean (eksekusi produksi) -> status, coba ulang,
batal, isolasi antar user, pembersihan media kedaluwarsa. Instagram/TikTok asli tidak bisa dipanggil (token palsu),
jadi yang diuji adalah aliran data & penanganan galatnya.
"""
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).parent.parent))
from test_auth import check, registered, results, rid  # noqa: E402
from mcp import Client as Mcp  # noqa: E402

CFG = json.loads((Path(__file__).parent.parent / 'targets.json').read_text())['local']
T = CFG['tables']
mcp = Mcp('local')
now = lambda: datetime.now(timezone.utc)


def rows(table, **flt):
    args = {'dataTableId': T[table], 'projectId': CFG['projectId'], 'limit': 100}
    if flt:
        args['filter'] = {'type': 'and', 'filters': [{'columnName': k, 'condition': 'eq', 'value': v} for k, v in flt.items()]}
    out = json.loads(mcp.call('get_data_table_rows', args))['rows']
    return sorted(out, key=lambda r: r['id'])


def add(table, row):
    mcp.call('add_data_table_rows', {'dataTableId': T[table], 'projectId': CFG['projectId'], 'rows': [row]})


def post(c, action, payload=None, origin=None):
    kw = {'origin': origin} if origin else {}
    return c.post('wany-post', action, payload, **kw)


def put(url, data, ctype):
    req = urllib.request.Request(url, data, {'content-type': ctype}, method='PUT')
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code


def upload(c, path, mime, meta):
    data = Path(path).read_bytes()
    s, d = post(c, 'media.start', dict(meta, mime=mime, size=len(data), name=Path(path).name))
    assert s == 200, d
    st = put(d['upload_url'], data, mime)
    s2, d2 = post(c, 'media.finish', {'media_id': d['media_id']})
    return d['media_id'], st, s2, d2


def run_worker():
    mcp.call('execute_workflow', {'workflowId': 'WanyPosting00001', 'executionMode': 'production', 'triggerNodeName': 'Setiap 2 Menit'})


def main():
    tmp = tempfile.mkdtemp()
    ff = lambda *a: subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', *a], cwd=tmp, check=True)
    ff('-f', 'lavfi', '-i', 'testsrc=size=1080x1920:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '5',
       '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', 'v.mp4')
    ff('-f', 'lavfi', '-i', 'testsrc=size=1080x1350', '-frames:v', '1', 'p.jpg')
    vid, jpg = os.path.join(tmp, 'v.mp4'), os.path.join(tmp, 'p.jpg')

    a, _ = registered('Post A')
    b, _ = registered('Post B')
    ua = a.api('auth.me')[1]['user']['uid']
    ub = b.api('auth.me')[1]['user']['uid']
    ig = '178414' + str(int(time.time()))[-8:] + rid(3).replace('a', '1')
    ig = ''.join(ch for ch in ig if ch.isdigit())[:17]
    tta, ttb = '-000post' + rid(8), '-000post' + rid(8)
    exp = (now() + timedelta(hours=20)).isoformat()
    add('accounts', {'ig_user_id': ig, 'username': 'uji_ig', 'name': 'Uji', 'avatar': '', 'access_token': 'palsu-' + rid(), 'token_expires_at': exp,
                     'token_refresh_error': '', 'ai_enabled': True, 'ai_persona': '', 'connected_at': now().isoformat(), 'owner_id': ua})
    for oid, owner, scope in ((tta, ua, 'user.info.basic,video.list,video.publish'), (ttb, ub, 'user.info.basic')):
        add('tt_accounts', {'open_id': oid, 'username': 'uji_' + oid[-4:], 'display_name': 'Uji', 'avatar': '', 'access_token': 'palsu-' + rid(),
                            'token_expires_at': exp, 'refresh_token': 'palsu', 'refresh_expires_at': exp, 'token_refresh_error': '', 'owner_id': owner,
                            'connected_at': now().isoformat(), 'scope': scope})

    print('Konfigurasi & izin')
    s, d = post(a, 'post.config', origin='https://jahat.example')
    check('origin asing ditolak (401)', s == 401, d)
    s, d = post(a, 'post.config')
    acc = {x['type'] + ':' + x['id']: x for x in d.get('accounts', [])}
    check('post.config: bucket siap, 1 IG + 1 TikTok', s == 200 and d.get('ready') is True and ('instagram:' + ig) in acc and ('tiktok:' + tta) in acc, d)
    check('IG token palsu -> butuh izin posting (cek langsung ke Instagram)', acc.get('instagram:' + ig, {}).get('need_auth') is True, acc.get('instagram:' + ig))
    check('TikTok dengan scope video.publish bisa dipilih', acc.get('tiktok:' + tta, {}).get('can_publish') is True, acc.get('tiktok:' + tta))
    s, d = post(b, 'post.config')
    tb = [x for x in d.get('accounts', []) if x['type'] == 'tiktok']
    check('TikTok B tanpa scope posting -> tombol izin', s == 200 and tb and tb[0]['need_auth'] is True and not tb[0]['can_publish'], d)
    s, d = a.api('auth.me')
    check('regresi: auth.me Admin API tetap jalan', s == 200 and d.get('ok'), d)

    print('Unggah media')
    vid_id, st, s, d = upload(a, vid, 'video/mp4', {'duration': 99, 'width': 10, 'height': 10, 'fps': 5})
    m = d.get('media') or {}
    check('video: PUT bertanda tangan diterima bucket', st == 200, st)
    check('video: media.finish membaca file asli (durasi/resolusi/codec dari server)', s == 200 and m.get('status') == 'ready' and round(m.get('duration', 0)) == 5
          and m.get('width') == 1080 and m.get('height') == 1920 and round(m.get('fps', 0)) == 30, d)
    jpg_id, st, s, d = upload(a, jpg, 'image/jpeg', {'width': 1, 'height': 1})
    check('foto: ukuran asli 1080x1350 dari JPEG', s == 200 and (d.get('media') or {}).get('width') == 1080 and d['media']['height'] == 1350, d)
    data = Path(vid).read_bytes()
    s, d = post(a, 'media.start', {'mime': 'video/mp4', 'size': len(data)})
    st = put(d['upload_url'], data[:-10], 'video/mp4')
    check('bucket menolak ukuran berbeda dari yang ditandatangani', st in (400, 403), st)
    st = put(d['upload_url'], data, 'image/jpeg')
    check('bucket menolak Content-Type berbeda dari yang ditandatangani', st == 403, st)
    fake = d['media_id']
    put(d['upload_url'], b'<html>' + b' ' * (len(data) - 6), 'video/mp4')
    s, d = post(a, 'media.finish', {'media_id': fake})
    check('file berisi HTML berlabel video ditolak saat media.finish', s == 422 and 'bukan video' in d.get('error', ''), d)
    s, d = post(b, 'media.finish', {'media_id': vid_id})
    check('user B tidak bisa memakai media A', s == 404, d)

    print('Buat posting')
    s, d = post(a, 'post.create', {'media_ids': [vid_id], 'caption': 'Uji', 'targets': [{'type': 'instagram', 'id': ig}]})
    check('IG tanpa izin posting ditolak dengan alasan', s == 422 and 'izin' in d.get('error', '').lower(), d)
    s, d = post(a, 'post.create', {'media_ids': [jpg_id, vid_id], 'caption': 'Uji', 'targets': [{'type': 'tiktok', 'id': tta}]})
    check('carousel foto+video ke TikTok ditolak', s == 422 and 'carousel berisi video' in d.get('error', ''), d)
    ref = rid(12)
    s, d = post(a, 'post.create', {'media_ids': [vid_id], 'caption': 'Halo #uji', 'targets': [{'type': 'tiktok', 'id': tta}], 'client_ref': ref,
                                   'tiktok': {'disable_duet': True}})
    pid = (d.get('post') or {}).get('post_id', '')
    check('video ke TikTok masuk antrean', s == 200 and pid.startswith('pst_') and d['post']['status'] == 'processing', d)
    s, d = post(a, 'post.create', {'media_ids': [vid_id], 'caption': 'Halo #uji', 'targets': [{'type': 'tiktok', 'id': tta}], 'client_ref': ref})
    check('kirim ganda (client_ref sama) -> posting yang sama', s == 200 and d.get('duplicate') and d['post']['post_id'] == pid, d)
    s, d = post(a, 'post.create', {'media_ids': [vid_id], 'caption': 'lagi', 'targets': [{'type': 'tiktok', 'id': tta}]})
    check('media yang sudah dipakai tidak bisa dipakai lagi', s == 409, d)
    tr = rows('post_targets', post_id=pid)
    check('baris target tersimpan lengkap', len(tr) == 1 and tr[0]['status'] == 'queued' and tr[0]['owner_id'] == ua and tr[0]['kind'] == 'video'
          and json.loads(tr[0]['media'])[0]['url'].startswith('https://media.example.test/p/'), tr)
    md = rows('media', media_id=vid_id)
    check('media dikunci ke posting + disimpan 3 hari', md and md[-1]['post_id'] == pid, md)
    s, d = post(b, 'post.get', {'post_id': pid})
    check('user B tidak bisa melihat posting A', s == 404, d)

    jpg2, *_ = upload(a, jpg, 'image/jpeg', {})
    later = (now() + timedelta(hours=2)).isoformat()
    s, d = post(a, 'post.create', {'media_ids': [jpg2], 'caption': 'Nanti', 'targets': [{'type': 'tiktok', 'id': tta}], 'schedule_at': later})
    pid2 = (d.get('post') or {}).get('post_id', '')
    check('foto ke TikTok dijadwalkan', s == 200 and d['post']['status'] == 'scheduled', d)

    print('Worker antrean')
    run_worker()
    t1 = []
    for _ in range(40):
        time.sleep(1.5)
        t1 = rows('post_targets', post_id=pid)
        if t1 and t1[0]['status'] != 'queued':
            break
    check('worker memproses target (token TikTok palsu -> gagal dengan pesan jelas)', t1 and t1[0]['status'] == 'failed' and t1[0]['error']
          and t1[0]['done_at'], t1)
    t2 = rows('post_targets', post_id=pid2)
    check('posting terjadwal belum disentuh worker', t2 and t2[0]['status'] == 'queued', t2)
    s, d = post(a, 'post.get', {'post_id': pid})
    check('post.get: status agregat gagal + pesan per akun', s == 200 and d['post']['status'] == 'failed' and d['post']['targets'][0]['error'], d)
    ev = a.api('events.list', {'type': 'tiktok'})[1].get('events') or []
    check('log aktivitas akun TikTok mencatat posting gagal', any(e['type'] == 'post_failed' and e['ref_id'] == pid for e in ev), ev[:3])
    retryable = d['post']['targets'][0]['retryable']
    s, d = post(a, 'post.retry', {'post_id': pid})
    if retryable:
        check('coba ulang -> kembali ke antrean', s == 200 and rows('post_targets', post_id=pid)[0]['status'] == 'queued', d)
    else:
        check('galat tidak bisa diulang -> coba ulang ditolak', s == 409, d)

    print('Batal & daftar')
    s, d = post(a, 'post.cancel', {'post_id': pid2})
    check('batalkan posting terjadwal', s == 200 and d.get('canceled') == 1 and rows('post_targets', post_id=pid2)[0]['status'] == 'canceled', d)
    s, d = post(a, 'post.list')
    ids = [p['post_id'] for p in d.get('posts', [])]
    check('post.list berisi kedua posting A, terbaru dulu', s == 200 and ids[:2] == [pid2, pid], ids)
    check('kuota bulan ini menghitung target (yang dibatalkan tidak)', d.get('plan', {}).get('used') == 1, d.get('plan'))
    s, d = post(b, 'post.list')
    check('post.list B kosong', s == 200 and d.get('posts') == [], d)

    print('Pembersihan media')
    old = 'old' + rid(10)
    add('media', {'media_id': old, 'owner_id': ua, 'kind': 'image', 'mime': 'image/jpeg', 'obj_key': 'p/' + old + '.jpg', 'size': 3, 'status': 'uploading',
                  'verified': False, 'post_id': '', 'expires_at': (now() - timedelta(hours=1)).isoformat(), 'note': ''})
    put_ok = 0
    s, d = post(a, 'media.start', {'mime': 'image/jpeg', 'size': 3})  # URL sah untuk menaruh objek "lama" di bucket tiruan
    run_worker()
    for _ in range(30):
        time.sleep(1.5)
        r = rows('media', media_id=old)
        if r and r[-1]['status'] == 'deleted':
            put_ok = 1
            break
    check('media kedaluwarsa ditandai terhapus oleh worker', put_ok, rows('media', media_id=old))

    ok = sum(1 for _, x in results if x)
    print('\n%d/%d uji lolos' % (ok, len(results)))
    sys.exit(0 if ok == len(results) else 1)


if __name__ == '__main__':
    main()
