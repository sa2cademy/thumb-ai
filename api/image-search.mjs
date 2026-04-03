// Bing 이미지 검색 프록시 (async 엔드포인트 — 확장 프로그램과 동일한 murl 결과)
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const { q, first = 1 } = req.query;
  if (!q) { res.status(400).json({ error: 'q 파라미터 필수' }); return; }

  const BLOCKED = new Set([
    '123rf.com','shutterstock.com','gettyimages.com','istockphoto.com',
    'alamy.com','dreamstime.com','depositphotos.com','adobestock.com',
    'vectorstock.com','freepik.com','pngtree.com','vecteezy.com',
    'canstockphoto.com','bigstockphoto.com','pond5.com','fotolia.com'
  ]);

  try {
    const bingFirst = first <= 1 ? 0 : (Math.floor((first - 1) / 10) * 10);
    const url = `https://www.bing.com/images/async?q=${encodeURIComponent(q)}&first=${bingFirst}&count=35&qft=+filterui:imagesize-large+filterui:photo-photo&SFX=2&mmasync=1`;

    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
        'Referer': 'https://www.bing.com/'
      }
    });

    if (!r.ok) throw new Error('Bing 오류: ' + r.status);
    const html = await r.text();

    const items = [];
    const seen = new Set();

    // murl 파싱 (HTML entity 인코딩: murl&quot;:&quot;URL&quot;)
    const murlRe = /murl&quot;:&quot;(https?[^&]+)&quot;/gi;
    const wRe = /imgw&quot;:(\d+)/;
    const hRe = /imgh&quot;:(\d+)/;
    const titleRe = /t&quot;:&quot;([^&]+)&quot;/;
    let m;

    while ((m = murlRe.exec(html)) !== null && items.length < 12) {
      let link;
      try { link = decodeURIComponent(m[1]); }
      catch { link = m[1]; }

      if (!link || seen.has(link)) continue;
      try {
        const host = new URL(link).hostname.toLowerCase().replace(/^www\./, '');
        if (BLOCKED.has(host) || [...BLOCKED].some(d => host.endsWith('.' + d))) continue;
      } catch { continue; }
      if (['watermark', 'wm_', '/wm/', 'placeholder'].some(k => link.toLowerCase().includes(k))) continue;

      const ctx = html.slice(Math.max(0, m.index - 200), m.index + 500);
      const w = parseInt(ctx.match(wRe)?.[1] || '0', 10);
      const h = parseInt(ctx.match(hRe)?.[1] || '0', 10);
      const title = (ctx.match(titleRe)?.[1] || '').replace(/\\u[\dA-Fa-f]{4}/g,
        ch => String.fromCharCode(parseInt(ch.slice(2), 16)));

      if (w > 0 && w < 400) continue;
      if (h > 0 && h < 300) continue;

      seen.add(link);
      items.push({ link, thumbnail: link, title, sizewidth: w || 800, sizeheight: h || 600 });
    }

    console.log('[image-search] q:', q, 'results:', items.length);
    res.json({ items });
  } catch (e) {
    console.error('[image-search] 에러:', e.message);
    res.status(500).json({ error: e.message });
  }
}
