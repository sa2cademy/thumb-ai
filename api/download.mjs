export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const { url, mode } = req.query;
  if (!url) { res.status(400).json({ error: 'URL이 없습니다' }); return; }

  try {
    const videoId = url.match(/(?:shorts\/|v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/)?.[1];
    if (!videoId) throw new Error('올바른 YouTube URL이 아닙니다');

    console.log('[download] videoId:', videoId, 'mode:', mode || 'proxy');

    // YouTube 웹페이지 HTML에서 스트림 URL 추출
    const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const htmlRes = await fetch(watchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
        'Accept': 'text/html,application/xhtml+xml',
      }
    });

    if (!htmlRes.ok) throw new Error('YouTube 페이지 로드 실패: ' + htmlRes.status);
    const html = await htmlRes.text();

    // ytInitialPlayerResponse 추출
    let playerResponse;
    const prMatch = html.match(/var ytInitialPlayerResponse\s*=\s*(\{.+?\});/s);
    if (prMatch) {
      playerResponse = JSON.parse(prMatch[1]);
    } else {
      // 다른 패턴 시도
      const prMatch2 = html.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\});/s);
      if (prMatch2) {
        playerResponse = JSON.parse(prMatch2[1]);
      }
    }

    if (!playerResponse) throw new Error('플레이어 데이터를 찾을 수 없습니다');

    const streamingData = playerResponse.streamingData;
    if (!streamingData) throw new Error('스트리밍 데이터 없음 (로그인 필요 또는 제한된 영상)');

    // video+audio 포맷 찾기 (formats = muxed, adaptiveFormats = separate)
    const formats = streamingData.formats || [];
    const best = formats.find(f => f.mimeType?.includes('video/mp4') && f.qualityLabel === '720p')
      || formats.find(f => f.mimeType?.includes('video/mp4') && f.qualityLabel === '480p')
      || formats.find(f => f.mimeType?.includes('video/mp4'))
      || formats[0];

    if (!best) throw new Error('적합한 포맷을 찾을 수 없습니다');

    const streamUrl = best.url;
    if (!streamUrl) {
      // signatureCipher가 있는 경우 (암호화된 URL)
      if (best.signatureCipher) {
        throw new Error('암호화된 스트림 (서버에서 해독 불가) - 파일을 직접 올려주세요');
      }
      throw new Error('스트림 URL 없음');
    }

    console.log('[download] 스트림 URL 추출 성공:', best.qualityLabel, best.mimeType);

    // mode=url → URL만 반환 (브라우저가 직접 다운로드)
    if (mode === 'url') {
      res.status(200).json({ url: streamUrl, quality: best.qualityLabel });
      return;
    }

    // 서버 프록시 모드 (로컬 개발서버용)
    const videoRes = await fetch(streamUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.youtube.com/',
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
