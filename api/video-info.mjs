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
    if (!videoId) throw new Error('올바른 YouTube URL이 아닙니다');

    console.log('[video-info] videoId:', videoId);
    const yt = await Innertube.create();
    const info = await yt.getBasicInfo(videoId);

    // 1. 자막 가져오기
    let transcript = [];
    try {
      const transcriptInfo = await yt.getTranscript(videoId);
      const segments = transcriptInfo?.transcript?.content?.body?.initial_segments || [];
      transcript = segments.map(seg => ({
        start: parseFloat(seg.start_ms) / 1000,
        end: parseFloat(seg.end_ms) / 1000,
        text: seg.snippet?.text || ''
      })).filter(s => s.text);
      console.log('[video-info] 자막:', transcript.length, '개');
    } catch (e) {
      console.log('[video-info] 자막 없음:', e.message);
    }

    // 2. 스토리보드 가져오기
    let storyboards = [];
    try {
      const sb = info.storyboards;
      if (sb) {
        const boards = sb.boards || sb;
        const list = Array.isArray(boards) ? boards : [boards];
        storyboards = list.map(b => ({
          url: b.template_url || b.url || '',
          width: b.thumbnail_width || b.width || 0,
          height: b.thumbnail_height || b.height || 0,
          cols: b.columns || b.cols || 0,
          rows: b.rows || 0,
          count: b.thumbnail_count || b.count || 0,
          interval: b.interval || 0,
        })).filter(b => b.url);
      }
      console.log('[video-info] 스토리보드:', storyboards.length, '개');
    } catch (e) {
      console.log('[video-info] 스토리보드 없음:', e.message);
    }

    // 3. 기본 정보
    const title = info.basic_info?.title || '';
    const duration = info.basic_info?.duration || 0;
    const thumbnail = `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`;

    res.status(200).json({
      videoId,
      title,
      duration,
      thumbnail,
      transcript,
      storyboards,
    });

  } catch (e) {
    console.error('[video-info] 에러:', e.message);
    res.status(500).json({ error: e.message });
  }
}
