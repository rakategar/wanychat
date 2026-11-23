#!/usr/bin/env node
// Penangkap SMTP untuk pengembangan lokal: menerima semua email dari n8n lokal dan menyimpannya sebagai .eml di
// dev/mail/ (tidak ada yang benar-benar terkirim). Hanya mendengarkan di bridge docker supaya tidak terbuka ke LAN.
//   node dev/mailcatcher.mjs            (HOST=172.17.0.1 PORT=1025)
import net from 'node:net'
import fs from 'node:fs'
import path from 'node:path'

const HOST = process.env.HOST || '172.17.0.1'
const PORT = Number(process.env.PORT || 1025)
const DIR = path.join(path.dirname(new URL(import.meta.url).pathname), 'mail')
fs.mkdirSync(DIR, { recursive: true })

net.createServer((sock) => {
  let buf = '', data = null, from = '', to = []
  const say = (s) => sock.write(s + '\r\n')
  say('220 wanychat-dev ESMTP')
  sock.on('data', (chunk) => {
    buf += chunk.toString('latin1')
    while (true) {
      if (data !== null) {
        const end = buf.indexOf('\r\n.\r\n')
        if (end < 0) return
        data += buf.slice(0, end)
        buf = buf.slice(end + 5)
        const file = path.join(DIR, `${Date.now()}-${to[0] || 'unknown'}.eml`.replace(/[^\w.@-]/g, '_'))
        fs.writeFileSync(file, `X-Envelope-From: ${from}\r\nX-Envelope-To: ${to.join(', ')}\r\n` + data.replace(/\r\n\.\./g, '\r\n.'), 'latin1')
        console.log(new Date().toISOString(), 'mail', from, '->', to.join(', '), path.basename(file))
        data = null; from = ''; to = []
        say('250 OK queued')
        continue
      }
      const i = buf.indexOf('\r\n')
      if (i < 0) return
      const line = buf.slice(0, i); buf = buf.slice(i + 2)
      const cmd = line.slice(0, 4).toUpperCase()
      if (cmd === 'EHLO') { sock.write('250-wanychat-dev\r\n250-AUTH PLAIN\r\n250 8BITMIME\r\n') }
      else if (cmd === 'HELO') say('250 wanychat-dev')
      else if (cmd === 'AUTH') say('235 OK') // kredensial lokal tanpa login; AUTH PLAIN diterima apa adanya
      else if (cmd === 'MAIL') { from = (line.match(/<([^>]*)>/) || [])[1] || ''; say('250 OK') }
      else if (cmd === 'RCPT') { to.push((line.match(/<([^>]*)>/) || [])[1] || ''); say('250 OK') }
      else if (cmd === 'DATA') { data = ''; say('354 End with <CRLF>.<CRLF>') }
      else if (cmd === 'RSET') { from = ''; to = []; say('250 OK') }
      else if (cmd === 'QUIT') { say('221 Bye'); sock.end() }
      else say('250 OK')
    }
  })
  sock.on('error', () => {})
}).listen(PORT, HOST, () => console.log(`mailcatcher ${HOST}:${PORT} -> ${DIR}`))
