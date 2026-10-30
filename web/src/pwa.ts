import { useEffect, useState } from 'react'

// Daftarkan service worker (hanya build produksi; dev server Vite tidak butuh cache)
export function registerSW() {
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}) })
  }
}

interface InstallEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferred: InstallEvent | null = null
const listeners = new Set<() => void>()
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferred = e as InstallEvent
    listeners.forEach((f) => f())
  })
  window.addEventListener('appinstalled', () => { deferred = null; listeners.forEach((f) => f()) })
}

const standalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) && !/crios|fxios/i.test(navigator.userAgent)

// canInstall: Android/desktop Chrome punya prompt; ios: tampilkan petunjuk "Bagikan → Tambah ke Layar Utama"
export function useInstall() {
  const [, tick] = useState(0)
  useEffect(() => {
    const f = () => tick((x) => x + 1)
    listeners.add(f)
    return () => { listeners.delete(f) }
  }, [])
  return {
    installed: standalone(),
    canInstall: !!deferred,
    ios: !standalone() && isIOS(),
    install: async () => {
      if (!deferred) return false
      await deferred.prompt()
      const { outcome } = await deferred.userChoice
      deferred = null
      tick((x) => x + 1)
      return outcome === 'accepted'
    },
  }
}
