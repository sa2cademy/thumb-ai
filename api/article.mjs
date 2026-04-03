export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const { url } = req.query;
  if (!url) { res.status(400).json({ error: 'URL이 없습니다' }); return; }

  try {
    console.log('[article] URL:', url);

    const pageRes = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html',
        'Accept-Language': 'ko-KR,ko;q=0.9',
      }
    });

    if (!pageRes.ok) throw new Error('페이지 로드 실패: ' + pageRes.status);

    // 인코딩 자동 감지
    const buf = await pageRes.arrayBuffer();
    let html;
    const contentType = pageRes.headers.get('content-type') || '';
    const charsetMatch = contentType.match(/charset=([^\s;]+)/i);
    let charset = charsetMatch ? charsetMatch[1].toLowerCase().replace(/['"]/g, '') : '';

    if (!charset) {
      const preview = new TextDecoder('ascii', { fatal: false }).decode(buf.slice(0, 4000));
      const metaMatch = preview.match(/charset=["']?([^"'\s;>]+)/i)
        || preview.match(/encoding=["']?([^"'\s;>]+)/i);
      if (metaMatch) charset = metaMatch[1].toLowerCase();
    }

    const eucKrAliases = ['euc-kr','euckr','ks_c_5601-1987','cp949','ms949','windows-949','x-windows-949'];
    if (eucKrAliases.includes(charset)) {
      html = new TextDecoder('euc-kr').decode(buf);
    } else {
      // UTF-8로 시도, 깨지면 EUC-KR로 재시도
      html = new TextDecoder('utf-8').decode(buf);
      if (html.includes('\uFFFD')) {
        try { html = new TextDecoder('euc-kr').decode(buf); } catch {}
      }
    }

    // 제목 추출
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : '';

    // og:description
    const ogDescMatch = html.match(/<meta[^>]*property="og:description"[^>]*content="([^"]*)"/)
      || html.match(/<meta[^>]*name="description"[^>]*content="([^"]*)"/) ;
    const description = ogDescMatch ? ogDescMatch[1] : '';

    // 본문 추출: <article> 또는 본문 영역
    let body = '';

    // 1. <article> 태그
    const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
    if (articleMatch) {
      body = articleMatch[1];
    }

    // 2. 네이버 뉴스
    if (!body) {
      const naverMatch = html.match(/id="dic_area"[^>]*>([\s\S]*?)<\/div>/)
        || html.match(/id="articleBodyContents"[^>]*>([\s\S]*?)<\/div>/)
        || html.match(/class="article_body"[^>]*>([\s\S]*?)<\/div>/);
      if (naverMatch) body = naverMatch[1];
    }

    // 3. 일반 <p> 태그 모음
    if (!body) {
      const paragraphs = [];
      const pRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
      let m;
      while ((m = pRegex.exec(html)) !== null) {
        const text = m[1].replace(/<[^>]+>/g, '').trim();
        if (text.length > 20) paragraphs.push(text);
      }
      body = paragraphs.join('\n\n');
    }

    // HTML 태그 제거 + 정리
    const cleanBody = body
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
      .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    console.log('[article] 제목:', title, '본문 길이:', cleanBody.length);

    res.json({ title, description, body: cleanBody, url });

  } catch (e) {
    console.error('[article] 에러:', e.message);
    res.status(500).json({ error: e.message });
  }
}
