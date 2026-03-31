import { Innertube } from 'youtubei.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const { url } = req.query;
  if (!url) {
    res.status(400).json({ error: 'URL이 없습니다' });
    return;
  }

  try {
    const videoId = url.match(/(?:shorts\/|v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/)?.[1];
    if (!videoId) throw new Error('올바른 YouTube URL이 아닙니다');

    const yt = await Innertube.create();
    const info = await yt.getInfo(videoId);

    // 오디오+비디오 합쳐진 포맷 중 최고화질
    const formats = info.streaming_data?.formats || [];
    const adaptiveFormats = info.streaming_data?.adaptive_formats || [];
    const allFormats = [...formats, ...adaptiveFormats];

    // 합쳐진 포맷 우선
    let format = formats.sort((a, b) => (b.width || 0) - (a.width || 0))[0];
    
    // 없으면 adaptive에서 비디오만 (화질 최고)
    if (!format?.url) {
      format = adaptiveFormats
        .filter(f => f.mime_type?.includes('video/mp4'))
        .sort((a, b) => (b.width || 0) - (a.width || 0))[0];
    }

    if (!format?.url) throw new Error('스트림 URL을 찾을 수 없습니다. 포맷 수: ' + allFormats.length);

    const videoRes = await fetch(format.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
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
