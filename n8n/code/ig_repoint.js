// Satu item per akun IG grup lama yang dipindah ke grup user; item dummy bila tidak ada (supaya rantai tetap jalan)
const r = $('Tukar Kode Login').first().json.repoint || [];
return (r.length ? r : [{ ig_user_id: 'none', owner_id: '' }]).map(json => ({ json }));
