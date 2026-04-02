import vm from 'vm';
import { Platform } from 'youtubei.js';

const origShim = { ...Platform.shim };
Platform.load({
  ...origShim,
  eval: async (data, env) => {
    const context = vm.createContext({ ...env });
    const code = data.output.replace(/\nreturn process\(/, '\nvar __result__ = process(');
    vm.runInContext(code, context);
    return context.__result__ || context;
  }
});

const { default: Innertube } = await import('youtubei.js');

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

    console.log('[download] Innertube 초기화...');
    const yt = await Innertube.create();

    console.log('[download] 영상 정보 가져오는 중...');
    const info = await yt.getBasicInfo(videoId);

    const format = info.chooseFormat({ type: 'video+audio', quality: 'best' });
    console.log('[download] 선택된 포맷:', format.quality_label, format.mime_type);

    const streamUrl = await format.decipher(yt.session.player);
    console.log('[download] decipher 완료, fetch 시작...');

    const videoRes = await fetch(streamUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 11) AppleWebKit/537.36 Chrome/90.0.4430.91 Mobile Safari/537.36',
        'Referer': 'https://www.youtube.com/',
      }
    });

    console.log('[download] 영상 fetch 응답:', videoRes.status);
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
