export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const { url } = req.query;
  if (!url) { res.status(400).json({ error: 'URL이 없습니다' }); return; }

  try {
    const videoId = url.match(/(?:shorts\/|v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/)?.[1];
    if (!videoId) throw new Error('올바른 YouTube URL이 아닙니다');

    console.log('[captions] videoId:', videoId);

    // YouTube 페이지를 모바일 UA로 가져오기 (더 가벼운 응답)
    const pageRes = await fetch(`https://m.youtube.com/watch?v=${videoId}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
        'Accept': 'text/html,application/xhtml+xml',
      }
    });
    const html = await pageRes.text();
    console.log('[captions] HTML 길이:', html.length);

    // ytInitialPlayerResponse에서 자막 트랙 추출
    const playerMatch = html.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\});\s*(?:var|<\/script)/s);
    if (!playerMatch) {
      console.log('[captions] ytInitialPlayerResponse 못 찾음');
      res.json({ captions: null, message: '영상 데이터를 파싱할 수 없습니다' });
      return;
    }

    const playerData = JSON.parse(playerMatch[1]);
    const tracks = playerData.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
    console.log('[captions] 트랙 수:', tracks.length);

    if (!tracks.length) {
      res.json({ captions: null, message: '자막이 없는 영상입니다' });
      return;
    }

    // 한국어 우선
    const track = tracks.find(t => t.languageCode === 'ko')
      || tracks.find(t => t.languageCode === 'en')
      || tracks[0];

    console.log('[captions] 선택 언어:', track.languageCode);

    // 자막 XML 가져오기 (같은 세션 쿠키 사용)
    const setCookies = pageRes.headers.getSetCookie?.() || [];
    const cookieStr = setCookies.map(c => c.split(';')[0]).join('; ');

    const xmlRes = await fetch(track.baseUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
        'Cookie': cookieStr,
        'Referer': `https://m.youtube.com/watch?v=${videoId}`,
      }
    });
    const xml = await xmlRes.text();
    console.log('[captions] XML 길이:', xml.length);

    if (xml.length > 0) {
      const lines = [];
      const regex = /<text start="([^"]*)" dur="([^"]*)"[^>]*>([\s\S]*?)<\/text>/g;
      let match;
      while ((match = regex.exec(xml)) !== null) {
        const start = parseFloat(match[1]);
        const text = match[3]
          .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
          .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/<[^>]+>/g, '').trim();
        if (text) lines.push({ start, text });
      }
      console.log('[captions] 파싱된 줄 수:', lines.length);
      res.json({ captions: lines, language: track.languageCode });
    } else {
      res.json({ captions: null, message: '자막 데이터가 비어있습니다' });
    }

  } catch (e) {
    console.error('[captions] 에러:', e.message);
    res.status(500).json({ error: e.message });
  }
}
