// ── 사진 찾기 엔진 (확장 프로그램 로직 포팅) ──

const PF = (() => {
  const MAX_QUERY_COUNT = 5;
  const INITIAL_TARGET = 20;
  const SECOND_PASS_TOP_K = 8;
  const SECOND_PASS_MIN_POOL = 3;
  const MIN_IMAGE_SIZE = 400;

  const BANNED_HINTS = [
    '차트','그래프','인포그래픽','통계','보고서','리포트','기사','뉴스','속보',
    '썸네일','실적','주가','캡처','가사','리뷰','해석','분석','신문','카드뉴스',
    '자막','문구','텍스트','문서','책','교재','worksheet','pdf',
    'thumbnail','screenshot','document','paper','book'
  ];
  const WATERMARK_HINTS = [
    'shutterstock','getty','alamy','istock','adobestock','depositphotos',
    'dreamstime','123rf','pngtree','freepik','vecteezy','vectorstock'
  ];
  const STOCK_HINTS = ['businessman','business person','stock photo','freepik','pexels','pixabay','smiling business'];
  const BAD_DOMAIN_HINTS = ['blog','tistory','velog'];
  const GROUP_HINTS = ['group','all member','all members','단체','전원','멤버','무대','공연','stage'];
  const PERSON_POSITIVE = ['official','press','portrait','close up','smile','event','화보','공식','현장포토','표정','미소','행사','프로필'];
  const BRAND_POSITIVE = ['headquarters','hq','office','building','본사','사옥','로고'];

  const KNOWN_ENTITIES = [
    { label:'BTS', type:'group', aliases:['bts','방탄','방탄소년단'], queries:['BTS 단체사진','BTS official group photo','방탄소년단 공식 단체사진'] },
    { label:'넷플릭스', type:'brand', aliases:['넷플릭스','netflix'], queries:['넷플릭스 본사','Netflix headquarters'] },
    { label:'태극기', type:'symbol', aliases:['태극기','대한민국 국기'], queries:['태극기 사진','태극기 펄럭이는 사진'] },
  ];

  function tokenize(text) { return String(text||'').split(/[\s,.\-_:;!?·]+/).filter(t => t.length >= 1); }
  function uniqueStrings(arr) { return [...new Set(arr.filter(Boolean))]; }

  function detectEntity(text, anchors=[]) {
    const lower = String(text||'').toLowerCase();
    for (const rule of KNOWN_ENTITIES) {
      if (rule.aliases.some(a => lower.includes(a.toLowerCase()))) return {...rule};
    }
    const match = anchors.find(e => lower.includes(String(e).toLowerCase()));
    if (match) return { label: match, type: inferType(match), aliases: [], queries: [] };
    const words = tokenize(text).filter(t => t.length >= 2);
    const explicit = words.find(t => /[A-Z]{2,}/.test(t) || /[가-힣]{2,}/.test(t));
    return explicit ? { label: explicit, type: inferType(explicit), aliases: [], queries: [] } : null;
  }

  function inferType(label) {
    const t = String(label||'');
    if (/BTS|방탄/.test(t)) return 'group';
    if (/넷플릭스|Netflix|회사|기업|브랜드/.test(t)) return 'brand';
    if (/태극기|국기/.test(t)) return 'symbol';
    if (/^[가-힣]{2,4}$/.test(t.trim())) return 'person';
    return 'general';
  }

  function guessSceneRole(sentence) {
    const s = String(sentence||'');
    if (/[?？]$/.test(s)) return 'hook';
    if (/구독|좋아요|알림|팔로우/.test(s)) return 'outro';
    if (/억|조|달러|\$|%|매출|수익|기록/.test(s)) return 'achievement';
    if (/자부심|대한민국|우리나라|한국인/.test(s)) return 'pride';
    if (/근데|그런데|사실|알고/.test(s)) return 'transition';
    return 'general';
  }

  function shouldUseFallback(sentence, localEntity, keyword) {
    if (!keyword) return false;
    if (localEntity && ['brand','group','person','symbol'].includes(localEntity.type)) return false;
    const text = String(sentence||'');
    if (/[?？]$/.test(text) || /^-/.test(text.trim())) return true;
    if (/이건|이제|그냥|사실|보면|생각|설명|입니다/.test(text)) return true;
    return tokenize(text).length <= 6;
  }

  function buildQueries(entity, sentence, keyword) {
    if (!entity) return [];
    const base = [...(entity.queries||[])];
    const label = entity.label;
    if (entity.type === 'group') {
      base.push(`${label} 단체사진`, `${label} official group photo`);
    } else if (entity.type === 'person') {
      base.push(`${label} 사진`, `${label} 인물사진`, `${label} 프로필 사진`, `${label} photo`, `${label} 공식 화보`);
    } else if (entity.type === 'brand') {
      base.push(`${label} 본사`, `${label} headquarters`, `${label} 공식 행사 사진`);
    } else if (entity.type === 'symbol') {
      base.push(`${label} 사진`, `${label} high quality`);
    } else {
      base.push(`${label}`, `${label} 사진`, `${label} official photo`);
    }
    return uniqueStrings(base).slice(0, MAX_QUERY_COUNT);
  }

  function buildPlan(index, sentences, keyword, globalPlan) {
    const sentence = sentences[index] || '';
    const localEntity = detectEntity(sentence, globalPlan.anchor_entities);
    const repEntity = detectEntity(keyword || '', globalPlan.anchor_entities)
      || { label: keyword || globalPlan.primary_entity || '핵심 대상', type: 'general', queries: [] };
    const useFallback = shouldUseFallback(sentence, localEntity, keyword);
    const target = useFallback ? (repEntity || localEntity) : (localEntity || repEntity);
    if (!target) return null;

    const mustMatch = uniqueStrings([...tokenize(target.label)]).slice(0, 6);
    const queries = uniqueStrings([
      ...buildQueries(target, sentence, keyword),
      ...(useFallback ? buildQueries(repEntity, sentence, keyword) : [])
    ]).slice(0, MAX_QUERY_COUNT);

    return {
      target_entity: target.label,
      entity_type: target.type || 'general',
      visual_intent: `${target.label}가 또렷하게 보이는 대표 장면`,
      must_match_tokens: mustMatch,
      search_queries: queries,
      reasoning_short: useFallback
        ? `설명 문장 → ${target.label} 사진으로 매칭`
        : `${target.label}가 바로 드러나는 사진 우선`,
      used_fallback: useFallback
    };
  }

  function evaluateCandidate(item, query, plan) {
    const title = String(item.title || '').toLowerCase();
    const link = String(item.link || '');
    const w = item.width || 800;
    const h = item.height || 600;
    const haystack = `${title} ${link} ${query}`.toLowerCase();

    if (w > 0 && w < MIN_IMAGE_SIZE) return null;
    if (BANNED_HINTS.some(b => haystack.includes(b))) return null;
    if (WATERMARK_HINTS.some(b => haystack.includes(b))) return null;

    const exactness = (plan.must_match_tokens || [])
      .filter(t => t.length >= 2)
      .reduce((acc, t) => acc + (haystack.includes(t.toLowerCase()) ? 1 : 0), 0);

    if (['group','brand','symbol'].includes(plan.entity_type) && exactness <= 0) return null;

    let score = 0;
    score += Math.min(w, 2200) / 110;
    score += Math.min(h, 2200) / 110;
    score += exactness * 30;

    try {
      const host = new URL(link).hostname.toLowerCase();
      if (BAD_DOMAIN_HINTS.some(b => host.includes(b))) score -= 20;
    } catch {}

    if (STOCK_HINTS.some(b => haystack.includes(b))) score -= 28;
    if (plan.entity_type === 'group' && GROUP_HINTS.some(b => haystack.includes(b))) score += 18;
    if (plan.entity_type === 'person' && PERSON_POSITIVE.some(b => haystack.includes(b))) score += 16;
    if (plan.entity_type === 'brand' && BRAND_POSITIVE.some(b => haystack.includes(b))) score += 16;

    if (score < 8) return null;
    return { ...item, score, sourceQuery: query };
  }

  async function searchBing(query, first = 1) {
    const res = await fetch(`/api/image-search?q=${encodeURIComponent(query)}&first=${first}`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.items || [];
  }

  async function searchWithPriority(queries, plan) {
    const collected = [];
    const seen = new Set();
    for (const query of queries) {
      let start = 1;
      while (start <= 91 && collected.length < INITIAL_TARGET) {
        const items = await searchBing(query, start);
        for (const item of items) {
          const key = item.link;
          if (seen.has(key)) continue;
          seen.add(key);
          const scored = evaluateCandidate(item, query, plan);
          if (scored) collected.push(scored);
        }
        start += 10;
        if (items.length < 2) break;
      }
      if (collected.length >= INITIAL_TARGET) break;
    }
    return collected.sort((a, b) => b.score - a.score);
  }

  async function rerankWithClaude(photos, plan, apiKey) {
    if (photos.length < SECOND_PASS_MIN_POOL || !apiKey) return photos;
    const top = photos.slice(0, SECOND_PASS_TOP_K);
    try {
      const prompt = `너는 사진 최종 셀렉터다. 메타데이터만 보고 가장 적합한 순서로 JSON 반환.

핵심 대상: ${plan.target_entity}
대상 유형: ${plan.entity_type}
장면 의도: ${plan.visual_intent}
규칙: 랜덤 얼굴/문서/기사형이면 뒤로. 그룹이면 단체사진 우선.

후보:
${top.map((p, i) => `${i + 1}. title=${p.title || '(없음)'} / size=${p.width}x${p.height} / query=${p.sourceQuery || ''}`).join('\n')}

JSON만: {"ordered_indices":[1,2,3,...]}`;

      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
        body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 300, messages: [{ role: 'user', content: prompt }] })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      const text = data.content[0].text;
      const json = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || '{}');
      const ordered = Array.isArray(json.ordered_indices) ? json.ordered_indices : [];
      if (!ordered.length) return photos;

      const reordered = [];
      const used = new Set();
      for (const idx of ordered) {
        const p = top[idx - 1];
        if (!p) continue;
        if (used.has(p.link)) continue;
        reordered.push({ ...p, score: p.score + 38 - reordered.length * 4 });
        used.add(p.link);
      }
      top.forEach(p => { if (!used.has(p.link)) reordered.push(p); });
      return [...reordered, ...photos.slice(SECOND_PASS_TOP_K)].sort((a, b) => b.score - a.score);
    } catch (e) {
      console.warn('rerank fallback:', e.message);
      return photos;
    }
  }

  async function analyzeScript(sentences, keyword, apiKey) {
    const fallback = {
      overall_tone: keyword ? `${keyword} 중심 설명형` : '대표 대상 중심 설명형',
      anchor_entities: keyword ? [keyword] : [],
      primary_entity: keyword || '핵심 대상'
    };
    if (!apiKey) return fallback;
    try {
      const prompt = `너는 영상 비주얼 디렉터다. 대본을 읽고 JSON만 출력.

대표 키워드: ${keyword || '(없음)'}
대본:
${sentences.slice(0, 30).map((s, i) => `${i + 1}. ${s}`).join('\n')}

JSON: {"overall_tone":"톤","anchor_entities":["핵심대상1","핵심대상2"],"primary_entity":"메인대상"}`;

      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
        body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 500, messages: [{ role: 'user', content: prompt }] })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      const text = data.content[0].text;
      const json = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || '{}');
      return {
        overall_tone: json.overall_tone || fallback.overall_tone,
        anchor_entities: Array.isArray(json.anchor_entities) ? json.anchor_entities : fallback.anchor_entities,
        primary_entity: keyword || json.primary_entity || fallback.primary_entity
      };
    } catch (e) {
      console.warn('analyzeScript fallback:', e.message);
      return fallback;
    }
  }

  // ── 메인 함수 ──
  async function findPhotos(sentences, keyword, apiKey, onProgress) {
    onProgress?.('AI가 대본을 분석하고 있어요...', 0);
    const globalPlan = await analyzeScript(sentences, keyword, apiKey);

    const results = [];
    for (let i = 0; i < sentences.length; i++) {
      onProgress?.(`사진 검색 중... (${i + 1}/${sentences.length})`, (i / sentences.length) * 100);

      const plan = buildPlan(i, sentences, keyword, globalPlan);
      if (!plan) { results.push({ sentence: sentences[i], plan: null, photos: [] }); continue; }

      let photos = await searchWithPriority(plan.search_queries, plan);
      photos = await rerankWithClaude(photos, plan, apiKey);

      results.push({
        sentence: sentences[i],
        plan,
        photos: photos.slice(0, 6)
      });
    }
    return results;
  }

  return { findPhotos };
})();
