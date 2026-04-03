// DuckDuckGo 이미지 검색 프록시
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const { q } = req.query;
  if (!q) { res.status(400).json({ error: 'q 파라미터 필수' }); return; }

  const BLOCKED = new Set([
    '123rf.com','shutterstock.com','gettyimages.com','istockphoto.com',
    'alamy.com','dreamstime.com','depositphotos.com','adobestock.com',
    'vectorstock.com','freepik.com','pngtree.com','vecteezy.com',
    'canstockphoto.com','bigstockphoto.com','pond5.com','fotolia.com'
  ]);

  try {
    // 1. vqd 토큰 가져오기
    const tokenRes = await fetch(`https://duckduckgo.com/?q=${encodeURIComponent(q)}&iax=images&ia=images`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      }
    });
    const tokenHtml = await tokenRes.text();
    const vqdMatch = tokenHtml.match(/vqd=([0-9a-zA-Z-]+)/);
    if (!vqdMatch) throw new Error('DuckDuckGo 토큰 추출 실패');
    const vqd = vqdMatch[1];

    // 2. 이미지 검색
    const searchRes = await fetch(`https://duckduckgo.com/i.js?l=kr-kr&o=json&q=${encodeURIComponent(q)}&vqd=${vqd}&f=size:Large`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Referer': 'https://duckduckgo.com/'
      }
    });

    if (!searchRes.ok) throw new Error('DuckDuckGo 검색 실패: ' + searchRes.status);
    const data = await searchRes.json();
    const results = data.results || [];

    // 3. 필터링
    const items = [];
    const seen = new Set();

    for (const r of results) {
      if (items.length >= 15) break;
      const link = r.image;
      if (!link || seen.has(link)) continue;

      try {
        const host = new URL(link).hostname.toLowerCase().replace(/^www\./, '');
        if (BLOCKED.has(host) || [...BLOCKED].some(d => host.endsWith('.' + d))) continue;
      } catch { continue; }

      const w = r.width || 0;
      const h = r.height || 0;
      if (w > 0 && w < 300) continue;
      if (h > 0 && h < 200) continue;

      seen.add(link);
      items.push({
        link,
        thumbnail: r.thumbnail || link,
        title: r.title || '',
        width: w || 800,
        height: h || 600,
        source: r.source || ''
      });
    }

    console.log('[image-search] q:', q, 'results:', items.length);
    res.json({ items });
  } catch (e) {
    console.error('[image-search] 에러:', e.message);
    res.status(500).json({ error: e.message });
  }
}
