// Bing 이미지 검색 프록시 (CORS 우회)
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const { q, first = 1 } = req.query;
  if (!q) { res.status(400).json({ error: 'q 파라미터 필수' }); return; }

  try {
    const url = `https://www.bing.com/images/search?q=${encodeURIComponent(q)}&qft=+filterui:imagesize-large+filterui:photo-photo&form=IRFLTR&first=${first}`;

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

    // murl 파싱
    const items = [];
    const seen = new Set();
    const BLOCKED = new Set([
      '123rf.com','shutterstock.com','gettyimages.com','istockphoto.com',
      'alamy.com','dreamstime.com','depositphotos.com','adobestock.com',
      'vectorstock.com','freepik.com','pngtree.com','vecteezy.com'
    ]);

    const murlRe = /"murl":"(https?[^"]+)"/g;
    const wRe = /"imgw":(\d+)/;
    const hRe = /"imgh":(\d+)/;
    const titleRe = /"t":"([^"]+)"/;
    let m;

    while ((m = murlRe.exec(html)) !== null && items.length < 12) {
      let link;
      try { link = decodeURIComponent(m[1].replace(/\\u0026/g, '&').replace(/&amp;/g, '&')); }
      catch { link = m[1]; }

      if (!link || seen.has(link)) continue;
      try {
        const host = new URL(link).hostname.toLowerCase().replace(/^www\./, '');
        if (BLOCKED.has(host) || [...BLOCKED].some(d => host.endsWith('.' + d))) continue;
      } catch { continue; }

      const ctx = html.slice(Math.max(0, m.index - 100), m.index + 400);
      const w = parseInt(ctx.match(wRe)?.[1] || '0', 10);
      const h = parseInt(ctx.match(hRe)?.[1] || '0', 10);
      const title = (ctx.match(titleRe)?.[1] || '').replace(/\\u[\dA-Fa-f]{4}/g,
        ch => String.fromCharCode(parseInt(ch.slice(2), 16)));

      if (w > 0 && w < 400) continue;
      if (h > 0 && h < 300) continue;

      seen.add(link);
      items.push({ link, title, width: w || 800, height: h || 600 });
    }

    res.json({ items });
  } catch (e) {
    console.error('[image-search] 에러:', e.message);
    res.status(500).json({ error: e.message });
  }
}
