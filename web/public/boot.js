// Dimuat sinkron di <head>: pengguna yang membuka panel tidak melihat landing prerender sekilas sebelum dasbor
if (/^#\/?(dashboard|automations|activity|analytics|billing|settings|admin)\b/.test(location.hash)) document.documentElement.classList.add('app-route')
