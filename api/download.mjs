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

    const yt = await Innertube.create();

    console.log('[download] 다운로드 시작...');
    const stream = await yt.download(videoId, {
      type: 'video+audio',
      quality: 'best',
    });

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', 'inline; filename="video.mp4"');

    const reader = stream.getReader();
    let bytes = 0;
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
