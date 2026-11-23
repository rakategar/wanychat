// Kanal TikTok (TikTok API for Business, Accounts API). Accounts API tidak punya DM:
// yang bisa dilakukan = profil & statistik, daftar video, membaca/membalas/menyembunyikan komentar.

export interface TtProfile {
  username?: string
  display_name?: string
  profile_image?: string
  followers_count?: number
  following_count?: number
  total_likes?: number
  videos_count?: number
  is_business_account?: boolean
}

export interface TtVideo {
  item_id: string
  caption?: string
  thumbnail_url?: string
  share_url?: string
  create_time?: number | string
  video_views?: number
  likes?: number
  comments?: number
  shares?: number
}

export interface TtComment {
  comment_id: string
  video_id: string
  text: string
  username?: string
  display_name?: string
  profile_image?: string
  create_time?: number | string
  likes?: number
  replies?: number
  owner?: boolean
  status?: string // PUBLIC | HIDDEN
  parent_comment_id?: string
}

// Izin yang diminta saat menghubungkan akun TikTok, beserta alasannya (ditampilkan ke pengguna)
export const TT_SCOPES: { scope: string; label: string; why: string }[] = [
  { scope: 'user.info.basic, user.info.profile', label: 'Profil', why: 'Menampilkan nama, foto, dan username akun yang terhubung.' },
  { scope: 'user.info.stats, user.insights', label: 'Statistik akun', why: 'Jumlah pengikut, suka, dan video di dasbor.' },
  { scope: 'video.list, video.insights', label: 'Daftar video', why: 'Menampilkan video beserta jumlah komentarnya.' },
  { scope: 'comment.list', label: 'Membaca komentar', why: 'Menampilkan komentar baru dari semua video.' },
  { scope: 'comment.list.manage', label: 'Mengelola komentar', why: 'Membalas komentar publik dan menyembunyikan spam.' },
]

export const compact = (n?: number) => {
  const v = Number(n) || 0
  return v >= 1_000_000 ? (v / 1_000_000).toLocaleString('id-ID', { maximumFractionDigits: 1 }) + 'jt'
    : v >= 1000 ? (v / 1000).toLocaleString('id-ID', { maximumFractionDigits: 1 }) + 'rb' : String(v)
}
// create_time TikTok = detik Unix
export const ttDate = (t?: number | string) => {
  if (!t) return ''
  const n = Number(t)
  return new Date(Number.isFinite(n) && n < 1e12 ? n * 1000 : String(t)).toISOString()
}
