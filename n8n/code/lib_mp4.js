// ---- lib_mp4.js (disisipkan build.py lewat //#include) ----
// Kenali jenis file dari byte awal (bukan dari nama/Content-Type kiriman browser) dan baca metadata video MP4/MOV.
// Dipakai saat media.finish: n8n membaca beberapa MB pertama objek di bucket. Browser sudah memindah "moov" ke depan
// (faststart), jadi durasi, resolusi, codec, dan fps biasanya terbaca dari potongan awal itu.
function sniffMedia(buf) {
  const b = buf || Buffer.alloc(0);
  const at = (i, hex) => b.length >= i + hex.length / 2 && b.slice(i, i + hex.length / 2).toString('hex') === hex;
  if (at(0, 'ffd8ff')) return { mime: 'image/jpeg', ext: 'jpg', kind: 'image' };
  if (at(0, '89504e470d0a1a0a')) return { mime: 'image/png', ext: 'png', kind: 'image' };
  if (at(0, '52494646') && at(8, '57454250')) return { mime: 'image/webp', ext: 'webp', kind: 'image' };
  if (at(0, '1a45dfa3')) return { mime: 'video/webm', ext: 'webm', kind: 'video' };
  if (b.length >= 12 && b.slice(4, 8).toString('latin1') === 'ftyp') {
    const brand = b.slice(8, 12).toString('latin1');
    if (/^(heic|heix|hevc|mif1|msf1|avif)/.test(brand)) return { mime: 'image/heic', ext: 'heic', kind: 'image', brand };
    return { mime: brand === 'qt  ' ? 'video/quicktime' : 'video/mp4', ext: brand === 'qt  ' ? 'mov' : 'mp4', kind: 'video', brand };
  }
  return null;
}

// Ukuran JPEG dari marker SOFn
function jpegSize(b) {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const m = b[i + 1];
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
    const len = b.readUInt16BE(i + 2);
    if ((m >= 0xc0 && m <= 0xcf) && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7), progressive: m === 0xc2 };
    }
    i += 2 + len;
  }
  return null;
}

// Kotak (box) ISO-BMFF: [size(4) type(4)] atau size=1 -> size 64-bit setelah type
function mp4Boxes(b, start, end) {
  const out = [];
  let i = start;
  while (i + 8 <= end) {
    let size = b.readUInt32BE(i);
    const type = b.slice(i + 4, i + 8).toString('latin1');
    let head = 8;
    if (size === 1) {
      if (i + 16 > end) { out.push({ type, start: i, size: -1, head: 16, partial: true }); break; }
      size = Number(b.readBigUInt64BE(i + 8)); head = 16;
    } else if (size === 0) size = end - i; // sampai akhir file
    if (size < head) break;
    out.push({ type, start: i, size, head, partial: i + size > end });
    if (i + size > end) break;
    i += size;
  }
  return out;
}

function mp4Info(b) {
  const info = { brand: '', moov: false, faststart: false, duration: 0, width: 0, height: 0, video_codec: '', audio_codec: '', fps: 0, edit_list: false, tracks: 0 };
  const top = mp4Boxes(b, 0, b.length);
  const ftyp = top.find(x => x.type === 'ftyp');
  if (ftyp) info.brand = b.slice(ftyp.start + 8, ftyp.start + 12).toString('latin1');
  const moovI = top.findIndex(x => x.type === 'moov');
  const mdatI = top.findIndex(x => x.type === 'mdat');
  info.faststart = moovI >= 0 && (mdatI < 0 || moovI < mdatI);
  const moov = top[moovI];
  if (!moov || moov.partial) return info;
  info.moov = true;
  const kids = (box) => mp4Boxes(b, box.start + box.head, box.start + box.size);
  const find = (box, path) => {
    let cur = box;
    for (const t of path) { cur = kids(cur).find(x => x.type === t); if (!cur) return null; }
    return cur;
  };
  const full = (box) => ({ version: b[box.start + box.head], body: box.start + box.head + 4 });
  const mvhd = find(moov, ['mvhd']);
  if (mvhd) {
    const { version, body } = full(mvhd);
    const scale = version === 1 ? b.readUInt32BE(body + 16) : b.readUInt32BE(body + 8);
    const dur = version === 1 ? Number(b.readBigUInt64BE(body + 20)) : b.readUInt32BE(body + 12);
    if (scale) info.duration = dur / scale;
  }
  for (const trak of kids(moov).filter(x => x.type === 'trak')) {
    info.tracks++;
    if (find(trak, ['edts', 'elst'])) info.edit_list = true;
    const hdlr = find(trak, ['mdia', 'hdlr']);
    const handler = hdlr ? b.slice(full(hdlr).body + 4, full(hdlr).body + 8).toString('latin1') : '';
    const stsd = find(trak, ['mdia', 'minf', 'stbl', 'stsd']);
    const codec = stsd ? b.slice(full(stsd).body + 8, full(stsd).body + 12).toString('latin1') : '';
    if (handler === 'vide') {
      info.video_codec = codec;
      const tkhd = find(trak, ['tkhd']);
      if (tkhd) {
        const end = tkhd.start + tkhd.size;
        info.width = Math.round(b.readUInt32BE(end - 8) / 65536);
        info.height = Math.round(b.readUInt32BE(end - 4) / 65536);
        // Matriks rotasi 90/270 derajat (video HP potret): lebar & tinggi tampilan ditukar
        const { version, body } = full(tkhd);
        const m = body + (version === 1 ? 32 : 20) + 16; // matriks a,b
        const a = b.readInt32BE(m), bb = b.readInt32BE(m + 4);
        if (a === 0 && Math.abs(bb) === 65536) [info.width, info.height] = [info.height, info.width];
      }
      const mdhd = find(trak, ['mdia', 'mdhd']);
      const stts = find(trak, ['mdia', 'minf', 'stbl', 'stts']);
      if (mdhd && stts) {
        const { version, body } = full(mdhd);
        const scale = version === 1 ? b.readUInt32BE(body + 16) : b.readUInt32BE(body + 8);
        const dur = version === 1 ? Number(b.readBigUInt64BE(body + 20)) : b.readUInt32BE(body + 12);
        const sb = full(stts).body;
        const n = b.readUInt32BE(sb);
        let samples = 0;
        for (let k = 0; k < n && sb + 8 + k * 8 <= stts.start + stts.size; k++) samples += b.readUInt32BE(sb + 4 + k * 8);
        if (scale && dur) info.fps = Math.round((samples / (dur / scale)) * 100) / 100;
      }
    } else if (handler === 'soun') info.audio_codec = codec;
  }
  return info;
}
// ---- akhir lib_mp4.js ----
