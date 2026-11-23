#!/usr/bin/env python3
"""Audit alur akun & sesi Wanychat terhadap n8n LOKAL (http://localhost:5678) + mailcatcher (dev/mail/).

  node dev/mailcatcher.mjs &      # sekali
  python3 dev/test_auth.py

Setiap uji memakai email acak, jadi bisa dijalankan berulang. Tidak menyentuh n8n produksi.
"""
import email
import email.header
import json
import random
import re
import string
import sys
import time
import urllib.request
from pathlib import Path

N8N = 'http://localhost:5678/webhook/'
ORIGIN = 'http://localhost:5180'
MAIL = Path(__file__).parent / 'mail'
results = []


def rid(n=8):
    return ''.join(random.choice(string.ascii_lowercase + string.digits) for _ in range(n))


class Client:
    def __init__(self):
        self.ip = '10.%d.%d.%d' % (random.randint(0, 255), random.randint(0, 255), random.randint(1, 254))
        self.cookie = ''

    def post(self, path, action, payload=None, origin=ORIGIN):
        h = {'content-type': 'application/json', 'x-vercel-forwarded-for': self.ip}
        if origin:
            h['origin'] = origin
        if self.cookie:
            h['cookie'] = 'wany_session=' + self.cookie
        req = urllib.request.Request(N8N + path, json.dumps({'action': action, 'payload': payload or {}}).encode(), h, method='POST')
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                status, body, hdr = r.status, r.read().decode(), r.headers
        except urllib.error.HTTPError as e:
            status, body, hdr = e.code, e.read().decode(), e.headers
        for c in hdr.get_all('set-cookie') or []:
            m = re.match(r'wany_session=([^;]*)', c)
            if m:
                self.cookie = m.group(1)
        try:
            data = json.loads(body)
        except ValueError:
            data = {'raw': body[:200]}
        return status, data

    def auth(self, action, payload=None, **kw):
        return self.post('wany-auth', action, payload, **kw)

    def api(self, action, payload=None, **kw):
        return self.post('wany-api', action, payload, **kw)


def otp_for(addr, after, purpose='verifikasi'):
    for _ in range(30):
        files = sorted(f for f in MAIL.glob('*.eml') if f.stat().st_mtime >= after and addr in f.name)
        for f in reversed(files):
            msg = email.message_from_bytes(f.read_bytes())
            subj = str(email.header.make_header(email.header.decode_header(msg['subject'])))
            if purpose in subj:
                return re.search(r'(\d{6})$', subj).group(1)
        time.sleep(0.3)
    raise AssertionError('email OTP untuk %s tidak ditemukan' % addr)


def check(name, cond, info=''):
    results.append((name, bool(cond)))
    print(('  OK   ' if cond else '  GAGAL') + ' ' + name + ('' if cond else '  -> ' + str(info)[:300]))


def registered(name='Uji'):
    """Akun baru yang sudah terverifikasi + login (cookie terisi)."""
    c = Client()
    addr = 'uji-%s@contoh.id' % rid()
    t = time.time() - 1
    c.auth('register', {'email': addr, 'password': 'rahasia123', 'name': name})
    c.auth('otp.verify', {'email': addr, 'code': otp_for(addr, t)})
    return c, addr


def main():
    print('Daftar & verifikasi')
    c = Client()
    addr = 'uji-%s@Contoh.ID' % rid()
    low = addr.lower()
    s, d = c.auth('register', {'email': addr, 'password': 'pendek', 'name': 'A'})
    check('password lemah ditolak', s == 400 and 'minimal 8' in d.get('error', ''), d)
    s, d = c.auth('register', {'email': 'bukan-email', 'password': 'rahasia123', 'name': 'A'})
    check('email tidak valid ditolak', s == 400, d)
    t = time.time() - 1
    s, d = c.auth('register', {'email': addr, 'password': 'rahasia123', 'name': 'Uji Satu'})
    check('daftar -> next verify, email dinormalisasi', s == 200 and d.get('next') == 'verify' and d.get('email') == low, d)
    code = otp_for(low, t)
    s, d = c.auth('otp.resend', {'email': low})
    check('kirim ulang OTP < 60 detik ditolak', s == 429, d)
    s, d = c.api('auth.me')
    check('belum terverifikasi = belum punya sesi', s == 401, d)
    s, d = c.auth('login', {'email': low, 'password': 'rahasia123'})
    check('login sebelum verifikasi -> diarahkan verify', s == 200 and d.get('next') == 'verify' and not c.cookie, d)
    wrong = '000000' if code != '000000' else '111111'
    s, d = c.auth('otp.verify', {'email': low, 'code': wrong})
    check('OTP salah ditolak + sisa percobaan', s == 400 and 'Sisa 4' in d.get('error', ''), d)
    s, d = c.auth('otp.verify', {'email': low, 'code': code})
    check('OTP benar -> sesi + onboarding', s == 200 and d.get('next') == 'onboarding' and c.cookie, d)
    s, d = c.auth('otp.verify', {'email': low, 'code': code})
    check('OTP tidak bisa dipakai ulang', s in (400, 409), d)
    s, d = c.auth('register', {'email': low, 'password': 'rahasia123', 'name': 'X'})
    check('daftar ulang email terverifikasi ditolak', s == 409, d)

    print('Sesi & data user')
    s, d = c.api('auth.me')
    u = d.get('user') or {}
    check('auth.me: user, tanpa akun sosial', s == 200 and u.get('email') == low and d.get('account') is None and d.get('accounts') == [], d)
    check('auth.me: tidak membocorkan hash/password', 'password_hash' not in json.dumps(d) and 'scrypt' not in json.dumps(d), d)
    check('billing grup default Gratis', (d.get('billing') or {}).get('plan', {}).get('id') == 'free', d.get('billing'))
    s, d = c.api('auth.me', origin='https://evil.example')
    check('Origin asing ditolak (CSRF)', s == 401 and not d.get('ok'), d)
    s, d = c.api('rules.save', {'rule': {'name': 'x', 'keywords': 'harga'}})
    check('rules.save tanpa Instagram -> 409', s == 409, d)
    s, d = c.api('rules.list')
    check('rules.list tanpa Instagram -> kosong', s == 200 and d.get('rules') == [], d)
    s, d = c.api('events.list')
    check('events.list tanpa Instagram -> kosong', s == 200 and d.get('events') == [], d)
    s, d = c.api('tiktok.status')
    check('tiktok.status belum terhubung', s == 200 and d.get('connected') is False and d.get('ready') is True, d)
    s, d = c.api('onboarding.save', {'channel': 'explore', 'step': 'about'})
    check('onboarding.save langkah', s == 200 and d['user']['onboarding'].get('channel') == 'explore', d)
    s, d = c.api('onboarding.save', {'for_whom': 'myself', 'heard_from': ['search', '<script>'], 'done': True})
    ob = (d.get('user') or {}).get('onboarding') or {}
    check('onboarding selesai + input disaring', ob.get('done') and ob.get('heard_from') == ['search'] and ob.get('channel') == 'explore', d)
    s, d = c.auth('login', {'email': low, 'password': 'rahasia123'})
    check('login ulang -> dasbor (onboarding sudah selesai)', s == 200 and d.get('next') == 'dashboard', d)
    s, d = c.api('user.update', {'name': '  Nama   Baru ', 'marketing_opt_in': False})
    check('user.update nama & opt-in', s == 200 and d['user']['name'] == 'Nama Baru' and d['user']['marketing_opt_in'] is False, d)
    s, d = c.api('user.password', {'current': 'salah123', 'next': 'baru12345'})
    check('ganti password: password lama salah ditolak', s == 400, d)
    s, d = c.api('user.password', {'current': 'rahasia123', 'next': 'baru12345'})
    check('ganti password berhasil', s == 200, d)
    c2 = Client()
    s, d = c2.auth('login', {'email': low, 'password': 'rahasia123'})
    check('password lama tidak berlaku lagi', s == 401, d)
    s, d = c2.auth('login', {'email': low, 'password': 'baru12345'})
    check('login dengan password baru', s == 200 and c2.cookie, d)

    print('Lupa password')
    c3 = Client()
    s, d = c3.auth('password.forgot', {'email': 'tidak-ada-%s@contoh.id' % rid()})
    check('lupa password email tak terdaftar -> jawaban generik', s == 200 and d.get('next') == 'reset', d)
    t = time.time() - 1
    s, d = c3.auth('password.forgot', {'email': low})
    check('lupa password terdaftar -> jawaban sama', s == 200 and d.get('next') == 'reset', d)
    rcode = otp_for(low, t, 'reset')
    s, d = c3.auth('password.reset', {'email': low, 'code': rcode, 'password': 'reset12345'})
    check('reset password -> sesi baru', s == 200 and c3.cookie, d)
    s, d = c.api('auth.me')
    check('reset mencabut sesi lama (klien 1)', s == 401, d)
    s, d = c2.api('auth.me')
    check('reset mencabut sesi lama (klien 2)', s == 401, d)
    s, d = c3.api('auth.me')
    check('sesi baru setelah reset valid', s == 200, d)

    print('Login gagal & batas percobaan')
    c4 = Client()
    s, d = c4.auth('login', {'email': 'tidak-ada-%s@contoh.id' % rid(), 'password': 'apa12345'})
    s2, d2 = c4.auth('login', {'email': low, 'password': 'salah12345'})
    check('pesan login gagal sama (tidak bocor email terdaftar)', s == s2 == 401 and d.get('error') == d2.get('error'), (d, d2))
    target = 'kunci-%s@contoh.id' % rid()
    for _ in range(8):
        Client().auth('login', {'email': target, 'password': 'salah12345'})
    s, d = Client().auth('login', {'email': target, 'password': 'salah12345'})
    check('batas 8 percobaan per email (beda IP)', s == 429, d)

    print('Logout & sesi lama')
    s, d = c3.api('auth.logout')
    check('logout', s == 200, d)
    s, d = c3.api('auth.me')
    check('sesi tidak berlaku setelah logout', s == 401, d)
    fake = Client()
    fake.cookie = 'a' * 64
    s, d = fake.api('auth.me')
    check('cookie palsu ditolak', s == 401, d)

    print('Isolasi antar user')
    a, _ = registered('A')
    b, _ = registered('B')
    sa, da = a.api('auth.me')
    sb, db = b.api('auth.me')
    check('grup user A dan B berbeda', da['user']['uid'] != db['user']['uid'], (da, db))
    s, d = b.api('accounts.switch', {'type': 'instagram', 'id': '17841459873082917'})
    check('tidak bisa membuka akun IG milik orang lain', s == 404 or not d.get('ok'), d)
    s, d = b.api('accounts.unlink', {'type': 'tiktok', 'id': '123456789'})
    check('tidak bisa melepas akun TikTok orang lain', not d.get('ok'), d)

    ok = sum(1 for _, r in results if r)
    print('\n%d/%d uji lolos' % (ok, len(results)))
    sys.exit(0 if ok == len(results) else 1)


if __name__ == '__main__':
    main()
