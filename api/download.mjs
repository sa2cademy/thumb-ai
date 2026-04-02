// YouTube API 요청 프록시 (CORS 우회용)
// 브라우저의 youtubei.js가 YouTube API를 호출할 때 이 프록시를 경유
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }

  const { url, method, headers, body } = req.body || {};
  if (!url) { res.status(400).json({ error: 'url 필수' }); return; }

  try {
    const fetchOpts = { method: method || 'POST' };

    if (headers) {
      // 프록시에 불필요한 헤더 제거
      const h = { ...headers };
      delete h['host'];
      delete h['origin'];
      delete h['referer'];
      fetchOpts.headers = h;
    }

    if (body) fetchOpts.body = typeof body === 'string' ? body : JSON.stringify(body);

    const response = await fetch(url, fetchOpts);
    const contentType = response.headers.get('content-type') || '';
    const data = await response.arrayBuffer();

    res.setHeader('Content-Type', contentType);
    res.status(response.status).send(Buffer.from(data));
  } catch (e) {
    console.error('[proxy] 에러:', e.message);
    res.status(500).json({ error: e.message });
  }
}
