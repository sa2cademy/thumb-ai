export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const { url } = req.query;
  if (!url) { res.status(400).json({ error: 'URL이 없습니다' }); return; }

  try {
    const videoId = url.match(/(?:shorts\/|v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/)?.[1];
    console.log('[download] videoId:', videoId);
    if (!videoId) throw new Error('올바른 YouTube URL이 아닙니다');

    // cobalt API로 다운로드 URL 가져오기
    console.log('[download] cobalt API 호출...');
    const cobaltRes = await fetch('https://api.cobalt.tools/', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        url: `https://www.youtube.com/watch?v=${videoId}`,
        videoQuality: '720',
        youtubeVideoCodec: 'h264',
        downloadMode: 'auto'
      })
    });

    const cobaltData = await cobaltRes.json();
    console.log('[download] cobalt 응답:', cobaltData.status);

    if (!cobaltRes.ok || (cobaltData.status !== 'tunnel' && cobaltData.status !== 'redirect')) {
      throw new Error(cobaltData.error?.code || cobaltData.text || 'cobalt API 실패');
    }

    // cobalt에서 받은 URL로 영상 다운로드
    console.log('[download] 영상 fetch 시작...');
    const videoRes = await fetch(cobaltData.url);
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
    console.log('[download] 완료. 전송:', (bytes / 1024 / 1024).toFixed(2), 'MB');

  } catch (e) {
    console.error('[download] 에러:', e.message);
    if (!res.headersSent) {
      res.status(500).json({ error: e.message });
    }
  }
}
