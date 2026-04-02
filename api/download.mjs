const INVIDIOUS_INSTANCES = [
  'https://inv.nadeko.net',
  'https://invidious.nerdvpn.de',
  'https://invidious.jing.rocks',
  'https://invidious.privacyredirect.com',
  'https://iv.ggtyler.dev'
];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const { url, mode } = req.query;
  if (!url) { res.status(400).json({ error: 'URL이 없습니다' }); return; }

  try {
    const videoId = url.match(/(?:shorts\/|v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/)?.[1];
    if (!videoId) throw new Error('올바른 YouTube URL이 아닙니다');

    // invidious 인스턴스에서 스트림 URL 가져오기
    let streamUrl = null;
    let lastErr = '';

    for (const instance of INVIDIOUS_INSTANCES) {
      try {
        console.log(`[download] ${instance} 시도...`);
        const apiRes = await fetch(`${instance}/api/v1/videos/${videoId}`, {
          headers: { 'Accept': 'application/json' },
          signal: AbortSignal.timeout(10000)
        });
        if (!apiRes.ok) { lastErr = `${instance}: ${apiRes.status}`; continue; }

        const data = await apiRes.json();
        // video+audio 포맷 찾기
        const formats = data.formatStreams || [];
        const best = formats.find(f => f.container === 'mp4' && f.encoding?.includes('avc1'))
          || formats.find(f => f.container === 'mp4')
          || formats[0];

        if (best?.url) {
          streamUrl = best.url;
          console.log(`[download] ${instance}에서 스트림 URL 획득`);
          break;
        }
        lastErr = `${instance}: 포맷 없음`;
      } catch(e) {
        lastErr = `${instance}: ${e.message}`;
      }
    }

    if (!streamUrl) throw new Error('모든 인스턴스 실패: ' + lastErr);

    // mode=url이면 URL만 반환
    if (mode === 'url') {
      res.status(200).json({ url: streamUrl });
      return;
    }

    // 서버 프록시 모드
    const videoRes = await fetch(streamUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 11) AppleWebKit/537.36 Chrome/90.0.4430.91 Mobile Safari/537.36',
      }
    });

    if (!videoRes.ok) throw new Error('영상 다운로드 실패: ' + videoRes.status);

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', 'inline; filename="video.mp4"');

    let bytes = 0;
    const reader = videoRes.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      res.write(Buffer.from(value));
    }
    res.end();
    console.log('[download] 완료:', (bytes / 1024 / 1024).toFixed(2), 'MB');

  } catch (e) {
    console.error('[download] 에러:', e.message);
    if (!res.headersSent) {
      res.status(500).json({ error: e.message });
    }
  }
}
