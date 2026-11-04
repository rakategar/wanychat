// Pasca-build: isi <div id="root"> di dist/index.html dengan HTML landing + JSON-LD,
// supaya crawler (Google, Bing, pratinjau WhatsApp/Facebook) membaca isi halaman tanpa menjalankan JavaScript.
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

const dist = resolve('dist/index.html')
const { render } = await import(pathToFileURL(resolve('dist-ssr/prerender.js')).href)
const { html, ld } = render()
const json = ld.map((o) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, '\\u003c')}</script>`).join('\n    ')

let page = readFileSync(dist, 'utf8')
if (!page.includes('<div id="root"></div>')) throw new Error('prerender: <div id="root"></div> tidak ditemukan')
// data-prerender: boot.js menyembunyikannya di rute panel; React mengganti seluruh isi #root saat mount
const marked = html.replace('<div class="landing">', '<div class="landing" data-prerender="">')
page = page.replace('<div id="root"></div>', `<div id="root">${marked}</div>`).replace('</head>', `  ${json}\n  </head>`)
writeFileSync(dist, page)
rmSync('dist-ssr', { recursive: true, force: true })
console.log(`prerender: ${html.length} karakter HTML, ${ld.length} blok JSON-LD`)
