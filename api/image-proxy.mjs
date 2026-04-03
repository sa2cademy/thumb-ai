// 이미지 다운로드 프록시 (CORS 우회)
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { url } = req.query;
  if (!url) { res.status(400).end(); return; }

  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
        'Referer': new URL(url).origin + '/'
      }
    });
    if (!r.ok) { res.status(r.status).end(); return; }

    const contentType = r.headers.get('content-type') || 'image/jpeg';
    res.setHeader('Content-Type', contentType);

    const buf = await r.arrayBuffer();
    res.send(Buffer.from(buf));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
