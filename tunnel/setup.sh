#!/usr/bin/env bash
# Sekali saja: buat tunnel Cloudflare "igar-autoreply" + DNS autoreply.remot.in (zona remot.in di cert.pem).
# Tidak menyentuh tunnel lain (gayatama-2026 / app.remot.in tetap aman).
set -euo pipefail
NAME=igar-autoreply
HOST=autoreply.remot.in
CF=~/.cloudflared

tunnel_id() {
  cloudflared --config /dev/null tunnel list -o json 2>/dev/null | python3 -c "import json,sys;print(next((t['id'] for t in json.load(sys.stdin) if t['name']=='$NAME'),''))"
}
ID=$(tunnel_id)
if [ -z "$ID" ]; then
  cloudflared --config /dev/null tunnel create "$NAME"
  ID=$(tunnel_id)
fi
[ -n "$ID" ] || { echo "Gagal membuat tunnel $NAME"; exit 1; }
# --config + ID eksplisit: ~/.cloudflared/config.yml (tunnel kinanti-bot) jangan sampai ikut terbaca
if ! cloudflared --config /dev/null tunnel route dns --overwrite-dns "$ID" "$HOST"; then
  echo
  echo "!! DNS gagal dibuat otomatis. Pilih salah satu:"
  echo "   a) cloudflared tunnel login   (pilih zona remot.in di browser), lalu jalankan ./setup.sh lagi"
  echo "   b) Cloudflare dashboard > remot.in > DNS > Add record:"
  echo "      Type CNAME, Name autoreply, Target $ID.cfargotunnel.com, Proxy ON"
  echo
fi

cat > "$CF/$NAME.yml" <<YML
tunnel: $ID
credentials-file: $CF/$ID.json

ingress:
  # Login Instagram + webhook Meta -> n8n lokal (hanya path igar-*, editor n8n tidak terekspos)
  - hostname: $HOST
    path: ^/webhook/wany-
    service: http://localhost:5678
  # Panel web
  - hostname: $HOST
    service: http://localhost:5180
  - service: http_status:404
YML
echo "Siap: $CF/$NAME.yml  ->  jalankan ./tunnel/start.sh"
