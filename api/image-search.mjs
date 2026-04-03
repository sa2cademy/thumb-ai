// Bing 이미지 검색 프록시 (CORS 우회)
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const { q, first = 1 } = req.query;
  if (!q) { res.status(400).json({ error: 'q 파라미터 필수' }); return; }

  try {
    const url = `https://www.bing.com/images/search?q=${encodeURIComponent(q)}&first=${first}`;

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
    const BLOCKED = new Set([
      '123rf.com','shutterstock.com','gettyimages.com','istockphoto.com',
      'alamy.com','dreamstime.com','depositphotos.com','adobestock.com',
      'vectorstock.com','freepik.com','pngtree.com','vecteezy.com'
    ]);

    // 방법 1: mediaurl 파싱 (서버 사이드 HTML)
    const mediaRe = /mediaurl=(https?[^&"]+)&[^"]*exph=(\d+)&[^"]*expw=(\d+)/g;
    const labelRe = /aria-label="([^"]+)"/;
    let m;

    while ((m = mediaRe.exec(html)) !== null && items.length < 12) {
      let link;
      try { link = decodeURIComponent(m[1]); }
      catch { link = m[1]; }

      if (!link || seen.has(link)) continue;
      try {
        const host = new URL(link).hostname.toLowerCase().replace(/^www\./, '');
        if (BLOCKED.has(host) || [...BLOCKED].some(d => host.endsWith('.' + d))) continue;
      } catch { continue; }

      const h = parseInt(m[2] || '0', 10);
      const w = parseInt(m[3] || '0', 10);
      if (w > 0 && w < 300) continue;
      if (h > 0 && h < 200) continue;

      // 주변 텍스트에서 제목 추출
      const ctx = html.slice(Math.max(0, m.index - 300), m.index + 500);
      const titleMatch = ctx.match(labelRe);
      const title = titleMatch ? titleMatch[1] : '';

      seen.add(link);
      items.push({ link, title, width: w || 800, height: h || 600 });
    }

    // 방법 2: murl 파싱 (클라이언트 사이드 JSON — fallback)
    if (items.length < 3) {
      const murlRe = /"murl":"(https?[^"]+)"/g;
      while ((m = murlRe.exec(html)) !== null && items.length < 12) {
        let link;
        try { link = decodeURIComponent(m[1].replace(/\\u0026/g, '&').replace(/&amp;/g, '&')); }
        catch { link = m[1]; }

        if (!link || seen.has(link)) continue;
        try {
          const host = new URL(link).hostname.toLowerCase().replace(/^www\./, '');
          if (BLOCKED.has(host) || [...BLOCKED].some(d => host.endsWith('.' + d))) continue;
        } catch { continue; }

        seen.add(link);
        items.push({ link, title: '', width: 800, height: 600 });
      }
    }

    console.log('[image-search] q:', q, 'results:', items.length);
    res.json({ items });
  } catch (e) {
    console.error('[image-search] 에러:', e.message);
    res.status(500).json({ error: e.message });
  }
}
