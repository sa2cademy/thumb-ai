export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const { url } = req.query;
  if (!url) { res.status(400).json({ error: 'URL이 없습니다' }); return; }

  try {
    const videoId = url.match(/(?:shorts\/|v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/)?.[1];
    if (!videoId) throw new Error('올바른 YouTube URL이 아닙니다');

    // Invidious 공개 인스턴스 목록 (순차 시도)
    const instances = [
      'https://invidious.privacydev.net',
      'https://vid.puffyan.us',
      'https://invidious.nerdvpn.de',
      'https://inv.tux.pizza',
      'https://invidious.flokinet.to',
    ];

    let videoUrl = null;
    let lastError = '';

    for (const instance of instances) {
      try {
        const apiRes = await fetch(`${instance}/api/v1/videos/${videoId}?fields=formatStreams,adaptiveFormats`, {
          headers: { 'User-Agent': 'thumb-ai/1.0' },
          signal: AbortSignal.timeout(6000)
        });

        if (!apiRes.ok) continue;
        const data = await apiRes.json();

        // formatStreams = 오디오+비디오 합쳐진 것
        const streams = data.formatStreams || [];
        const best = streams.sort((a, b) => (parseInt(b.resolution) || 0) - (parseInt(a.resolution) || 0))[0];

        if (best?.url) {
          videoUrl = best.url;
          break;
        }
      } catch(e) {
        lastError = e.message;
        continue;
      }
    }

    if (!videoUrl) throw new Error('모든 인스턴스 실패: ' + lastError);

    // 영상 프록시
    const videoRes = await fetch(videoUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      }
    });

    if (!videoRes.ok) throw new Error('영상 fetch 실패: ' + videoRes.status);

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', 'inline; filename="video.mp4"');

    const reader = videoRes.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
