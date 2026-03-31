export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const { url } = req.query;
  if (!url) { res.status(400).json({ error: 'URL이 없습니다' }); return; }

  try {
    const videoId = url.match(/(?:shorts\/|v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/)?.[1];
    if (!videoId) throw new Error('올바른 YouTube URL이 아닙니다');

    const YT_KEY = process.env.YT_API_KEY;

    const playerRes = await fetch(`https://www.youtube.com/youtubei/v1/player?key=${YT_KEY}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 Chrome/90.0.4430.91 Mobile Safari/537.36',
        'Origin': 'https://www.youtube.com',
        'Referer': 'https://www.youtube.com/',
        'X-YouTube-Client-Name': '2',
        'X-YouTube-Client-Version': '19.09.3',
      },
      body: JSON.stringify({
        videoId,
        context: {
          client: {
            clientName: 'ANDROID',
            clientVersion: '19.09.3',
            androidSdkVersion: 30,
            hl: 'ko',
            gl: 'KR',
          }
        }
      })
    });

    const data = await playerRes.json();
    const formats = data.streamingData?.formats || [];
    if (!formats.length) throw new Error('포맷 없음 - YouTube가 차단했습니다');

    const format = formats.sort((a, b) => (b.width || 0) - (a.width || 0))[0];
    if (!format?.url) throw new Error('다운로드 URL 없음');

    const videoRes = await fetch(format.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 11) AppleWebKit/537.36 Chrome/90.0.4430.91 Mobile Safari/537.36',
        'Referer': 'https://www.youtube.com/',
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
