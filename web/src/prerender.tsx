import { renderToStaticMarkup, renderToString } from 'react-dom/server'
import Landing, { FAQ, FEATURES } from './pages/Landing'
import { ToastProvider } from './components/ui'
import { DEFAULT_PLANS, planFeatures } from './plans'

// Dipakai scripts/prerender.mjs saat build: HTML landing + data terstruktur (JSON-LD) untuk mesin pencari.
// Sumbernya sama dengan halaman (FAQ, fitur, paket), jadi isi Google tidak pernah beda dari yang tampil.
const SITE = 'https://wanychat.remot.in'
const text = (node: React.ReactNode) =>
  renderToStaticMarkup(<>{node}</>).replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/\s+/g, ' ').trim()

export function render() {
  const html = renderToString(<ToastProvider><Landing signedIn={false} /></ToastProvider>)
  const ld = [
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      '@id': SITE + '/#org',
      name: 'Wanychat',
      url: SITE + '/',
      logo: { '@type': 'ImageObject', url: SITE + '/icons/icon-512.png', width: 512, height: 512 },
      image: SITE + '/icons/icon-512.png',
    },
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      '@id': SITE + '/#website',
      // Nama situs di hasil Google (menggantikan label domain "remot.in")
      name: 'Wanychat',
      alternateName: ['Wanychat Indonesia', 'Wanychat Auto DM Instagram'],
      url: SITE + '/',
      inLanguage: 'id-ID',
      publisher: { '@id': SITE + '/#org' },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'Wanychat',
      url: SITE + '/',
      applicationCategory: 'BusinessApplication',
      applicationSubCategory: 'Instagram DM automation',
      operatingSystem: 'Web, Android, iOS',
      inLanguage: 'id-ID',
      description: 'Auto-DM Instagram: balas komentar dan DM Instagram otomatis dengan keyword, tombol, AI, dan follow-up. Alternatif ManyChat dalam Rupiah.',
      image: SITE + '/og-image.png',
      featureList: FEATURES.map((f) => f.title + ': ' + f.desc),
      publisher: { '@id': SITE + '/#org' },
      offers: {
        '@type': 'AggregateOffer',
        priceCurrency: 'IDR',
        lowPrice: Math.min(...DEFAULT_PLANS.map((p) => p.price)),
        highPrice: Math.max(...DEFAULT_PLANS.map((p) => p.price)),
        offerCount: DEFAULT_PLANS.length,
        offers: DEFAULT_PLANS.map((p) => ({
          '@type': 'Offer',
          name: 'Paket ' + p.name,
          price: p.price,
          priceCurrency: 'IDR',
          description: planFeatures(p).join(', '),
          url: SITE + '/#harga',
        })),
      },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: FAQ.map((f) => ({
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: text(f.a) },
      })),
    },
  ]
  return { html, ld }
}
