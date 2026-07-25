// ─────────────────────────────────────────────────────────────────────────────
// app-view.js — 집계 엔진(calc)·AI 분석·내비게이션·대시보드·현장 패널·저장/PII 마스킹 — 화면을 그리는 층.
//   빌드 없이 여러 <script>로 나눠 로드한다(순서 고정: core → data → view → boot).
//   함수 선언은 전역에 올라가므로 파일 간 호출은 자유롭지만, **최상위 실행문은 순서에 의존**한다.
//   index.html의 로드 순서와 스냅샷 인라인 순서(exportSnapshot의 APP_PARTS)를 함께 유지할 것.
// ─────────────────────────────────────────────────────────────────────────────
// ANALYSIS ENGINE
// 대시보드 집계에서 제외할 권역 (사이드바·현장패널에는 표시)
const DASH_EXCLUDE_REGIONS=[PERM_REGION];
function dashSites(){return teamSites().filter(s=>!DASH_EXCLUDE_REGIONS.includes(s.region));}
function calc(items,site,rm){
  if(window.__SNAP__){const _e=window.__SNAP__.st&&window.__SNAP__.st[site.id];if(_e)return _e;} // 스냅샷: 임베드 집계 반환
  // 메모이즈: (현장·기준월·데이터버전·건수) 조합으로 캐시. 건수를 내용 프록시로 사용한다.
  // 캐시 무효화는 S.def Proxy가 자동 처리(set/delete). defVer·length는 키의 보조 식별자.
  const _ck=site.id+'|'+rm+'|'+S.defVer+'|'+(site.lastUploadedAt||'')+'|'+(items?items.length:0);
  const _hit=_calcCache.get(_ck);if(_hit)return _hit;
  if(_calcCache.size>80)_calcCache.clear(); // 소프트 상한 — 월 전환 반복 열람 시 메모리 증식 방지
  const _res=_calcImpl(items,site,rm);
  _calcCache.set(_ck,_res);
  return _res;
}
// 중대하자 "의심" 후보 추출(규칙) — 매니저가 잘 안 채우는 중대하자유형 컬럼에 의존하지 않고,
//   하자유형·접수내용에서 사내 매뉴얼 신호(누수/침수, 엘리베이터 갇힘·멈춤, 퇴거·거주불가, 언론리스크)와
//   피해보상·법적 분쟁, 장문(강성민원)을 넓게 포착한다. 최종 중대하자 판정은 AI가 매뉴얼 기준으로 거른다.
function critReason(i){
  const c=((i.receiptContent||'')+' '+(i.complaint||''));
  const t=((i.defectType||'')+' '+(i.trade||''));
  const tags=[];
  // 부정·해소 절 필터: 위험어가 속한 절(다음 구두점까지, 최대 20자) 안에 부정/해소어(없음·정상·해결 등)만
  //   있고 위험 확정 문맥이 아니면 그 매치는 무효. 모든 매치가 부정 문맥이면 신호 제외(오탐 제거).
  //   위험어가 부정 없이 한 번이라도 등장하면 채택(recall 보존 — 최종 판정은 AI).
  const NEG=/없|아니|아님|無|해결|정상|이상\s*무|단순\s*문의|해당\s*무/;
  const hasHazard=(re,text)=>{
    const g=new RegExp(re.source,re.flags.replace('g','')+'g');let m;
    while((m=g.exec(text))){
      const clause=text.slice(m.index,m.index+20).split(/[,.\n·;]/)[0];
      if(!NEG.test(clause.slice(m[0].length)))return true;
    }
    return false;
  };
  if(i.criticalType&&String(i.criticalType).trim())tags.push('유형기재');
  {const rx=critKwRegex('c_leak');if(rx&&hasHazard(rx,t+' '+c))tags.push('누수침수');}
  {const r1=critKwRegex('c_ev1','i'),r2=critKwRegex('c_ev2');if(r1&&r2&&r1.test(c)&&r2.test(c))tags.push('엘리베이터');}
  {const rx=critKwRegex('c_evict');if(rx&&hasHazard(rx,c))tags.push('퇴거거주불가');}
  {const rx=critKwRegex('c_media');if(rx&&rx.test(c))tags.push('언론리스크');}
  {const rx=critKwRegex('c_legal');if(rx&&rx.test(c))tags.push('피해보상법적');}
  if((i.receiptContent||'').replace(/\s+/g,'').length>=critLongLen())tags.push('장문민원');
  return tags;
}
function isCritCandidate(i){return critReason(i).length>0;}
// ── AI 분석 규칙 사용자 설정 (설정 > AI 분석) ──
// aiRules: 기본 시스템 지침 뒤에 덧붙는 팀 추가 지침(내용 규칙 우선, 출력 형식은 불변).
// critKw: 중대하자 의심 추출에 더할 키워드(쉼표 구분) — 규칙 추출(critReason)과 접수내용 샘플 우선순위 양쪽에 반영.
// ── 분석 규칙 레지스트리 — 고정 기본값(수정은 코드에서). 런타임 편집 기능은 의도적으로 두지 않음: 운영자 1인 도구라 좋은 기본값이 설정 UI보다 낫다는 결정. ──
//    비운 항목은 기본값 사용. 프롬프트는 buildRules(scope)가 (override ?? 기본값)으로 재조립 — 미수정 시 종전 하드코딩 문자열과 바이트 동일.
const RULE_DEF=[
 {scope:"site",label:"역할",hdr:null,fmt:false,rules:[
  {id:"s_role",t:"역할 정의",d:"You are a senior housing defect maintenance manager at a construction company, writing the analysis section of a monthly executive meeting report. Analyze the provided defect data and write a concise, insightful Korean analysis."}]},
 {scope:"site",label:"출력 형식·스타일",hdr:"**[OUTPUT FORMAT & STYLE RULES]**",fmt:true,rules:[
  {id:"s_f1",t:"1. HTML 출력만",d:"1. Return the output ONLY in raw HTML using elements like <div>, <p>, <ul>, <li>, <strong>, <span>. Do NOT wrap the response in markdown code blocks like ```html. Just return raw HTML text."},
  {id:"s_f2",t:"2. 마크다운 금지",d:"2. NO MARKDOWN SYMBOLS: Absolutely DO NOT include markdown header tags like '###' or '#' in the text. Subtitles must be styled purely with HTML (e.g., <div style='font-size: 16px; font-weight: bold; margin-top: 16px; margin-bottom: 8px; color: #333;'>Subtitle Name</div>)."},
  {id:"s_f3",t:"3. 서두 문장 금지",d:"3. NO INTRO PARAGRAPH: Do NOT write any introductory sentence summarizing what the report covers (e.g., do NOT write '본 보고서는 ...을 제시함.'). Start directly with the first subtitle and its content."},
  {id:"s_f4",t:"4. 개조식 어미",d:"4. TONE & ENDING (개조식): Use a concise, professional, bullet-point reporting style. Every sentence MUST end with short noun-style terminations such as '~함.', '~임.', '~음.' instead of full polite sentences like '~합니다.', '~입니다.'"},
  {id:"s_f5",t:"5. 본문 폰트",d:"5. FONT SIZE: Apply font size 14px to all body text (<p>, <li>) using inline styles (e.g., style='font-size: 14px; line-height: 1.6; color: #444;'). Subtitles use 16px bold as shown above."},
  {id:"s_f6",t:"6. 숫자 천단위",d:"6. FORMAT NUMBERS: Always apply thousands separators (e.g., 1,234)."},
  {id:"s_f7",t:"7. 강조 색상",d:"7. TEXT HIGHLIGHTING: Emphasize key metrics with bold + color inline styles (e.g., <strong style='color: #d9534f;'>text</strong> for negative/critical/delay issues, <strong style='color: #0275d8;'>text</strong> for achievements/positive metrics)."}]},
 {scope:"site",label:"내용 규칙",hdr:"**[CONTENT RULES — IMPORTANT]**",fmt:false,rules:[
  {id:"s_cA",t:"A. 소제목 최대 6개",d:"A. Write a MAXIMUM of 6 subtitled sections. Do NOT force all topics. Select only meaningful sections and order them by importance."},
  {id:"s_cB",t:"B. 무의미 항목 생략",d:"B. OMIT any section with no data or nothing noteworthy. If vacant-unit (공가세대) count is 0 or negligible, skip it. If the outstanding-case contents reveal no special issue, skip that section."},
  {id:"s_cC",t:"C. 논리적 인과(핵심)",d:"C. ANALYTICAL & LOGICAL REASONING (MOST IMPORTANT): Never write a sentence that only reports a current number or status. The dashboard already shows the figures. EVERY bullet must contain reasoning: (1) briefly state the fact, (2) explain WHY it happened by inferring the cause from the trade/type/delay/content data given, (3) project the expected outcome IF a specific concrete action is taken (e.g., '~에 우선 재방문을 집중하면 60일+ 장기미처리가 다음 달 X건 수준으로 감소할 것으로 판단됨'). A bullet without cause OR projection is unacceptable."},
  {id:"s_cD",t:"D. 성과·리스크 우선",d:"D. Lead with the two most important things first: notable month-over-month achievements, and worsened/risk points (each with reasoning). Then structural analysis, then concrete improvements."},
  {id:"s_cE",t:"E. 조치 범위 제한",d:"E. SCOPE OF IMPROVEMENTS — STRICT: Every suggested action must be executable by a single field maintenance manager (담당자) at the site level. ABSOLUTELY NEVER mention or propose company-level or organizational changes: dedicated team / task force operation (전담팀 운영), executive or management decisions (경영진), supply-chain / procurement-system reform (공급망, 구매 시스템 개선), hiring more staff (인력 충원), or introducing new IT/approval systems (시스템 도입). These are impossible at the manager level and must not appear at all. Limit advice strictly to: prioritizing specific units/trades, scheduling re-visits (재방문), coordinating with specific subcontractors already contracted, following up on pending 품의/자재 지연, managing 공가세대 access, etc."},
  {id:"s_cF",t:"F. 기호 안전",d:"F. SYMBOL SAFETY (CRITICAL): For emphasis use ONLY <strong> tags. NEVER wrap any word in single or double quotation marks (e.g., do NOT write '민원', '품의'). Stray quotes collide with the HTML inline-style quotes and break the layout, causing symbols to overlap with text. Always refer to keywords plainly inside tags, e.g., <strong style='color: #d9534f;'>누수</strong>. Do not place bullet characters or markdown dashes inside the text; the <li> element already provides the bullet."},
  {id:"s_cG",t:"G. 중대하자 판정·서술",d:"G. CRITICAL DEFECTS (중대하자) — HIGH PRIORITY + JUDGMENT REQUIRED: The [중대하자 의심 후보] block lists items rule-extracted from receipt content/type (keywords, 피해보상, long complaints) each with a 의심 reason tag. These are CANDIDATES, NOT confirmed. Apply the COMPANY MANUAL and CONFIRM only those that genuinely qualify, EXCLUDING keyword false-positives (e.g., a passing mention of 보상 with no real damage, or a long but trivial complaint). Manual 중대하자 = 누수, a defect forcing residents to vacate the unit for 2+ weeks, 엘리베이터 갇힘·멈춤, 침수, or 언론보도 리스크; also confirm severe 피해보상/강성민원 when the content shows real severity. If 1 or more candidates genuinely qualify, you MUST add a dedicated subtitled section near the TOP: state how many qualify and of what kind, cite the specific 동/호 of the most serious ones, infer the cause, and give manager-level priority actions ONLY (prioritized re-visit to that 동/호, calling the already-contracted subcontractor first, accelerating the pending 품의) — NEVER executives (경영진), task forces (전담팀), hiring, or new systems. If NONE genuinely qualify (or the block shows 의심 0건), include ONE brief line: 중대하자 의심 해당 없음. This is an EXCEPTION to rule B's omit policy."}]},
 {scope:"site",label:"후보 주제",hdr:"**[CANDIDATE TOPICS — pick the most relevant, up to 5]**",fmt:false,rules:[
  {id:"s_topics",t:"후보 주제 6종",d:"- 현황 분석 및 전월대비 추이 (analytical interpretation with cause and projection)\n- 공종별/유형별 특이사항 및 장기미처리 리스크 (infer delay causes, project effect of targeted follow-up)\n- 중대하자 현황 및 안전·법적 리스크 (critical defects: types/counts/MoM, cause + manager-level priority action; if 0, one brief line per rule G)\n- 미처리건 접수내용 특이사항 (only if the provided outstanding-case text reveals critical keywords: 누수, 민원, 품의, 자재, 피해보상 등)\n- 공가세대 하자처리 현황 (only if vacant-unit data is meaningful)\n- 처리 신속도 개선 방안 / 괄목할만한 성과 (manager-level concrete actions only)"}]},
 {scope:"dash",label:"역할",hdr:null,fmt:false,rules:[
  {id:"d_role",t:"역할 정의",d:"You are a senior housing defect maintenance manager writing the '주요 이슈 및 분석 의견' callouts on a monthly dashboard. You are given 3 pre-selected issue cards, each with a title, grade, and two raw lines (key metrics, diagnosis/action). Rewrite each card's TWO lines in Korean following the rules below. Keep the exact numbers from the source — do NOT invent or change any figure."}]},
 {scope:"dash",label:"출력 형식",hdr:"**[OUTPUT FORMAT]**",fmt:true,rules:[
  {id:"d_f1",t:"1. JSON 배열 출력",d:"1. Return ONLY a raw JSON array of exactly 3 objects, no markdown fences, no commentary. Each object: {\"line1\":\"...\",\"line2\":\"...\"}. Output order must match the input card order (card1, card2, card3)."},
  {id:"d_f2",t:"2. 줄 구성",d:"2. line1 = key metrics line (state the figures and month-over-month change concisely). line2 = diagnosis + action line."},
  {id:"d_f3",t:"3. HTML 강조",d:"3. Each line is ONE line of raw HTML. Use <strong style='color:#C0392B'>...</strong> for negative/risk figures and <strong style='color:#1A7A3C'>...</strong> for positive/achievement figures. Do NOT use <br> inside a line."},
  {id:"d_f4",t:"4. 길이 제한",d:"4. Keep each line SHORT (fits one dashboard line, roughly under 60 Korean chars)."}]},
 {scope:"dash",label:"스타일·내용",hdr:"**[STYLE & CONTENT RULES]**",fmt:false,rules:[
  {id:"d_cA",t:"A. 개조식",d:"A. 개조식: end phrases with noun-style terminations such as '~함.', '~임.', '~음.' — never '~합니다.', '~입니다.'"},
  {id:"d_cB",t:"B. 논리적 인과",d:"B. LOGICAL REASONING in line2: do not merely restate status. Infer the likely cause and project the expected effect of a concrete action (cause → action → expected change)."},
  {id:"d_cC",t:"C. 조치 범위 제한",d:"C. SCOPE — STRICT: every action must be doable by a single field manager (담당자). NEVER mention 전담팀/태스크포스 운영, 경영진 결정, 공급망·구매 시스템 개선, 인력 충원, 신규 시스템 도입. Limit to: 특정 세대·공종 우선처리, 재방문 일정, 기존 협력업체 PM 호출·처리계획 요구, 품의·자재 지연 후속조치, 공가세대 출입 관리 등."},
  {id:"d_cD",t:"D. 기호 안전",d:"D. SYMBOL SAFETY: never wrap words in quotation marks for emphasis; use <strong> only. No bullet characters or dashes inside text."}]}
];
// 중대하자 의심 추출 규칙 기본값 — critReason이 critKwRegex/critLongLen으로 참조. 쉼표 구분, 키워드 내 공백은 \s*로 완화(띄어쓰기 유무 모두 매칭).
const CRIT_DEF=[
 {id:'c_leak',t:'누수·침수 키워드',d:'누수, 침수, 누유, 역류',hint:'하자유형+접수내용 대상 · 부정문맥 필터 적용'},
 {id:'c_ev1',t:'엘리베이터 대상어',d:'엘리베이터, 엘베, 승강기, EV',hint:'아래 상태어와 접수내용에 함께 있을 때만 의심'},
 {id:'c_ev2',t:'엘리베이터 상태어',d:'갇힘, 갇혔, 멈춤, 정지, 고장, 추락'},
 {id:'c_evict',t:'퇴거·거주불가 키워드',d:'퇴거, 이주, 이사, 숙박, 호텔, 거주 불가, 입주 불가',hint:'부정문맥 필터 적용'},
 {id:'c_media',t:'언론리스크 키워드',d:'언론, 기자, 방송, 뉴스, 제보, 보도'},
 {id:'c_legal',t:'피해보상·법적 키워드',d:'피해, 보상, 배상, 변상, 손해, 소송, 법무, 내용증명, 고소, 고발'},
 {id:'c_long',t:'장문민원 기준(공백 제외 글자수)',d:'80',num:true},
];
function _ruleFind(id){for(const g of RULE_DEF)for(const r of g.rules)if(r.id===id)return r;for(const r of CRIT_DEF)if(r.id===id)return r;return null;}
function ruleVal(id){const r=_ruleFind(id);return r?r.d:'';}
function buildRules(scope){let out='';for(const g of RULE_DEF){if(g.scope!==scope)continue;const body=g.rules.map(r=>String(ruleVal(r.id)).trim()).filter(Boolean).join('\n');if(!body)continue;out+=(out?'\n\n':'')+(g.hdr?g.hdr+'\n':'')+body;}return out;}
let _critRxCache={}; // 정규식 캐시(규칙이 고정이라 무효화 불필요)
function critKwRegex(id,flags){const k=id+'|'+(flags||'');if(k in _critRxCache)return _critRxCache[k];const v=String(ruleVal(id)||'').split(',').map(x=>x.trim()).filter(Boolean);let rx=null;if(v.length){try{rx=new RegExp(v.map(x=>x.replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/\s+/g,'\\s*')).join('|'),flags||'');}catch(e){rx=null;}}_critRxCache[k]=rx;return rx;}
function critLongLen(){const n=parseInt(ruleVal('c_long'),10);return (isFinite(n)&&n>0)?n:80;}
function _calcImpl(items,site,rm){
  const pm=pM(rm),all=items.filter(i=>i.receiptDate);
  // 전월 말일 문자열 (ex. "2026-04-30") — 역산 기준일
  const pmParts=pm.split('-').map(Number);
  const pmLastDay=new Date(pmParts[0],pmParts[1],0).getDate();
  const pmEnd=`${pm}-${String(pmLastDay).padStart(2,'0')}`;
  // 금월 말일 문자열
  const rmParts=rm.split('-').map(Number);
  const rmLastDay=new Date(rmParts[0],rmParts[1],0).getDate();
  const rmEnd=`${rm}-${String(rmLastDay).padStart(2,'0')}`;

  // 미처리 통일 기준: 접수일<=cutoff & (status가 미처리 또는 완료일이 cutoff 이후) → 미처리
  // 처리로 간주: status==='처리' AND 완료일<=cutoff. (status 미처리는 무조건 미처리)
  const isDone=(i,cutoff)=>i.status==='처리'&&i.completionDate&&i.completionDate<=cutoff;

  // 금월 기준: 접수일 <= 금월말
  const ref=all.filter(i=>i.receiptDate<=rmEnd);
  const tR=ref.length;
  const res=ref.filter(i=>isDone(i,rmEnd)).length;
  const unr=tR-res;
  const rate=tR>0?res/tR*100:0;
  // 금월 기준 미처리 목록
  const ul=ref.filter(i=>!isDone(i,rmEnd));
  // 지연일 역산: 기준일 - 접수일 (단, 원본 delayDays가 있으면 보조로만 활용)
  const daysBetween=(a,b)=>{const da=new Date(a),db=new Date(b);return Math.max(0,Math.round((db-da)/86400000));};
  const d0=ul.filter(i=>{const dd=daysBetween(i.receiptDate,rmEnd);return dd<30;}).length;
  const d30=ul.filter(i=>{const dd=daysBetween(i.receiptDate,rmEnd);return dd>=30&&dd<60;}).length;
  const d60=ul.filter(i=>{const dd=daysBetween(i.receiptDate,rmEnd);return dd>=60;}).length;
  const lt=d30+d60;
  const ltr=unr>0?lt/unr*100:0;
  const top=topT(ul,5);
  // 금월 장기미처리(30일+) 목록 및 TOP5 — 장기미처리 탭 상위5 표용
  const lul=ul.filter(i=>daysBetween(i.receiptDate,rmEnd)>=30);
  const topLt=topT(lul,5);

  // 전월 기준 역산: 접수일 <= 전월말
  const prev=all.filter(i=>i.receiptDate<=pmEnd);
  const pT=prev.length;
  const pRes=prev.filter(i=>isDone(i,pmEnd)).length;
  const pUnr=pT-pRes;
  const pRate=pT>0?pRes/pT*100:0;
  const ulPrev=prev.filter(i=>!isDone(i,pmEnd));
  const pd0=ulPrev.filter(i=>{const dd=daysBetween(i.receiptDate,pmEnd);return dd<30;}).length;
  const pd30=ulPrev.filter(i=>{const dd=daysBetween(i.receiptDate,pmEnd);return dd>=30&&dd<60;}).length;
  const pd60=ulPrev.filter(i=>{const dd=daysBetween(i.receiptDate,pmEnd);return dd>=60;}).length;
  const pLt=pd30+pd60;
  const pLtr=pUnr>0?pLt/pUnr*100:0;

  // 전월 공종별 미처리 맵 — 증감 계산용
  const topPrev={};ulPrev.forEach(i=>{const k=i.trade||'기타';topPrev[k]=(topPrev[k]||0)+1;});
  // 전월 공종별 장기미처리(30일+) 맵 — 장기미처리 탭 증감 계산용
  const lulPrev=ulPrev.filter(i=>daysBetween(i.receiptDate,pmEnd)>=30);
  const topLtPrev={};lulPrev.forEach(i=>{const k=i.trade||'기타';topLtPrev[k]=(topLtPrev[k]||0)+1;});

  // 공가 — 세대/상가 개별 집계
  const _buildVac=(set,pset)=>{
    const ul=set.filter(i=>!isDone(i,rmEnd));
    const T=set.length,Unr=ul.length,Res=T-Unr,Rate=T>0?Res/T*100:0,Top=topT(ul,5);
    const Lt=ul.filter(i=>daysBetween(i.receiptDate,rmEnd)>=30).length;
    const _us=new Set(set.map(i=>`${i.building||''}-${i.unit||''}`));_us.delete('-');const Units=_us.size;
    const TopPrev={};pset.filter(i=>!isDone(i,pmEnd)).forEach(i=>{const k=i.trade||'기타';TopPrev[k]=(TopPrev[k]||0)+1;});
    return{T,Res,Unr,Rate,Lt,Units,Top,TopPrev};
  };
  const vacU=_buildVac(ref.filter(i=>isVacUnit(i)),prev.filter(i=>isVacUnit(i)));     // 공가세대
  const vacS=_buildVac(ref.filter(i=>isVacStore(i,site)),prev.filter(i=>isVacStore(i,site))); // 공가상가
  // 레거시 평면 필드(vT 등)는 세대 기준으로 매핑(AI 프롬프트·기타 호환)
  const vT=vacU.T,vRes=vacU.Res,vUnr=vacU.Unr,vRate=vacU.Rate,vLt=vacU.Lt,vUnits=vacU.Units,vTop=vacU.Top,vTopPrev=vacU.TopPrev;

  const rpb={};ul.forEach(i=>{rpb[i.repairParty||'미지정']=(rpb[i.repairParty||'미지정']||0)+1;});
  const dtb={};ul.forEach(i=>{dtb[i.defectType||'미분류']=(dtb[i.defectType||'미분류']||0)+1;});
  // 중대하자 "의심" 후보 — isCritCandidate(규칙: 매뉴얼 키워드+피해보상+장문)로 추출. 최종 판정은 AI가 함.
  const _critAll=ref.filter(isCritCandidate);
  const critT=_critAll.length;
  const critUl=_critAll.filter(i=>!isDone(i,rmEnd));
  const critUnr=critUl.length;
  const critPrevUnr=prev.filter(i=>isCritCandidate(i)&&!isDone(i,pmEnd)).length;
  // 공종별 전체 처리현황 집계(trAgg) — 현장 화면 표의 단일 출처. 게시 kpi에 실려 뷰어·스냅샷도 동일 표를 본다.
  //   (기존에는 rSite가 로컬 원본으로 직접 재계산 → 원본이 없는 뷰어에서 표가 비는 문제)
  const _trm={};
  for(const i of all){
    if(i.receiptDate>rmEnd)continue;
    const t=i.trade||'기타';
    const o=_trm[t]||(_trm[t]={t,r:0,res:0,u:0,lt:0,d0:0,d30:0,d60:0,co:{},pu:0,plt:0});
    o.r++;
    const done=i.status==='처리'&&i.completionDate&&i.completionDate<=rmEnd;
    if(done)o.res++;else{o.u++;const dd=daysBetween(i.receiptDate,rmEnd);if(dd>=60){o.d60++;o.lt++;}else if(dd>=30){o.d30++;o.lt++;}else o.d0++;}
    if(i.contractor)o.co[i.contractor]=(o.co[i.contractor]||0)+1;
  }
  for(const i of all){ // 전월 기준 역산(증감용) — rmEnd 범위가 pmEnd를 포함하므로 _trm에 항목 존재 보장
    if(i.receiptDate>pmEnd)continue;
    const o=_trm[i.trade||'기타'];if(!o)continue;
    const done=i.status==='처리'&&i.completionDate&&i.completionDate<=pmEnd;
    if(!done){o.pu++;if(daysBetween(i.receiptDate,pmEnd)>=30)o.plt++;}
  }
  const trAgg=Object.values(_trm).sort((a,b)=>b.u-a.u).map(o=>({t:o.t,r:o.r,res:o.res,u:o.u,lt:o.lt,d0:o.d0,d30:o.d30,d60:o.d60,coTop:Object.entries(o.co).sort((a,b)=>b[1]-a[1])[0]?.[0]||'-',coN:Object.keys(o.co).length,pu:o.pu,plt:o.plt}));
  return{tR,res,unr,rate,lt,ltr,prev:{total:pT,res:pRes,unr:pUnr,rate:pRate,lt:pLt,ltr:pLtr,dd:[pd0,pd30,pd60]},weekly:calcW(ref,rmEnd,pmEnd),monthly:calcMo(all),top,topPrev,topLt,topLtPrev,dd:[d0,d30,d60],vT,vRes,vUnr,vRate,vLt,vUnits,vTop,vTopPrev,vacU,vacS,rpb,dtb,critT,critUnr,critPrevUnr,critUl,rm,pm,rmEnd,pmEnd,ul,lul,trAgg};
}
function topT(items,n){
  const m={};
  items.forEach(i=>{const k=i.trade||'기타';if(!m[k])m[k]={c:0,co:{}};m[k].c++;const co=i.contractor||'';if(co)m[k].co[co]=(m[k].co[co]||0)+1;});
  const s=Object.entries(m).sort((a,b)=>b[1].c-a[1].c);
  const top=s.slice(0,n).map(([t,v])=>{const coEntries=Object.entries(v.co).sort((a,b)=>b[1]-a[1]);return{t,c:v.c,co:coEntries[0]?.[0]||'-',coN:coEntries.length};});
  const oth=s.slice(n).reduce((a,[,v])=>a+v.c,0),tot=s.reduce((a,[,v])=>a+v.c,0);
  // 기타(6위~끝) 묶음의 고유 시공업체 집합
  const othCo={};s.slice(n).forEach(([,v])=>{Object.keys(v.co).forEach(c=>{othCo[c]=true;});});
  if(oth>0)top.push({t:'기타',c:oth,isO:true,coN:Object.keys(othCo).length,keys:s.slice(n).map(([k])=>k)});
  top.push({t:'계',c:tot,isT:true});
  return top;
}
function calcW(items,rmEnd,pmEnd){
  // 각 주차 일요일 cutoff 기준 역산. 지연구간(d0/d30/d60) 분해를 diff-array로 O(N·logW+W)에 계산.
  // (구버전 O(주차×건수) 재순회 대체 — 동일 입력 BIT-EXACT 일치 검증 완료)
  const DAY=86400000;
  const cutSet={};
  for(const i of items){const k=wk(i.receiptDate);if(k)cutSet[k]=true;}
  // 월말 컷 추가: 월별 표의 각 월 값이 '월 마지막 일요일'이 아닌 '월말일' 기준이 되도록.
  // KPI(unr=접수≤월말−처리≤월말)·도넛·추이차트 종점(refLim)과 동일 수식으로 정렬된다. 일요일 컷 값들은 불변.
  const _me=ym=>{const[y,m]=ym.split('-').map(Number);cutSet[`${ym}-${String(new Date(y,m,0).getDate()).padStart(2,'0')}`]=true;};
  for(const i of items){const rd=i.receiptDate;if(rd&&/^\d{4}-\d{2}/.test(rd))_me(rd.slice(0,7));}
  if(rmEnd)cutSet[rmEnd]=true;
  if(pmEnd)cutSet[pmEnd]=true;
  const cuts=Object.keys(cutSet).sort();const W=cuts.length;if(!W)return[];
  const cutMs=cuts.map(c=>new Date(c).getTime());
  const byReceipt=items.filter(i=>i.receiptDate).slice().sort((a,b)=>a.receiptDate<b.receiptDate?-1:a.receiptDate>b.receiptDate?1:0);
  const doneSorted=byReceipt.filter(i=>i.status==='처리'&&i.completionDate).map(i=>i.completionDate).sort();
  // 누적 접수 r / 누적 처리 res — 포인터(문자열 비교, 구버전과 동일)
  const rArr=new Array(W),resArr=new Array(W);
  {let rPtr=0,resPtr=0;for(let c=0;c<W;c++){const cutoff=cuts[c];
    while(rPtr<byReceipt.length&&byReceipt[rPtr].receiptDate<=cutoff)rPtr++;rArr[c]=rPtr;
    while(resPtr<doneSorted.length&&doneSorted[resPtr]<=cutoff)resPtr++;resArr[c]=resPtr;}}
  // cutMs 오름차순 → lowerBound(첫 c: cutMs[c]>=v)
  const lb=v=>{let lo=0,hi=W;while(lo<hi){const mid=(lo+hi)>>1;if(cutMs[mid]>=v)hi=mid;else lo=mid+1;}return lo;};
  const D0=new Float64Array(W+1),D30=new Float64Array(W+1),D60=new Float64Array(W+1);
  const addRange=(D,a,b)=>{if(a<b){D[a]++;D[b]--;}};
  for(const it of byReceipt){
    const rcMs=new Date(it.receiptDate).getTime();
    const enter=lb(rcMs);                                   // 접수<=cutoff 최초 주차
    const done=it.status==='처리'&&it.completionDate;
    const end=Math.min(done?lb(new Date(it.completionDate).getTime()):W,W); // 완료<=cutoff 이후 제외
    if(enter>=end)continue;
    const i30=lb(rcMs+30*DAY),i60=lb(rcMs+60*DAY);          // 경과 30·60일 도달 주차
    addRange(D0,enter,Math.min(i30,end));
    addRange(D30,Math.max(i30,enter),Math.min(i60,end));
    addRange(D60,Math.max(i60,enter),end);
  }
  let a0=0,a30=0,a60=0;const arr=[];
  for(let c=0;c<W;c++){a0+=D0[c];a30+=D30[c];a60+=D60[c];
    arr.push({week:cuts[c],r:rArr[c],res:resArr[c],u:rArr[c]-resArr[c],d0:a0,d30:a30,d60:a60});}
  // M월 Nw주 — 같은 달 내 누적 주 번호 (월 바뀌면 1로 리셋). 일요일 컷만 주번호를 증가시키고,
  // 월말(비일요일) 컷은 'M월 말' 라벨 + sun:false — 월별 표 전용 스냅샷임을 표시(주차별 표는 sun 컷만 표시).
  let lastM=null,wInM=0;
  arr.forEach(r=>{const m=Number(r.week.slice(5,7));r.m=m;
    const isSun=new Date(r.week).getUTCDay()===0;r.sun=isSun;
    if(m!==lastM){wInM=0;lastM=m;}
    if(isSun){wInM++;r.wn=wInM;r.label=`${m}월 ${wInM}주`;}
    else{r.wn=wInM;r.label=`${m}월 말`;}
  });
  return arr;
}
function calcMo(items){const m={};items.forEach(i=>{const k=(i.receiptDate||'').slice(0,7);if(!k)return;if(!m[k])m[k]={month:k,r:0,res:0,u:0};m[k].r++;const done=i.status==='처리'&&i.completionDate;if(done)m[k].res++;else m[k].u++;});return Object.values(m).sort((a,b)=>a.month.localeCompare(b.month));}
function wk(d){if(!d)return null;const m=String(d).match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);if(!m)return null;const dt=new Date(Date.UTC(+m[1],+m[2]-1,+m[3]));if(isNaN(dt))return null;const sunOff=(7-dt.getUTCDay())%7;const sun=new Date(dt.getTime()+sunOff*86400000);return `${sun.getUTCFullYear()}-${String(sun.getUTCMonth()+1).padStart(2,'0')}-${String(sun.getUTCDate()).padStart(2,'0')}`;}
// 상가 표기 감지 — 동/호 오타 변형 포함 ([강산살상성싱]+[가거기], 뒤에 숫자 허용)
// 상가 라벨 판별 — '상가'와 업로드 데이터에서 실제 관찰된 오타 변형을 넓게 매칭.
//   수용 리스크: 문자클래스 조합상 '살기' 등 우연 조합도 매치되지만, 검사 대상이 동·호 필드
//   (isVacStore에서 hasCommercial 현장 + 공용 하자 한정)라 실데이터 오탐 개연성은 낮음.
function isStoreLabel(s){return /[강산살상성싱][가거기]/.test(String(s||''));}
// 공가세대/공가상가 하자건 판정 (둘 중 하나라도 해당하면 공가 건)
// - 공가세대 하자: (모든 현장) 하자구분='세대' AND 입주상태∈{미분양,미납}
// - 공가상가 하자: (공가상가 포함 현장만) 하자구분='공용' AND (동 또는 호에 상가 표기)
function isVacUnit(item){return item.defectClass==='세대'&&(item.saleStatus==='미분양'||item.saleStatus==='미납');}
function isVacStore(item,site){return !!site?.hasCommercial&&item.defectClass==='공용'&&(isStoreLabel(item.building)||isStoreLabel(item.unit));}
function isVac(item,site){
  return isVacUnit(item)||isVacStore(item,site);
}

// NAVIGATION
function go(view,sid){
  if(document.body.classList.contains('snap')&&view!=='dashboard'&&view!=='site'){view='dashboard';sid=null;} // 정적 스냅샷 파일: 대시보드·현장만 허용(Firebase 뷰어는 현장관리·설정 접근 가능)
  S.view=view;S.sid=sid||null;
  if(window.innerWidth<=768)closeMobileSB();
  document.querySelectorAll('.view').forEach(v=>{v.classList.remove('act');});
  document.getElementById('view-'+view)?.classList.add('act');
  document.querySelectorAll('.nvi[data-view]').forEach(n=>n.classList.toggle('act',n.dataset.view===view));
  document.querySelectorAll('.sti').forEach(n=>n.classList.toggle('act',n.dataset.site===sid));
  const titles={dashboard:'전체 현황 대시보드',site:'현장 패널',manage:'현장 관리',upload:'리스트 업로드',settings:'설정'};
  document.getElementById('tbt').textContent=titles[view]||'';
  const site=sid?S.sites.find(s=>s.id===sid):null;
  document.getElementById('tbsu').textContent=site?`${site.region}  ›  ${site.name}`:'';
  document.getElementById('pbtn').style.display=(view==='dashboard'||view==='site')?'':'none';
  if(view==='dashboard')rDash();
  if(view==='site'&&sid)rSite(sid);
  try{if(FB2.ready)fb2ScopeSiteSubs(view==='site'?sid:null);}catch(_){}// P2: 보고 있는 현장만 plans/analysis 실시간 구독
  if(view==='manage')rManage();
  if(view==='settings')loadSettings();
  const _c=document.getElementById('content');if(_c)_c.scrollTop=0;
  // 해시 딥링크 동기화 — 새로고침 유지 + "#site/{sid}" 링크 공유. replaceState라 hashchange 미발화(루프 없음).
  if(!document.body.classList.contains('snap')){
    try{
      const want=(view==='site'&&sid)?('#site/'+encodeURIComponent(sid)):('#'+view);
      if(location.hash!==want)history.replaceState(null,'',want);
    }catch(_){}
  }
}
// 해시 → 화면 복원. 유효하면 true(부팅 기본 진입 대체), 아니면 false.
function parseHashNav(){
  try{
    const h=decodeURIComponent(location.hash||'');
    let m;
    if((m=h.match(/^#site\/(.+)$/))){
      const sid=m[1];
      if(teamSites().some(s=>s.id===sid)){go('site',sid);return true;}
      return false;
    }
    if((m=h.match(/^#(dashboard|manage|settings)$/))){go(m[1]);return true;}
  }catch(_){}
  return false;
}
window.addEventListener('hashchange',function(){parseHashNav();}); // 주소창 직접 수정·붙여넣기 대응
function rNav(){
  const c=document.getElementById('rgnav');
  c.innerHTML=orderedRGS().map(r=>{
    const sites=teamSites().filter(s=>s.region===r);
    const er=esc(r);
    return`<div class="rgblock" data-region="${er}">`
      +`<div class="rgh open" role="button" tabindex="0" draggable="true" data-region="${er}" data-tip="${er} (${sites.length}개)" data-act="nav.region">`
      +`<span class="rgdrag" data-tt="권역 순서 변경" aria-label="권역 순서 변경">⠿</span>${er}<span style="margin-left:4px;font-size:9px;color:var(--lbl3)">${sites.length}</span>`
      +`<svg class="rgch" width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 3.5l3 3 3-3"/></svg></div>`
      +`<div class="rgs" data-region="${er}">`
      +sites.map(s=>{const en=esc(s.name);return `<div class="sti${S.sid===s.id?' act':''}" role="button" tabindex="0" draggable="true" data-site="${s.id}" data-region="${er}" data-tip="${er} · ${en}" data-act="nav.site"><span class="std"></span><span class="stl">${en}</span></div>`;}).join('')
      +`</div></div>`;
  }).join('');
  wireNavDnD();
}
// ===== 사이드바 드래그 정렬 =====
// 현장(sti): 같은 권역 내에서만 순서 변경 (S.sites 배열 재정렬). 권역 간 이동은 막음(권역은 현장 속성).
// 권역(rgh): 권역 블록 순서 변경 (S.regionOrder 갱신).
let _dnd=null;
function wireNavDnD(){
  const c=document.getElementById('rgnav');if(!c)return;
  c.querySelectorAll('.sti[draggable]').forEach(el=>{
    el.addEventListener('dragstart',e=>{_dnd={type:'site',id:el.dataset.site,region:el.dataset.region};el.classList.add('dragging');e.dataTransfer.effectAllowed='move';try{e.dataTransfer.setData('text/plain',el.dataset.site);}catch(_){}; e.stopPropagation();});
    el.addEventListener('dragend',()=>{el.classList.remove('dragging');c.querySelectorAll('.drop-above,.drop-below').forEach(x=>x.classList.remove('drop-above','drop-below'));_dnd=null;});
    el.addEventListener('dragover',e=>{if(_dnd?.type!=='site'||_dnd.region!==el.dataset.region)return;e.preventDefault();const rect=el.getBoundingClientRect();const after=e.clientY>rect.top+rect.height/2;el.classList.toggle('drop-below',after);el.classList.toggle('drop-above',!after);});
    el.addEventListener('dragleave',()=>el.classList.remove('drop-above','drop-below'));
    el.addEventListener('drop',e=>{if(_dnd?.type!=='site'||_dnd.region!==el.dataset.region)return;e.preventDefault();e.stopPropagation();const rect=el.getBoundingClientRect();const after=e.clientY>rect.top+rect.height/2;reorderSite(_dnd.id,el.dataset.site,after);});
  });
  c.querySelectorAll('.rgh[draggable]').forEach(el=>{
    el.addEventListener('dragstart',e=>{_dnd={type:'region',region:el.dataset.region};el.classList.add('dragging');e.dataTransfer.effectAllowed='move';try{e.dataTransfer.setData('text/plain',el.dataset.region);}catch(_){}});
    el.addEventListener('dragend',()=>{el.classList.remove('dragging');c.querySelectorAll('.drop-above,.drop-below').forEach(x=>x.classList.remove('drop-above','drop-below'));_dnd=null;});
    el.addEventListener('dragover',e=>{if(_dnd?.type!=='region')return;e.preventDefault();const rect=el.getBoundingClientRect();const after=e.clientY>rect.top+rect.height/2;el.classList.toggle('drop-below',after);el.classList.toggle('drop-above',!after);});
    el.addEventListener('dragleave',()=>el.classList.remove('drop-above','drop-below'));
    el.addEventListener('drop',e=>{if(_dnd?.type!=='region')return;e.preventDefault();reorderRegion(_dnd.region,el.dataset.region,e.clientY>el.getBoundingClientRect().top+el.getBoundingClientRect().height/2);});
  });
}
function reorderSite(dragId,targetId,after){
  if(dragId===targetId)return;
  const arr=S.sites;
  const di=arr.findIndex(s=>s.id===dragId),ti=arr.findIndex(s=>s.id===targetId);
  if(di<0||ti<0)return;
  const[moved]=arr.splice(di,1);
  let insertAt=arr.findIndex(s=>s.id===targetId);
  insertAt=after?insertAt+1:insertAt;
  arr.splice(insertAt,0,moved);
  lsSave();rNav();
}
function reorderRegion(dragR,targetR,after){
  if(dragR===targetR)return;
  const t=curTeam();if(!t)return;
  let ord=orderedRGS();
  ord=ord.filter(r=>r!==dragR);
  let insertAt=ord.indexOf(targetR);
  insertAt=after?insertAt+1:insertAt;
  ord.splice(insertAt,0,dragR);
  t.regionOrder=ord;
  lsSave();rNav();
}
function tRg(el){el.classList.toggle('open');el.nextElementSibling.classList.toggle('closed',!el.classList.contains('open'));}
function rSMgr(){const el=document.getElementById('mgsites');if(!el)return;if(!teamSites().length){el.innerHTML='<p style="font-size:12px;color:var(--lbl3);padding:22px 0;text-align:center">등록된 현장이 없습니다.<br><b>+ 현장 추가</b> 또는 <b>리스트 업로드</b>로 등록하세요.</p>';return;}
  const sorted=sortSM(teamSites());
  const regs=curRegions();
  const regOpts=s=>regs.map(r=>`<option ${s.region===r?'selected':''}>${esc(r)}</option>`).join('')+(regs.includes(s.region)?'':`<option selected>${esc(s.region||'')}</option>`);
  const fmtUp=iso=>{if(!iso)return '<span style="color:var(--lbl3)">—</span>';const d=new Date(iso);if(isNaN(d))return '<span style="color:var(--lbl3)">—</span>';return `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`;};
  el.innerHTML=`<div style="overflow-x:auto"><table class="dt mgtbl" id="smtable"><thead><tr>
    <th style="width:12%" data-sort="region" tabindex="0" data-act="smt.sort" data-key="region">권역 <span class="sortmk"></span></th>
    <th style="width:20%" data-sort="name" tabindex="0" data-act="smt.sort" data-key="name">현장명 <span class="sortmk"></span></th>
    <th class="cc" style="width:8%" data-sort="units" tabindex="0" data-act="smt.sort" data-key="units">세대수 <span class="sortmk"></span></th>
    <th class="cc" style="width:7%" data-sort="buildings" tabindex="0" data-act="smt.sort" data-key="buildings">동수 <span class="sortmk"></span></th>
    <th class="cc" style="width:8%" data-sort="commercialUnits" tabindex="0" data-act="smt.sort" data-key="commercialUnits">상가수 <span class="sortmk"></span></th>
    <th class="cc" style="width:8%" data-sort="completionDate" tabindex="0" data-act="smt.sort" data-key="completionDate">준공일 <span class="sortmk"></span></th>
    <th class="cc" style="width:8%">공가세대</th>
    <th class="cc" style="width:8%">공가상가</th>
    <th class="cc" style="width:10%">업데이트일</th>
    <th class="cc" style="width:5%"></th>
  </tr></thead><tbody>${sorted.map(s=>`<tr>
    <td><select class="mg-inp" data-act="site.upd" data-sid="${esc(s.id)}" data-field="region" aria-label="권역 선택">${regOpts(s)}</select></td>
    <td><input class="mg-inp" value="${esc(s.name)}" data-act="site.upd" data-sid="${esc(s.id)}" data-field="name" aria-label="현장명"></td>
    <td><input class="mg-inp n" type="number" value="${s.units||0}" data-act="site.upd" data-sid="${esc(s.id)}" data-field="units" aria-label="세대수"></td>
    <td><input class="mg-inp n" type="number" value="${s.buildings||0}" data-act="site.upd" data-sid="${esc(s.id)}" data-field="buildings" aria-label="동수"></td>
    <td><input class="mg-inp n" type="number" value="${s.commercialUnits||0}" data-act="site.upd" data-sid="${esc(s.id)}" data-field="commercialUnits" aria-label="상가세대수"></td>
    <td class="cc"><input class="mg-inp" type="date" max="9999-12-31" style="width:130px;max-width:100%;text-align:center;display:inline-block" value="${esc(s.completionDate||'')}" data-act="site.completion" data-sid="${esc(s.id)}" aria-label="준공일"></td>
    <td class="cc"><label class="sw"><input type="checkbox" ${s.showVacant!==false?'checked':''} data-act="site.updc" data-sid="${esc(s.id)}" data-field="showVacant" aria-label="공가세대 표시"><span class="sw-t"></span></label></td>
    <td class="cc"><label class="sw"><input type="checkbox" ${s.hasCommercial?'checked':''} data-act="site.updc" data-sid="${esc(s.id)}" data-field="hasCommercial" aria-label="상가 포함"><span class="sw-t"></span></label></td>
    <td class="cc" style="font-size:11.5px;color:var(--lbl2);white-space:nowrap">${fmtUp(s.lastUploadedAt)}</td>
    <td class="cc"><button class="tm-x tm-del" data-act="site.del" data-sid="${esc(s.id)}" data-tt="삭제" aria-label="삭제">${ICON_TRASH}</button></td>
  </tr>`).join('')}</tbody></table></div>`;
  rSMMark();
}
function sortSM(arr){if(!S.smsort?.col)return arr;const{col,dir}=S.smsort,num=['units','buildings','commercialUnits'].includes(col);return arr.slice().sort((a,b)=>{const va=a[col]??(num?0:''),vb=b[col]??(num?0:'');if(num)return dir*((Number(va)||0)-(Number(vb)||0));return dir*String(va).localeCompare(String(vb),'ko');});}
function sortSMT(col){if(!S.smsort)S.smsort={col:null,dir:-1};if(S.smsort.col===col){if(S.smsort.dir===-1)S.smsort.dir=1;else{S.smsort.col=null;S.smsort.dir=-1;}}else{S.smsort.col=col;S.smsort.dir=-1;}rSMgr();}
function rSMMark(){document.querySelectorAll('#smtable th[data-sort]').forEach(th=>{const c=th.dataset.sort,mk=th.querySelector('.sortmk');const act=S.smsort?.col===c;th.classList.toggle('act',act);if(mk)mk.textContent=act?(S.smsort.dir===1?'▲':'▼'):'↕';th.setAttribute('aria-sort',act?(S.smsort.dir===1?'ascending':'descending'):'none');});}

// 범용 패널 테이블 정렬 (DOM 기반). 기타/합계(data-fixed 또는 tr.tot)는 맨 아래 고정.
window._panelSort={};
function sortPanel(tableId,th){
  const tbl=document.getElementById(tableId);if(!tbl||!th)return;
  // colIdx: thead 전체 th 기준 (data-sort 없는 것 포함) — 마크 갱신과 동일 기준 유지
  const allTh=Array.prototype.slice.call(th.parentNode.children);
  const colIdx=allTh.indexOf(th);
  const type=th.dataset.sortType||'num';
  const st=window._panelSort[tableId]||{col:null,dir:-1};
  if(st.col===colIdx){if(st.dir===1){st.col=null;st.dir=-1;}else st.dir=1;}
  else{st.col=colIdx;st.dir=-1;}
  window._panelSort[tableId]=st;
  // 헤더 마크 갱신 — 전체 th 인덱스 기준으로 비교
  tbl.querySelectorAll('thead th').forEach((h,idx)=>{const mk=h.querySelector('.sortmk');const hasSort=!!h.dataset.sort;const act=st.col===idx&&hasSort;h.classList.toggle('act',act);if(mk)mk.textContent=act?(st.dir===1?'▲':'▼'):'↕';if(hasSort)h.setAttribute('aria-sort',act?(st.dir===1?'ascending':'descending'):'none');});
  const tb=tbl.querySelector('tbody');if(!tb)return;
  const allRows=Array.prototype.slice.call(tb.querySelectorAll(':scope > tr'));
  const fixed=allRows.filter(r=>r.classList.contains('tot')||r.dataset.fixed==='1');
  let rows=allRows.filter(r=>!(r.classList.contains('tot')||r.dataset.fixed==='1'));
  if(st.col!==null){
    // 월별/주차별 테이블(월 셀 mcell 포함): 월 그룹 단위로 정렬 후 그룹 내 행 순서 유지
    const isMoWkTable=(tableId.startsWith('mo-')||tableId.startsWith('wk-'));
    const getVal=(r)=>{const cell=r.children[st.col];if(!cell)return type==='str'?'':-Infinity;let txt=(cell.textContent||'').trim();if(type==='str')return txt;txt=txt.replace(/\u2212/g,'-').replace(/[▲▼]/g,'');const num=parseFloat(txt.replace(/[^0-9.\-]/g,''));return isNaN(num)?-Infinity:num;};
    if(isMoWkTable){
      // 행을 월 그룹으로 묶기 (mcell이 있는 행이 그룹 첫 행)
      const groups=[];let cur=null;
      rows.forEach(r=>{if(r.querySelector('td.mcell')){cur={rep:r,rows:[r]};groups.push(cur);}else if(cur){cur.rows.push(r);}else{const g={rep:r,rows:[r]};groups.push(g);cur=g;}});
      // 대표값: 그룹 내 mcell 행(첫 행) 기준
      groups.sort((a,b)=>{const va=getVal(a.rep),vb=getVal(b.rep);let cmp;if(type==='str')cmp=String(va).localeCompare(String(vb),'ko');else cmp=va-vb;return cmp*st.dir;});
      rows=groups.flatMap(g=>g.rows);
    }else{
      rows.sort((a,b)=>{const va=getVal(a),vb=getVal(b);let cmp;if(type==='str')cmp=String(va).localeCompare(String(vb),'ko');else cmp=va-vb;return cmp*st.dir;});
    }
  }
  rows.concat(fixed).forEach(r=>tb.appendChild(r));
}

// DASHBOARD
// ── 월별/주차별 현황 테이블 공유 헬퍼 (단일 출처) ──
//   기존 buildDashMonthTable·rSite 상세표가 동일 본문을 각자 복붙(nf/dlt/ltrCells/metrics/th/thG)하던 것을
//   여기로 통합. 두 호출부는 이 함수들을 로컬 별칭으로 받아 쓴다(사용처 무변경 → 출력 동일, 드리프트 불가).
//   tblMetrics는 ltRatio 포함 상위집합 — 월별표는 그 필드를 안 쓰므로 무해.
const tblNF=n=>(n||0).toLocaleString();
const tblDlt=(d,isFirst,cur,u)=>{ // cur(현재값)·u('월'|'주')를 주면 이전→현재 비교 툴팁 부착 — 현장별 현황 배지와 동일 UX
  if(isFirst)return'<span class="na">—</span>';
  const tt=(typeof cur==='number')?` data-tt="전${u||'월'} ${(cur-d).toLocaleString()} → 금${u||'월'} ${cur.toLocaleString()}" aria-label="전${u||'월'} ${(cur-d).toLocaleString()} → 금${u||'월'} ${cur.toLocaleString()}"`:'';
  if(d===0)return`<span class="ba bgr"${tt}>─ 0</span>`;
  const cls=d>0?'brd':'bgn',sign=d>0?'+':'−',arrow=d>0?'▲':'▼';
  return`<span class="ba ${cls}"${tt}>${arrow} ${sign}${Math.abs(d).toLocaleString()}</span>`;};
const tblLtrCells=(d0,d30,d60,unr,ltDlt,isFirst,u)=>{const lt=d30+d60;const ltr=unr>0?(lt/unr*100):0;const p60=unr>0?Math.min(d60/unr*100,100):0,p30=unr>0?Math.min(d30/unr*100,100):0,p0=unr>0?Math.min(d0/unr*100,100):0;const dltCell=`<td class="cc">${tblDlt(ltDlt,isFirst,lt,u)}</td>`;const barCell=`<td class="cc tl-grp-ltr"><div class="ltrbar-wrap"><div class="ltrbar" data-tip="장기미처리|${unr}|${d60}|${d30}|${d0}|${ltr.toFixed(1)}"><div class="seg s60" style="width:${p60.toFixed(1)}%"></div><div class="seg s30" style="width:${p30.toFixed(1)}%"></div><div class="seg s0" style="width:${p0.toFixed(1)}%"></div></div><span class="ltrbar-pct">${ltr.toFixed(1)}%</span></div></td>`;return`<td class="cc ltr-red tl-grp-ltr">${tblNF(lt)}</td>${barCell}${dltCell}`;};
const tblMetrics=(cur,prev,prev2)=>{const tR=cur.r,cumRes=cur.res,unr=cur.u,d0=cur.d0,lt=cur.d30+cur.d60;const rate=tR>0?(cumRes/tR*100):0,ltRatio=unr>0?(lt/unr*100):0;const recvW=prev?cur.r-prev.r:cur.r;const resW=prev?cur.res-prev.res:cur.res;const prevResW=prev?(prev2?prev.res-prev2.res:prev.res):0;const prevLt=prev?(prev.d30+prev.d60):0,prevUnr=prev?prev.u:0;return{tR,cumRes,unr,d0,d30:cur.d30,d60:cur.d60,lt,rate,ltRatio,recvW,resW,resWDlt:resW-prevResW,ltDlt:lt-prevLt,unrDlt:unr-prevUnr};};
const tblTh=(cls,txt)=>`<th class="cc ${cls}">${txt}</th>`;
const tblThG=(cls,txt)=>`<th class="cc ${cls} tl-grp">${txt}</th>`;
// SORTING dashboard table
function sortDR(all){if(!S.dsort?.col)return all;const{col,dir}=S.dsort,getV=({s,st})=>({region:s.region,name:s.name,units:s.units||0,tR:st.tR,res:st.res,rate:st.rate,unr:st.unr,deltaUnr:st.unr-st.prev.unr,lt:st.lt,ltr:st.ltr,delta:st.lt-st.prev.lt}[col]);return all.slice().sort((a,b)=>{const va=getV(a),vb=getV(b);if(typeof va==='string')return dir*va.localeCompare(vb,'ko');return dir*(va-vb);});}
function sortDT(col){if(!S.dsort)S.dsort={col:null,dir:-1};if(S.dsort.col===col){if(S.dsort.dir===1){S.dsort.col=null;S.dsort.dir=-1;}else S.dsort.dir=1;}else{S.dsort={col,dir:-1};}if(S.view==='dashboard')rDash();}
function rDTMark(){document.querySelectorAll('#dtable th[data-sort]').forEach(th=>{const c=th.dataset.sort,mk=th.querySelector('.sortmk');const act=S.dsort?.col===c;th.classList.toggle('act',act);if(mk)mk.textContent=act?(S.dsort.dir===1?'▲':'▼'):'↕';th.setAttribute('aria-sort',act?(S.dsort.dir===1?'ascending':'descending'):'none');});}
function attachLtrTip(){if(window._ltrTipAttached)return;window._ltrTipAttached=true;const tip=document.getElementById('htooltip');if(!tip)return;const show=(e,bar)=>{const[nm,unrS,d60S,d30S,d0S]=bar.dataset.tip.split('|'),unr=Number(unrS)||0,d60=Number(d60S)||0,d30=Number(d30S)||0,d0=Number(d0S)||0,pct=n=>unr>0?(n/unr*100).toFixed(1)+'%':'0%';tip.innerHTML=`<div class="trow"><span class="tmark ck-d60"></span><span class="tlabel">60일 이상</span><span class="tval">${d60.toLocaleString()}건 (${pct(d60)})</span></div><div class="trow"><span class="tmark ck-d30"></span><span class="tlabel">30~59일</span><span class="tval">${d30.toLocaleString()}건 (${pct(d30)})</span></div><div class="trow"><span class="tmark ck-d0"></span><span class="tlabel">30일 미만</span><span class="tval">${d0.toLocaleString()}건 (${pct(d0)})</span></div>`;tip.style.left=e.clientX+'px';tip.style.top=e.clientY+'px';tip.classList.remove('gl');tip.classList.remove('sb-mode');tip.classList.add('show');};const hide=()=>tip.classList.remove('show');// document 전체 위임 — 대시보드 + 현장 패널 모든 ltrbar 커버
document.addEventListener('mouseover',e=>{const bar=e.target.closest('.ltrbar');if(bar&&bar.dataset.tip)show(e,bar);});document.addEventListener('mousemove',e=>{if(tip.classList.contains('show')){tip.style.left=e.clientX+'px';tip.style.top=e.clientY+'px';}});document.addEventListener('mouseout',e=>{const bar=e.target.closest('.ltrbar');if(bar&&!e.relatedTarget?.closest('.ltrbar'))hide();});
  // 장기미처리 비율 현황 바 — 세그먼트별 개별 툴팁
  const showSeg=(e,seg)=>{const[lbl,band,cntS,totS]=seg.dataset.tip.split('|'),cnt=Number(cntS)||0,tot=Number(totS)||0,pc=tot>0?(cnt/tot*100).toFixed(1):'0.0',bg=seg.classList.contains('s60')?cvar('--ch-d60','#DA6A60'):seg.classList.contains('s30')?cvar('--ch-d30','#E89C9A'):cvar('--ch-d0','#B3C7DD');tip.innerHTML=`<div class="trow"><span class="tmark" style="background:${bg}"></span><span class="tlabel">${esc(lbl)} · ${esc(band)}</span><span class="tval">${cnt.toLocaleString()}건 (${pc}%)</span></div>`;tip.style.left=e.clientX+'px';tip.style.top=e.clientY+'px';tip.classList.remove('gl');tip.classList.remove('sb-mode');tip.classList.add('show');};
  document.addEventListener('mouseover',e=>{const seg=e.target.closest('.ltrmom-bar .seg');if(seg&&seg.dataset.tip)showSeg(e,seg);});document.addEventListener('mouseout',e=>{const seg=e.target.closest('.ltrmom-bar .seg');if(seg&&!e.relatedTarget?.closest('.ltrmom-bar .seg'))hide();});}
// 사이드바 mini 상태에서 호버 시 우측에 라벨 툴팁 표시 (DOM 위임)
function attachSBTip(){if(window._sbTipAttached)return;window._sbTipAttached=true;const sb=document.getElementById('sidebar'),tip=document.getElementById('htooltip');if(!sb||!tip)return;const show=(target)=>{if(!sb.classList.contains('mini'))return;const txt=target.dataset.tip;if(!txt)return;tip.innerHTML=`<div style="font-size:12px;font-weight:500">${esc(txt)}</div>`;const r=target.getBoundingClientRect();tip.style.left=(r.right+10)+'px';tip.style.top=(r.top+r.height/2)+'px';tip.classList.remove('gl');tip.classList.add('sb-mode');tip.classList.add('show');};const hide=()=>{tip.classList.remove('show');};sb.addEventListener('mouseover',e=>{const t=e.target.closest('[data-tip]');if(t)show(t);});sb.addEventListener('mouseout',e=>{const t=e.target.closest('[data-tip]');if(t&&!e.relatedTarget?.closest('[data-tip]'))hide();});sb.addEventListener('mouseleave',hide);
// 페이드아웃 완료 후 sb-mode 클래스 해제 (다른 툴팁 호출에 영향 안 주게)
tip.addEventListener('transitionend',e=>{if(e.propertyName==='opacity'&&!tip.classList.contains('show'))tip.classList.remove('sb-mode');});
}
function attachTitleTip(){if(window._ttTipAttached)return;window._ttTipAttached=true;const tip=document.getElementById('htooltip');if(!tip)return;const show=(e,t)=>{const txt=t.dataset.tt;if(!txt)return;tip.innerHTML=`<div style="font-size:11.5px;font-weight:500">${esc(txt)}</div>`;tip.style.left=e.clientX+'px';tip.style.top=e.clientY+'px';tip.classList.remove('gl');tip.classList.remove('sb-mode');tip.classList.add('show');};const hide=()=>tip.classList.remove('show');document.addEventListener('mouseover',e=>{const t=e.target.closest('[data-tt]');if(t)show(e,t);});document.addEventListener('mousemove',e=>{if(tip.classList.contains('show')&&!tip.classList.contains('sb-mode')&&e.target.closest('[data-tt]')){tip.style.left=e.clientX+'px';tip.style.top=e.clientY+'px';}});document.addEventListener('mouseout',e=>{const t=e.target.closest('[data-tt]');if(t&&!e.relatedTarget?.closest('[data-tt]'))hide();});}
// 모바일 KPI 카드 탭 애니메이션 — 터치기기에선 비대화형 div에 :active가 안정적으로 안 걸리므로 JS로 클래스 토글
function attachKpiTap(){if(window._kpiTapAttached)return;window._kpiTapAttached=true;
  let cur=null;
  const clear=()=>{if(cur){cur.classList.remove('tapped');cur=null;}};
  document.addEventListener('touchstart',e=>{const kc=e.target.closest('.akpi .kc');if(kc){clear();cur=kc;kc.classList.add('tapped');}},{passive:true});
  document.addEventListener('touchend',clear,{passive:true});
  document.addEventListener('touchcancel',clear,{passive:true});
  document.addEventListener('touchmove',clear,{passive:true});}
// ── 대시보드 월별 하자처리 현황 — 전 현장 주차별 누적 스냅샷을 주(week)별로 합산해 월말 스냅샷 산출 ──
function setDashMonthYear(y){S.dashMoYear=y;buildDashMonthTable();}
function buildDashMonthTable(){
  const tbl=document.getElementById('dmo-table');if(!tbl)return;
  // 전 현장 weekly 합산 (week 키 기준, 인수 전 현장 제외)
  // 현장별 weekly 스냅샷(주차=일요일 cutoff; 누적 r/res + 시점 u/d*) 수집
  const siteWeekly=dashSites().map(s=>{
    const st=calc(S.def[s.id]||[],s,S.rm);
    return (st.weekly||[]).slice().sort((a,b)=>a.week<b.week?-1:a.week>b.week?1:0);
  }).filter(arr=>arr.length);
  // 전체 월 목록 = 모든 현장 주차의 'YYYY-MM' 합집합
  const moKeys=[...new Set(siteWeekly.flatMap(arr=>arr.map(w=>w.week.slice(0,7))))].filter(mk=>mk<=S.rm).sort();
  // 월말 스냅샷: 각 월말 시점마다 현장별 '그 달 이전까지의 마지막 스냅샷'을 carry-forward 합산.
  // (현장마다 주차 집합이 달라서, 해당 월에 접수 없는 현장이 통째로 누락 → 합계 출렁임 → 월간델타 음수 발생하던 버그 수정)
  const moMap={};
  moKeys.forEach(mk=>{
    const a={r:0,res:0,u:0,d0:0,d30:0,d60:0};
    siteWeekly.forEach(arr=>{
      let last=null;
      for(const w of arr){if(w.week.slice(0,7)<=mk)last=w;else break;}
      if(last){a.r+=last.r;a.res+=last.res;a.u+=last.u;a.d0+=last.d0;a.d30+=last.d30;a.d60+=last.d60;}
    });
    moMap[mk]={week:mk,...a};
  });
  // 연도 옵션
  const years=[...new Set(moKeys.map(k=>k.slice(0,4)))].sort();
  const curYear=(years.includes(S.dashMoYear)?S.dashMoYear:(years.includes(S.rm.slice(0,4))?S.rm.slice(0,4):years[years.length-1]))||S.rm.slice(0,4);
  const yrSel=document.getElementById('dmo-yr');
  if(yrSel){yrSel.innerHTML=years.length?years.map(y=>`<option value="${y}" ${y===curYear?'selected':''}>${y}년</option>`).join(''):`<option value="${curYear}" selected>${curYear}년</option>`;}
  // 파생 지표 (rSite와 동일 규칙)
  const nf=tblNF,dlt=tblDlt,ltrCells=tblLtrCells,metrics=tblMetrics; // 공유 헬퍼 별칭(단일 출처)
  const rows=moKeys.map((k,i)=>{const w=moMap[k],prev=i>0?moMap[moKeys[i-1]]:null,prev2=i>1?moMap[moKeys[i-2]]:null;return{w,k,m:metrics(w,prev,prev2),first:i===0,yr:k.slice(0,4),mo:Number(k.slice(5,7))};}).filter(x=>x.yr===curYear);
  const body=rows.map((x,j)=>{const{w,m,first,mo}=x;return`<tr><td class="cc mcell">${mo}월</td><td class="cc recv-total tl-grp">${nf(m.tR)}</td><td class="cc recv-weekly">${nf(m.recvW)}</td><td class="cc proc-blue tl-grp">${nf(m.cumRes)}</td><td class="rate-col proc-blue">${m.rate.toFixed(1)}%</td><td class="cc proc-blue">${nf(m.resW)}</td><td class="cc">${dlt(m.resWDlt,first,m.resW,'월')}</td><td class="cc unr-red tl-grp">${nf(m.unr)}</td><td class="cc">${dlt(m.unrDlt,first,m.unr,'월')}</td>${ltrCells(m.d0,m.d30,m.d60,m.unr,m.ltDlt,first,'월')}</tr>`;}).join('');
  const eq='6.5%',ltrW='16%';
  const colgroup=`<colgroup><col style="width:9%"><col style="width:${eq}"><col style="width:${eq}"><col style="width:${eq}"><col style="width:${eq}"><col style="width:${eq}"><col style="width:${eq}"><col style="width:${eq}"><col style="width:${eq}"><col style="width:${eq}"><col style="width:${ltrW}"><col style="width:${eq}"></colgroup>`;
  const th=tblTh,thG=tblThG; // 공유 헬퍼 별칭(단일 출처)
  const thead=`<thead><tr>${th('','월')}${thG('','전체 접수')}${th('recv-sub','월간 접수')}${thG('','전체 처리')}${th('rate-col','처리율')}${th('','월간 처리')}${th('','전월대비')}${thG('','전체 미처리')}${th('','전월대비')}${th('tl-grp-ltr','장기미처리')}<th class="cc tl-grp-ltr">장기미처리 비율</th><th class="cc">전월대비</th></tr></thead>`;
  tbl.innerHTML=colgroup+thead+`<tbody>${body||'<tr><td colspan="12" style="text-align:center;padding:14px;color:var(--lbl3)">데이터 없음</td></tr>'}</tbody>`;
}
// 기준월 칩 — 라벨은 모드에 따라 다르다(편집자=로컬 집계 / 사내공유=게시본 / 스냅샷=박제 문서).
// 렌더마다 갱신되므로 단일 진입점으로 둔다. (과거 rDash가 편집자 형식으로 덮어써 뷰어·스냅샷 라벨이 지워졌음)
function setRmChip(){
  const chip=document.getElementById('mchip');if(!chip)return;
  const b=document.body.classList;
  const src=b.contains('snap')?' · 스냅샷':(b.contains('viewer')?' · 사내공유':'');
  chip.textContent='기준월 '+S.rm+src;
}
// 스냅샷에 여러 달이 담긴 경우의 기준월 선택기 — 뷰어(vrm)와 같은 자리·같은 모양, 네트워크 없이 동작
function snapInitRmSel(){
  const M=window.__SNAPM__,mc=document.querySelector('.mc');if(!mc)return;
  const months=M?Object.keys(M).sort().reverse():[];
  let sel=document.getElementById('vrm');
  if(months.length<2){if(sel)sel.style.display='none';mc.style.display='';return;}
  if(!sel){sel=document.createElement('select');sel.id='vrm';sel.className='fbu-sel vrm-sel';sel.setAttribute('aria-label','열람할 기준월 선택');mc.parentNode.insertBefore(sel,mc.nextSibling);}
  sel.setAttribute('data-act','snap.rm');
  sel.innerHTML=months.map(m=>`<option value="${esc(m)}"${m===S.rm?' selected':''}>${esc(m)}</option>`).join('');
  sel.style.display='';mc.style.display='none'; // 선택기가 보이면 기준월 칩은 중복 정보 — 숨김
}
function snapSwitchMonth(rm){
  const M=window.__SNAPM__;if(!M||!M[rm]||rm===S.rm)return;
  const P=M[rm];
  window.__SNAP__=P;
  S.sites=P.sites||[];S.teams=P.teams||[];S.cmt=P.cmt||{};S.ana=P.ana||{};S.rm=P.rm||rm;
  for(const sid in (P.st||{}))deriveLul(P.st[sid]); // 장기미처리는 미저장 — 전환 시 파생
  _calcCache.clear();
  ensureTeams();setRmChip();rTeamSel();rNav();
  if(S.view==='site'&&S.sid&&teamSites().some(s=>s.id===S.sid))rSite(S.sid);else go('dashboard');
}
function rDash(){
  setRmChip();
  const all=dashSites().map(s=>({s,st:calc(S.def[s.id]||[],s,S.rm)}));
  // 합계: all을 단일 패스로 집계 (KPI 4종 + 전월 3종 + 지연구간 3종 + 전월장기 1종).
  let tR=0,tRes=0,tU=0,tLt=0,pU=0,pR=0,pRes=0,tDd0=0,tDd30=0,tDd60=0,pLt=0;
  for(const x of all){const st=x.st;tR+=st.tR;tRes+=st.res;tU+=st.unr;tLt+=st.lt;pU+=st.prev.unr;pR+=st.prev.total;pRes+=st.prev.res;tDd0+=st.dd[0];tDd30+=st.dd[1];tDd60+=st.dd[2];pLt+=st.prev.lt;}
  const rate=tR>0?tRes/tR*100:0,pRate=pR>0?pRes/pR*100:0;
  const tUnits=dashSites().reduce((a,s)=>a+(s.units||0),0);
  document.getElementById('dkpi').innerHTML=[
    {cls:'bl',label:'관리대상현장',valHTML:`<span class="kpi-pc">${tUnits.toLocaleString()}<span class="u">세대</span></span><span class="kpi-mo kpi-team">${esc((((S.teams||[]).find(t=>t.id===S.teamId)||(S.teams||[])[0])||{}).name||'전체')}</span>`,meta:`<span class="kpi-pc">${dashSites().length.toLocaleString()}개 현장</span><span class="kpi-mo">${dashSites().length}개 현장 ${tUnits.toLocaleString()}세대</span>`},
    {cls:'sk',label:'전체 접수',val:tR,unit:'건',meta:`세대당 ${tUnits>0?(tR/tUnits).toFixed(1):'0.0'}건`},
    {cls:'ms',label:'처리 완료',val:tRes,unit:'건',meta:`처리율 ${rate.toFixed(1)}%`},
    {cls:'wh',label:'미처리',val:tU,unit:'건',meta:`세대당 ${tUnits>0?(tU/tUnits).toFixed(1):'0.0'}건`,act:'ul',tt:'팀 전체 미처리 목록 보기'},
    {cls:'wh',label:'장기미처리(30일+)',val:tLt,unit:'건',meta:`미처리의 ${tU>0?(tLt/tU*100).toFixed(1):0}%`,act:'lul',tt:'팀 전체 장기미처리 목록 보기'},
  ].map(k=>`<div class="kc ${k.cls}${k.act?' kc-click':''}"${k.act?` data-act="rec.list" data-sid="__team" data-scope="${k.act}"`:''}${k.tt?` data-tt="${esc(k.tt)}"`:''}><div class="kl">${k.label}</div><div class="kv">${k.valHTML!==undefined?k.valHTML:k.val.toLocaleString()+(k.unit?`<span class="u">${k.unit}</span>`:'')}</div><div class="km">${k.meta}</div>${k.act?`<span class="kc-cta"><span class="kc-cta-t">목록 보기</span> <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M9 6l6 6-6 6"/></svg></span>`:''}</div>`).join('');
  document.getElementById('dtbody').innerHTML=sortDR(all).map(({s,st})=>{const ld=st.lt-st.prev.lt,isUp=ld>0,isFlat=ld===0,p60=st.unr>0?Math.min(st.dd[2]/st.unr*100,100):0,p30=st.unr>0?Math.min(st.dd[1]/st.unr*100,100):0,p0=st.unr>0?Math.min(st.dd[0]/st.unr*100,100):0,arrow=isFlat?'─':isUp?'▲':'▼',sign=isFlat?'':isUp?'+':'−',badge=isFlat?'bgr':isUp?'brd':'bgn';const uD=st.unr-st.prev.unr,uArrow=uD===0?'─':uD>0?'▲':'▼',uSign=uD>0?'+':uD<0?'−':'',uBadge=uD===0?'bgr':uD>0?'brd':'bgn';return`<tr><td class="cc" style="white-space:nowrap"><span class="ba bbl">${esc(s.region)}</span></td><td><b style="color:var(--bt1);cursor:pointer" data-act="nav.site" data-site="${esc(s.id)}">${esc(s.name)}</b></td><td class="n">${s.units.toLocaleString()}</td><td class="n">${st.tR.toLocaleString()}</td><td class="n" style="color:var(--gn)">${st.res.toLocaleString()}</td><td class="n" style="font-weight:600">${st.rate.toFixed(1)}%</td><td class="n" style="color:var(--am)">${st.unr.toLocaleString()}</td><td class="cc" style="white-space:nowrap"><span class="ba ${uBadge}" data-tt="전월 ${st.prev.unr.toLocaleString()} → 금월 ${st.unr.toLocaleString()}" aria-label="전월 ${st.prev.unr.toLocaleString()} → 금월 ${st.unr.toLocaleString()}">${uArrow} ${uSign}${Math.abs(uD).toLocaleString()}</span></td><td class="n" style="color:var(--rd)">${st.lt.toLocaleString()}</td><td><div class="ltrbar-wrap"><div class="ltrbar" data-tip="${esc(s.name)}|${st.unr}|${st.dd[2]}|${st.dd[1]}|${st.dd[0]}|${st.ltr.toFixed(1)}"><div class="seg s60" style="width:${p60}%"></div><div class="seg s30" style="width:${p30}%"></div><div class="seg s0" style="width:${p0}%"></div></div><span class="ltrbar-pct">${st.ltr.toFixed(1)}%</span></div></td><td class="cc" style="white-space:nowrap"><span class="ba ${badge}" data-tt="전월 ${st.prev.lt.toLocaleString()} → 금월 ${st.lt.toLocaleString()}" aria-label="전월 ${st.prev.lt.toLocaleString()} → 금월 ${st.lt.toLocaleString()}">${arrow} ${sign}${Math.abs(ld).toLocaleString()}</span></td></tr>`;}).join('')||'<tr><td colspan="11" style="text-align:center;padding:24px;color:var(--lbl3)">현장리스트에서 현장을 추가하고 리스트를 업로드하세요.</td></tr>';
  // 합계 행 — sortDT에도 위치 고정 (tfoot에 별도 배치). 데이터 0건일 땐 비움.
  const ft=document.getElementById('dtfoot');
  if(ft){
    if(!all.length){ft.innerHTML='';}
    else{
      const tLtr=tU>0?tLt/tU*100:0,pLtr=pU>0?pLt/pU*100:0,fld=tLt-pLt;
      const fp60=tU>0?Math.min(tDd60/tU*100,100):0,fp30=tU>0?Math.min(tDd30/tU*100,100):0,fp0=tU>0?Math.min(tDd0/tU*100,100):0;
      const farrow=fld===0?'─':fld>0?'▲':'▼',fsign=fld===0?'':fld>0?'+':'−',fbadge=fld===0?'bgr':fld>0?'brd':'bgn';
      const fuD=tU-pU,fuArrow=fuD===0?'─':fuD>0?'▲':'▼',fuSign=fuD>0?'+':fuD<0?'−':'',fuBadge=fuD===0?'bgr':fuD>0?'brd':'bgn';
      ft.innerHTML=`<tr class="tot"><td class="cc" style="white-space:nowrap"></td><td><b>합계</b></td><td class="n">${tUnits.toLocaleString()}</td><td class="n">${tR.toLocaleString()}</td><td class="n" style="color:var(--gn)">${tRes.toLocaleString()}</td><td class="n">${rate.toFixed(1)}%</td><td class="n" style="color:var(--am)">${tU.toLocaleString()}</td><td class="cc" style="white-space:nowrap"><span class="ba ${fuBadge}" data-tt="전월 ${pU.toLocaleString()} → 금월 ${tU.toLocaleString()}" aria-label="전월 ${pU.toLocaleString()} → 금월 ${tU.toLocaleString()}">${fuArrow} ${fuSign}${Math.abs(fuD).toLocaleString()}</span></td><td class="n" style="color:var(--rd)">${tLt.toLocaleString()}</td><td><div class="ltrbar-wrap"><div class="ltrbar" data-tip="합계|${tU}|${tDd60}|${tDd30}|${tDd0}|${tLtr.toFixed(1)}"><div class="seg s60" style="width:${fp60}%"></div><div class="seg s30" style="width:${fp30}%"></div><div class="seg s0" style="width:${fp0}%"></div></div><span class="ltrbar-pct">${tLtr.toFixed(1)}%</span></div></td><td class="cc" style="white-space:nowrap"><span class="ba ${fbadge}" data-tt="전월 ${pLt.toLocaleString()} → 금월 ${tLt.toLocaleString()}" aria-label="전월 ${pLt.toLocaleString()} → 금월 ${tLt.toLocaleString()}">${farrow} ${fsign}${Math.abs(fld).toLocaleString()}</span></td></tr>`;
    }
  }
  rDTMark();
  attachLtrTip();
  // 2단계 렌더: KPI·현장표를 먼저 페인트하고 무거운 표·차트·이슈는 다음 프레임에 생성(체감 즉시성).
  // rDash._flush 일치 검사 = 토큰(연속 호출 시 이전 지연분 무효화). 동기 완결이 필요한 경로(스냅샷 생성)는 rDash._flush()로 즉시 실행.
  const _late=()=>{
    if(rDash._flush!==_late)return;rDash._flush=null;
    if(S.view!=='dashboard')return; // 이탈 시 스킵 — 재진입 시 go()가 rDash를 다시 부름
    try{buildDashMonthTable();}catch(e){console.error('buildDashMonthTable failed',e);}
    try{rCharts(all);}catch(e){console.error('rCharts failed',e);}
    rInsights(all,tR,tRes,tU,tLt,rate,pRate);
  };
  rDash._flush=_late;
  (window.requestAnimationFrame||function(f){setTimeout(f,16);})(()=>_late());
}
// 주요 이슈 — 11종 후보 점수화 → 상위 3개 노출.
// 점수 = 전월대비 변화 점수×0.6 + 현장 간 z-score×0.4 (월간회의: 전월대비 우선, 튀는 현장 가중).
// 카드당 2줄: 1줄=핵심수치(전월대비), 2줄=진단·조치. 제목은 후보별 자동.
// ── 주요 이슈 카드 확장 상세 ──
// 카드 제목(ttl) 프리셋으로 관련 미처리 건을 필터해 현장별·공종·유형·지연구간 분해와 목록 바로가기를 생성.
// 데이터는 확장 시점에 calc로 재계산 — 편집자(로컬 원본)·뷰어(게시 kpi 조기반환) 동일 경로, AI 재작성 후에도 제목이 유지되므로 유효.
function insDetailHTML(ttl){
  const list=dashSites().map(s=>({s,st:calc(S.def[s.id]||[],s,S.rm)}));
  if(!list.length)return '<div class="insd"><div class="insd-empty">데이터 없음</div></div>';
  const t=String(ttl||'');
  const lul=/장기미처리/.test(t);
  let rows=list.flatMap(x=>((lul?x.st.lul:x.st.ul)||[]).map(i=>({i,s:x.s})));
  const aggr=key=>{const m={};rows.forEach(r=>{const k=r.i[key]||'기타';m[k]=(m[k]||0)+1;});return Object.entries(m).sort((a,b)=>b[1]-a[1]);};
  let filtLbl='',listBtns='';
  const scopeLbl=lul?'장기미처리(30일+)':'미처리',sc=lul?'lul':'ul';
  const teamBtn=(lb,extra)=>`<button class="btn bo bsm" data-act="${extra&&extra.indexOf('data-fk')>=0?'dash.insList':'rec.list'}" data-sid="__team" data-scope="${sc}"${extra||''}>${lb}</button>`;
  if(/품의/.test(t)){rows=rows.filter(r=>r.i.repairParty==='품의(대기)');filtLbl='품의(대기)';listBtns=teamBtn('품의(대기) 목록',' data-fk="repairParty" data-fv="품의(대기)"');}
  else if(/공가/.test(t)){rows=rows.filter(r=>isVacUnit(r.i));filtLbl='공가세대';listBtns=teamBtn('공가세대 목록',' data-vac="unit"');}
  else if(/하자유형/.test(t)){const top=aggr('defectType')[0];if(top){rows=rows.filter(r=>(r.i.defectType||'기타')===top[0]);filtLbl=top[0]+' 유형';listBtns=teamBtn(esc(top[0])+' 목록',` data-fk="defectType" data-fv="${esc(top[0])}"`);}}
  else if(/협력사|업체/.test(t)){const m={};rows.forEach(r=>{const k=r.i.contractor||'';if(!k||k==='미지정')return;m[k]=(m[k]||0)+1;});const top=Object.entries(m).sort((a,b)=>b[1]-a[1])[0];if(top){rows=rows.filter(r=>(r.i.contractor||'')===top[0]);filtLbl=top[0];listBtns=teamBtn(esc(top[0])+' 목록',` data-fk="contractor" data-fv="${esc(top[0])}"`);}}
  else listBtns=teamBtn(lul?'팀 장기미처리 목록':'팀 미처리 목록','');
  if(!rows.length)return '<div class="insd" data-act="modal.stop"><div class="insd-empty">해당 조건의 '+scopeLbl+' 건이 없습니다</div></div>';
  // 지연구간 분해(기준월 말일 역산 — 대시보드 지연 기준과 동일)
  const _p=S.rm.split('-').map(Number),_end=new Date(_p[0],_p[1],0);
  const bands=[0,0,0];rows.forEach(r=>{const d=r.i.receiptDate?Math.max(0,Math.round((_end-new Date(r.i.receiptDate))/86400000)):0;bands[d>=60?2:d>=30?1:0]++;});
  const sm={};rows.forEach(r=>{sm[r.s.id]=(sm[r.s.id]||0)+1;});
  const siteRows=Object.entries(sm).map(([id,v])=>({s:list.find(x=>x.s.id===id).s,v})).sort((a,b)=>b.v-a.v).slice(0,5); // 상위 5개 — 다른 블록과 행수 통일, 확장 카드 내 스크롤 방지
  const tot=rows.length;
  const mini=(bt,pairs)=>`<div class="insd-b"><div class="insd-bt">${bt}</div>${pairs.map(p=>`<div class="insd-r">${p.h}<b>${p.v.toLocaleString()}</b><span class="insd-p">${Math.round(p.v/tot*100)}%</span></div>`).join('')||'<div class="insd-r insd-empty">없음</div>'}</div>`;
  const bSite=mini('현장별 상위',siteRows.map(r=>({h:`<span class="insd-l" data-act="nav.site" data-site="${esc(r.s.id)}">${esc(shortName(r.s.name))}</span>`,v:r.v})));
  const bTr=mini('공종 상위',aggr('trade').slice(0,5).map(([k,v])=>({h:`<span class="insd-l" data-act="dash.insTr" data-tr="${esc(k)}" data-scope="${sc}">${esc(k)}</span>`,v}))); // 클릭 → 해당 공종 팀 목록
  const bDt=mini('하자유형 상위',aggr('defectType').slice(0,5).map(([k,v])=>({h:`<span class="insd-l" data-act="dash.insList" data-scope="${sc}" data-fk="defectType" data-fv="${esc(k)}">${esc(k)}</span>`,v}))); // 클릭 → 해당 유형 팀 목록
  const bBand=mini('지연구간',[['~29일',bands[0]],['30~59일',bands[1]],['60일+',bands[2]]].map(([k,v])=>({h:`<span>${k}</span>`,v})));
  return `<div class="insd" data-act="modal.stop"><div class="insd-h"><span>${esc(filtLbl||scopeLbl)} <b>${tot.toLocaleString()}건</b> 기준 상세</span><span class="insd-btns">${listBtns}<button class="btn bg2 bsm" data-act="dash.insCollapse">접기</button></span></div><div class="insd-cols">${bSite}${bTr}${bDt}${bBand}</div></div>`;
}
// 카드에 확장 토글 속성 부착 — safeHTML(ALLOW_DATA_ATTR:false·속성 화이트리스트)이 data-act를 제거하므로 살균 후 DOM에서 부여.
// 제목은 .ic-ttl 텍스트에서 읽어 세 렌더 경로(규칙 선정·AI 재작성·스냅샷 임베드) 공통으로 동작.
function insCollapseAll(){const g=document.getElementById('d-insight');if(!g)return false;const c=g.querySelector('.ic.exp');if(!c)return false;c.classList.remove('exp');c.dataset.tt='펼치기';c.setAttribute('aria-expanded','false');g.classList.remove('ins-open');g.style.height='';return true;}
function insBindCards(){
  const el=document.getElementById('d-insight');if(!el)return;
  el.classList.remove('ins-open');el.style.height=''; // 재렌더 시 확장 잔여 상태 초기화 — 남으면 전 카드가 투명·클릭불가로 잠김
  el.querySelectorAll('.ic').forEach(c=>{
    const tt=c.querySelector('.ic-ttl');if(!tt)return;
    const t=tt.textContent.trim();
    if(t==='데이터 없음'||t==='주요 이슈 없음')return; // 안내 카드는 확장 대상 아님
    c.dataset.act='dash.insToggle';c.dataset.instt=t;
    c.dataset.tt='펼치기'; // 접힌 상태 안내(펼치면 제거)
    c.setAttribute('role','button');c.setAttribute('tabindex','0');c.setAttribute('aria-expanded','false');
  });
}
// 게시·스냅샷 캡처용 — 확장 상태(.exp)·상세(.insd)와 DOM 부착 토글 속성을 제거한 정적 HTML
function insCleanHTML(){const el=document.getElementById('d-insight');if(!el)return '';const c=el.cloneNode(true);c.querySelectorAll('.insd').forEach(x=>x.remove());c.querySelectorAll('.ic').forEach(x=>{x.classList.remove('exp');x.removeAttribute('data-act');x.removeAttribute('data-instt');x.removeAttribute('role');x.removeAttribute('tabindex');x.removeAttribute('aria-expanded');});c.classList.remove('ins-open');return c.innerHTML;}
function rInsights(all,tR,tRes,tU,tLt,rate,pRate){
  const el=document.getElementById('d-insight');if(!el)return;
  if(window.__SNAP__){ // 스냅샷: 임베드 인사이트(살균) — 비어 있으면(구게시본·대시보드 미방문 게시) 안내 표시
    const _ih=window.__SNAP__.insightsHTML||'';
    el.innerHTML=_ih.replace(/\s/g,'')?themeHTML(safeHTML(_ih)):'<div class="ic warn"><div class="ic-t"><div class="ic-ttl">주요 이슈 없음</div><div class="ic-sub">이 게시본에는 주요 이슈가 포함되지 않았습니다 · 재게시하면 표시됩니다.</div></div></div>';
    insBindCards(); // 스냅샷 임베드 카드에도 확장 토글 부착
    return;}
  if(!all.length){el.innerHTML='<div class="ic warn"><div class="ic-t"><div class="ic-ttl">데이터 없음</div><div class="ic-sub">현장리스트에서 현장을 추가하고 리스트를 업로드하세요.</div></div></div>';return;}
  const C={gn:'#1A7A3C',rd:'#C0392B'};
  const ICON={up:'<path d="M22.0 7.0L13.5 15.5L8.5 10.5L2.0 17.0"/><path d="M16.0 7.0L22.0 7.0L22.0 13.0"/>',clock:'<path d="M2.0 12.0a10.0 10.0 0 1 0 20.0 0a10.0 10.0 0 1 0 -20.0 0"/><path d="M12.0 6.0L12.0 12.0L16.0 14.0"/>',wrench:'<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',user:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><path d="M5.0 7.0a4.0 4.0 0 1 0 8.0 0a4.0 4.0 0 1 0 -8.0 0"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',layers:'<path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"/><path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12"/><path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17"/>',box:'<path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z"/><path d="M12 22V12"/><path d="m3.3 7 7.703 4.734a2 2 0 0 0 1.994 0L20.7 7"/><path d="m7.5 4.27 9 5.15"/>',home:'<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'}; // Lucide(ISC) — path만 사용(safeHTML 허용 태그 제약) // Lucide(ISC) — path만 사용(safeHTML 허용 태그 제약)
  const fmt=n=>Math.round(n).toLocaleString();
  const sgn=n=>(n>=0?'+':'−')+fmt(Math.abs(n));
  const pct=(n,d)=>d>0?(n/d*100):0;
  // z-score 헬퍼: 현장 배열에서 한 현장이 평균 대비 얼마나 튀는지(표준편차 배수)
  const zTop=(arr)=>{const v=arr.map(a=>a.v),n=v.length;if(n<2)return arr[0]?{...arr[0],z:0}:null;const m=v.reduce((a,b)=>a+b,0)/n,sd=Math.sqrt(v.reduce((a,b)=>a+(b-m)**2,0)/n)||1;return arr.map(a=>({...a,z:(a.v-m)/sd})).sort((a,b)=>b.z-a.z)[0];};
  // 전월대비 변화 점수: 비율(%) 절댓값을 0~1로 (40% 변화면 만점). 악화 방향이면 가산.
  const chg=(curr,prev,worseUp)=>{if(prev<=0)return curr>0?0.5:0;const r=(curr-prev)/prev;const mag=Math.min(Math.abs(r)/0.4,1);const worse=worseUp?r>0:r<0;return mag*(worse?1:0.35);};
  // 미처리 원시건 (대시보드 기준월말 기준)
  const _rmPi=S.rm.split('-').map(Number),_rmEndI=`${S.rm}-${String(new Date(_rmPi[0],_rmPi[1],0).getDate()).padStart(2,'0')}`;
  const siteUnr={};all.forEach(({s})=>{siteUnr[s.id]=(S.def[s.id]||[]).filter(i=>i.receiptDate&&i.receiptDate<=_rmEndI&&!(i.status==='처리'&&i.completionDate&&i.completionDate<=_rmEndI));});
  const _unrAll=all.flatMap(({s})=>siteUnr[s.id]);
  // 집계 헬퍼
  const agg=(items,key)=>{const m={};items.forEach(i=>{const k=(typeof key==='function'?key(i):i[key])||'기타';m[k]=(m[k]||0)+1;});return Object.entries(m).sort((a,b)=>b[1]-a[1]);};
  // 미귀책 보수주체 집합 (시공업체=정상귀책 외 전부)
  const NONFAULT=new Set(['품의(대기)','외주','외주(다기능공)','H서비스센터','신속대응팀','현장직영','미지정']);
  // 전월 대비 합계
  const pT=all.reduce((a,x)=>a+x.st.prev.total,0),pRes=all.reduce((a,x)=>a+x.st.prev.res,0),pU=all.reduce((a,x)=>a+x.st.prev.unr,0),pLt=all.reduce((a,x)=>a+x.st.prev.lt,0);
  const deltaU=tU-pU,deltaLt=tLt-pLt,deltaR=tRes-pRes,deltaIn=tR-pT,delta=rate-pRate;
  const ltr=pct(tLt,tU);

  // 현장명 줄임말 헬퍼 (도넛 차트 범례와 동일)
  const sn=s=>shortName(s.name);
  // 현장 목록 → 줄임말 나열 (최대 4개, 초과 시 '외N개')
  const siteList=(arr,max=4)=>{if(!arr||!arr.length)return'';const names=arr.map(s=>sn(s));if(names.length<=max)return names.map(n=>`<b>${n}</b>`).join('·');return names.slice(0,max).map(n=>`<b>${n}</b>`).join('·')+`·외${names.length-max}개`;};

  // 미처리 상위 10 협력사 집합 (미처리 건수 기준) — 협력사/공종 후보 필터링에 공통 사용
  const _unrByCo={}; _unrAll.forEach(i=>{const k=i.contractor||'미지정';if(k==='미지정'||k==='')return;(_unrByCo[k]=_unrByCo[k]||0);_unrByCo[k]++;});
  const _top10Co=new Set(Object.entries(_unrByCo).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([k])=>k));
  // 미처리 상위 10 공종 집합
  const _unrByTr={}; _unrAll.forEach(i=>{const k=i.trade||'기타';(_unrByTr[k]=_unrByTr[k]||0);_unrByTr[k]++;});
  const _top10Tr=new Set(Object.entries(_unrByTr).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([k])=>k));

  const cand=[];
  // 1. 협력사 처리율 저조 — 미처리 상위 10 업체 중 처리율 최저, 타 업체 평균 대비 격차
  (()=>{
    // 협력사별 접수·처리·미처리 + 주공종(미처리 기준) + 소속 현장 추적
    const byCo={};all.flatMap(({s})=>(S.def[s.id]||[]).filter(i=>i.receiptDate&&i.receiptDate<=_rmEndI).map(i=>({...i,_s:s}))).forEach(i=>{const k=i.contractor||'미지정';if(k==='미지정'||k==='')return;const done=i.status==='처리'&&i.completionDate&&i.completionDate<=_rmEndI;if(!byCo[k])byCo[k]={t:0,r:0,u:0,siteSet:new Set(),trades:{}};byCo[k].t++;if(done)byCo[k].r++;else{byCo[k].u++;const tr=i.trade||'기타';byCo[k].trades[tr]=(byCo[k].trades[tr]||0)+1;}byCo[k].siteSet.add(i._s.id);});
    // 미처리 상위 10 업체만 대상 + 접수 충분(50건+) 필터
    const rows=Object.entries(byCo).filter(([k,v])=>_top10Co.has(k)&&v.t>=50).map(([k,v])=>({k,t:v.t,rate:pct(v.r,v.t),u:v.u,topTr:Object.entries(v.trades).sort((a,b)=>b[1]-a[1])[0]?.[0]||'-',sites:[...v.siteSet].map(id=>all.find(x=>x.s.id===id)?.s).filter(Boolean)}));if(rows.length<2)return;
    const avg=rows.reduce((a,r)=>a+r.rate,0)/rows.length;const w=rows.slice().sort((a,b)=>a.rate-b.rate)[0];const gap=avg-w.rate;if(w.rate>=90||gap<10)return;
    const score=0.6*Math.min(gap/30,1)+0.4*Math.min(gap/15,1);
    const sLabel=w.sites.length===1?` (${sn(w.sites[0])})`:w.sites.length>1?` (${siteList(w.sites)})`:' ';
    cand.push({score,cls:'bad',icon:ICON.user,ttl:'협력사 처리율 저조',
      sub:`<b>${w.topTr} · ${w.k}</b>${sLabel} 처리율 <b style="color:${C.rd}">${w.rate.toFixed(1)}%</b> · 미처리 ${fmt(w.u)}건 (타 협력사 평균 ${avg.toFixed(1)}%, <b>−${gap.toFixed(1)}%p</b>)<br>해당 협력사 PM 호출 — 다음 달 처리계획 제출 요구, 미처리 ${fmt(w.u)}건 일정 확정 필요`});})();
  // 2. 장기미처리 다수 — 30일+ 절대건수·미처리대비%, 현장 z-score
  (()=>{const z=zTop(all.filter(x=>x.st.unr>0).map(x=>({s:x.s,v:x.st.lt,st:x.st})));if(!z)return;
    const score=0.6*chg(tLt,pLt,true)+0.4*Math.min(Math.max(z.z,0)/2,1)*(ltr>=25?1:0.6);
    cand.push({score,cls:deltaLt>0||ltr>=40?'bad':ltr>=25?'warn':'ok',icon:ICON.clock,ttl:'장기미처리 적체',
      sub:`30일+ <b>${fmt(tLt)}건</b> (전월대비 <b style="color:${deltaLt<=0?C.gn:C.rd}">${sgn(deltaLt)}</b>) · 미처리 대비 <b>${ltr.toFixed(1)}%</b> · 집중 <b>${sn(z.s)}</b> ${fmt(z.v)}건<br>${deltaLt>0?`<b style="color:${C.rd}">증가 ${fmt(deltaLt)}건</b> — 60일+ 별도 추적, 180일+ 동결건 분리 후 30일대 가속`:`<b style="color:${C.gn}">전월대비 ${fmt(Math.abs(deltaLt))}건 감소</b> — 개선 흐름 유지, <b>${sn(z.s)}</b> 집중 관리`}`});})();
  // 3. 품의(대기) 적체 — 건수·평균지연 + 쏠린 공종/유형/업체
  (()=>{const pi=_unrAll.filter(i=>i.repairParty==='품의(대기)');const n=pi.length;if(n<30)return;
    const _dB=(a,b)=>Math.max(0,Math.round((new Date(b)-new Date(a))/86400000));
    const avgDelay=pi.reduce((a,i)=>a+(i.receiptDate?_dB(i.receiptDate,_rmEndI):0),0)/Math.max(n,1); // 역산(기준일-접수일)으로 통일 — 대시보드 전체와 동일 기준
    const tT=agg(pi,'trade')[0],dT=agg(pi,'defectType')[0],cT=agg(pi,i=>i.contractor||'미지정')[0];
    // 품의 적체가 쏠린 현장
    const piSites=all.map(({s})=>({s,v:siteUnr[s.id].filter(i=>i.repairParty==='품의(대기)').length})).filter(r=>r.v>=10).sort((a,b)=>b.v-a.v);
    const piSiteLbl=piSites.length?` · 집중 ${siteList(piSites.slice(0,3).map(r=>r.s))}`:' ';
    const score=0.6*Math.min(avgDelay/120,1)+0.4*Math.min(n/200,1);
    cand.push({score,cls:n>=100||avgDelay>=100?'bad':'warn',icon:ICON.box,ttl:'품의(대기) 적체 — 당사 의사결정 병목',
      sub:`품의(대기) <b>${fmt(n)}건</b> · 평균지연 <b>${Math.round(avgDelay)}일</b>${piSiteLbl}<br>쏠림: <b>${tT?.[0]||'-'}</b> ${fmt(tT?.[1]||0)}건 · <b>${dT?.[0]||'-'}</b> ${fmt(dT?.[1]||0)}건 · <b>${cT?.[0]||'-'}</b> — 30일↑ 외주 전환·품의 승인 가속 필요`});})();
  // 4. 특정 하자유형 다수 — 미처리 최다 하자유형 점유율
  (()=>{const dt=agg(_unrAll,'defectType');if(!dt.length)return;const top=dt[0],share=pct(top[1],tU);if(share<20)return;
    const tradeOf=agg(_unrAll.filter(i=>(i.defectType||'미분류')===top[0]),'trade')[0];
    // 해당 유형이 쏠린 현장들
    const dtSites=all.map(({s})=>({s,v:siteUnr[s.id].filter(i=>(i.defectType||'미분류')===top[0]).length})).filter(r=>r.v>0).sort((a,b)=>b.v-a.v);
    const dtSiteLbl=dtSites.length?` · ${siteList(dtSites.slice(0,3).map(r=>r.s))} 집중`:' ';
    const score=0.6*Math.min(share/50,1)+0.4*Math.min(share/35,1);
    cand.push({score,cls:share>=40?'bad':'warn',icon:ICON.wrench,ttl:'특정 하자유형 집중',
      sub:`<b>${top[0]}</b> 미처리 <b>${fmt(top[1])}건</b> (미처리의 <b>${share.toFixed(0)}%</b>) · 주 공종 <b>${tradeOf?.[0]||'-'}</b>${dtSiteLbl}<br>해당 하자유형 표준 보수절차 정비·자재 선조달로 일괄 해소 검토`});})();
  // 5. 공가세대 다수 — 공가 미처리 건수, 현장 z-score
  (()=>{const isVac=i=>isVacUnit(i); // 공식 공가세대 정의로 일원화 — 카드/탭과 동일(하자구분='세대' AND 입주상태∈{미분양,미납})
    const rows=all.map(({s})=>({s,v:siteUnr[s.id].filter(isVac).length})).filter(r=>r.v>0);if(!rows.length)return;
    const tot=rows.reduce((a,r)=>a+r.v,0);const z=zTop(rows);if(tot<30||!z)return;
    const tradeOf=agg(all.flatMap(({s})=>siteUnr[s.id].filter(isVac)),'trade')[0];
    const affSites=rows.sort((a,b)=>b.v-a.v).slice(0,3).map(r=>r.s);
    const score=0.6*Math.min(tot/150,1)+0.4*Math.min(Math.max(z.z,0)/2,1);
    cand.push({score,cls:'warn',icon:ICON.home,ttl:'공가세대 미처리 다수',
      sub:`공가세대 미처리 <b>${fmt(tot)}건</b> · 집중 ${siteList(affSites)} · 주 공종 <b>${tradeOf?.[0]||'-'}</b><br>공가 일괄작업일 지정 — 단일 업체 다공종 보유 시 1회 투입으로 동선 절감`});})();
  // 6. 전월대비 접수 급증
  (()=>{if(pT<=0)return;const r=(tR-pT)/pT;if(r<=0.15)return;const z=zTop(all.filter(x=>x.st.prev.total>0).map(x=>({s:x.s,v:(x.st.tR-x.st.prev.total)/x.st.prev.total})));
    const score=0.6*chg(tR,pT,true)+0.4*Math.min(Math.max(z?.z||0,0)/2,1);
    cand.push({score,cls:'warn',icon:ICON.up,ttl:'전월대비 접수 급증',
      sub:`전체 접수 <b>${fmt(tR)}건</b> (전월대비 <b style="color:${C.rd}">${sgn(deltaIn)}</b>, <b>+${(r*100).toFixed(0)}%</b>)${z?` · 급증 <b>${sn(z.s)}</b>`:''}<br>입주 초기 피크 가능성 — 다발 공종 사전 인력·자재 확보, 신규 30일+ 진입 차단`});})();
  // 7. 전월대비 처리 급감
  (()=>{if(pRes<=0)return;const r=(tRes-pRes)/pRes;if(r>=-0.15)return;const z=zTop(all.filter(x=>x.st.prev.res>0).map(x=>({s:x.s,v:(x.st.prev.res-x.st.res)/x.st.prev.res})));
    const score=0.6*chg(tRes,pRes,false)+0.4*Math.min(Math.max(z?.z||0,0)/2,1);
    cand.push({score,cls:'bad',icon:ICON.up,ttl:'전월대비 처리량 급감',
      sub:`처리 완료 <b>${fmt(tRes)}건</b> (전월대비 <b style="color:${C.rd}">${sgn(deltaR)}</b>, <b>${(r*100).toFixed(0)}%</b>)${z?` · 급감 <b>${sn(z.s)}</b>`:''}<br>처리 동력 저하 — 협력사 가동률 점검, 주간 처리 KPI 직전월 평균 +50% 재설정`});})();
  // 8. 전월대비 미처리 급증
  (()=>{if(pU<=0)return;const r=(tU-pU)/pU;if(r<=0.1)return;const z=zTop(all.filter(x=>x.st.prev.unr>0).map(x=>({s:x.s,v:(x.st.unr-x.st.prev.unr)/x.st.prev.unr})));
    const score=0.6*chg(tU,pU,true)+0.4*Math.min(Math.max(z?.z||0,0)/2,1);
    cand.push({score,cls:'bad',icon:ICON.clock,ttl:'전월대비 미처리 급증',
      sub:`미처리 <b>${fmt(tU)}건</b> (전월대비 <b style="color:${C.rd}">${sgn(deltaU)}</b>, <b>+${(r*100).toFixed(0)}%</b>)${z?` · 급증 <b>${sn(z.s)}</b>`:''}<br>접수 대비 처리 적체 — 다발 공종 우선 배정, 미귀책건 외주 전환 가속`});})();
  // 9. 전월대비 장기미처리 급증
  (()=>{if(pLt<=0)return;const r=(tLt-pLt)/pLt;if(r<=0.1)return;const z=zTop(all.filter(x=>x.st.prev.lt>0).map(x=>({s:x.s,v:(x.st.lt-x.st.prev.lt)/x.st.prev.lt})));
    const score=0.6*chg(tLt,pLt,true)+0.4*Math.min(Math.max(z?.z||0,0)/2,1)+0.1;
    cand.push({score,cls:'bad',icon:ICON.clock,ttl:'전월대비 장기미처리 급증',
      sub:`30일+ <b>${fmt(tLt)}건</b> (전월대비 <b style="color:${C.rd}">${sgn(deltaLt)}</b>, <b>+${(r*100).toFixed(0)}%</b>)${z?` · 급증 <b>${sn(z.s)}</b>`:''}<br>신규 장기진입 가속 — 30일 도래 임박건 집중 처리, 60일+ 별도 동결 분류`});})();
  // 10. 전 현장 특정 업체·공종 미처리 다수 — 미처리 상위 10 업체 AND 상위 10 공종 조합만
  (()=>{const m={};_unrAll.forEach(i=>{const co=i.contractor||'미지정',tr=i.trade||'기타';if(co==='미지정')return;if(!_top10Co.has(co)||!_top10Tr.has(tr))return;// 상위 10 업체·공종 교차만
    const k=co+'|'+tr;if(!m[k])m[k]={co,tr,c:0,siteIds:new Set()};m[k].c++;m[k].siteIds.add(i.siteCode||i.siteName||'');});
    const rows=Object.values(m).filter(v=>v.siteIds.size>=2).sort((a,b)=>b.c-a.c);if(!rows.length)return;const top=rows[0];const share=pct(top.c,tU);if(top.c<50)return;
    // 해당 협력사+공종 조합이 있는 현장 실제 객체 찾기
    const affIds=top.siteIds;const affSites=all.filter(({s})=>affIds.has(s.id)||affIds.has(s.name)).map(({s})=>s);
    const siteLbl=affSites.length?` (${siteList(affSites)})`:` (${top.siteIds.size}개 현장)`;
    const score=0.6*Math.min(share/30,1)+0.4*Math.min(top.siteIds.size/all.length,1);
    cand.push({score,cls:share>=15?'bad':'warn',icon:ICON.layers,ttl:'전 현장 특정 업체·공종 미처리',
      sub:`<b>${top.tr} · ${top.co}</b> 미처리 <b>${fmt(top.c)}건</b>${siteLbl} · 미처리의 ${share.toFixed(0)}%<br>전사 단일 협력사 적체 — 본부 차원 합동 점검·자재 선조달, 협력사 증원 협의`});})();
  // 11. 미귀책 보수주체 비중 과다 — 쏠린 공종·업체가 미처리 상위 10 안에 있을 때만 명시
  (()=>{const nf=_unrAll.filter(i=>NONFAULT.has(i.repairParty));const share=pct(nf.length,tU);if(nf.length<50||share<25)return;
    const rows=all.map(({s})=>{const u=siteUnr[s.id];return{s,v:pct(u.filter(i=>NONFAULT.has(i.repairParty)).length,u.length)};}).filter(r=>r.v>0);const z=zTop(rows);
    const tT=agg(nf.filter(i=>_top10Tr.has(i.trade||'기타')),'trade')[0];// 상위 10 공종만
    const cT=agg(nf.filter(i=>_top10Co.has(i.contractor||'')),'contractor')[0];// 상위 10 업체만
    const pT2=agg(nf,'repairParty')[0];
    const score=0.6*Math.min(share/50,1)+0.4*Math.min(Math.max(z?.z||0,0)/2,1);
    const trCoLbl=(tT&&cT)?`<b>${tT[0]} · ${cT[0]}</b>`:(tT?`공종 <b>${tT[0]}</b>`:(cT?`업체 <b>${cT[0]}</b>`:''));
    cand.push({score,cls:share>=40?'bad':'warn',icon:ICON.box,ttl:'미귀책 보수주체 비중 과다',
      sub:`시공업체 외 보수주체 <b>${fmt(nf.length)}건</b> (미처리의 <b>${share.toFixed(0)}%</b>) · 최다 <b>${pT2?.[0]||'-'}</b>${z?` · 집중 <b>${sn(z.s)}</b>`:''}<br>쏠림: ${trCoLbl||'-'} — 품의 승인·외주 발주 우선 처리로 신속 해소`});})();

  // ── 긍정 후보 ──
  // 12. 전월대비 처리율 상승 — 괄목 현장 포함
  (()=>{if(delta<=1)return;// 1%p 초과 상승
    const byImpP=all.filter(x=>x.st.prev.total>0).map(x=>({s:x.s,imp:x.st.rate-x.st.prev.rate})).sort((a,b)=>b.imp-a.imp);
    const topUp=byImpP[0];const upSites=byImpP.filter(x=>x.imp>1).map(x=>x.s);
    const score=0.45*Math.min(delta/10,1)+0.3*Math.min((rate-60)/35,1)+0.25;// 긍정은 기본 0.25 가산
    cand.push({score,cls:'ok',icon:ICON.up,ttl:'전월대비 처리율 상승',
      sub:`처리율 <b style="color:${C.gn}">${rate.toFixed(1)}%</b> (전월대비 <b style="color:${C.gn}">+${delta.toFixed(1)}%p</b>) · 미처리 <b>${fmt(tU)}건</b> (전월대비 ${deltaU<=0?`<b style="color:${C.gn}">${sgn(deltaU)}</b>`:`<b style="color:${C.rd}">${sgn(deltaU)}</b>`})<br>${upSites.length?`개선 현장: ${siteList(upSites.slice(0,4))} — 처리 흐름 유지, 미도달 현장 집중 지원`:'전체 처리율 상승 — 협력사 현 가동률 유지 권고'}`});})();
  // 13. 전월대비 미처리 감소 (처리율 상승 없이도 미처리 자체가 줄었을 때)
  (()=>{if(deltaU>=-5||tU<=0)return;const r=Math.abs(deltaU)/Math.max(pU,1);if(r<0.05)return;
    const byDn=all.filter(x=>x.st.prev.unr>0).map(x=>({s:x.s,dn:x.st.prev.unr-x.st.unr})).filter(x=>x.dn>0).sort((a,b)=>b.dn-a.dn);
    const score=0.4*Math.min(r/0.3,1)+0.25;
    cand.push({score,cls:'ok',icon:ICON.clock,ttl:'전월대비 미처리 감소',
      sub:`미처리 <b style="color:${C.gn}">${fmt(tU)}건</b> (전월대비 <b style="color:${C.gn}">${sgn(deltaU)}</b>, <b>${(r*100).toFixed(0)}%↓</b>) · 처리율 <b>${rate.toFixed(1)}%</b><br>${byDn.length?`감소 주도: ${siteList(byDn.slice(0,3).map(x=>x.s))} — 미처리 추가 감축 목표 연속 설정`:'전반 미처리 감소 — 처리 속도 유지, 60일+ 모니터링 강화'}`});})();
  // 14. 전월대비 장기미처리 감소
  (()=>{if(deltaLt>=-5||tLt<=0)return;const r=Math.abs(deltaLt)/Math.max(pLt,1);if(r<0.05)return;
    const z=zTop(all.filter(x=>x.st.prev.lt>0&&x.st.lt<x.st.prev.lt).map(x=>({s:x.s,v:x.st.prev.lt-x.st.lt})));
    const score=0.4*Math.min(r/0.3,1)+0.2;
    cand.push({score,cls:'ok',icon:ICON.clock,ttl:'전월대비 장기미처리 감소',
      sub:`30일+ <b style="color:${C.gn}">${fmt(tLt)}건</b> (전월대비 <b style="color:${C.gn}">${sgn(deltaLt)}</b>, <b>${(r*100).toFixed(0)}%↓</b>) · 미처리 대비 <b>${ltr.toFixed(1)}%</b>${z?` · 최대개선 <b>${sn(z.s)}</b> −${fmt(z.v)}건`:''}<br>장기 적체 해소 진행 중 — 60일+ 동결건 분리 완료 후 30일 구간 가속 권고`});})();
  // 15. 전월대비 처리량 급증
  (()=>{if(pRes<=0)return;const r=(tRes-pRes)/pRes;if(r<0.15)return;const z=zTop(all.filter(x=>x.st.prev.res>0).map(x=>({s:x.s,v:(x.st.res-x.st.prev.res)/x.st.prev.res})));
    const score=0.4*Math.min(r/0.4,1)+0.2;
    cand.push({score,cls:'ok',icon:ICON.up,ttl:'전월대비 처리량 급증',
      sub:`처리 완료 <b style="color:${C.gn}">${fmt(tRes)}건</b> (전월대비 <b style="color:${C.gn}">+${(r*100).toFixed(0)}%</b>, ${sgn(deltaR)})${z?` · 선도 <b>${sn(z.s)}</b>`:''}<br>처리 동력 강화 확인 — 협력사 가동률·인력 현수준 유지, 미처리 감축 목표 추가 설정`});})();

  // 항상 노출되는 기본 카드(종합 처리 성과) — 후보 부족 시 보충용
  const byImpAll=all.filter(x=>x.st.prev.total>0).map(x=>({s:x.s,imp:x.st.rate-x.st.prev.rate}));
  const mostUp=byImpAll.slice().sort((a,b)=>b.imp-a.imp)[0],mostDn=byImpAll.slice().sort((a,b)=>a.imp-b.imp)[0];
  cand.push({score:0.05,cls:rate>=75?'ok':rate>=60?'warn':'bad',icon:ICON.up,ttl:'종합 처리 성과',
    sub:`처리율 <b>${rate.toFixed(1)}%</b> (전월대비 <b style="color:${delta>=0?C.gn:C.rd}">${delta>=0?'+':''}${delta.toFixed(1)}%p</b>) · 미처리 <b>${fmt(tU)}건</b> (전월대비 <b style="color:${deltaU<=0?C.gn:C.rd}">${sgn(deltaU)}</b>)<br>${mostUp&&mostUp.imp>0.5?`괄목 <b>${sn(mostUp.s)}</b> <b style="color:${C.gn}">+${mostUp.imp.toFixed(1)}%p</b>`:'전월 대비 큰 개선 현장 없음'}${mostDn&&mostDn.imp<-0.5?` · 문제 <b>${sn(mostDn.s)}</b> <b style="color:${C.rd}">${mostDn.imp.toFixed(1)}%p</b> 하락`:` · 전반 ${delta>=0?'개선 유지':'하락 — 본부 일정 협의'}`}`});

  // 상위 3개 선정 — 경고/불량만 뽑지 않도록 ok 후보도 반드시 1개 이상 확보
  // 1) 점수 내림차순 정렬, 중복 제목 제거
  const seen=new Set(),allItems=[];
  cand.sort((a,b)=>b.score-a.score);
  for(const c of cand){if(seen.has(c.ttl))continue;seen.add(c.ttl);allItems.push(c);}
  // 2) bad/warn 후보와 ok 후보 분리
  const badItems=allItems.filter(x=>x.cls==='bad'||x.cls==='warn');
  const okItems=allItems.filter(x=>x.cls==='ok');
  // 3) 3개 슬롯 구성: ok 후보가 있으면 최소 1개 ok 보장. bad/warn 가득 차면 최하위 1개를 ok로 교체.
  const items=[];
  if(badItems.length>=3&&okItems.length>0){
    // bad/warn 상위 2 + ok 상위 1
    items.push(badItems[0],badItems[1],okItems[0]);
  }else{
    // 그냥 점수순 상위 3
    for(const c of allItems){items.push(c);if(items.length===3)break;}
  }
  el.innerHTML=themeHTML(safeHTML(items.map(x=>`<div class="ic ${x.cls}"><div class="ic-i">${icoSVG(x.icon)}</div><div class="ic-t"><div class="ic-ttl">${x.ttl}</div><div class="ic-sub">${x.sub}</div></div></div>`).join('')));
  insBindCards(); // 살균으로 제거된 토글 속성을 DOM에서 부착
  // AI 재작성 입력용으로 선정 결과 보관 (수치·맥락은 규칙기반 결과를 그대로 사용)
  S._dashIns=items.map(x=>({cls:x.cls,icon:x.icon,ttl:x.ttl,sub:x.sub}));
}
function dC(k){if(S.charts[k]){S.charts[k].$destroyed=true;S.charts[k].destroy();delete S.charts[k];}}
// ── 게시·스냅샷용 순수 집계 (P3: __CAPTURE 렌더 부수효과 의존 제거) ──
// capWks: 주차별 누계 스냅샷 — rChartsImpl/buildSiteTrend의 차트 데이터 계산과 동일 수식(BIT-EXACT).
//   입력 defs는 receiptDate 형식(YYYY-MM-DD) 필터가 이미 적용된 배열을 기대(차트 코드와 동일 입력).
function capWks(defs,rm,year){
  const _ty=Number(year);
  const ymPart=rm.split('-').map(Number),lastDay=new Date(ymPart[0],ymPart[1],0).getDate();
  const refLimTS=Math.min(Date.UTC(ymPart[0],ymPart[1]-1,lastDay),Date.UTC(_ty,11,31));
  const _rl=new Date(refLimTS),refLimStr=`${_rl.getUTCFullYear()}-${String(_rl.getUTCMonth()+1).padStart(2,'0')}-${String(_rl.getUTCDate()).padStart(2,'0')}`;
  const startTS=Date.UTC(_ty,0,1),firstSunOff=(7-new Date(startTS).getUTCDay())%7;
  const wks=[];let sunTS=startTS+firstSunOff*86400000,prevCutoff=`${_ty}-01-01`;
  while(prevCutoff<refLimStr){
    const isPartial=sunTS>refLimTS;
    const cutTS=isPartial?refLimTS:sunTS;
    const cutD=new Date(cutTS),cutoff=`${cutD.getUTCFullYear()}-${String(cutD.getUTCMonth()+1).padStart(2,'0')}-${String(cutD.getUTCDate()).padStart(2,'0')}`;
    const m=cutD.getUTCMonth()+1;
    let weekNum;
    if(wks.length>0&&wks[wks.length-1].m===m)weekNum=wks[wks.length-1].w+1;
    else weekNum=1;
    let cR=0,cRes=0,curU=0,curLt=0,curLt60=0;
    for(const it of defs){if(it.receiptDate>cutoff)continue;cR++;const done=it.status==='처리'&&it.completionDate&&it.completionDate<=cutoff;if(done)cRes++;else{curU++;const _dd=Math.max(0,Math.round((new Date(cutoff)-new Date(it.receiptDate))/86400000));if(_dd>=60){curLt++;curLt60++;}else if(_dd>=30)curLt++;}}
    wks.push({m,w:weekNum,cumR:cR,cumRes:cRes,u:curU,lt:curLt,lt60:curLt60});
    if(isPartial)break;
    sunTS+=7*86400000;prevCutoff=cutoff;
  }
  return wks;
}
// capAm: 기준월말 시점 미처리 공종 분포 — rChartsImpl/buildSiteTradeDonut의 도넛 데이터와 동일 수식.
function capAm(defs,rm){
  const _rmP=rm.split('-').map(Number),_rmEnd=`${rm}-${String(new Date(_rmP[0],_rmP[1],0).getDate()).padStart(2,'0')}`;
  const am={};(defs||[]).filter(i=>i.receiptDate&&i.receiptDate<=_rmEnd&&!(i.status==='처리'&&i.completionDate&&i.completionDate<=_rmEnd)).forEach(i=>{am[i.trade||'기타']=(am[i.trade||'기타']||0)+1;});
  return am;
}
// capAll: 게시/스냅샷 전체 캡처 — 연도 선택 규칙(trendYearInfo)까지 차트 렌더와 동일하게 적용.
//   렌더·setTimeout 없이 순수 산출 → 느린 기기/백그라운드 탭에서의 캡처 누락 클래스 제거.
function capAll(){
  const allDefRaw=dashSites().flatMap(s=>S.def[s.id]||[]);
  const allDef=allDefRaw.filter(i=>i.receiptDate&&/^\d{4}-\d{2}-\d{2}/.test(i.receiptDate));
  const cap={wks:capWks(allDef,S.rm,trendYearInfo(allDef,'trendYear').year),am:capAm(allDefRaw,S.rm),siteWks:{},siteAm:{}};
  for(const s of teamSites()){ // 현장별 캡처는 인수 전 현장 포함 — 대시보드 합산(wks/am)만 dashSites로 집계 제외
    const defs=S.def[s.id]||[];
    const sd=defs.filter(i=>i.receiptDate&&/^\d{4}-\d{2}-\d{2}/.test(i.receiptDate));
    cap.siteWks[s.id]=capWks(sd,S.rm,trendYearInfo(sd,'siteTrendYear').year);
    cap.siteAm[s.id]=capAm(defs,S.rm);
  }
  return cap;
}
function rCharts(all){
  // Globally disable datalabels by default (enabled per-dataset where needed)
  if(window.ChartDataLabels&&!Chart.__dlOff){Chart.register(ChartDataLabels);Chart.defaults.set('plugins.datalabels',{display:false});Chart.__dlOff=true;}
  // Center-text plugin for doughnut total
  if(!Chart.__ctReg){Chart.register({id:'centerText',afterDraw(chart,_,opts){if(!opts||!opts.display)return;const{ctx,chartArea:{left,right,top,bottom}}=chart;const cx=(left+right)/2,cy=(top+bottom)/2;ctx.save();ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle=opts.valueColor||cvar('--lbl','#1C1C1E');ctx.font=`700 ${opts.valueSize||16}px 'Pretendard Variable',Pretendard,sans-serif`;ctx.fillText(opts.value||'',cx,cy-2);ctx.fillStyle=opts.labelColor||cvar('--ch-axis','rgba(60,60,67,.58)');ctx.font=`600 ${opts.labelSize||11}px 'Pretendard Variable',Pretendard,sans-serif`;ctx.fillText(opts.label||'',cx,cy+14);ctx.restore();}});Chart.__ctReg=true;}
  // 모든 차트 통일 외부 툴팁 — ltrbar와 동일 룩 (항목 그레이 / 수치 볼드 흰색 / 간격 구분)
  if(!Chart.__exTip){
    const tipEl=document.getElementById('htooltip');
    const colOf=(it)=>{const ds=it.dataset,ct=it.chart?.config?.type,dt=ds.type||ct;const bg=Array.isArray(ds.backgroundColor)?ds.backgroundColor[it.dataIndex]:ds.backgroundColor;if(dt==='line'&&typeof ds.borderColor==='string')return ds.borderColor;return bg||'#999';};
    Chart.defaults.plugins.tooltip.enabled=false;
    Chart.defaults.plugins.tooltip.external=(ctx)=>{const tt=ctx.tooltip;if(!tipEl)return;if(tt.opacity===0){tipEl.classList.remove('show');tipEl.classList.remove('gl');return;}const items=tt.dataPoints||[];const ct=ctx.chart.config.type,isPie=ct==='doughnut'||ct==='pie';const html=items.map(it=>{const lbl=it.dataset.label||it.label||'';const raw=typeof it.parsed==='object'?(it.parsed.y??it.parsed.x??it.raw):it.parsed;const num=typeof raw==='number'?raw:Number(raw)||0;let valTxt=num.toLocaleString()+'건';if(isPie){const tot=(it.dataset.data||[]).reduce((a,b)=>a+(Number(b)||0),0);if(tot>0)valTxt+=` (${(num/tot*100).toFixed(1)}%)`;}return `<div class="trow"><span class="tmark" style="background:${colOf(it)}"></span><span class="tlabel">${esc(lbl)}</span><span class="tval">${valTxt}</span></div>`;}).join('');tipEl.innerHTML=html;const canvas=ctx.chart.canvas,r=canvas.getBoundingClientRect();const wasShown=tipEl.classList.contains('show');tipEl.classList.remove('sb-mode');tipEl.style.left=(r.left+tt.caretX)+'px';tipEl.style.top=(r.top+tt.caretY)+'px';if(wasShown){tipEl.classList.add('gl');}else{tipEl.classList.remove('gl');requestAnimationFrame(()=>{if(tipEl.classList.contains('show'))tipEl.classList.add('gl');});}tipEl.classList.add('show');};
    Chart.__exTip=true;
  }
  // Defer chart creation one frame so flex layout settles canvas dimensions — otherwise Chart.js initial render at 0px skips animation
  requestAnimationFrame(()=>rChartsImpl(all));
}
// y축 눈금을 깔끔한 숫자로 반올림. dir=1→올림, dir=-1→내림.
// 선형(라인) 데이터의 최저~최고값에 우측 축을 바짝 맞춰 변화를 극대화.
// 데이터 범위(span)에 비례한 작은 여백만 주고, 보기 좋은 눈금 간격으로 경계만 정렬.
function niceFitRange(lo,hi){
  const span=Math.max(hi-lo,1);
  const pad=Math.max(span*0.12,1);
  let rawMin=lo-pad,rawMax=hi+pad;
  // 보기 좋은 눈금 간격(약 5칸 기준)
  const rough=(rawMax-rawMin)/5;
  const mag=Math.pow(10,Math.floor(Math.log10(rough)));
  const steps=[1,2,2.5,5,10];let step=10*mag;
  for(const s of steps){if(s*mag>=rough){step=s*mag;break;}}
  let min=Math.floor(rawMin/step)*step;
  if(min<0)min=0;
  const max=Math.ceil(rawMax/step)*step;
  return{min,max};
}
function rChartsImpl(all){
  dC('mo');
  // 메인 차트: 선택연도 1/1부터 (기준월 말일·선택연도 말일 중 이른 시점)까지, 각 주 일요일 기준 누계 스냅샷
  // 막대 = 그 주 시점의 미처리 누계 (현재 누적 접수 - 누적 처리)
  // 선   = 그 주 시점의 누계 전체접수 / 누계 처리완료
  const allDefRaw=dashSites().flatMap(s=>S.def[s.id]||[]);
  const allDef=allDefRaw.filter(i=>i.receiptDate&&/^\d{4}-\d{2}-\d{2}/.test(i.receiptDate));
  const _tyInfo=trendYearInfo(allDef,'trendYear'),_ty=Number(_tyInfo.year);
  {const _sel=document.getElementById('dtrend-yr');if(_sel)_sel.innerHTML=trendYrOptions(_tyInfo);}
  const wks=capWks(allDef,S.rm,_ty); // 순수 집계 공유 — 게시/스냅샷(capAll)과 동일 산출 보장
  if(window.__SNAP__&&window.__SNAP__.wks)for(let _i=0;_i<wks.length;_i++){if(window.__SNAP__.wks[_i])wks[_i]=window.__SNAP__.wks[_i];}
  const cumR=wks.map(x=>x.cumR),cumRes=wks.map(x=>x.cumRes);
  // y1(누계 접수·처리 라인) 동적 범위 — 데이터 최저~최고에 바짝 맞춰 변화를 극대화
  const _y1vals=[...cumR,...cumRes].filter(v=>v>0);
  let _y1min=0,_y1max;
  if(_y1vals.length){
    const lo=Math.min(..._y1vals),hi=Math.max(..._y1vals);
    const r=niceFitRange(lo,hi);_y1min=r.min;_y1max=r.max;
  }
  // 모션 구성:
  //  - 막대/선 모두 dataset-level animations로 baseline에서 위로 grow
  //  - 막대: easeOutQuart, 선: easeOutCubic (같은 duration, 다른 곡선)
  //  - 라벨: 차트 완성 후 opacity 0→1 raf 페이드인 (350ms smoothstep)
  const MO_DUR=520;
  const _baseY=(ctx)=>{if(ctx.type!=='data')return;const ds=ctx.chart.data.datasets[ctx.datasetIndex];const sc=ctx.chart.scales[ds?.yAxisID||'y'];if(!sc)return 0;const base=(sc.min!=null)?sc.min:0;return sc.getPixelForValue(base);};
  const _barAnim={y:{duration:MO_DUR,easing:'easeOutQuart',from:_baseY},base:{duration:MO_DUR,easing:'easeOutQuart',from:_baseY}};
  const _lineAnim={y:{duration:MO_DUR,easing:'easeOutCubic',from:_baseY}};
  const _op=(ctx)=>ctx.chart.$la??0,_opIn=(ctx)=>(ctx.chart.$la??0)*0.55;
  const moDs=[
    {type:'bar',label:'60일 이상',data:wks.map(x=>x.lt60||0),backgroundColor:cvar('--ch-d60','#DA6A60'),hoverBackgroundColor:cvar('--ch-d60h','#C65A50'),pointStyle:'rectRounded',stack:'u',borderRadius:0,borderSkipped:false,yAxisID:'y',order:3,animations:_barAnim,datalabels:{display:ctx=>window.innerWidth>768&&moDLCfg(ctx).showInner&&ctx.dataset.data[ctx.dataIndex]>0,opacity:_opIn,anchor:'center',align:'center',color:'#fff',font:ctx=>({size:moDLCfg(ctx).size,weight:600}),formatter:v=>v.toLocaleString()}},
    {type:'bar',label:'30~59일',data:wks.map(x=>x.lt-(x.lt60||0)),backgroundColor:cvar('--ch-d30','#E89C9A'),hoverBackgroundColor:cvar('--ch-d30h','#C76F6D'),pointStyle:'rectRounded',stack:'u',borderRadius:0,borderSkipped:false,yAxisID:'y',order:3,animations:_barAnim,datalabels:{display:ctx=>window.innerWidth>768&&moDLCfg(ctx).showInner&&ctx.dataset.data[ctx.dataIndex]>0,opacity:_opIn,anchor:'center',align:'center',color:cvar('--ch-lbl2','#7A3434'),font:ctx=>({size:moDLCfg(ctx).size,weight:600}),formatter:v=>v.toLocaleString()}},
    {type:'bar',label:'30일 미만',data:wks.map(x=>x.u-x.lt),backgroundColor:cvar('--ch-d0','#B3C7DD'),hoverBackgroundColor:cvar('--ch-d0h','#7E9BBC'),pointStyle:'rectRounded',stack:'u',borderRadius:0,borderSkipped:false,yAxisID:'y',order:3,animations:_barAnim,datalabels:{labels:{value:{display:ctx=>window.innerWidth>768&&moDLCfg(ctx).showInner&&ctx.dataset.data[ctx.dataIndex]>0,opacity:_opIn,anchor:'center',align:'center',color:cvar('--ch-lbl','#1F2B4C'),font:ctx=>({size:moDLCfg(ctx).size,weight:600}),formatter:v=>v.toLocaleString()},total:{display:ctx=>{if(window.innerWidth<=768)return false;const t=wks[ctx.dataIndex]?.u||0;if(t<=0)return false;const c=moDLCfg(ctx),n=ctx.chart.data.labels.length;return c.totalEvery===1||ctx.dataIndex%c.totalEvery===0||ctx.dataIndex===n-1;},opacity:_op,anchor:'end',align:'end',offset:2,clip:false,color:dlInk(),font:ctx=>({size:moDLCfg(ctx).size,weight:700}),textStrokeColor:dlStroke(),textStrokeWidth:4,formatter:(v,ctx)=>{const t=wks[ctx.dataIndex].u;return t>0?t.toLocaleString():'';}}}}},
    {type:'line',label:'전체 접수',data:cumR,borderColor:cvar('--ch-recv','#3E71D2'),backgroundColor:cvar('--bg2','#fff'),pointBackgroundColor:cvar('--bg2','#fff'),pointBorderColor:cvar('--ch-recv','#3E71D2'),pointBorderWidth:2,tension:.4,pointRadius:4,pointHoverRadius:8,pointHoverBorderWidth:3,pointHoverBackgroundColor:cvar('--ch-recv','#3E71D2'),pointHoverBorderColor:'#fff',hoverBorderWidth:3.5,borderWidth:2.5,fill:false,yAxisID:'y1',order:1,animations:_lineAnim,datalabels:{display:ctx=>window.innerWidth>768&&(ctx.dataIndex===0||ctx.dataIndex===ctx.dataset.data.length-1),opacity:_op,anchor:'center',align:ctx=>ctx.dataIndex===0?'right':'left',offset:8,clip:false,color:dlBlue(),font:{size:11,weight:700},textStrokeColor:dlStroke(),textStrokeWidth:4,textShadowColor:'rgba(0,0,0,.2)',textShadowBlur:3,formatter:v=>v.toLocaleString()}},
    {type:'line',label:'처리 완료',data:cumRes,borderColor:cvar('--ch-done','#F0B144'),backgroundColor:cvar('--bg2','#fff'),pointBackgroundColor:cvar('--bg2','#fff'),pointBorderColor:cvar('--ch-done','#F0B144'),pointBorderWidth:2,tension:.4,pointRadius:4,pointHoverRadius:8,pointHoverBorderWidth:3,pointHoverBackgroundColor:cvar('--ch-done','#F0B144'),pointHoverBorderColor:'#fff',hoverBorderWidth:3.5,borderWidth:2.5,fill:false,yAxisID:'y1',order:0,animations:_lineAnim,datalabels:{display:ctx=>window.innerWidth>768&&(ctx.dataIndex===0||ctx.dataIndex===ctx.dataset.data.length-1),opacity:_op,anchor:'center',align:ctx=>ctx.dataIndex===0?'right':'left',offset:8,clip:false,color:dlAmber(),font:{size:11,weight:700},textStrokeColor:dlStroke(),textStrokeWidth:4,textShadowColor:'rgba(0,0,0,.2)',textShadowBlur:3,formatter:v=>v.toLocaleString()}}
  ];
  const _atSize=(typeof window!=='undefined'&&window.innerWidth<=768)?10:13;const _tkSize=(typeof window!=='undefined'&&window.innerWidth<=768)?9:12;
  S.charts['mo']=new Chart(document.getElementById('c-mo'),{data:{labels:wks.map(x=>`${x.m}월\n${x.w}주`),datasets:moDs},options:{responsive:true,maintainAspectRatio:false,animation:{duration:MO_DUR,easing:'easeOutQuart',onComplete(ac){if(!ac.initial||ac.chart.$dlShown)return;ac.chart.$dlShown=true;const ch=ac.chart,t0=performance.now(),fd=350;const tick=()=>{if(!ch||ch.$destroyed||!ch.ctx)return;try{const p=Math.min(1,(performance.now()-t0)/fd);ch.$la=p*p*(3-2*p);ch.update('none');if(p<1)requestAnimationFrame(tick);}catch(e){console.warn('label fade tick aborted',e);}};requestAnimationFrame(tick);}},plugins:{legend:{display:false},tooltip:{mode:'index',intersect:false,position:'aboveAll',yAlign:'top',caretPadding:6,padding:12,usePointStyle:true,boxWidth:10,boxHeight:10,boxPadding:6,callbacks:{label:ctx=>`${ctx.dataset.label}: ${(ctx.parsed.y??ctx.parsed??0).toLocaleString()}건`}}},scales:{x:{grid:{display:false},ticks:{font:{size:10},color:chartInk(),callback:function(v){return this.getLabelForValue(v).split('\n');}}},y:{beginAtZero:true,position:'left',grace:'25%',grid:{color:chartGrid()},ticks:{font:{size:_tkSize}},title:{display:true,text:'미처리(건)',font:{size:_atSize,weight:600},color:chartAxisTitle()}},y1:{beginAtZero:false,min:_y1min,max:_y1max,position:'right',grid:{display:false},ticks:{font:{size:_tkSize}},title:{display:true,text:'접수·처리(건)',font:{size:_atSize,weight:600},color:chartAxisTitle()}}}}});
  // Custom HTML legend for c-mo
  const lgMo=document.getElementById('c-mo-lg');if(lgMo)lgMo.innerHTML=[
    {label:'60일 이상',type:'bar',cls:'ck-d60'},
    {label:'30~59일',type:'bar',cls:'ck-d30'},
    {label:'30일 미만',type:'bar',cls:'ck-d0'},
    {label:'전체 접수',type:'line',cls:'ck-recv'},
    {label:'처리 완료',type:'line',cls:'ck-done'}
  ].map(d=>`<div class="li"><span class="${d.type==='bar'?'mk-bar':'mk-ln'} ${d.cls}"></span>${d.label}</div>`).join('');
  // 1) MoM performance panel — 4 metrics comparing prev/curr month
  const mPT=all.reduce((a,x)=>a+x.st.prev.total,0),mPRes=all.reduce((a,x)=>a+x.st.prev.res,0),mPU=all.reduce((a,x)=>a+x.st.prev.unr,0),mPL=all.reduce((a,x)=>a+x.st.prev.lt,0);
  const mCT=all.reduce((a,x)=>a+x.st.tR,0),mCRes=all.reduce((a,x)=>a+x.st.res,0),mCU=all.reduce((a,x)=>a+x.st.unr,0),mCL=all.reduce((a,x)=>a+x.st.lt,0);
  const momMetrics=[
    {label:'전체 접수',prev:mPT,curr:mCT,goodUp:false,grp:'in'},
    {label:'처리 완료',prev:mPRes,curr:mCRes,goodUp:true,grp:'in'},
    {label:'미처리',prev:mPU,curr:mCU,goodUp:false,grp:'un'},
    {label:'장기미처리',prev:mPL,curr:mCL,goodUp:false,grp:'un'}
  ];
  // 그룹별 max로 정규화: 접수·처리는 큰 스케일, 미처리·장기미처리는 작은 스케일을 각각 꽉 채워 비교가 잘 보이도록
  const momMaxIn=Math.max(...momMetrics.filter(m=>m.grp==='in').flatMap(m=>[m.prev,m.curr]),1);
  const momMaxUn=Math.max(...momMetrics.filter(m=>m.grp==='un').flatMap(m=>[m.prev,m.curr]),1);
  // 변화가 잘 보이도록: min을 끌어올려 바 기준선 조정
  const momMinIn=(()=>{const vs=momMetrics.filter(m=>m.grp==='in').flatMap(m=>[m.prev,m.curr]).filter(v=>v>0);if(!vs.length)return 0;const lo=Math.min(...vs),hi=Math.max(...vs),span=hi-lo;return span<hi*0.12?Math.max(0,Math.floor(lo-span*2)):0;})();
  const momEl=document.getElementById('c-mom');if(momEl){momEl.innerHTML=momMetrics.map(m=>{const mx=m.grp==='in'?momMaxIn:momMaxUn,mn=m.grp==='in'?momMinIn:0;const eff=Math.max(mx-mn,1);const diff=m.curr-m.prev,pct=m.prev>0?(diff/m.prev*100):0,isUp=diff>0,isEq=diff===0,arrow=isEq?'—':isUp?'▲':'▼',good=isEq?'eq':(m.goodUp===isUp?'up':'dn'),pctTxt=isEq?'변동 없음':(m.prev>0?(diff>0?'+':'')+pct.toFixed(1)+'%':'—');return`<div class="mom-row"><div class="label">${m.label}</div><div class="bars"><div class="bar prev"><span class="lb">전월</span><div class="tr"><div class="fl" data-w="${Math.max(0,(m.prev-mn)/eff*100)}"></div></div><span class="vl">${m.prev.toLocaleString()}</span></div><div class="bar curr"><span class="lb">금월</span><div class="tr"><div class="fl" data-w="${Math.max(0,(m.curr-mn)/eff*100)}"></div></div><span class="vl">${m.curr.toLocaleString()}</span></div></div><div class="delta"><span class="d ${good}">${arrow} ${pctTxt}</span></div></div>`;}).join('');requestAnimationFrame(()=>{momEl.querySelectorAll('.fl').forEach((fl,i)=>{setTimeout(()=>{fl.style.width=fl.dataset.w+'%';},60+i*40);});});}

  // 3) Top trades treemap (with fallback if library missing)
  dC('mx');const mxEl=document.getElementById('c-mx');if(mxEl){
    const am=capAm(allDefRaw,S.rm); // 순수 집계 공유
    if(window.__SNAP__&&window.__SNAP__.am)Object.assign(am,window.__SNAP__.am);
    const ownEtc=am['기타']||0;delete am['기타'];
    const sorted=Object.entries(am).sort((a,b)=>b[1]-a[1]),top11=sorted.slice(0,11),restEtc=sorted.slice(11).reduce((a,[,c])=>a+c,0),etcTotal=ownEtc+restEtc;
    const tmData=top11.map(([t,c])=>({t,c}));if(etcTotal>0)tmData.push({t:'기타',c:etcTotal});
    const tot=tmData.reduce((a,x)=>a+x.c,0);
    const tmColors=donutPalette();
    S.charts['mx']=new Chart(mxEl,{type:'doughnut',data:{labels:tmData.map(d=>d.t),datasets:[{data:tmData.map(d=>d.c),backgroundColor:tmColors,borderWidth:3,borderColor:chartSegBorder(),pointStyle:'circle',hoverOffset:12,hoverBorderWidth:3}]},options:{responsive:true,maintainAspectRatio:false,layout:{padding:14},cutout:'58%',plugins:{centerText:{display:true,value:tot.toLocaleString()+'건',label:'미처리'},legend:{display:false},tooltip:{caretPadding:32,padding:12,usePointStyle:true,boxWidth:10,boxHeight:10,boxPadding:6,callbacks:{labelPointStyle:()=>({pointStyle:'circle',rotation:0}),label:ctx=>`${ctx.label}: ${ctx.parsed.toLocaleString()}건 (${tot>0?(ctx.parsed/tot*100).toFixed(1):0}%)`}},datalabels:{display:false}}}});
    const mxLg=document.getElementById('c-mx-lg');if(mxLg){mxLg.innerHTML=tmData.map((d,i)=>`<div class="it" data-idx="${i}"><span class="l"><span class="dt" style="background:${tmColors[i%tmColors.length]}"></span><span class="nm">${esc(d.t)}</span></span><span class="cnt">${d.c.toLocaleString()}건</span><span class="pct">${tot>0?(d.c/tot*100).toFixed(1):0}%</span></div>`).join('');mxLg.querySelectorAll('.it').forEach(el=>{el.addEventListener('mouseenter',()=>{const ch=S.charts['mx'];if(!ch)return;const idx=Number(el.dataset.idx);ch.setActiveElements([{datasetIndex:0,index:idx}]);ch.tooltip?.setActiveElements([{datasetIndex:0,index:idx}],{x:0,y:0});ch.update();});el.addEventListener('mouseleave',()=>{const ch=S.charts['mx'];if(!ch)return;ch.setActiveElements([]);ch.tooltip?.setActiveElements([],{x:0,y:0});ch.update();});});}
  }
  // 4) 현장별 미처리 분포 도넛 — 미처리 건수 기준 12현장 분포
  dC('sx');const sxEl=document.getElementById('c-sx');if(sxEl){
    const sxData=all.filter(x=>x.st.unr>0).map(x=>({t:shortName(x.s.name),full:x.s.name,c:x.st.unr})).sort((a,b)=>b.c-a.c);
    const sxTot=sxData.reduce((a,x)=>a+x.c,0);
    const sxColors=donutPalette();
    S.charts['sx']=new Chart(sxEl,{type:'doughnut',data:{labels:sxData.map(d=>d.t),datasets:[{data:sxData.map(d=>d.c),backgroundColor:sxColors,borderWidth:3,borderColor:chartSegBorder(),pointStyle:'circle',hoverOffset:12,hoverBorderWidth:3}]},options:{responsive:true,maintainAspectRatio:false,layout:{padding:14},cutout:'58%',plugins:{centerText:{display:true,value:sxTot.toLocaleString()+'건',label:'미처리'},legend:{display:false},tooltip:{caretPadding:32,padding:12,usePointStyle:true,boxWidth:10,boxHeight:10,boxPadding:6,callbacks:{labelPointStyle:()=>({pointStyle:'circle',rotation:0}),label:ctx=>`${ctx.label}: ${ctx.parsed.toLocaleString()}건 (${sxTot>0?(ctx.parsed/sxTot*100).toFixed(1):0}%)`}},datalabels:{display:false}}}});
    const sxLg=document.getElementById('c-sx-lg');if(sxLg){sxLg.innerHTML=sxData.map((d,i)=>`<div class="it" data-idx="${i}" data-tt="${esc(d.full)}" aria-label="${esc(d.full)}"><span class="l"><span class="dt" style="background:${sxColors[i%sxColors.length]}"></span><span class="nm">${esc(d.t)}</span></span><span class="cnt">${d.c.toLocaleString()}건</span><span class="pct">${sxTot>0?(d.c/sxTot*100).toFixed(1):0}%</span></div>`).join('');sxLg.querySelectorAll('.it').forEach(el=>{el.addEventListener('mouseenter',()=>{const ch=S.charts['sx'];if(!ch)return;const idx=Number(el.dataset.idx);ch.setActiveElements([{datasetIndex:0,index:idx}]);ch.tooltip?.setActiveElements([{datasetIndex:0,index:idx}],{x:0,y:0});ch.update();});el.addEventListener('mouseleave',()=>{const ch=S.charts['sx'];if(!ch)return;ch.setActiveElements([]);ch.tooltip?.setActiveElements([],{x:0,y:0});ch.update();});});}
  }
}
// 현장명 줄임말 — 범례 가독성. "힐스테이트"를 (앞/뒤 위치 무관) 제거한 뒤 앞 2글자만 사용.
// 예: "힐스테이트 두정역"→"두정", "갑천1 트리풀시티 힐스테이트"→"갑천"
function shortName(name){if(!name)return'-';const stripped=String(name).replace(/힐스테이트/g,'').trim();const core=stripped||String(name).trim();return core.slice(0,2)||name;}

// SITE PANEL
// 공가 미처리 상위 공종 표 (세대/상가 공용)
function vacRowsHTML(sid,stat,cm,planField){
  const unr=stat.Unr,topPrev=stat.TopPrev||{};
  const _vk=planField==='commercialProcessingPlan'?'store':'unit'; // 목록 진입 시 공가 칩 사전 선택용
  const rowFn=(t,i)=>{
    const plan=cm[planField]?.[S.rm+'@'+t.t]||'';
    const ratio=unr>0?(t.c/unr*100).toFixed(1):'0.0';
    const pc=topPrev[t.t]||0,dN=t.c-pc;
    const dArrow=dN===0?'─':dN>0?'▲':'▼',dBadge=dN===0?'bgr':dN>0?'brd':'bgn';
    const dTxt=dN===0?'0':`${dN>0?'+':'−'}${Math.abs(dN).toLocaleString()}`;
    const coCell=esc(t.co||'-');
    return`<tr><td class="cc"><b>${i+1}</b></td><td class="rl-link" data-act="rec.list" data-sid="${esc(sid)}" data-scope="ul" data-trade="${esc(t.t)}" data-vac="${_vk}"><b>${esc(t.t)}</b></td><td>${coCell}</td><td class="n">${pc.toLocaleString()}</td><td class="n" style="color:var(--bt1);font-weight:700">${t.c.toLocaleString()}</td><td class="cc" style="white-space:nowrap"><span class="ba ${dBadge}" data-tt="전월 ${pc.toLocaleString()} → 금월 ${t.c.toLocaleString()}" aria-label="전월 ${pc.toLocaleString()} → 금월 ${t.c.toLocaleString()}">${dArrow} ${dTxt}</span></td><td class="cc" style="font-weight:600">${ratio}%</td><td style="padding-left:20px"><textarea class="inp plan-ta" maxlength="5000" aria-label="처리계획" name="plan-${sid}-${planField}-${esc(t.t)}" data-plan-id="cmt|${sid}|${planField}|${esc(S.rm+'@'+t.t)}" style="padding:5px 9px;font-size:11.5px;min-height:32px;resize:none;font-family:inherit;width:100%;overflow:hidden" placeholder="" data-act="panel.plan">${esc(plan)}</textarea></td></tr>`;
  };
  const etcFn=(etc)=>{
    if(!etc)return'';
    const pc=(etc.keys||[]).reduce((a,k)=>a+(topPrev[k]||0),0),dN=etc.c-pc;
    const dArrow=dN===0?'─':dN>0?'▲':'▼',dBadge=dN===0?'bgr':dN>0?'brd':'bgn';
    const dTxt=dN===0?'0':`${dN>0?'+':'−'}${Math.abs(dN).toLocaleString()}`;
    const ratio=unr>0?(etc.c/unr*100).toFixed(1):'0.0';
    const coCell=etc.coN>0?`외 ${etc.coN.toLocaleString()}개 업체`:'-';
    const planE=cm[planField]?.[S.rm+'@기타']||'';
    return`<tr data-fixed="1"><td class="cc"></td><td><b>기타</b></td><td>${coCell}</td><td class="n">${pc.toLocaleString()}</td><td class="n" style="color:var(--bt1);font-weight:700">${etc.c.toLocaleString()}</td><td class="cc" style="white-space:nowrap"><span class="ba ${dBadge}" data-tt="전월 ${pc.toLocaleString()} → 금월 ${etc.c.toLocaleString()}" aria-label="전월 ${pc.toLocaleString()} → 금월 ${etc.c.toLocaleString()}">${dArrow} ${dTxt}</span></td><td class="cc" style="font-weight:600">${ratio}%</td><td style="padding-left:20px"><textarea class="inp plan-ta" maxlength="5000" aria-label="처리계획" name="plan-${sid}-${planField}-기타" data-plan-id="cmt|${sid}|${planField}|${esc(S.rm+'@기타')}" style="padding:5px 9px;font-size:11.5px;min-height:32px;resize:none;font-family:inherit;width:100%;overflow:hidden" placeholder="" data-act="panel.plan">${esc(planE)}</textarea></td></tr>`;
  };
  const totFn=(tot,prevTot)=>{
    if(!tot)return'';
    const dN=tot.c-prevTot,dArrow=dN===0?'─':dN>0?'▲':'▼',dBadge=dN===0?'bgr':dN>0?'brd':'bgn';
    const dTxt=dN===0?'0':`${dN>0?'+':'−'}${Math.abs(dN).toLocaleString()}`;
    return`<tr class="tot"><td class="cc"></td><td><b>합계</b></td><td></td><td class="n"><b>${prevTot.toLocaleString()}</b></td><td class="n" style="color:var(--bt1)"><b>${tot.c.toLocaleString()}</b></td><td class="cc" style="white-space:nowrap"><span class="ba ${dBadge}" data-tt="전월 ${prevTot.toLocaleString()} → 금월 ${tot.c.toLocaleString()}" aria-label="전월 ${prevTot.toLocaleString()} → 금월 ${tot.c.toLocaleString()}">${dArrow} ${dTxt}</span></td><td class="cc"><b>100.0%</b></td><td style="padding-left:20px"><div style="min-height:32px"></div></td></tr>`;
  };
  const base=(stat.Top||[]).filter(t=>!t.isT&&!t.isO);
  const etc=(stat.Top||[]).find(t=>t.isO),tot=(stat.Top||[]).find(t=>t.isT);
  const prevTot=Object.values(topPrev).reduce((a,b)=>a+b,0);
  return(base.map((t,i)=>rowFn(t,i)).join('')+etcFn(etc)+totFn(tot,prevTot))
    ||'<tr><td colspan="8" style="text-align:center;padding:14px;color:var(--lbl3)">미처리 없음</td></tr>';
}
// 공가 탭 패널 내용 (kind: 'sedae' | 'sangga')
function vacPaneHTML(sid,site,cm,stat,kind){
  const sangga=kind==='sangga';
  const vl=sangga?'공가상가':'공가세대';
  const statusField=sangga?'commercialStatus':'vacantStatus';
  const planField=sangga?'commercialProcessingPlan':'vacantProcessingPlan';
  const _u=sangga?'호실':'세대';
  const sv=cm[statusField]||{};
  const _mbN=parseInt(sv['미분양'],10),_mkN=parseInt(sv['미키불출'],10);
  const _mb=isNaN(_mbN)?0:_mbN,_mk=isNaN(_mkN)?0:_mkN,_vu=_mb+_mk;
  const _hasV=(sv['미분양']!=null&&sv['미분양']!=='')||(sv['미키불출']!=null&&sv['미키불출']!=='');
  const _vrate=stat.Rate.toFixed(1);
  const _perRecv=stat.Units>0?(stat.T/stat.Units).toFixed(1):'-';
  const _perUnr=stat.Units>0?(stat.Unr/stat.Units).toFixed(1):'-';
  const vRows=vacRowsHTML(sid,stat,cm,planField);
  return`<div class="as">
    <div class="card" data-print="vac-status"><div class="sh"><div class="st cardttl">${vl} 현황</div></div><div class="vrow">
        <div class="vseg vseg-edit" role="button" tabindex="0" data-act="vac.edit" data-sid="${esc(sid)}" data-vl="${esc(vl)}" data-sf="${esc(statusField)}">
          <div class="vseg-l">${vl}</div>
          <div class="vseg-v">${_hasV?_vu.toLocaleString():'<span class="vph">입력</span>'}<span class="vseg-u">${_u}</span></div>
          <div class="vseg-m">미분양 ${_mb.toLocaleString()}·<span class="vmk-f">미키불출</span><span class="vmk-a">미키</span> ${_mk.toLocaleString()}</div>
        </div>
        <div class="vseg"><div class="vseg-l">전체 접수</div><div class="vseg-v">${stat.T.toLocaleString()}<span class="vseg-u">건</span></div><div class="vseg-m">${_u}당 ${_perRecv}건</div></div>
        <div class="vseg"><div class="vseg-l">처리 완료</div><div class="vseg-v">${stat.Res.toLocaleString()}<span class="vseg-u">건</span></div><div class="vseg-m">처리율 ${_vrate}%</div></div>
        <div class="vseg"><div class="vseg-l">미처리</div><div class="vseg-v" style="color:var(--am)">${stat.Unr.toLocaleString()}<span class="vseg-u">건</span></div><div class="vseg-m">${_u}당 ${_perUnr}건</div></div>
        <div class="vseg"><div class="vseg-l">장기미처리</div><div class="vseg-v" style="color:var(--rd)">${stat.Lt.toLocaleString()}<span class="vseg-u">건</span></div><div class="vseg-m">미처리의 ${stat.Unr>0?(stat.Lt/stat.Unr*100).toFixed(1):'0.0'}%</div></div>
      </div></div>
    <div class="card" data-print="vac-top5"><div class="sh"><div class="st cardttl">${vl} 미처리 상위 5개 공종 처리 현황</div></div><table class="dt" style="table-layout:fixed" id="vtop-${kind}-${sid}"><thead><tr><th class="cc" style="width:6%">순위</th><th style="width:11%">공종</th><th style="width:11%">시공업체</th><th class="n" style="width:7%">전월</th><th class="n" style="width:7%">금월</th><th class="cc" style="width:7%;white-space:nowrap">전월대비</th><th class="cc" style="width:7%">비율</th><th style="width:44%">처리계획</th></tr></thead><tbody>${vRows}</tbody></table></div>
  </div>`;
}
function rSite(sid){
  const site=S.sites.find(s=>s.id===sid);if(!site)return;
  const allItems=S.def[sid]||[],filtered=allItems;
  const st=calc(filtered,site,S.rm),cm=S.cmt[sid]||{processingPlan:{},vacantProcessingPlan:{},teamLeaderComment:''},ai=anaGet(sid); // 기준월 아카이브 — 월 전환 시 해당 월 분석 표시
  const showSedae=site.showVacant!==false;         // 공가세대 탭
  const showSangga=!!site.hasCommercial;           // 공가상가 탭 (독립)
  if(S.tab==='vacant'&&!showSedae)S.tab='overview';
  if(S.tab==='commercial'&&!showSangga)S.tab='overview';
  S.lastSt=st;

  // 장기미처리 비율 현황 — 전월/금월 가로 누적 바 (탭 상단)
  const _curLtr=st.ltr,_prevLtr=st.prev.ltr,_dLtr=Number((_curLtr-_prevLtr).toFixed(1));
  const _dCls=_dLtr>0?'up':_dLtr<0?'dn':'eq',_dArrow=_dLtr>0?'▲':_dLtr<0?'▼':'─',_dSign=_dLtr>0?'+':_dLtr<0?'−':'';
  const _deltaBadge=`<span class="lm-delta ${_dCls}" data-tt="전월 ${_prevLtr.toFixed(1)}% → 금월 ${_curLtr.toFixed(1)}%" aria-label="전월 ${_prevLtr.toFixed(1)}% → 금월 ${_curLtr.toFixed(1)}%">${_dArrow} ${_dSign}${Math.abs(_dLtr).toFixed(1)}%</span>`;
  // 두 바 중 미처리 총계가 큰 쪽이 트랙을 꽉 채우고, 작은 쪽은 부족분이 회색으로 남도록 정규화
  const _maxUnr=Math.max(st.prev.unr||0,st.unr||0,1);
  const _ltrMomRow=(label,dd,unr,isCur)=>{
    const d0=dd[0]||0,d30=dd[1]||0,d60=dd[2]||0,tot=unr||0;
    const lt=d30+d60,ltr=tot>0?lt/tot*100:0;
    const fillW=tot/_maxUnr*100;
    const w=n=>tot>0?(n/tot*100):0;
    const seg=(cls,lbl,n)=>{const wd=w(n);if(wd<=0)return'';return`<div class="seg ${cls}" data-tip="${label}|${lbl}|${n}|${tot}" style="width:${wd}%"><span class="seg-v">${n.toLocaleString()}</span></div>`;};
    const segs=tot>0?(seg('s60','60일 이상',d60)+seg('s30','30~59일',d30)+seg('s0','30일 미만',d0)):'';
    const inner=`<div class="lm-fill" style="width:${fillW}%">${segs}</div>`;
    return`<div class="ltrmom-row${isCur?' cur':''}"><span class="lm-mo">${label}</span><span class="lm-stat">${lt.toLocaleString()}건 · ${ltr.toFixed(1)}%</span><div class="ltrmom-bar">${inner}</div></div>`;
  };
  const _legend=`<div class="ltrmom-lg"><div class="li"><span class="mk ck-d60"></span>60일 이상</div><div class="li"><span class="mk ck-d30"></span>30~59일</div><div class="li"><span class="mk ck-d0"></span>30일 미만</div></div>`;
  const ltrMomBar=`<div class="card ltrmom-card" data-print="tr-ltr"><div class="ltrmom-head"><span class="lm-ttl">장기미처리 비율 현황</span>${_legend}</div><div class="ltrmom-body"><div class="ltrmom-rows">${_ltrMomRow('전월',st.prev.dd,st.prev.unr,false)}${_ltrMomRow('금월',st.dd,st.unr,true)}</div><div class="ltrmom-delta">${_deltaBadge}</div></div></div>`;

  const units=site.units||0;
  const compDate=site.completionDate?` · ${site.completionDate}`:'';
  const _klSite=`<span class="kpi-screen">${esc(site.region||'-')}</span><span class="kpi-print">현장규모</span>`;
  const _kvSite=`<span class="kpi-screen">${esc(site.name||'-')}</span><span class="kpi-print">${units.toLocaleString()}<span class="u">세대</span></span>`;
  const _kmSite=`<span class="kpi-screen">${units.toLocaleString()}세대 · ${site.buildings||0}개동${compDate}</span><span class="kpi-print">${site.buildings||0}개동${site.completionDate?` · ${site.completionDate}`:''}</span>`;
  const kpis=[
    {cls:'bl kc-site',label:_klSite,valHTML:_kvSite,meta:_kmSite},
    {cls:'sk',label:'전체 접수',val:st.tR,unit:'건',meta:`세대당 ${units>0?(st.tR/units).toFixed(1):'0.0'}건`},
    {cls:'ms',label:'처리 완료',val:st.res,unit:'건',meta:`처리율 ${st.rate.toFixed(1)}%`},
    {cls:'wh',label:'미처리',val:st.unr,unit:'건',meta:`세대당 ${units>0?(st.unr/units).toFixed(1):'0.0'}건`,act:'ul',tt:'미처리 하자리스트 보기'},
    {cls:'wh',label:'장기미처리(30일+)',val:st.lt,unit:'건',meta:`미처리의 ${st.ltr.toFixed(1)}%`,act:'lul',tt:'장기미처리 하자리스트 보기'},
  ].map(k=>`<div class="kc ${k.cls}${k.act?' kc-click':''}"${k.act?` data-act="rec.list" data-sid="${esc(sid)}" data-scope="${k.act}"`:''}${k.tt?` data-tt="${esc(k.tt)}"`:''}><div class="kl">${k.label}</div><div class="kv">${k.valHTML!==undefined?k.valHTML:k.val.toLocaleString()+(k.unit?`<span class="u">${k.unit}</span>`:'')}</div><div class="km">${k.meta}</div>${k.act?`<span class="kc-cta"><span class="kc-cta-t">목록 보기</span> <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M9 6l6 6-6 6"/></svg></span>`:''}</div>`).join('');
  // 공종 TOP5 표 — 미처리를 전월/금월 분개 + 증감. 기타 행(6위~끝, 시공업체 외 N개) + 합계 행 추가.
  // colspan: 순위/공종/시공업체/전월/금월/증감/비율/처리계획 = 8열
  const trRowFn=(t,i,planMap,planKey)=>{
    const plan=planMap?.[S.rm+'@'+t.t]||'';
    const ratio=st.lt>0?(t.c/st.lt*100).toFixed(1):'0.0';
    const pc=st.topLtPrev?.[t.t]||0,dN=t.c-pc;
    const dArrow=dN===0?'─':dN>0?'▲':'▼',dBadge=dN===0?'bgr':dN>0?'brd':'bgn';
    const dTxt=dN===0?'0':`${dN>0?'+':'−'}${Math.abs(dN).toLocaleString()}`;
    const coCell=esc(t.co||'-');
    return`<tr><td class="cc"><b>${i+1}</b></td><td class="rl-link" data-act="rec.list" data-sid="${esc(sid)}" data-scope="lul" data-trade="${esc(t.t)}"><b>${esc(t.t)}</b></td><td>${coCell}</td><td class="n">${pc.toLocaleString()}</td><td class="n" style="color:var(--bt1);font-weight:700">${t.c.toLocaleString()}</td><td class="cc" style="white-space:nowrap"><span class="ba ${dBadge}" data-tt="전월 ${pc.toLocaleString()} → 금월 ${t.c.toLocaleString()}" aria-label="전월 ${pc.toLocaleString()} → 금월 ${t.c.toLocaleString()}">${dArrow} ${dTxt}</span></td><td class="cc" style="font-weight:600">${ratio}%</td><td style="padding-left:20px"><textarea class="inp plan-ta" maxlength="5000" aria-label="처리계획" name="plan-${sid}-${planKey}-${esc(t.t)}" data-plan-id="cmt|${sid}|${planKey==='pp'?'processingPlan':'vacantProcessingPlan'}|${esc(S.rm+'@'+t.t)}" style="padding:5px 9px;font-size:11.5px;min-height:32px;resize:none;font-family:inherit;width:100%;overflow:hidden" placeholder="" data-act="panel.plan">${esc(plan)}</textarea></td></tr>`;
  };
  // 기타 행 — 순위 없음, 시공업체는 외 N개 업체, 전월=기타 묶음 공종들의 전월 합
  const trEtcFn=(etc,prevMap)=>{
    if(!etc)return'';
    const pc=(etc.keys||[]).reduce((a,k)=>a+(prevMap?.[k]||0),0),dN=etc.c-pc;
    const dArrow=dN===0?'─':dN>0?'▲':'▼',dBadge=dN===0?'bgr':dN>0?'brd':'bgn';
    const dTxt=dN===0?'0':`${dN>0?'+':'−'}${Math.abs(dN).toLocaleString()}`;
    const ratio=st.lt>0?(etc.c/st.lt*100).toFixed(1):'0.0';
    const coCell=etc.coN>0?`외 ${etc.coN.toLocaleString()}개 업체`:'-';
    const planEtc=cm.processingPlan?.[S.rm+'@기타']||'';
    return`<tr data-fixed="1"><td class="cc"></td><td><b>기타</b></td><td>${coCell}</td><td class="n">${pc.toLocaleString()}</td><td class="n" style="color:var(--bt1);font-weight:700">${etc.c.toLocaleString()}</td><td class="cc" style="white-space:nowrap"><span class="ba ${dBadge}" data-tt="전월 ${pc.toLocaleString()} → 금월 ${etc.c.toLocaleString()}" aria-label="전월 ${pc.toLocaleString()} → 금월 ${etc.c.toLocaleString()}">${dArrow} ${dTxt}</span></td><td class="cc" style="font-weight:600">${ratio}%</td><td style="padding-left:20px"><textarea class="inp plan-ta" maxlength="5000" aria-label="처리계획" name="plan-${sid}-pp-기타" data-plan-id="cmt|${sid}|processingPlan|${esc(S.rm+'@기타')}" style="padding:5px 9px;font-size:11.5px;min-height:32px;resize:none;font-family:inherit;width:100%;overflow:hidden" placeholder="" data-act="panel.plan">${esc(planEtc)}</textarea></td></tr>`;
  };
  // 합계 행
  const trTotFn=(tot,prevTot)=>{
    if(!tot)return'';
    const dN=tot.c-prevTot,dArrow=dN===0?'─':dN>0?'▲':'▼',dBadge=dN===0?'bgr':dN>0?'brd':'bgn';
    const dTxt=dN===0?'0':`${dN>0?'+':'−'}${Math.abs(dN).toLocaleString()}`;
    return`<tr class="tot"><td class="cc"></td><td><b>합계</b></td><td></td><td class="n"><b>${prevTot.toLocaleString()}</b></td><td class="n" style="color:var(--bt1)"><b>${tot.c.toLocaleString()}</b></td><td class="cc" style="white-space:nowrap"><span class="ba ${dBadge}" data-tt="전월 ${prevTot.toLocaleString()} → 금월 ${tot.c.toLocaleString()}" aria-label="전월 ${prevTot.toLocaleString()} → 금월 ${tot.c.toLocaleString()}">${dArrow} ${dTxt}</span></td><td class="cc"><b>100.0%</b></td><td style="padding-left:20px"><div style="min-height:32px"></div></td></tr>`;
  };
  const trBase=st.topLt.filter(t=>!t.isT&&!t.isO);
  const trEtc=st.topLt.find(t=>t.isO),trTot=st.topLt.find(t=>t.isT);
  const prevTrTot=Object.values(st.topLtPrev||{}).reduce((a,b)=>a+b,0);
  const trRows=(trBase.map((t,i)=>trRowFn(t,i,cm.processingPlan,'pp')).join('')
    +trEtcFn(trEtc,st.topLtPrev)+trTotFn(trTot,prevTrTot))
    ||'<tr><td colspan="8" style="text-align:center;padding:14px;color:var(--lbl3)">장기미처리 없음</td></tr>';
  // ── 상세 현황 (월별/주차별) — 기존 .dt 디자인, 연도 피커로 필터 ──
  // 월별/주차별 공유 헬퍼 별칭(단일 출처) — _metrics는 ltRatio 포함 상위집합
  const _nf=tblNF,_dlt=tblDlt,_ltrCells=tblLtrCells,_metrics=tblMetrics;
  const _rateNum=r=>`${r}%`;
  const _wkAll=st.weekly;
  // 연도 목록 (데이터 기준), 선택 연도 기본값 = 기준월 연도
  const _years=[...new Set(_wkAll.map(w=>w.week.slice(0,4)))].sort();
  const _curYear=(_years.includes(S.detailYear)?S.detailYear:(_years.includes(S.rm.slice(0,4))?S.rm.slice(0,4):_years[_years.length-1]))||S.rm.slice(0,4);
  const _yrOpts=_years.length?_years.map(y=>`<option value="${y}" ${y===_curYear?'selected':''}>${y}년</option>`).join(''):`<option value="${_curYear}" selected>${_curYear}년</option>`;
  const _yrPicker=`<select class="yr-sel no-print" data-act="panel.detailYear" aria-label="상세 연도 선택">${_yrOpts}</select>`;
  // colgroup: % 기반 비율 열 너비 (모바일·인쇄 대응)
  // 장기미처리비율 제외 모든 열 균일(6.5%) + 장기비율(16%) = 100%
  // 월별(12열): 월(9%) + 균일열×10(6.5%×10=65%) + 장기비율(16%) + 전월대비(10%) = 100%
  //   → 월(9%), 균일×9(6.5%), 비율(16%), 나머지(6.5%)
  // 주차별(13열): 월(4.5%) + 주차(4.5%) + 균일열×9(6.5%×9=58.5%) + 비율(16%) + 전월대비(6%)
  const _eq='6.5%';// 균일 열 너비
  const _ltrW='16%';// 장기미처리비율 열 너비
  const _moColgroup=`<colgroup><col style="width:9%"><col style="width:${_eq}"><col style="width:${_eq}"><col style="width:${_eq}"><col style="width:${_eq}"><col style="width:${_eq}"><col style="width:${_eq}"><col style="width:${_eq}"><col style="width:${_eq}"><col style="width:${_eq}"><col style="width:${_ltrW}"><col style="width:${_eq}"></colgroup>`;
  const _wkColgroup=`<colgroup><col style="width:4.5%"><col style="width:4.5%"><col style="width:${_eq}"><col style="width:${_eq}"><col style="width:${_eq}"><col style="width:${_eq}"><col style="width:${_eq}"><col style="width:${_eq}"><col style="width:${_eq}"><col style="width:${_eq}"><col style="width:${_eq}"><col style="width:${_ltrW}"><col style="width:${_eq}"></colgroup>`;
  // 주차별 본문: 전체 배열로 지표 계산 후 선택 연도만 표시 (월 셀 매 행 표기, rowspan 미사용)
  const _wkBody=_wkAll.map((w,i)=>{
    const prev=i>0?_wkAll[i-1]:null,prev2=i>1?_wkAll[i-2]:null;
    return{w,m:_metrics(w,prev,prev2),first:i===0,yr:w.week.slice(0,4)};
  }).filter(x=>x.yr===_curYear&&x.w.week.slice(0,7)<=S.rm&&(x.w.sun!==false||x.w.week===st.rmEnd)).map((x,j,arr)=>{
    const {w,m,first}=x;
    const firstOfMonth=j===0||arr[j-1].w.m!==w.m;
    const lastOfMonth=j===arr.length-1||arr[j+1].w.m!==w.m;
    const monthCell=firstOfMonth?`<td class="cc mcell">${w.m}월</td>`:'<td class="cc"></td>';
    return`<tr class="${lastOfMonth?'mend':''}">${monthCell}<td class="cc">${w.wn}주</td><td class="cc recv-total tl-grp">${_nf(m.tR)}</td><td class="cc recv-weekly">${_nf(m.recvW)}</td><td class="cc proc-blue tl-grp">${_nf(m.cumRes)}</td><td class="rate-col proc-blue">${_rateNum(m.rate.toFixed(1))}</td><td class="cc proc-blue">${_nf(m.resW)}</td><td class="cc">${_dlt(m.resWDlt,first,m.resW,'주')}</td><td class="cc unr-red tl-grp">${_nf(m.unr)}</td><td class="cc">${_dlt(m.unrDlt,first,m.unr,'주')}</td>${_ltrCells(m.d0,m.d30,m.d60,m.unr,m.ltDlt,first,'주')}</tr>`;
  }).join('');
  // 월별 본문: 각 월의 마지막(월말) 누적 스냅샷
  const _moMapAll={};_wkAll.forEach(w=>{_moMapAll[w.week.slice(0,7)]=w;});
  const _moKeys=Object.keys(_moMapAll).sort();
  const _moRows=_moKeys.map((k,i)=>{
    const w=_moMapAll[k],prev=i>0?_moMapAll[_moKeys[i-1]]:null,prev2=i>1?_moMapAll[_moKeys[i-2]]:null;
    return{w,k,m:_metrics(w,prev,prev2),first:i===0,yr:k.slice(0,4)};
  }).filter(x=>x.yr===_curYear&&x.k<=S.rm);
  const _moBody=_moRows.map((x,j)=>{
    const {w,m,first}=x;
    return`<tr><td class="cc mcell">${w.m}월</td><td class="cc recv-total tl-grp">${_nf(m.tR)}</td><td class="cc recv-weekly">${_nf(m.recvW)}</td><td class="cc proc-blue tl-grp">${_nf(m.cumRes)}</td><td class="rate-col proc-blue">${_rateNum(m.rate.toFixed(1))}</td><td class="cc proc-blue">${_nf(m.resW)}</td><td class="cc">${_dlt(m.resWDlt,first,m.resW,'월')}</td><td class="cc unr-red tl-grp">${_nf(m.unr)}</td><td class="cc">${_dlt(m.unrDlt,first,m.unr,'월')}</td>${_ltrCells(m.d0,m.d30,m.d60,m.unr,m.ltDlt,first,'월')}</tr>`;
  }).join('');
  // 헤더 생성 헬퍼 — 정렬 기능 없음, 모두 중앙정렬
  const _th=tblTh;
  const _thG=tblThG;
  // 헤더
  const _moTheadFn=()=>`<thead><tr>${_th('','월')}${_thG('','전체 접수')}${_th('recv-sub','월간 접수')}${_thG('','전체 처리')}${_th('rate-col','처리율')}${_th('','월간 처리')}${_th('','전월대비')}${_thG('','전체 미처리')}${_th('','전월대비')}${_th('tl-grp-ltr','장기미처리')}<th class="cc tl-grp-ltr">장기미처리 비율</th><th class="cc">전월대비</th></tr></thead>`;
  const _wkTheadFn=()=>`<thead><tr>${_th('','월')}${_th('','주차')}${_thG('','전체 접수')}${_th('recv-sub','주간 접수')}${_thG('','전체 처리')}${_th('rate-col','처리율')}${_th('','주간 처리')}${_th('','전월대비')}${_thG('','전체 미처리')}${_th('','전월대비')}${_th('tl-grp-ltr','장기미처리')}<th class="cc tl-grp-ltr">장기미처리 비율</th><th class="cc">전월대비</th></tr></thead>`;
  const _moThead=_moTheadFn();
  const _wkThead=_wkTheadFn();
  // All-trade table for trade tab — 시공업체 최다 사용 1개 + 추가 N
  // 공종별 전체 처리 현황 — 현장별 하자처리 현황과 동일 구성
  // NO/공종/시공업체/전체접수/처리/처리율/미처리/장기미처리/장기미처리비율(바)/전월대비
  // 공종별 전체 처리현황 — calc의 trAgg(단일 출처)를 사용. 뷰어는 게시 kpi에 실린 trAgg를 그대로 받는다.
  const allTradeRows=(st.trAgg||[]).map((x,i)=>{
    const rt=x.r>0?(x.res/x.r*100).toFixed(1):'0.0';
    const coTop=x.coTop||'-';
    const ltr=x.u>0?(x.lt/x.u*100):0;
    const p={u:x.pu||0,lt:x.plt||0},pLtr=p.u>0?(p.lt/p.u*100):0;
    const dN=Number((ltr-pLtr).toFixed(1)),isUp=dN>0,isFlat=dN===0,arrow=isFlat?'─':isUp?'▲':'▼',sign=isFlat?'':isUp?'+':'−',badge=isFlat?'bgr':isUp?'brd':'bgn';
    const p60=x.u>0?Math.min(x.d60/x.u*100,100):0,p30=x.u>0?Math.min(x.d30/x.u*100,100):0,p0=x.u>0?Math.min(x.d0/x.u*100,100):0;
    const uD=x.u-p.u,uArrow=uD===0?'─':uD>0?'▲':'▼',uSign=uD>0?'+':uD<0?'−':'',uBadge=uD===0?'bgr':uD>0?'brd':'bgn';
    return`<tr><td class="cc">${i+1}</td><td class="rl-link" data-act="rec.list" data-sid="${esc(sid)}" data-scope="ul" data-trade="${esc(x.t)}"><b>${esc(x.t)}</b></td><td>${esc(coTop)}</td><td class="n">${x.r.toLocaleString()}</td><td class="n" style="color:var(--gn)">${x.res.toLocaleString()}</td><td class="n" style="font-weight:600">${rt}%</td><td class="n" style="color:var(--am)">${x.u.toLocaleString()}</td><td class="cc" style="white-space:nowrap"><span class="ba ${uBadge}" data-tt="전월 ${p.u.toLocaleString()} → 금월 ${x.u.toLocaleString()}" aria-label="전월 ${p.u.toLocaleString()} → 금월 ${x.u.toLocaleString()}">${uArrow} ${uSign}${Math.abs(uD).toLocaleString()}</span></td><td class="n" style="color:var(--rd)">${x.lt.toLocaleString()}</td><td><div class="ltrbar-wrap"><div class="ltrbar" data-tip="${esc(x.t)}|${x.u}|${x.d60}|${x.d30}|${x.d0}|${ltr.toFixed(1)}"><div class="seg s60" style="width:${p60}%"></div><div class="seg s30" style="width:${p30}%"></div><div class="seg s0" style="width:${p0}%"></div></div><span class="ltrbar-pct">${ltr.toFixed(1)}%</span></div></td><td class="cc" style="white-space:nowrap"><span class="ba ${badge}" data-tt="전월 ${pLtr.toFixed(1)}% → 금월 ${ltr.toFixed(1)}%" aria-label="전월 ${pLtr.toFixed(1)}% → 금월 ${ltr.toFixed(1)}%">${arrow} ${sign}${Math.abs(dN).toFixed(1)}%</span></td></tr>`;
  }).join('');

  // 현장 헤더(서브타이틀)에 데이터 신선도 간단 표기
  (()=>{
    const su=document.getElementById('tbsu');if(!su)return;
    const base=`${esc(site.region||'')}  ›  ${esc(site.name||'')}`;
    if(document.body.classList.contains('snap')){su.innerHTML=base;return;} // 스냅샷은 박제 문서 — 데이터 신선도('업로드 N일 전'/'데이터 없음') 표기 무의미
    const up=site.lastUploadedAt;
    if(!up||isNaN(new Date(up).getTime())){su.innerHTML=base+' <span class="tbsu-up empty">· 데이터 없음</span>';return;}
    const days=Math.floor((Date.now()-new Date(up).getTime())/86400000),lbl=days<=0?'오늘':(days+'일 전');
    su.innerHTML=base+` <span class="tbsu-up${days>=14?' stale':''}">· 업로드 ${lbl}</span>`;
  })();
  document.getElementById('scontent').innerHTML=`
<div class="akpi mb12">${kpis}</div>
<div class="tnav">
  <button class="tnav-i ${S.tab==='overview'?'act':''}" data-tab="overview" data-act="panel.tab" data-tab="overview"><svg class="icn icn-sm" aria-hidden="true"><use href="#i-chart"></use></svg>종합</button>
  <button class="tnav-i ${S.tab==='trade'?'act':''}" data-tab="trade" data-act="panel.tab" data-tab="trade"><svg class="icn icn-sm" aria-hidden="true"><use href="#i-warn"></use></svg>장기미처리</button>
  ${showSedae?`<button class="tnav-i ${S.tab==='vacant'?'act':''}" data-tab="vacant" data-act="panel.tab" data-tab="vacant"><svg class="icn icn-sm" aria-hidden="true"><use href="#i-home"></use></svg>공가세대</button>`:''}
  ${showSangga?`<button class="tnav-i ${S.tab==='commercial'?'act':''}" data-tab="commercial" data-act="panel.tab" data-tab="commercial"><svg class="icn icn-sm" aria-hidden="true"><use href="#i-build"></use></svg>공가상가</button>`:''}
  <button class="tnav-i ${S.tab==='timeline'?'act':''}" data-tab="timeline" data-act="panel.tab" data-tab="timeline"><svg class="icn icn-sm" aria-hidden="true"><use href="#i-trend"></use></svg>상세 현황</button>
</div>

<div class="tpane ${S.tab==='overview'?'act':''}" data-tab="overview">
  <div class="as">
    <div class="card main-chart-card" data-print="ov-chart"><div class="sh" style="margin-bottom:6px;flex-shrink:0"><div class="ct cardttl">하자접수 · 처리 주차별 추이</div><select class="yr-sel no-print" id="strend-yr" data-act="site.trendYear" aria-label="현장 추이 연도 선택"></select></div><div class="cw" style="flex:1;min-height:0"><canvas id="c-mo-${sid}"></canvas></div><div id="c-mo-lg-${sid}" class="chart-lg" style="padding-left:48px;flex-shrink:0"><div class="li"><span class="mk-bar" style="background:${cvar('--ch-d60','#DA6A60')}"></span>60일 이상</div><div class="li"><span class="mk-bar" style="background:${cvar('--ch-d30','#E89C9A')}"></span>30~59일</div><div class="li"><span class="mk-bar" style="background:${cvar('--ch-d0','#B3C7DD')}"></span>30일 미만</div><div class="li"><span class="mk-ln" style="border-color:'+cvar('--ch-recv','#3E71D2')+'"></span>전체 접수</div><div class="li"><span class="mk-ln" style="border-color:'+cvar('--ch-done','#F0B144')+'"></span>처리 완료</div></div></div>
    <div class="opsr" style="margin-bottom:0" data-print="ov-opsr">
      <div class="card"><div class="ct cardttl">전월대비 실적 현황</div><div id="c-mom-${sid}" class="mom-wrap"></div></div>
      <div class="card"><div class="ct cardttl">공종별 미처리 분포</div><div class="dn-side"><div class="canv" style="padding:0px"><canvas id="c-mx-${sid}"></canvas></div><div class="lg lg-2col" id="c-mx-lg-${sid}"></div></div></div>
    </div>
    <div class="card" data-print="ov-analysis"><div class="sh"><div class="st cardttl">종합 분석 의견</div><button class="btn bo bsm" data-act="panel.ai" data-sid="${esc(sid)}">AI 분석 생성</button></div><div class="aib"><div class="ail">AI 분석</div><div id="ait-${sid}" class="ait">${ai?themeHTML(safeHTML(ai)):'<p style="color:var(--lbl3)">AI 분석 생성 버튼을 클릭하세요. (설정에서 Gemini API 키 필요)</p>'}</div></div></div>
  </div>
</div>

<div class="tpane ${S.tab==='trade'?'act':''}" data-tab="trade">
  <div class="as">
    ${ltrMomBar}
    <div class="card" data-print="tr-top5"><div class="sh"><div class="st cardttl">장기미처리 상위 5개 공종 처리 현황</div><button class="btn bo bsm no-print" data-act="panel.carryPlan" data-sid="${esc(sid)}" data-tt="전월(${pM(S.rm)}) 처리계획을 이번 달 빈 칸에만 복사합니다" aria-label="전월 처리계획 불러오기">전월 계획 불러오기</button></div><table class="dt" style="table-layout:fixed" id="ttop-${sid}"><thead><tr><th class="cc" style="width:6%">순위</th><th style="width:11%">공종</th><th style="width:11%">시공업체</th><th class="n" style="width:7%">전월</th><th class="n" style="width:7%">금월</th><th class="cc" style="width:7%;white-space:nowrap">전월대비</th><th class="cc" style="width:7%">비율</th><th style="width:44%">처리계획</th></tr></thead><tbody>${trRows}</tbody></table></div>
    <div class="card" data-print="tr-all"><div class="ct">공종별 전체 처리 현황</div><table class="dt" style="table-layout:fixed" id="trade-${sid}"><thead><tr><th class="cc" style="width:6%" data-sort data-sort-type="num" tabindex="0" data-act="panel.sort" data-tbl="trade-${esc(sid)}">NO <span class="sortmk">↕</span></th><th style="width:11%" data-sort data-sort-type="str" tabindex="0" data-act="panel.sort" data-tbl="trade-${esc(sid)}">공종 <span class="sortmk">↕</span></th><th style="width:11%" data-sort data-sort-type="str" tabindex="0" data-act="panel.sort" data-tbl="trade-${esc(sid)}">시공업체 <span class="sortmk">↕</span></th><th class="n" style="width:7%" data-sort data-sort-type="num" tabindex="0" data-act="panel.sort" data-tbl="trade-${esc(sid)}">전체 접수 <span class="sortmk">↕</span></th><th class="n" style="width:7%" data-sort data-sort-type="num" tabindex="0" data-act="panel.sort" data-tbl="trade-${esc(sid)}">처리 <span class="sortmk">↕</span></th><th class="n" style="width:7%" data-sort data-sort-type="num" tabindex="0" data-act="panel.sort" data-tbl="trade-${esc(sid)}">처리율 <span class="sortmk">↕</span></th><th class="n" style="width:7%" data-sort data-sort-type="num" tabindex="0" data-act="panel.sort" data-tbl="trade-${esc(sid)}">미처리 <span class="sortmk">↕</span></th><th class="cc" style="width:6%;white-space:nowrap" data-sort data-sort-type="num" tabindex="0" data-act="panel.sort" data-tbl="trade-${esc(sid)}">전월대비 <span class="sortmk">↕</span></th><th class="n" style="width:7%" data-sort data-sort-type="num" tabindex="0" data-act="panel.sort" data-tbl="trade-${esc(sid)}">장기미처리 <span class="sortmk">↕</span></th><th class="cc" style="width:25%">장기미처리 비율</th><th class="cc" style="width:6%;white-space:nowrap" data-sort data-sort-type="num" tabindex="0" data-act="panel.sort" data-tbl="trade-${esc(sid)}">전월대비 <span class="sortmk">↕</span></th></tr></thead><tbody>${allTradeRows||'<tr><td colspan="11" style="text-align:center;padding:14px;color:var(--lbl3)">데이터 없음</td></tr>'}</tbody></table></div>
  </div>
</div>

${showSedae?`<div class="tpane ${S.tab==='vacant'?'act':''}" data-tab="vacant">${vacPaneHTML(sid,site,cm,st.vacU,'sedae')}</div>`:''}
${showSangga?`<div class="tpane ${S.tab==='commercial'?'act':''}" data-tab="commercial">${vacPaneHTML(sid,site,cm,st.vacS,'sangga')}</div>`:''}

<div class="tpane ${S.tab==='timeline'?'act':''}" data-tab="timeline">
  <div class="as">
    <div class="card" data-print="tl-month"><div class="sh"><div class="st cardttl">월별 현황</div>${_yrPicker}</div><div style="overflow-x:auto"><table class="dt dt-detail" style="table-layout:fixed" id="mo-${sid}">${_moColgroup}${_moThead}<tbody>${_moBody||'<tr><td colspan="12" style="text-align:center;padding:14px;color:var(--lbl3)">데이터 없음</td></tr>'}</tbody></table></div></div>
    <div class="card" data-print="tl-week"><div class="sh"><div class="st cardttl">주차별 현황</div></div><div style="overflow-x:auto"><table class="dt dt-detail" style="table-layout:fixed" id="wk-${sid}">${_wkColgroup}${_wkThead}<tbody>${_wkBody||'<tr><td colspan="13" style="text-align:center;padding:14px;color:var(--lbl3)">데이터 없음</td></tr>'}</tbody></table></div></div>
  </div>
</div>
`;
  setTimeout(()=>{renderTabCharts(sid,st);autoSizeAll(document.getElementById('scontent'));fitSiteName();},60);
  attachLtrTip();
}
// 첫 슬롯 현장명: 20px 기준, 카드 폭을 넘치면 한 줄 유지되도록 폰트만 축소 (최소 13px)
function fitSiteName(){
  document.querySelectorAll('.akpi .kc.kc-site .kv .kpi-screen').forEach(el=>{
    el.style.fontSize='';
    let size=20;
    el.style.fontSize=size+'px';
    // scrollWidth가 clientWidth를 넘으면 한 줄에 안 들어감 → 줄임
    let guard=0;
    while(el.scrollWidth>el.clientWidth&&size>13&&guard<40){size-=0.5;el.style.fontSize=size+'px';guard++;}
  });
}

// ===== 종합 탭(현장패널) 대시보드형 차트 — 데이터는 해당 현장 =====
function buildSiteTrend(sid,st){
  if(typeof Chart==='undefined')return; // CDN 차단 시 조용히 생략 — 부팅 토스트가 별도 안내
  const moEl=document.getElementById('c-mo-'+sid);if(!moEl)return;
  const siteDef=(S.def[sid]||[]).filter(i=>i.receiptDate&&/^\d{4}-\d{2}-\d{2}/.test(i.receiptDate));
  const _tyInfo=trendYearInfo(siteDef,'siteTrendYear'),_ty=Number(_tyInfo.year);
  {const _sel=document.getElementById('strend-yr');if(_sel)_sel.innerHTML=trendYrOptions(_tyInfo);}
  const wks=capWks(siteDef,S.rm,_ty); // 순수 집계 공유 — 게시/스냅샷(capAll)과 동일 산출 보장
  if(window.__SNAP__&&window.__SNAP__.siteWks&&window.__SNAP__.siteWks[sid]){const _sw=window.__SNAP__.siteWks[sid];for(let _i=0;_i<wks.length;_i++){if(_sw[_i])wks[_i]=_sw[_i];}}
  const cumR=wks.map(x=>x.cumR),cumRes=wks.map(x=>x.cumRes);
  const _y1vals=[...cumR,...cumRes].filter(v=>v>0);let _y1min=0,_y1max;
  if(_y1vals.length){const lo=Math.min(..._y1vals),hi=Math.max(..._y1vals),r=niceFitRange(lo,hi);_y1min=r.min;_y1max=r.max;}
  const MO_DUR=520;
  const _baseY=(ctx)=>{if(ctx.type!=='data')return;const ds=ctx.chart.data.datasets[ctx.datasetIndex];const sc=ctx.chart.scales[ds?.yAxisID||'y'];if(!sc)return 0;const base=(sc.min!=null)?sc.min:0;return sc.getPixelForValue(base);};
  const _barAnim={y:{duration:MO_DUR,easing:'easeOutQuart',from:_baseY},base:{duration:MO_DUR,easing:'easeOutQuart',from:_baseY}},_lineAnim={y:{duration:MO_DUR,easing:'easeOutCubic',from:_baseY}},_op=(ctx)=>ctx.chart.$la??0,_opIn=(ctx)=>(ctx.chart.$la??0)*0.55;
  const moDs=[
    {type:'bar',label:'60일 이상',data:wks.map(x=>x.lt60||0),backgroundColor:cvar('--ch-d60','#DA6A60'),hoverBackgroundColor:cvar('--ch-d60h','#C65A50'),stack:'u',borderRadius:0,borderSkipped:false,yAxisID:'y',order:3,animations:_barAnim,datalabels:{display:ctx=>window.innerWidth>768&&moDLCfg(ctx).showInner&&ctx.dataset.data[ctx.dataIndex]>0,opacity:_opIn,anchor:'center',align:'center',color:'#fff',font:ctx=>({size:moDLCfg(ctx).size,weight:600}),formatter:v=>v.toLocaleString()}},
    {type:'bar',label:'30~59일',data:wks.map(x=>x.lt-(x.lt60||0)),backgroundColor:cvar('--ch-d30','#E89C9A'),hoverBackgroundColor:cvar('--ch-d30h','#C76F6D'),stack:'u',borderRadius:0,borderSkipped:false,yAxisID:'y',order:3,animations:_barAnim,datalabels:{display:ctx=>window.innerWidth>768&&moDLCfg(ctx).showInner&&ctx.dataset.data[ctx.dataIndex]>0,opacity:_opIn,anchor:'center',align:'center',color:cvar('--ch-lbl2','#7A3434'),font:ctx=>({size:moDLCfg(ctx).size,weight:600}),formatter:v=>v.toLocaleString()}},
    {type:'bar',label:'30일 미만',data:wks.map(x=>x.u-x.lt),backgroundColor:cvar('--ch-d0','#B3C7DD'),hoverBackgroundColor:cvar('--ch-d0h','#7E9BBC'),stack:'u',borderRadius:0,borderSkipped:false,yAxisID:'y',order:3,animations:_barAnim,datalabels:{labels:{value:{display:ctx=>window.innerWidth>768&&moDLCfg(ctx).showInner&&ctx.dataset.data[ctx.dataIndex]>0,opacity:_opIn,anchor:'center',align:'center',color:cvar('--ch-lbl','#1F2B4C'),font:ctx=>({size:moDLCfg(ctx).size,weight:600}),formatter:v=>v.toLocaleString()},total:{display:ctx=>{if(window.innerWidth<=768)return false;const t=wks[ctx.dataIndex]?.u||0;if(t<=0)return false;const c=moDLCfg(ctx),n=ctx.chart.data.labels.length;return c.totalEvery===1||ctx.dataIndex%c.totalEvery===0||ctx.dataIndex===n-1;},opacity:_op,anchor:'end',align:'end',offset:2,clip:false,color:dlInk(),font:ctx=>({size:moDLCfg(ctx).size,weight:700}),textStrokeColor:dlStroke(),textStrokeWidth:4,formatter:(v,ctx)=>{const t=wks[ctx.dataIndex].u;return t>0?t.toLocaleString():'';}}}}},
    {type:'line',label:'전체 접수',data:cumR,borderColor:cvar('--ch-recv','#3E71D2'),backgroundColor:cvar('--bg2','#fff'),pointBackgroundColor:cvar('--bg2','#fff'),pointBorderColor:cvar('--ch-recv','#3E71D2'),pointBorderWidth:2,tension:.4,pointRadius:4,pointHoverRadius:8,borderWidth:2.5,fill:false,yAxisID:'y1',order:1,animations:_lineAnim,datalabels:{display:ctx=>window.innerWidth>768&&(ctx.dataIndex===0||ctx.dataIndex===ctx.dataset.data.length-1),opacity:_op,anchor:'center',align:ctx=>ctx.dataIndex===0?'right':'left',offset:8,clip:false,color:dlBlue(),font:{size:11,weight:700},textStrokeColor:dlStroke(),textStrokeWidth:4,formatter:v=>v.toLocaleString()}},
    {type:'line',label:'처리 완료',data:cumRes,borderColor:cvar('--ch-done','#F0B144'),backgroundColor:cvar('--bg2','#fff'),pointBackgroundColor:cvar('--bg2','#fff'),pointBorderColor:cvar('--ch-done','#F0B144'),pointBorderWidth:2,tension:.4,pointRadius:4,pointHoverRadius:8,borderWidth:2.5,fill:false,yAxisID:'y1',order:0,animations:_lineAnim,datalabels:{display:ctx=>window.innerWidth>768&&(ctx.dataIndex===0||ctx.dataIndex===ctx.dataset.data.length-1),opacity:_op,anchor:'center',align:ctx=>ctx.dataIndex===0?'right':'left',offset:8,clip:false,color:dlAmber(),font:{size:11,weight:700},textStrokeColor:dlStroke(),textStrokeWidth:4,formatter:v=>v.toLocaleString()}}
  ];
  const _atSize=(typeof window!=='undefined'&&window.innerWidth<=768)?10:13;const _tkSize=(typeof window!=='undefined'&&window.innerWidth<=768)?9:12;
  S.charts['mo-'+sid]=new Chart(moEl,{data:{labels:wks.map(x=>`${x.m}월\n${x.w}주`),datasets:moDs},options:{responsive:true,maintainAspectRatio:false,animation:{duration:MO_DUR,easing:'easeOutQuart',onComplete(ac){if(!ac.initial||ac.chart.$dlShown)return;ac.chart.$dlShown=true;const ch=ac.chart,t0=performance.now(),fd=350;const tick=()=>{if(!ch||ch.$destroyed||!ch.ctx)return;try{const p=Math.min(1,(performance.now()-t0)/fd);ch.$la=p*p*(3-2*p);ch.update('none');if(p<1)requestAnimationFrame(tick);}catch(e){}};requestAnimationFrame(tick);}},plugins:{legend:{display:false},tooltip:{mode:'index',intersect:false,padding:12,usePointStyle:true,boxWidth:10,boxHeight:10,boxPadding:6,callbacks:{label:ctx=>`${ctx.dataset.label}: ${(ctx.parsed.y??ctx.parsed??0).toLocaleString()}건`}}},scales:{x:{grid:{display:false},ticks:{font:{size:10},color:chartInk(),callback:function(v){return this.getLabelForValue(v).split('\n');}}},y:{beginAtZero:true,position:'left',grace:'25%',grid:{color:chartGrid()},ticks:{font:{size:_tkSize}},title:{display:true,text:'미처리(건)',font:{size:_atSize,weight:600},color:chartAxisTitle()}},y1:{beginAtZero:false,min:_y1min,max:_y1max,position:'right',grid:{display:false},ticks:{font:{size:_tkSize}},title:{display:true,text:'접수·처리(건)',font:{size:_atSize,weight:600},color:chartAxisTitle()}}}}});
}
function buildSiteMom(sid,st){
  if(typeof Chart==='undefined')return;
  const momEl=document.getElementById('c-mom-'+sid);if(!momEl)return;
  const M=[
    {label:'전체 접수',prev:st.prev.total,curr:st.tR,goodUp:false,grp:'in'},
    {label:'처리 완료',prev:st.prev.res,curr:st.res,goodUp:true,grp:'in'},
    {label:'미처리',prev:st.prev.unr,curr:st.unr,goodUp:false,grp:'un'},
    {label:'장기미처리',prev:st.prev.lt,curr:st.lt,goodUp:false,grp:'un'}
  ];
  const mxIn=Math.max(...M.filter(m=>m.grp==='in').flatMap(m=>[m.prev,m.curr]),1),mxUn=Math.max(...M.filter(m=>m.grp==='un').flatMap(m=>[m.prev,m.curr]),1);
  const mnIn=(()=>{const vs=M.filter(m=>m.grp==='in').flatMap(m=>[m.prev,m.curr]).filter(v=>v>0);if(!vs.length)return 0;const lo=Math.min(...vs),hi=Math.max(...vs),span=hi-lo;return span<hi*0.12?Math.max(0,Math.floor(lo-span*2)):0;})();
  momEl.innerHTML=M.map(m=>{const mx=m.grp==='in'?mxIn:mxUn,mn=m.grp==='in'?mnIn:0,eff=Math.max(mx-mn,1);const diff=m.curr-m.prev,pct=m.prev>0?(diff/m.prev*100):0,isUp=diff>0,isEq=diff===0,arrow=isEq?'—':isUp?'▲':'▼',good=isEq?'eq':(m.goodUp===isUp?'up':'dn'),pctTxt=isEq?'변동 없음':(m.prev>0?(diff>0?'+':'')+pct.toFixed(1)+'%':'—');return`<div class="mom-row"><div class="label">${m.label}</div><div class="bars"><div class="bar prev"><span class="lb">전월</span><div class="tr"><div class="fl" data-w="${Math.max(0,(m.prev-mn)/eff*100)}"></div></div><span class="vl">${m.prev.toLocaleString()}</span></div><div class="bar curr"><span class="lb">금월</span><div class="tr"><div class="fl" data-w="${Math.max(0,(m.curr-mn)/eff*100)}"></div></div><span class="vl">${m.curr.toLocaleString()}</span></div></div><div class="delta"><span class="d ${good}">${arrow} ${pctTxt}</span></div></div>`;}).join('');
  requestAnimationFrame(()=>{momEl.querySelectorAll('.fl').forEach((fl,i)=>{setTimeout(()=>{fl.style.width=fl.dataset.w+'%';},60+i*40);});});
}
function buildSiteTradeDonut(sid){
  if(typeof Chart==='undefined')return;
  const mxEl=document.getElementById('c-mx-'+sid);if(!mxEl)return;
  if(!Chart.__ctReg){Chart.register({id:'centerText',afterDraw(chart,_,opts){if(!opts||!opts.display)return;const{ctx,chartArea:{left,right,top,bottom}}=chart;const cx=(left+right)/2,cy=(top+bottom)/2;ctx.save();ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle=opts.valueColor||cvar('--lbl','#1C1C1E');ctx.font=`700 ${opts.valueSize||16}px 'Pretendard Variable',Pretendard,sans-serif`;ctx.fillText(opts.value||'',cx,cy-2);ctx.fillStyle=opts.labelColor||cvar('--ch-axis','rgba(60,60,67,.58)');ctx.font=`600 ${opts.labelSize||11}px 'Pretendard Variable',Pretendard,sans-serif`;ctx.fillText(opts.label||'',cx,cy+14);ctx.restore();}});Chart.__ctReg=true;}
  const am=capAm(S.def[sid]||[],S.rm); // 순수 집계 공유
  if(window.__SNAP__&&window.__SNAP__.siteAm&&window.__SNAP__.siteAm[sid]){for(const _k in am)delete am[_k];Object.assign(am,window.__SNAP__.siteAm[sid]);}
  const ownEtc=am['기타']||0;delete am['기타'];
  const sorted=Object.entries(am).sort((a,b)=>b[1]-a[1]),top11=sorted.slice(0,11),restEtc=sorted.slice(11).reduce((a,[,c])=>a+c,0),etcTotal=ownEtc+restEtc;
  const tmData=top11.map(([t,c])=>({t,c}));if(etcTotal>0)tmData.push({t:'기타',c:etcTotal});
  const tot=tmData.reduce((a,x)=>a+x.c,0);
  const tmColors=donutPalette();
  S.charts['mx-'+sid]=new Chart(mxEl,{type:'doughnut',data:{labels:tmData.map(d=>d.t),datasets:[{data:tmData.map(d=>d.c),backgroundColor:tmColors,borderWidth:3,borderColor:chartSegBorder(),hoverOffset:12,hoverBorderWidth:3}]},options:{responsive:true,maintainAspectRatio:false,layout:{padding:14},cutout:'58%',plugins:{centerText:{display:true,value:tot.toLocaleString()+'건',label:'미처리'},legend:{display:false},tooltip:{padding:12,usePointStyle:true,boxWidth:10,boxHeight:10,boxPadding:6,callbacks:{labelPointStyle:()=>({pointStyle:'circle',rotation:0}),label:ctx=>`${ctx.label}: ${ctx.parsed.toLocaleString()}건 (${tot>0?(ctx.parsed/tot*100).toFixed(1):0}%)`}},datalabels:{display:false}}}});
  const mxLg=document.getElementById('c-mx-lg-'+sid);if(mxLg){mxLg.innerHTML=tmData.map((d,i)=>`<div class="it" data-idx="${i}"><span class="l"><span class="dt" style="background:${tmColors[i%tmColors.length]}"></span><span class="nm">${esc(d.t)}</span></span><span class="cnt">${d.c.toLocaleString()}건</span><span class="pct">${tot>0?(d.c/tot*100).toFixed(1):0}%</span></div>`).join('');mxLg.querySelectorAll('.it').forEach(el=>{el.addEventListener('mouseenter',()=>{const ch=S.charts['mx-'+sid];if(!ch)return;const idx=Number(el.dataset.idx);ch.setActiveElements([{datasetIndex:0,index:idx}]);ch.tooltip?.setActiveElements([{datasetIndex:0,index:idx}],{x:0,y:0});ch.update();});el.addEventListener('mouseleave',()=>{const ch=S.charts['mx-'+sid];if(!ch)return;ch.setActiveElements([]);ch.tooltip?.setActiveElements([],{x:0,y:0});ch.update();});});}
}
function renderTabCharts(sid,st){
  if(!st){const site=S.sites.find(s=>s.id===sid);if(!site)return;st=calc(S.def[sid]||[],site,S.rm);}
  // overview charts — 대시보드와 동일한 구성(추이 복합차트 / 전월대비 실적현황 / 공종 미처리 도넛), 데이터는 해당 현장
  dC('mo-'+sid);dC('mx-'+sid);
  buildSiteTrend(sid,st);
  buildSiteMom(sid,st);
  buildSiteTradeDonut(sid);
}

// SAVE
// 호환용 — 이제 textarea는 schedulePlanSave를 통해 자동저장. 외부에서 직접 호출하는 경우만 남김.
// ── 처리계획 전월 이월 — 월초 반복 타이핑 제거. add-only: 이미 입력된 이번 달 칸은 건드리지 않음(시드와 동일 원칙). ──
//   세대·공가·상가 3개 필드를 한 번에 처리. 복사분은 fb2PlanWrite로 즉시 동기화(협업자에게도 반영).
function carryPlansForward(sid){
  const prev=pM(S.rm),PF=['processingPlan','vacantProcessingPlan','commercialProcessingPlan'];
  const cm=S.cmt[sid];if(!cm)return 0;
  let n=0;
  PF.forEach(function(f){
    const leaf=cm[f];if(!leaf||typeof leaf!=='object')return;
    for(const k in leaf){
      if(!k.startsWith(prev+'@'))continue;
      const v=leaf[k];if(typeof v!=='string'||!v.trim())continue;
      const cur=S.rm+k.slice(prev.length);
      const ex=leaf[cur];
      if(typeof ex==='string'&&ex.trim())continue; // add-only: 이번 달 값 보존
      leaf[cur]=v;n++;
      try{fb2PlanWrite(sid,f,cur,v);}catch(_){}
    }
  });
  if(n)lsSave();
  return n;
}
function openVacEdit(sid,vl,statusField){
  statusField=statusField||'vacantStatus';
  const cur=S.cmt[sid]?.[statusField]||{};
  const _u=statusField==='commercialStatus'?'호실':'세대';
  const mb=cur['미분양']??'',mk=cur['미키불출']??'';
  const ov=document.createElement('div');ov.className='vmodal-ov';
  ov.innerHTML=`<div class="vmodal">
    <div class="vmodal-ttl">${vl} 수 입력</div>
    <div class="vmodal-sub">미분양·미키불출 ${_u}수를 입력하면 합계가 자동 계산됩니다.</div>
    <div class="vmodal-row"><label>미분양</label><input type="text" inputmode="numeric" class="inp vmodal-in" id="vm-mb" value="${esc(String(mb))}" placeholder="0"></div>
    <div class="vmodal-row"><label>미키불출</label><input type="text" inputmode="numeric" class="inp vmodal-in" id="vm-mk" value="${esc(String(mk))}" placeholder="0"></div>
    <div class="vmodal-sum"><span>${vl} 합계</span><b id="vm-sum">0 ${_u}</b></div>
    <button class="vmodal-btn" id="vm-save">저장</button>
  </div>`;
  document.body.appendChild(ov);
  const $mb=ov.querySelector('#vm-mb'),$mk=ov.querySelector('#vm-mk'),$sum=ov.querySelector('#vm-sum');
  const upd=()=>{const a=parseInt($mb.value,10)||0,b=parseInt($mk.value,10)||0;$sum.textContent=(a+b).toLocaleString()+' '+_u;};
  $mb.addEventListener('input',upd);$mk.addEventListener('input',upd);upd();
  const close=()=>{if(ov.parentNode)ov.parentNode.removeChild(ov);};
  const commit=()=>{
    if(!S.cmt[sid])S.cmt[sid]={};if(!S.cmt[sid][statusField])S.cmt[sid][statusField]={};
    S.cmt[sid][statusField]['미분양']=$mb.value.trim();
    S.cmt[sid][statusField]['미키불출']=$mk.value.trim();
    lsSave();close();if(S.sid===sid)rSite(sid);
  };
  ov.querySelector('#vm-save').addEventListener('click',commit);
  ov.addEventListener('click',e=>{if(e.target===ov)commit();});
  setTimeout(()=>$mb.focus(),30);
}

// ── PII 마스킹 (P4) — 외부 AI(Gemini)로 나가는 자유 텍스트 전용 ──
//   대상: 휴대전화·일반전화·이메일·호칭(님/씨) 붙은 인명. 동·호수는 원인분석에 필요하므로 마스킹하지 않음(운영 결정).
//   저장·화면 표시 데이터는 원본 유지 — 프롬프트 조립 직전에만 적용. (게시 경로는 redactUL이 별도 담당)
//   범용 한국어 PII 마스킹은 성숙한 OSS가 사실상 없어(영문 위주) 도메인 특화 정규식으로 유지.
//   _PII_ROLE: 님/씨 앞에 붙는 흔한 직책·역할 명사 — 인명이 아니므로 보존(과잉 마스킹 방지).
const _PII_ROLE=new Set(['고객','손님','선생','사장','기사','소장','반장','과장','차장','부장','대리','주임','팀장','실장','원장','이사','상무','전무','대표','회장','여사','담당','담당자','관리자','작업자','기술자','입주자','입주민','세대주','어르신','사모','아저','아주머','어머','아버']);
function maskPII(s){
  return String(s==null?'':s)
    .replace(/01[016789][ .-]?\d{3,4}[ .-]?\d{4}\b/g,'010-****-****')
    .replace(/\b0\d{1,2}[ .-]\d{3,4}[ .-]\d{4}\b/g,'0**-***-****')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,'***@***')
    .replace(/([가-힣]{2,4})(님|씨)(?![가-힣])/g,(m,name,h)=>_PII_ROLE.has(name)?m:'○○'+h);
  // 알려진 한계: '홍길동님이'처럼 님/씨 뒤에 조사가 바로 붙으면 매치하지 않음(의도 — 완화 시 '날씨가' 등
  // 일반 어휘 오탐이 발생). 인명 마스킹은 best-effort이며 고위험 PII(전화·이메일)는 위 규칙이 전담.
}
async function runAI(sid){if(!S.ck){toast('설정에서 Gemini API 키를 입력하세요');return;}const site=S.sites.find(s=>s.id===sid);if(!site)return;const st=calc(S.def[sid]||[],site,S.rm),el=document.getElementById(`ait-${sid}`);if(el)el.innerHTML='<p style="color:var(--lbl3)">AI 분석 생성 중…</p>';
const systemInstruction = buildRules('site'); // 기본 규칙 레지스트리(RULE_DEF)에서 조립 — 설정>기본 규칙 편집의 override 반영, 미수정 시 종전 문자열과 동일
const _ul=st.ul||[];
// 키워드 포함건 우선 + 60일+ 장기미처리 우선으로 접수내용 샘플 추출 (최대 40건, 각 60자)
const _kw=new RegExp('누수|민원|품의|자재|피해|보상|결로|곰팡이|균열|파손|재시공|소송|법무|하자판정|중대');
const _daysB=(a,b)=>{const da=new Date(a),db=new Date(b);return Math.max(0,Math.round((db-da)/86400000));};
const _scored=_ul.map(i=>{const c=(i.receiptContent||'').replace(/\s+/g,' ').trim();const dd=i.receiptDate?_daysB(i.receiptDate,st.rmEnd):0;return{c,dd,co:i.complaint,t:i.trade||'',kw:_kw.test(c)||_kw.test(i.complaint||'')};}).filter(x=>x.c);
_scored.sort((a,b)=>(b.kw-a.kw)||(b.dd-a.dd));
const _sample=_scored.slice(0,40).map(x=>`- [${x.t}|${x.dd}일${x.kw?'|★':''}] ${maskPII(x.c).slice(0,60)}`).join('\n');
const _contentBlock=_sample?`\n[미처리건 접수내용 샘플 — ★는 누수·민원·품의·자재·피해보상 등 주요 키워드 포함건]\n${_sample}`:`\n[미처리건 접수내용] 제공된 접수내용 데이터 없음 (해당 분석 항목 생략)`;
// 중대하자 의심 후보 블록 — 규칙(isCritCandidate)으로 넓게 추출한 후보 + 의심사유 태그. AI가 매뉴얼 기준으로 최종 판정.
const _critList=(st.critUl||[]).slice(0,12).map(i=>{const dd=i.receiptDate?_daysB(i.receiptDate,st.rmEnd):0;const c=(i.receiptContent||'').replace(/\s+/g,' ').trim();const rs=critReason(i).join('/');return `- ${i.building||'?'}동 ${i.unit||'?'}호 [${i.trade||'-'}|${i.defectType||'-'}|${dd}일|의심:${rs}] ${maskPII(c).slice(0,70)}`;}).join('\n');
const _critBlock=(st.critUnr>0)?`\n[중대하자 의심 후보 — 규칙 추출, AI가 사내 매뉴얼 기준으로 최종 판정할 것] 미처리 의심 ${st.critUnr}건(전월 의심 ${st.critPrevUnr}건)\n${_critList}`:`\n[중대하자 의심 후보] 규칙상 의심 0건`;
const p=`현대건설 ${(curTeam()?curTeam().name:'H서비스센터')} ${site.name} 현장의 하자처리 현황을 분석하여 한국어 개조식으로 작성하세요. 기준월 ${S.rm}, 전월 대비 변화를 중심으로 분석할 것.\n[현장] ${site.name}(${site.region}), ${site.units}세대 ${site.buildings}동, 준공 ${site.completionDate}\n[현황] 전체접수 ${st.tR}건(전월${st.prev.total}), 처리 ${st.res}건(전월${st.prev.res}), 미처리 ${st.unr}건(전월${st.prev.unr}), 처리율 ${st.rate.toFixed(1)}%(전월${st.prev.rate.toFixed(1)}%), 장기미처리 ${st.lt}건(전월${st.prev.lt}건, 미처리의 ${st.ltr.toFixed(1)}%), 지연구간: ~29일 ${st.dd[0]}, 30~59일 ${st.dd[1]}, 60일+ ${st.dd[2]}\n[상위공종(미처리)] ${st.top.filter(t=>!t.isT&&!t.isO).map(t=>`${t.t}:${t.c}건`).join(', ')}\n[하자유형(미처리)] ${Object.entries(st.dtb).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([t,c])=>`${t}:${c}건`).join(', ')}\n[공가세대] 총접수 ${st.vT}건, 미처리 ${st.vUnr}건${_critBlock}${_contentBlock}\n\n위 데이터를 분석해 시스템 지침의 형식·내용 규칙에 따라 작성하세요. 단순 수치 나열이 아닌 해석·원인·대응을 담되, 데이터가 없거나 특이사항이 없는 항목은 생략하고 중요한 것만 최대 6개 소제목으로 쓸 것. (단 중대하자는 시스템 지침 G에 따라 처리)`;
try{const url=`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`;const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':S.ck},body:JSON.stringify({systemInstruction:{parts:[{text:systemInstruction}]},contents:[{parts:[{text:p}]}],generationConfig:{maxOutputTokens:4096,temperature:0.4,thinkingConfig:{thinkingBudget:0}}})});const d=await r.json();if(d.error)throw new Error(d.error.message||'API 오류');let txt=d.candidates?.[0]?.content?.parts?.[0]?.text||'분석 결과를 불러올 수 없습니다.';txt=txt.replace(/^```html\s*/i,'').replace(/```$/,'').trim();anaSet(sid,txt);lsSave();fb2AnaWrite(sid,txt);if(el)el.innerHTML=themeHTML(safeHTML(txt));toast('AI 분석 완료');}
catch(e){if(el)el.innerHTML=`<p style="color:var(--rd)">(AI 오류: ${esc(e.message)})</p>`;}}

// 대시보드 주요 이슈 — 규칙기반 선정 결과(수치·맥락)를 현장패널과 동일한 작성규칙(개조식·논리적 인과·담당자 권한 내 조치)으로 AI 재작성. 3슬롯·2줄 형식 유지.
async function runDashAI(){
  if(!S.ck){toast('설정에서 Gemini API 키를 입력하세요');return;}
  const el=document.getElementById('d-insight');
  const items=S._dashIns||[];
  if(!items.length){toast('표시할 이슈가 없습니다');return;}
  if(el)el.innerHTML='<div class="ic"><div class="ic-t"><div class="ic-sub" style="color:var(--lbl3)">AI 분석 생성 중…</div></div></div>';
  const stripTags=h=>String(h).replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim();
  const src=items.map((x,i)=>{const parts=String(x.sub).split('<br>');return `[카드${i+1}] 제목:${x.ttl} | 등급:${x.cls}\n  핵심수치(원문):${stripTags(parts[0]||'')}\n  진단·조치(원문):${stripTags(parts[1]||'')}`;}).join('\n');
  const dashSystem = buildRules('dash'); // RULE_DEF 조립 — 기본 규칙 편집 override 반영
  const dp=`아래 3개 카드의 각 2줄을 위 규칙에 따라 한국어 개조식으로 다시 작성하세요. 수치는 원문 그대로 유지할 것.\n\n${src}`;
  try{
    const url=`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`;
    const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':S.ck},body:JSON.stringify({systemInstruction:{parts:[{text:dashSystem}]},contents:[{parts:[{text:dp}]}],generationConfig:{maxOutputTokens:1200,temperature:0.4,thinkingConfig:{thinkingBudget:0}}})});
    const d=await r.json();
    if(d.error)throw new Error(d.error.message||'API 오류');
    let txt=(d.candidates?.[0]?.content?.parts?.[0]?.text||'').replace(/^```json\s*/i,'').replace(/^```\s*/i,'').replace(/```$/,'').trim();
    const arr=JSON.parse(txt);
    if(!Array.isArray(arr)||arr.length<items.length)throw new Error('형식 오류');
    el.innerHTML=items.map((x,i)=>{const a=arr[i]||{};const l1=safeHTML(a.line1||''),l2=safeHTML(a.line2||'');return `<div class="ic ${x.cls}"><div class="ic-i">${icoSVG(x.icon)}</div><div class="ic-t"><div class="ic-ttl">${x.ttl}</div><div class="ic-sub">${l1}<br>${l2}</div></div></div>`;}).join('');
    insBindCards();
    toast('AI 분석 완료');
  }catch(e){
    // 실패 시 규칙기반 원본 복원
    el.innerHTML=themeHTML(safeHTML(items.map(x=>`<div class="ic ${x.cls}"><div class="ic-i">${icoSVG(x.icon)}</div><div class="ic-t"><div class="ic-ttl">${x.ttl}</div><div class="ic-sub">${x.sub}</div></div></div>`).join('')));
    insBindCards();
    toast('AI 분석 실패: '+e.message);
  }
}
