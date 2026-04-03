// ── 사진 찾기 엔진 (확장 프로그램 results.js 원본 포팅) ──
const PF = (() => {

// ── 상수 ──
const MIN_IMAGE_SIZE       = 400;
const INITIAL_TARGET_RESULTS = 12;
const SECOND_PASS_TOP_K    = 8;
const SECOND_PASS_MIN_POOL = 3;
const MAX_QUERY_COUNT      = 2;
const MAX_QUERY_PAGE       = 1;

const selectedPhotoKeys = new Set();

const KNOWN_ENTITY_RULES = [
  { label:'BTS', type:'group', aliases:['bts','방탄','방탄소년단'], mustMatchTokens:['bts','방탄','방탄소년단'], preferredShot:'단체 공식 사진', queries:['BTS 단체사진','BTS official group photo','BTS full group photo','방탄소년단 공식 단체사진','BTS 무대 단체사진'] },
  { label:'넷플릭스', type:'brand', aliases:['넷플릭스','netflix'], mustMatchTokens:['넷플릭스','netflix'], preferredShot:'본사 또는 공식 행사 사진', queries:['넷플릭스 본사','Netflix headquarters','넷플릭스 공식 행사 사진','Netflix office building','Netflix brand event'] },
  { label:'태극기', type:'symbol', aliases:['태극기','대한민국 국기','korea flag'], mustMatchTokens:['태극기'], preferredShot:'태극기 실사 사진', queries:['태극기 사진','한국 국기 실사','태극기 펄럭이는 사진','Korea national flag photo'] },
  { label:'한국', type:'country', aliases:['한국','대한민국','korea'], mustMatchTokens:['한국','대한민국','korea'], preferredShot:'대표 상징 사진', queries:['한국 상징 사진','Korea landmark photo','대한민국 랜드마크 사진','한국 도시 전경'] },
  { label:'케이팝 데몬 헌터스', type:'title', aliases:['케데헌','케이팝 데몬 헌터스','kpop demon hunters','k-pop demon hunters'], mustMatchTokens:['케이팝','데몬','헌터스'], preferredShot:'공식 스틸컷', queries:['케이팝 데몬 헌터스 스틸컷','KPop Demon Hunters official still','케데헌 공식 이미지','KPop Demon Hunters poster'] }
];

const GROUP_HINTS      = ['group','all member','all members','7명','단체','전원','멤버','무대','공연','stage'];
const BTS_SOLO_HINTS   = ['rm','jin','suga','j-hope','jhope','jimin','taehyung','jungkook','남준','진','슈가','호석','지민','태형','정국'];
const BANNED_HINTS     = ['차트','그래프','인포그래픽','통계','보고서','리포트','자료','기사','뉴스','속보','썸네일','실적','주가','캡처','가사','리뷰','해석','분석','신문','카드뉴스','자막','문구','텍스트','문서','책','교재','worksheet','pdf','thumbnail','screenshot','document','paper','book'];
const BAD_DOMAIN_HINTS = ['blog','tistory','velog'];
const WATERMARK_HINTS  = ['shutterstock','getty','alamy','istock','adobestock','depositphotos','dreamstime','123rf','pngtree','freepik','vecteezy','vectorstock','clipart','bigstock','pond5','fotolia','corbis','masterfile','canstock','superstock'];
const BLOCKED_IMG_DOMAINS = new Set(['123rf.com','shutterstock.com','gettyimages.com','istockphoto.com','alamy.com','dreamstime.com','depositphotos.com','adobestock.com','vectorstock.com','freepik.com','pngtree.com','vecteezy.com','canstockphoto.com','bigstockphoto.com','pond5.com','fotolia.com']);
const STOCK_HINTS      = ['businessman','business person','stock photo','freepik','pexels','pixabay','smiling business'];
const PERSON_POSITIVE  = ['official','press','portrait','close up','close-up','smile','event','화보','공식','현장포토','표정','얼굴','미소','행사','프로필','인터뷰'];
const BRAND_POSITIVE   = ['headquarters','hq','office','building','campus','logo','본사','사옥','오피스','캠퍼스','로고'];
const TITLE_POSITIVE   = ['official still','still cut','스틸컷','포스터','공식'];

function isBlockedDomain(url) {
  try { const h = new URL(url).hostname.toLowerCase().replace(/^www\./,''); return BLOCKED_IMG_DOMAINS.has(h) || [...BLOCKED_IMG_DOMAINS].some(d => h.endsWith('.'+d)); } catch(_) { return false; }
}

// ── 유틸 ──
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function tokenize(text) { return String(text||'').split(/[^A-Za-z0-9가-힣]+/).map(t=>t.trim()).filter(Boolean); }
function uniqueStrings(arr) { return [...new Set((arr||[]).map(i=>String(i||'').trim()).filter(Boolean))]; }
function uniquePhotos(photos) { const m=new Map(); (photos||[]).forEach(p=>{ const k=p.link||p.thumbnail; if(!k) return; const prev=m.get(k); if(!prev||Number(p.score||0)>Number(prev.score||0)) m.set(k,p); }); return [...m.values()]; }
function stripHtml(v) { return String(v||'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim(); }
function getHostnameSafe(url) { try { return new URL(url).hostname.toLowerCase(); } catch(_) { return ''; } }
function truncateText(t, max) { const s=String(t||'').trim(); return s.length>max?s.slice(0,max-1)+'…':s; }
function ensureStringArray(v, fb=[], max=6) { return (Array.isArray(v)?v:fb).map(i=>truncateText(String(i||'').trim(),40)).filter(Boolean).slice(0,max); }

function safeParseJson(text) {
  if (!text) return null;
  const t = String(text).trim();
  try { return JSON.parse(t); } catch(_) {}
  const fenced = t.match(/```json\s*([\s\S]*?)```/i) || t.match(/```([\s\S]*?)```/i);
  if (fenced?.[1]) { try { return JSON.parse(fenced[1].trim()); } catch(_) {} }
  const first = t.indexOf('{'), last = t.lastIndexOf('}');
  if (first>=0 && last>first) { try { return JSON.parse(t.slice(first, last+1)); } catch(_) {} }
  return null;
}

// ── Claude API ──
async function callClaudeForJson(prompt, apiKey, maxTokens=500) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method:'POST',
    headers:{ 'Content-Type':'application/json', 'x-api-key':apiKey, 'anthropic-version':'2023-06-01', 'anthropic-dangerous-direct-browser-access':'true' },
    body:JSON.stringify({ model:'claude-sonnet-4-6', max_tokens:maxTokens, temperature:0.2, messages:[{role:'user',content:prompt}] })
  });
  if (!response.ok) throw new Error(`Anthropic API 오류 (${response.status})`);
  const data = await response.json();
  const text = Array.isArray(data.content) ? data.content.map(p=>p.text||'').join('\n') : '';
  const parsed = safeParseJson(text);
  if (!parsed) throw new Error('AI 응답을 JSON으로 해석하지 못했습니다.');
  return parsed;
}

// ── Bing 검색 (서버 프록시 경유) ──
async function searchImages(query, start) {
  const res = await fetch(`/api/image-search?q=${encodeURIComponent(query)}&first=${start}`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.items || [];
}

// ── 전체 대본 분석 ──
async function analyzeWholeScript(sentences, context, keyword, apiKey) {
  const fallback = buildFallbackGlobalPlan(sentences, context, keyword);
  if (!apiKey) return fallback;
  try {
    const prompt = `너는 영상 비주얼 디렉터다.
대표 키워드와 대본 전체를 읽고 JSON만 출력하라.

대표 키워드: ${keyword || '(없음)'}
컨텍스트: ${context || '(없음)'}
대본:
${(() => {
  const MAX=40;
  if (sentences.length<=MAX) return sentences.map((s,i)=>`${i+1}. ${s}`).join('\n');
  const head=sentences.slice(0,30).map((s,i)=>`${i+1}. ${s}`).join('\n');
  const tail=sentences.slice(-10).map((s,i)=>`(${sentences.length-10+i+1}). ${s}`).join('\n');
  return head+`\n... (중간 ${sentences.length-40}줄 생략) ...\n`+tail;
})()}

규칙:
- 랜덤 스톡 인물 금지
- 책/문서/기사/카드뉴스 금지
- 설명 문장은 대표 키워드 기준으로 받쳐주는 사진 사용 가능
- 특정 인물/그룹/브랜드가 나오면 반드시 그 대상 매칭 우선

JSON 형식:
{
  "overall_tone": "짧은 톤 설명",
  "anchor_entities": ["대표 키워드 포함 핵심 대상"],
  "rule_summary": "짧은 한 줄"
}`;
    const data = await callClaudeForJson(prompt, apiKey, 500);
    return {
      overall_tone:   truncateText(data?.overall_tone  || fallback.overall_tone, 28),
      anchor_entities:ensureStringArray(data?.anchor_entities, fallback.anchor_entities, 8),
      rule_summary:   truncateText(data?.rule_summary  || fallback.rule_summary, 90),
      primary_entity: keyword || ensureStringArray(data?.anchor_entities, fallback.anchor_entities, 1)[0] || fallback.primary_entity
    };
  } catch(e) { console.warn('analyzeWholeScript fallback', e); return fallback; }
}

function buildFallbackGlobalPlan(sentences, context, keyword) {
  const extracted = extractEntitiesFallback(sentences, context, keyword);
  return { overall_tone: keyword?`${keyword} 중심 설명형`:'대표 대상 중심 설명형', anchor_entities:extracted, rule_summary:'대표 키워드 우선, 문장 속 명확한 대상 우선, 랜덤 얼굴/문서/기사형 이미지는 제외', primary_entity:keyword||extracted[0]||'핵심 대상' };
}

function extractEntitiesFallback(sentences, context, keyword) {
  const values = [];
  if (keyword) values.push(keyword);
  KNOWN_ENTITY_RULES.forEach(rule => { const text=`${context||''} ${(sentences||[]).join(' ')}`.toLowerCase(); if(rule.aliases.some(a=>text.includes(a.toLowerCase()))) values.push(rule.label); });
  return uniqueStrings(values).slice(0,8);
}

// ── 엔티티 감지 ──
function detectEntityFromText(text, anchorEntities=[], preferKnownOnly=false) {
  const lower = String(text||'').toLowerCase();
  for (const rule of KNOWN_ENTITY_RULES) { if (rule.aliases.some(a=>lower.includes(a.toLowerCase()))) return {...rule}; }
  const matchingAnchor = (anchorEntities||[]).find(e=>lower.includes(String(e).toLowerCase()));
  if (matchingAnchor) return buildRawEntity(matchingAnchor, inferTypeFromLabel(matchingAnchor));
  if (preferKnownOnly) return null;
  const words = tokenize(text).filter(t=>t.length>=2);
  const explicit = words.find(t=>/[A-Z]{2,}/.test(t)||/[가-힣]{2,}/.test(t));
  return explicit ? buildRawEntity(explicit, inferTypeFromLabel(explicit)) : null;
}

function buildRawEntity(label, type) {
  const s=String(label||'').trim(); if(!s) return null;
  return { label:s, type:type||'general', aliases:[], mustMatchTokens:tokenize(s).slice(0,4), queries:[] };
}

function inferTypeFromLabel(label) {
  const t=String(label||'');
  if(/BTS|방탄/.test(t)) return 'group';
  if(/넷플릭스|Netflix|회사|기업|브랜드/.test(t)) return 'brand';
  if(/태극기|국기/.test(t)) return 'symbol';
  if(/한국|대한민국/.test(t)) return 'country';
  if(/^[가-힣]{2,4}$/.test(t.trim())) return 'person';
  return 'general';
}

function shouldUseRepresentativeFallback(sentence, localEntity, keyword) {
  if (!keyword) return false;
  // 로컬 엔티티가 대표 키워드와 같으면 그대로 사용
  if (localEntity && localEntity.label === keyword) return false;
  // 특정 인물/그룹/브랜드가 문장의 주어일 때만 로컬 엔티티 우선
  // "한국", "태극기" 같은 일반 엔티티는 대표 키워드에 양보
  if (localEntity && ['country','symbol'].includes(localEntity.type)) return true;
  if (localEntity && ['person','group','brand','title'].includes(localEntity.type) && localEntity.label !== keyword) return false;
  const text=String(sentence||'');
  if (/[?？]$/.test(text)) return true;
  if (/^-/.test(text.trim())) return true;
  if (/[0-9]/.test(text)) return true;
  if (/이건|이제|그냥|사실|보면|생각|설명|시작하는데요|아니죠|쉽게|그러니까|보자면|입니다/.test(text)) return true;
  return tokenize(text).length <= 6;
}

function guessSceneRole(sentence) {
  const t=String(sentence||'');
  if (/[?？]$/.test(t)||/왜|과연|정말|도대체/.test(t)) return 'hook';
  if (/이득|성과|1위|기록|흥행|효과|매출|투자|가치/.test(t)) return 'achievement';
  if (/넷플릭스|브랜드|회사|기업|본사/.test(t)) return 'brand';
  if (/한국|자부심|국뽕|태극기/.test(t)) return 'pride';
  if (/감동|눈물|미소|표정|웃/.test(t)) return 'emotion';
  if (/마지막|결국|그래서/.test(t)) return 'outro';
  return 'general';
}

function buildVisualIntent(sentence, targetLabel, role, usedRepFallback) {
  if (usedRepFallback) return `${targetLabel}를 대표하는 사진으로 설명 구간을 받쳐주는 장면`;
  if (role==='achievement') return `${targetLabel}의 성과나 영향력이 느껴지는 장면`;
  if (role==='brand') return `${targetLabel}가 바로 보이는 브랜드 장면`;
  if (role==='pride') return `${targetLabel}를 통해 자부심이 느껴지는 장면`;
  if (role==='hook') return `${targetLabel}에 시선이 바로 꽂히는 장면`;
  return `${targetLabel}가 또렷하게 보이는 대표 장면`;
}

function buildQueriesForEntity(entity, sentence, facePriorityLock) {
  if (!entity) return [];
  const base=[...(entity.queries||[])];
  const label=entity.label;
  if (entity.type==='group') { base.push(`${label} 단체사진`,`${label} official group photo`,`${label} full group photo`,`${label} 무대 단체사진`); }
  else if (entity.type==='person') { base.push(`${label}`,`${label} 사진`,`${label} 인물사진`,`${label} 프로필 사진`,`${label} photo`); if(facePriorityLock) base.push(`${label} 공식 화보`,`${label} 행사 사진`); }
  else if (entity.type==='brand') { base.push(`${label} 본사`,`${label} headquarters`,`${label} 공식 행사 사진`,`${label} logo building`); }
  else if (entity.type==='symbol') { base.push(`${label} 사진`,`${label} 펄럭이는 사진`,`${label} high quality`); }
  else if (entity.type==='country') { base.push(`${label} 상징 사진`,`${label} landmark photo`,`${label} 대표 이미지`); }
  else if (entity.type==='title') { base.push(`${label} 공식 스틸컷`,`${label} official still`,`${label} poster`); }
  else { base.push(`${label}`,`${label} 사진`,`${label} official photo`); }
  if (/케이팝|k-pop/i.test(sentence)&&entity.type!=='brand') base.push(`${label} 공연 사진`,`${label} performance photo`);
  return uniqueStrings(base).slice(0,MAX_QUERY_COUNT);
}

// ── 플랜 빌드 ──
function buildSentencePlan(index, sentences, keyword, gPlan, facePriorityLock) {
  const sentence=sentences[index]||'';
  const hasRepKw=Boolean(String(keyword||'').trim());
  const localEntity=detectEntityFromText(sentence, gPlan.anchor_entities, hasRepKw);
  const repEntity=detectEntityFromText(keyword||'', gPlan.anchor_entities, false)||buildRawEntity(keyword||gPlan.primary_entity||'', 'general');
  const useRepFallback=shouldUseRepresentativeFallback(sentence, localEntity, keyword);
  const target=useRepFallback?(repEntity||localEntity||buildRawEntity(gPlan.primary_entity||'핵심 대상','general')):(localEntity||repEntity||buildRawEntity(gPlan.primary_entity||'핵심 대상','general'));

  const sceneRole=guessSceneRole(sentence);
  const visualIntent=buildVisualIntent(sentence, target.label, sceneRole, useRepFallback);
  const mustMatchTokens=uniqueStrings([...(target.mustMatchTokens||[]),...tokenize(target.label)]).slice(0,6);
  const searchQueries=uniqueStrings([...buildQueriesForEntity(target,sentence,facePriorityLock),...(useRepFallback?buildQueriesForEntity(repEntity,sentence,facePriorityLock):[])]).slice(0,MAX_QUERY_COUNT);

  return {
    scene_role:sceneRole, target_entity:target.label||keyword||gPlan.primary_entity||'핵심 대상',
    entity_type:target.type||'general', visual_intent:visualIntent,
    must_match_tokens:mustMatchTokens, search_queries:searchQueries,
    reasoning_short: useRepFallback?`설명 문장 → ${target.label||keyword} 사진으로 매칭`:`${target.label}가 바로 드러나는 사진 우선`,
    used_representative_fallback:useRepFallback
  };
}

// ── 후보 평가 ──
function evaluateCandidate(item, query, plan) {
  const width=Number(item.sizewidth||item.width||0);
  const height=Number(item.sizeheight||item.height||0);
  const title=stripHtml(item.title||'');
  const link=item.link||'';
  const thumbnail=item.thumbnail||'';
  const hostname=getHostnameSafe(link||thumbnail);
  const haystack=`${title} ${link} ${thumbnail} ${query}`.toLowerCase();
  const key=link||thumbnail;

  if (!key) return null;
  if (width>0&&width<MIN_IMAGE_SIZE) return null;
  if (height>0&&height<MIN_IMAGE_SIZE) return null;
  if (BANNED_HINTS.some(h=>haystack.includes(h))) return null;
  if (WATERMARK_HINTS.some(h=>haystack.includes(h))) return null;
  if (isBlockedDomain(link||thumbnail)) return null;

  const exactness=computeExactMatchScore(haystack, plan.must_match_tokens);
  if (requiresStrictMatch(plan.entity_type)&&exactness<=0) return null;

  if (plan.entity_type==='group') {
    const hasGroupHint=GROUP_HINTS.some(h=>haystack.includes(h));
    const hasSoloOnly=BTS_SOLO_HINTS.some(h=>haystack.includes(h))&&!haystack.includes('bts')&&!haystack.includes('방탄');
    if (hasSoloOnly) return null;
    if (!hasGroupHint&&exactness<2) return null;
  }

  let score=0;
  score+=Math.min(width||800,2200)/110;
  score+=Math.min(height||600,2200)/110;
  score+=exactness*30;

  if (BAD_DOMAIN_HINTS.some(h=>hostname.includes(h))) score-=20;
  if (STOCK_HINTS.some(h=>haystack.includes(h))) score-=28;
  if (/instagram|instiz|dcinside|fmkorea/.test(haystack)&&exactness<=1) score-=22;

  if (plan.entity_type==='group'&&GROUP_HINTS.some(h=>haystack.includes(h))) score+=18;
  if (plan.entity_type==='person'&&PERSON_POSITIVE.some(h=>haystack.includes(h))) score+=16;
  if (plan.entity_type==='brand'&&BRAND_POSITIVE.some(h=>haystack.includes(h))) score+=16;
  if (plan.entity_type==='title'&&TITLE_POSITIVE.some(h=>haystack.includes(h))) score+=16;
  if (plan.entity_type==='symbol'&&/flag|태극기/.test(haystack)) score+=16;

  if (selectedPhotoKeys.has(key)) score-=40;
  if (score<8) return null;

  return {...item, width:width||800, height:height||600, title, hostname, link, thumbnail, score, sourceQuery:query};
}

function computeExactMatchScore(haystack, tokens) {
  return (tokens||[]).filter(t=>t&&t.length>=2).reduce((acc,t)=>acc+(haystack.includes(String(t).toLowerCase())?1:0),0);
}

function requiresStrictMatch(type) {
  return ['group','brand','symbol','country','title'].includes(type);
}

// ── 검색 ──
async function searchByPriorityQueries(queries, plan) {
  const safeQueries=uniqueStrings(queries).slice(0,MAX_QUERY_COUNT);
  const queryStarts={};
  const collected=[];

  for (const query of safeQueries) {
    let start=Number(queryStarts[query]||1);
    while (start<=MAX_QUERY_PAGE&&collected.length<INITIAL_TARGET_RESULTS) {
      let items;
      try { items=await searchImages(query,start); } catch(e) { console.warn('search error',e); break; }
      const filtered=items.map(item=>evaluateCandidate(item,query,plan)).filter(Boolean).sort((a,b)=>b.score-a.score);
      collected.push(...filtered);
      start+=10;
      queryStarts[query]=start;
      if (items.length<2) break;
    }
    if (collected.length>=INITIAL_TARGET_RESULTS) break;
  }

  return uniquePhotos(collected).sort((a,b)=>b.score-a.score).slice(0,Math.max(INITIAL_TARGET_RESULTS,SECOND_PASS_TOP_K));
}

// ── 2차 리랭킹 (Claude) ──
async function secondPassRerankPhotos(photos, plan, apiKey) {
  const unique=uniquePhotos(photos).sort((a,b)=>b.score-a.score);
  if (unique.length<SECOND_PASS_MIN_POOL||!apiKey) return unique;

  const top=unique.slice(0,SECOND_PASS_TOP_K);
  try {
    const prompt=`너는 사진 최종 셀렉터다. 이미지는 못 보고 메타데이터만 본다.
가장 잘 맞는 순서대로 번호를 JSON으로만 반환하라.

핵심 대상: ${plan.target_entity}
대상 유형: ${plan.entity_type}
장면 의도: ${plan.visual_intent}
반드시 맞아야 할 토큰: ${(plan.must_match_tokens||[]).join(', ')}
규칙: 랜덤 얼굴/문서/기사형이면 뒤로. 그룹이면 단체사진 우선.

후보:
${top.map((p,i)=>`${i+1}. title=${p.title||'(없음)'} / host=${p.hostname||'(없음)'} / size=${p.width}x${p.height} / query=${p.sourceQuery||''}`).join('\n')}

JSON 형식: {"ordered_indices":[1,2,3,4,5,6,7,8]}`;

    const data=await callClaudeForJson(prompt,apiKey,300);
    const ordered=Array.isArray(data?.ordered_indices)?data.ordered_indices:[];
    if (!ordered.length) return unique;

    const reordered=[];
    const used=new Set();
    ordered.forEach(idx=>{ const p=top[idx-1]; if(!p) return; const k=p.link||p.thumbnail; if(used.has(k)) return; reordered.push({...p,score:p.score+38-reordered.length*4}); used.add(k); });
    top.forEach(p=>{ const k=p.link||p.thumbnail; if(!used.has(k)) reordered.push(p); });
    return [...reordered,...unique.slice(SECOND_PASS_TOP_K)].sort((a,b)=>b.score-a.score);
  } catch(e) { console.warn('second pass fallback',e); return unique; }
}

// ── 메인 ──
async function findPhotos(sentences, keyword, apiKey, onProgress) {
  selectedPhotoKeys.clear();
  const facePriorityLock = true;

  onProgress?.('AI가 대본을 분석하고 있어요...');
  const globalPlan = await analyzeWholeScript(sentences, '', keyword, apiKey);

  const results = [];
  for (let i = 0; i < sentences.length; i++) {
    onProgress?.(`사진 검색 중... (${i + 1}/${sentences.length})`);

    const plan = buildSentencePlan(i, sentences, keyword, globalPlan, facePriorityLock);
    if (!plan) { results.push({ sentence: sentences[i], plan: null, photos: [] }); continue; }

    const photos = await searchByPriorityQueries(plan.search_queries, plan);

    // 상위 사진 키 등록 (다음 문장에서 중복 방지)
    photos.slice(0, 4).forEach(p => { const k = p.link || p.thumbnail; if (k) selectedPhotoKeys.add(k); });

    results.push({ sentence: sentences[i], plan, photos: photos.slice(0, 6) });
  }
  return results;
}

return { findPhotos };
})();
