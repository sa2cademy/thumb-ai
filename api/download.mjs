const PIPED_INSTANCES = [
  'https://pipedapi.kavin.rocks',
  'https://api.piped.private.coffee',
  'https://pipedapi.darkness.services',
  'https://pipedapi.syncpundit.io',
  'https://api.piped.yt'
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

    let streamUrl = null;
    let lastErr = '';

    for (const instance of PIPED_INSTANCES) {
      try {
        console.log(`[download] ${instance} 시도...`);
        const apiRes = await fetch(`${instance}/streams/${videoId}`, {
          signal: AbortSignal.timeout(10000)
        });

        if (!apiRes.ok) { lastErr = `${instance}: ${apiRes.status}`; continue; }

        const contentType = apiRes.headers.get('content-type') || '';
        if (!contentType.includes('json')) { lastErr = `${instance}: JSON 아님`; continue; }

        const data = await apiRes.json();

        // video+audio 포맷 (videoStreams에서 videoOnly가 아닌 것)
        const streams = data.videoStreams?.filter(s => !s.videoOnly && s.mimeType?.includes('mp4')) || [];
        // 720p 이하에서 가장 좋은 화질
        const best = streams.find(s => s.quality === '720p')
          || streams.find(s => s.quality === '480p')
          || streams.find(s => s.quality === '360p')
          || streams[0];

        // videoStreams에 video+audio가 없으면 audioStreams에서 오디오만이라도
        if (!best) {
          // hls 사용
          if (data.hls) { streamUrl = data.hls; break; }
          lastErr = `${instance}: 적합한 포맷 없음`;
          continue;
        }

        streamUrl = best.url;
        console.log(`[download] ${instance} 성공: ${best.quality}`);
        break;
      } catch(e) {
        lastErr = `${instance}: ${e.message}`;
      }
    }

    if (!streamUrl) throw new Error('영상 URL 추출 실패: ' + lastErr);

    // mode=url이면 URL만 반환 (브라우저가 직접 다운로드)
    if (mode === 'url') {
      res.status(200).json({ url: streamUrl });
      return;
    }

    // 서버 프록시 모드
    const videoRes = await fetch(streamUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 11) AppleWebKit/537.36 Chrome/90.0.4430.91 Mobile Safari/537.36' },
      signal: AbortSignal.timeout(50000)
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
