// ─────────────────────────────────────────────────────────────────────────────
// app-core.js — 상태(S)·공용 유틸·UI 원시함수(모달/토스트/차트색)·도메인 계산(calc 등)·계층 훅.
//   로드 순서 고정: core → data → view → boot · 호출 방향도 같은 한 방향(tests/deps.mjs 검사).
//   최하위 층 — 위 계층 함수를 절대 부르지 않는다. 알릴 일은 fireHook 으로.
//   index.html의 로드 순서와 스냅샷 인라인 순서(exportSnapshot의 APP_PARTS)를 함께 유지할 것.
// ─────────────────────────────────────────────────────────────────────────────
const S={view:'dashboard',sid:null,sites:[],def:{},defVer:0,cmt:{},ana:{},rm:pM(todayYM()),ck:'',charts:{},ubuf:null,mini:false,tab:'overview',exTk:'dummy',smsort:null,regionOrder:[],detailYear:null,trendYear:null,siteTrendYear:null,teams:[],teamId:null};
// calc() 메모이즈 캐시. 키 = 현장id|기준월|defVer|필터서명.
// 캐시 무효화는 자동: S.def를 Proxy로 감싸 set/delete 시 bumpDef() 호출 → defVer↑ + 캐시 비움.
// (S.def는 전부 통째 교체/삭제만 — 깊은 in-place 편집(push/splice/필드수정)은 트랩 미포착이라 금지: 항상 통째 교체)
const _calcCache=new Map();
function bumpDef(){S.defVer++;_calcCache.clear();warmCalcKick();}
// ── 대시보드 첫 진입 렉 방지: 데이터 변경 후 유휴 시간에 현장별 집계를 미리 계산해 캐시를 채운다 ──
// Proxy set(초기 로드·업로드·동기화)마다 bumpDef가 킥 → 600ms 조용해지면 현장당 1태스크로 순차 워밍.
// 진입 시 캐시 히트로 계산 0. 무효화는 기존 bumpDef가 처리하므로 정합성 영향 없음. 스냅샷 모드는 임베드 집계라 불필요.
let _warmT=null,_warmQ=null;
function warmCalcKick(){clearTimeout(_warmT);_warmQ=null;_warmT=setTimeout(()=>{if(window.__SNAP__)return;_warmQ=(S.sites||[]).slice();_warmStep();},600);}
function _warmStep(){
  if(!_warmQ||!_warmQ.length)return;
  const idle=window.requestIdleCallback||function(f){return setTimeout(()=>f(),120);};
  idle(()=>{if(!_warmQ)return;const s=_warmQ.shift();if(s){try{calc(S.def[s.id]||[],s,S.rm);}catch(e){}}if(_warmQ&&_warmQ.length)_warmStep();},{timeout:3000});
}
S.def=new Proxy(S.def,{set(t,k,v){t[k]=v;bumpDef();return true;},deleteProperty(t,k){delete t[k];bumpDef();return true;}});
// ===== 팀 / 권역 모델 =====
function uid(p){return (p||'id')+'_'+Date.now().toString(36)+Math.random().toString(36).slice(2,6);}
function makeDefaultTeam(){return{id:uid('t'),name:'H서비스중부팀',regions:[],regionOrder:[]};}
function curTeam(){return S.teams.find(t=>t.id===S.teamId)||S.teams[0]||null;}
const PERM_REGION='인수 전 현장';// 항상 존재하는 고정 권역 (센터 인수 전). 편집·삭제 불가, 대시보드 집계 제외.
function curRegions(){const t=curTeam();const base=(t&&Array.isArray(t.regions))?t.regions.filter(r=>r!==PERM_REGION):[];base.push(PERM_REGION);return base;}
function teamSites(){return S.sites.filter(s=>s.teamId===S.teamId);}
// 사용자(viewer)는 현장/팀/권역 구조를 변경할 수 없음(읽기 전용). 관리자·로컬 모드만 변경 가능.
function manageLocked(){try{return FB2.role==='viewer';}catch(e){return false;}}
// 사용자 정의 권역 순서 반영 (없으면 팀 기본 순서). 목록에 없는/추가된 권역은 뒤에 붙임.
function orderedRGS(){const t=curTeam();const base=(t&&Array.isArray(t.regions))?t.regions.filter(r=>r!==PERM_REGION):[];const ord=(t&&Array.isArray(t.regionOrder))?t.regionOrder:[];const seen=new Set();const out=[];for(const r of ord){if(base.includes(r)&&!seen.has(r)){out.push(r);seen.add(r);}}for(const r of base){if(!seen.has(r)){out.push(r);seen.add(r);}}out.push(PERM_REGION);return out;}
// 사이드바 팀 선택기 렌더
function rTeamSel(){
  const el=document.getElementById('teamsel');if(!el)return;
  const opts=S.teams.map(t=>`<option value="${esc(t.id)}" ${t.id===S.teamId?'selected':''}>${esc(t.name)}</option>`).join('');
  el.innerHTML=`<div class="tsel-wrap"><select data-act="team.switch" data-tt="팀 선택" aria-label="팀 선택">${opts}</select><span class="tsel-ch"><svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M2 3.5l3 3 3-3"/></svg></span></div>`;
}
// ===== 현장 관리 페이지 (팀·권역·현장) =====
const ICON_TRASH='<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6M14 11v6"/></svg>';
const ICON_RADIO_ON='<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.6" fill="currentColor" stroke="none"/></svg>';
const ICON_RADIO_OFF='<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8"/></svg>';
const ICON_LOCK='<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
function uniqName(base,existing){let n=base,i=2;const set=new Set(existing);while(set.has(n)){n=base+' '+i;i++;}return n;}
function todayYM(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;} // 로컬 날짜 기준 — toISOString(UTC)은 KST 매월 1일 00~09시에 기준월이 한 달 밀림
// HTML 이스케이프 — textarea 내용/사용자 입력값을 안전하게 attribute·content로 렌더링
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
// 태그드 템플릿 — 보간값을 자동 HTML 이스케이프해 안전한 문자열을 만든다(기본 안전).
//   이미 안전하게 만든 HTML 조각은 rawHTML(s)로 표시해 그대로 통과시킨다(중첩 합성용).
//   배열은 각 요소를 재귀 처리 후 join. null/undefined/false는 빈 문자열.
//   (lit-html 등 OSS는 TemplateResult를 반환하는 다른 렌더 모델이라, 문자열 innerHTML 구조인 이 앱엔 부적합)
function rawHTML(s){return{__html:String(s==null?'':s)};}
function _htmlPiece(v){
  if(v==null||v===false||v==='')return '';
  if(v&&typeof v==='object'&&typeof v.__html==='string')return v.__html;
  if(Array.isArray(v))return v.map(_htmlPiece).join('');
  return esc(v);
}
function html(strings,...vals){
  let out=strings[0];
  for(let i=0;i<vals.length;i++)out+=_htmlPiece(vals[i])+strings[i+1];
  return out;
}
// AI·외부 생성 HTML 살균 — DOMPurify(성숙 OSS)로 XSS 차단. CDN 차단 등으로 미로드 시 보수적 폴백.
// innerHTML 주입 직전에만 호출(출력 시점 살균). 저장은 원본 유지.
// 이슈 카드 아이콘 — ICON 값은 <path> 마크업. 구버전 게시본에 저장된 'M…' 단일 path 문자열도 감싸서 호환.
function icoSVG(v){
  const s=String(v||'');
  const inner=/^\s*[Mm][\s\d.-]/.test(s)?'<path d="'+s+'"/>':s;
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'+inner+'</svg>';
}
// 색 토큰 조회 — CSS 변수를 단일 진실 공급원으로 두고 차트가 그 값을 읽는다(다크모드·테마 변경 대비).
//   getComputedStyle은 비용이 있어 1회 캐시하고, 테마가 바뀌면 CSSVAR.clear()로 무효화한다.
const CSSVAR=new Map();
function cvar(name,fallback){
  if(CSSVAR.has(name))return CSSVAR.get(name);
  let v='';try{v=getComputedStyle(document.documentElement).getPropertyValue(name).trim();}catch(_){}
  const out=v||fallback;CSSVAR.set(name,out);return out;
}
function safeHTML(dirty){
  const s=String(dirty==null?'':dirty);
  if(window.DOMPurify&&DOMPurify.sanitize){
    // class 토큰 화이트리스트 훅(1회 등록): 살균 통과 HTML이 앱 스타일 클래스를 도용해 UI를 위장하지 못하도록
    // 인사이트 카드가 실제 사용하는 클래스만 통과시킨다. (AI 분석 HTML은 인라인 스타일만 사용 → 무영향)
    if(!safeHTML._clsHook){
      safeHTML._cls=new Set(['ic','ic-i','ic-t','ic-ttl','ic-sub','warn','bad','ok']);
      DOMPurify.addHook('uponSanitizeAttribute',(node,data)=>{
        if(data.attrName==='class'){
          data.attrValue=String(data.attrValue).split(/\s+/).filter(c=>safeHTML._cls.has(c)).join(' ');
          if(!data.attrValue)data.keepAttr=false;
        }
      });
      safeHTML._clsHook=true;
    }
    return DOMPurify.sanitize(s,{
      ALLOWED_TAGS:['div','p','ul','ol','li','strong','b','em','i','span','br','small','h1','h2','h3','h4','table','thead','tbody','tr','td','th','svg','path'],
      ALLOWED_ATTR:['style','class','viewBox','fill','stroke','stroke-width','stroke-linecap','stroke-linejoin','d','opacity','width','height','xmlns'],
      ALLOW_DATA_ATTR:false
    });
  }
  // 폴백(DOMPurify 부재): 위험 태그·이벤트핸들러·위험 URL 스킴 제거 (최소 방어선)
  return s.replace(/<\/?(?:script|iframe|object|embed|link|meta|style|form|input|button|base|frame|frameset|applet)\b[^>]*>/gi,'')
          .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi,'')
          .replace(/(?:href|src|xlink:href|formaction|action)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi,'')
          .replace(/(?:javascript|vbscript)\s*:/gi,'');
}
// 게시(Firebase)·스냅샷에 실리는 미처리 목록에서 입주민 자유텍스트(접수내용·민원)를 제거 — 외부 공유 시 개인정보 최소화.
// 구조 필드(공종·하자유형·보수주체·일자 등)는 유지되어 집계/뷰어 표시에는 영향 없음.
function redactUL(ul,all){const a=all?(ul||[]):(ul||[]).slice(0,300);return a.map(i=>Object.assign({},i,{receiptContent:maskPII(String(i.receiptContent||'')),complaint:''}));} // all=true: 캡 없이. 접수내용은 비우지 않고 PII(전화·이메일·인명)만 마스킹해 게시 — 뷰어도 내용 확인 가능
// 게시본·스냅샷 공용 — 뷰어에게 제공하는 목록 필드만 남긴다(표시·피벗에 실제로 쓰는 것만, 접수내용은 PII 마스킹·민원 제외).
// 원본 행에는 status·completionDate·receiptNo·siteCode 등이 더 있으나 미처리 목록에서는 쓰지 않아 제외 — 데이터량 직결.
function slimUL(ul){return (ul||[]).map(i=>({building:i.building,unit:i.unit,receiptDate:i.receiptDate,defectClass:i.defectClass,space:i.space,trade:i.trade,defectType:i.defectType,receiptContent:maskPII(String(i.receiptContent||'')),saleStatus:i.saleStatus,repairParty:i.repairParty,contractor:i.contractor,repairContractor:i.repairContractor,delayDays:i.delayDays}));}
// 장기미처리(lul)는 ul의 부분집합이라 싣지 않고 열 때 파생한다(_calcImpl과 동일 산식 · 게시본·스냅샷 공용).
function deriveLul(k){
  if(!k||(Array.isArray(k.lul)&&k.lul.length))return;
  if(!Array.isArray(k.ul)||!k.ul.length||!k.rmEnd)return;
  const _dB=(a,b)=>{const da=new Date(a),db=new Date(b);return Math.max(0,Math.round((db-da)/86400000));};
  k.lul=k.ul.filter(i=>_dB(i.receiptDate,k.rmEnd)>=30);
}

// ===== 이벤트 위임 인프라 (인라인 핸들러 제거 기반) =====
// 인라인 on*= 대신 요소에 data-act + 의미 data-* 속성을 부여하고, 문서 루트의 위임 리스너 1개가
// closest('[data-act]')로 대상을 찾아 디스패치한다. 동적 innerHTML로 요소가 재생성돼도 위임은
// 루트에 고정이라 재바인딩이 불필요하다.



// AI 분석 HTML은 고정 색(#C0392B 등)으로 저장·게시된다 — 다크 모드에서 읽히도록 '표시할 때만' 토큰으로 바꾼다.
//   저장물은 손대지 않으므로 과거 게시본도 그대로 적용된다.
const AI_COLOR_MAP={'#c0392b':'var(--rd)','#1a7a3c':'var(--gn)','#a0590a':'var(--am)','#d97706':'var(--am)',
                    '#3e71d2':'var(--bt1)','#3259b6':'var(--bt1)','#1f2b4c':'var(--bt2)',
                    '#1c1c1e':'var(--lbl)','#6e6e73':'var(--lbl2)','#333':'var(--lbl)','#444':'var(--lbl)'};
function themeHTML(html){
  return String(html||'').replace(/color:\s*(#[0-9a-fA-F]{3,6})/g,(m,hex)=>{
    const t=AI_COLOR_MAP[hex.toLowerCase()];return t?('color:'+t):m;
  });
}
// ── 다크 모드 — 토큰만 갈아끼우는 방식(개별 규칙 수정 없음). 선택은 이 PC의 브라우저에만 저장.
//   인쇄는 @media print에서 항상 밝은 값으로 강제하므로 출력물은 영향 없음.
function isDark(){try{return localStorage.getItem('theme')==='dark';}catch(_){return false;}}
function applyTheme(dark){
  document.documentElement.classList.toggle('dark',!!dark); // :root에 걸어야 cvar()가 읽는 CSS 변수까지 바뀐다
  try{dark?localStorage.setItem('theme','dark'):localStorage.removeItem('theme');}catch(_){}
  const c=document.getElementById('darkChk');if(c)c.checked=!!dark;
  {const u=document.getElementById('thIcon');if(u)u.setAttribute('href',dark?'#i-moon':'#i-sun');   // 현재 모드를 아이콘으로 표시(해=라이트, 달=다크)
   const b=document.querySelector('.sb-th1');if(b){b.dataset.tt='라이트/다크 모드';}}
  fireHook('theme.changed',!!dark);   // 차트 재렌더는 boot가 받아서 처리
}
// ── 빌드 식별자 ──
//   화면에 뜬 것이 '어느 배포본'인지 알 수 있어야 진단이 싸진다(캐시된 옛 버전 vs 실제 버그 구분).
//   배포 때마다 이 값을 올린다 — 안 올리면 CI(tests/build.mjs)가 실패한다.
const BUILD='2026-08-03.1';

// ── 오류 기록 ──
//   catch가 콘솔에만 남기면 뷰어(팀원)는 고장을 영영 모른다.
//   여기 모아두고, 화면에는 한 번만 조용히 알린 뒤 설정에서 내용을 복사해 담당자에게 전달할 수 있게 한다.
const ERRLOG=[];
const CRLF_='\n';
let _errToasted=false;
function logErr(where,e){
  const msg=(e&&(e.message||e.reason&&e.reason.message))||String(e&&e.reason||e||'');
  ERRLOG.push({t:new Date().toISOString().slice(11,19),where:String(where||''),msg:msg.slice(0,300)});
  if(ERRLOG.length>50)ERRLOG.shift();
  try{console.error('['+where+']',e);}catch(_){}
  if(!_errToasted){
    _errToasted=true;
    setTimeout(()=>{try{toast('일부 기능 오류 · Ctrl+F5 새로고침 · 계속되면 담당자에게 알릴 것',8000);}catch(_){}},400);
  }
}
function errLogText(){
  return 'build '+BUILD+' · '+navigator.userAgent+CRLF_+ERRLOG.map(x=>`[${x.t}] ${x.where}: ${x.msg}`).join(CRLF_);
}
window.addEventListener('error',e=>logErr('window',e.error||e.message));
window.addEventListener('unhandledrejection',e=>logErr('promise',e));

// ── 자연어 찾기(해석) ──
//   외부 API를 쓰지 않는다. 사전은 화면에 있는 현장·공종에서 그때그때 만들고,
//   해석기는 '조건'만 만든다. 세는 일은 앱이 하므로 숫자를 지어낼 수 없다.
const NLQ_JOSA=/(에서|으로|에게|까지|부터|이랑|하고|이야|인거|인 거|랑|만|도|은|는|이|가|을|를|의|에|로|와|과)$/;
const NLQ_NOISE=/^(거|것|좀|중|해줘|알려줘|보여줘|찾아줘|줘|해|목록|건|개|다|전부|모두|세대|어때|뭐|얼마나|건수|몇)$/;
const NLQ_SYN={
  vac:['공가세대','공가','빈집'], shop:['상가','근생'],
  old:['오래된 순','오래된순','지연 순','지연순','밀린 순','오래된'], recent:['최신순','최근 순','최근순'],
  done:['처리완료','완료된','완료']
};
// 사전 — 현장·공종 이름에서 '부를 만한 이름'을 자동으로 뽑는다.
//   "힐스테이트 두정역" → 힐스테이트 두정역 · 두정역 · 두정 로도 찾히게.
//   단, 여러 현장이 공유하는 말(브랜드명 등)은 어느 현장인지 못 정하므로 조건에서 뺀다.
function _nlqKeys(names){
  const cand=new Map();
  const add=(k,n)=>{ k=(k||'').trim(); if(k.length<2)return;
    if(!cand.has(k))cand.set(k,new Set()); cand.get(k).add(n); };
  names.forEach(n=>{
    add(n,n);
    n.split(/[\s·,()\-\/]+/).forEach(w=>{ add(w,n); add(w.replace(/(역|지구|시티|아파트|단지|차)$/,''),n); });
    (n.match(/[가-힣]{2,}/g)||[]).forEach(w=>{ add(w,n); add(w.replace(/(역|지구|시티|아파트|단지|차)$/,''),n); });
  });
  const uniq=[],ambig=[];
  cand.forEach((set,k)=>{ if(set.size===1)uniq.push([k,[...set][0]]); else ambig.push(k); });
  uniq.sort((a,b)=>b[0].length-a[0].length);
  ambig.sort((a,b)=>b.length-a.length);
  return {keys:uniq,ambig:ambig};
}
function nlqDict(){
  const sites=(typeof dashSites==='function'?dashSites():(S.sites||[])).map(s=>s.name).filter(Boolean);
  const tr=new Set();
  (S.sites||[]).forEach(s=>((S.def&&S.def[s.id])||[]).forEach(r=>{ if(r.trade)tr.add(r.trade); }));
  const A=_nlqKeys([...new Set(sites)]), B=_nlqKeys([...tr]);
  return {siteKeys:A.keys, siteAmbig:A.ambig, tradeKeys:B.keys, tradeAmbig:B.ambig};
}
function nlqParse(q,dict){
  const D=dict||nlqDict();
  let s=' '+String(q||'').trim()+' ';
  const R={site:null,trades:[],delay:null,vac:false,shop:false,dong:null,ho:null,sort:null,doneAsked:false};
  const rx=v=>new RegExp(v.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'g');
  const eat=(re,fn)=>{ s=s.replace(re,(...a)=>{ fn(...a); return ' '; }); };
  eat(/(\d+)\s*일\s*(이상|넘는|넘은|넘어|초과)/g,(m,n)=>R.delay={op:'gte',n:+n});
  eat(/(\d+)\s*일\s*(미만|이내|이하)/g,(m,n)=>R.delay={op:'lt',n:+n});
  eat(/장기\s*미?처리?/g,()=>{ R.delay=R.delay||{op:'gte',n:30}; });
  eat(/미처리/g,()=>{});                     // 목록 자체가 미처리라 조건이 아니다
  eat(/(\d+)\s*동/g,(m,n)=>R.dong=String(+n));
  eat(/(\d+)\s*호/g,(m,n)=>R.ho=String(+n));
  NLQ_SYN.done.forEach(v=>eat(rx(v),()=>R.doneAsked=true));
  NLQ_SYN.vac.forEach(v=>eat(rx(v),()=>R.vac=true));
  NLQ_SYN.shop.forEach(v=>eat(rx(v),()=>R.shop=true));
  NLQ_SYN.old.forEach(v=>eat(rx(v),()=>R.sort='old'));
  NLQ_SYN.recent.forEach(v=>eat(rx(v),()=>R.sort='new'));
  D.tradeKeys.forEach(kv=>eat(rx(kv[0]),()=>{ if(!R.trades.includes(kv[1]))R.trades.push(kv[1]); }));
  D.siteKeys.forEach(kv=>eat(rx(kv[0]),()=>{ R.site=R.site||kv[1]; }));
  // 여러 현장이 함께 쓰는 말은 조건이 되지 못한다 — 못 알아들은 말로 보고하지 말고 따로 알린다
  D.siteAmbig.concat(D.tradeAmbig).forEach(v=>eat(rx(v),()=>{ R.ambig=v; }));
  // 남은 말은 버리지 않고 '본문 검색어'로 쓴다 — 접수내용·하자유형·공간·업체까지 훑는다
  R.text=s.split(/[\s,·]+/).map(w=>w.replace(NLQ_JOSA,'').trim()).filter(w=>w&&!NLQ_NOISE.test(w));
  R.empty=!(R.site||R.trades.length||R.delay||R.vac||R.shop||R.dong||R.ho||R.text.length);
  return {R};   // 본문 검색어는 R.text 하나로 전달
}
// 해석 결과를 사람이 읽는 조건 칩으로
function nlqChips(R){
  const c=[];
  if(R.site)c.push(['현장',R.site]);
  if(R.trades.length)c.push(['공종',R.trades.join(', ')]);
  if(R.delay)c.push(['지연',R.delay.op==='gte'?(R.delay.n+'일 이상'):(R.delay.n+'일 미만')]);
  if(R.vac)c.push(['구분','공가세대']);
  if(R.shop)c.push(['구분','상가']);
  if(R.dong)c.push(['동',R.dong+'동']);
  if(R.ho)c.push(['호',R.ho+'호']);
  if(R.text&&R.text.length)c.push(['내용',R.text.join(' ')]);
  if(R.sort)c.push(['정렬',R.sort==='old'?'오래된 순':'최근 순']);
  return c;
}
// 조건으로 행 거르기 — 목록 창의 필터와 같은 필드를 본다
function nlqApply(rows,R){
  const out=(rows||[]).filter(r=>{
    if(R.site&&(r.siteName||'')!==R.site)return false;
    if(R.trades.length&&!R.trades.includes(r.trade||'기타'))return false;
    if(R.co&&(r.contractor||'(미기재)')!==R.co)return false;   // 업체별 표에서 목록을 열 때
    if(R.dong&&String(r.building||'').replace(/[^0-9]/g,'')!==R.dong)return false;
    if(R.ho&&String(r.unit||'').replace(/[^0-9]/g,'')!==R.ho)return false;
    if(R.vac&&!isVacUnit(r))return false;
    if(R.shop&&!r.__hc)return false;
    if(R.delay){ const d=Number(r.delayDays)||0;
      if(R.delay.op==='gte'&&!(d>=R.delay.n))return false;
      if(R.delay.op==='lt'&&!(d<R.delay.n))return false; }
    if(R.text&&R.text.length){
      const hay=[r.siteName,r.building,r.unit,r.space,r.trade,r.defectType,r.receiptContent,
                 r.defectClass,r.saleStatus,r.repairParty,r.contractor,r.repairContractor,r.receiptDate]
                .filter(Boolean).join(' ').toLowerCase();
      for(const w of R.text){ if(hay.indexOf(w.toLowerCase())<0)return false; }   // 모두 포함(AND)
    }
    return true;
  });
  if(R.sort==='old')out.sort((a,b)=>(Number(b.delayDays)||0)-(Number(a.delayDays)||0));
  else if(R.sort==='new')out.sort((a,b)=>(Number(a.delayDays)||0)-(Number(b.delayDays)||0));
  return out;
}

// 최근 검색 기록 — 이 PC의 브라우저에만 남는다(팀 공유 아님).
const NLQ_HKEY='nlqHist', NLQ_HMAX=8;
function nlqHist(){ try{ const a=JSON.parse(localStorage.getItem(NLQ_HKEY)||'[]'); return Array.isArray(a)?a.slice(0,NLQ_HMAX):[]; }catch(_){ return []; } }
function nlqHistAdd(q){
  q=String(q||'').trim(); if(q.length<2)return;
  try{ const a=nlqHist().filter(x=>x!==q); a.unshift(q); localStorage.setItem(NLQ_HKEY,JSON.stringify(a.slice(0,NLQ_HMAX))); }catch(_){}
}
function nlqHistDel(q){ try{ localStorage.setItem(NLQ_HKEY,JSON.stringify(nlqHist().filter(x=>x!==q))); }catch(_){} }
function nlqHistClear(){ try{ localStorage.removeItem(NLQ_HKEY); }catch(_){} }

// ── 계층 훅 ──
//   아래 계층(core·data)이 위 계층(view·boot)의 함수를 직접 부르면 의존 방향이 뒤집힌다.
//   그래서 아래는 '알리기만' 하고(fireHook), 위가 '받아서 처리한다'(onHook). 등록은 boot에서 한 곳에 모아둔다.
const HOOKS={};
function onHook(name,fn){(HOOKS[name]=HOOKS[name]||[]).push(fn);}
function fireHook(name){const a=Array.prototype.slice.call(arguments,1);
  (HOOKS[name]||[]).forEach(f=>{try{f.apply(null,a);}catch(e){console.warn('[hook] '+name,e);}});}

// ── 도메인 계산(순수 함수) ──
function _ruleFind(id){for(const g of RULE_DEF)for(const r of g.rules)if(r.id===id)return r;for(const r of CRIT_DEF)if(r.id===id)return r;return null;}

function ruleVal(id){const r=_ruleFind(id);return r?r.d:'';}

function critKwRegex(id,flags){const k=id+'|'+(flags||'');if(k in _critRxCache)return _critRxCache[k];const v=String(ruleVal(id)||'').split(',').map(x=>x.trim()).filter(Boolean);let rx=null;if(v.length){try{rx=new RegExp(v.map(x=>x.replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/\s+/g,'\\s*')).join('|'),flags||'');}catch(e){rx=null;}}_critRxCache[k]=rx;return rx;}

function critLongLen(){const n=parseInt(ruleVal('c_long'),10);return (isFinite(n)&&n>0)?n:80;}

// 게시·스냅샷 캡처용 — 확장 상태(.exp)·상세(.insd)와 DOM 부착 토글 속성을 제거한 정적 HTML
function insCleanHTML(){const el=document.getElementById('d-insight');if(!el)return '';const c=el.cloneNode(true);c.querySelectorAll('.insd').forEach(x=>x.remove());c.querySelectorAll('.ic').forEach(x=>{x.classList.remove('exp');x.removeAttribute('data-act');x.removeAttribute('data-instt');x.removeAttribute('role');x.removeAttribute('tabindex');x.removeAttribute('aria-expanded');});c.classList.remove('ins-open');return c.innerHTML;}

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

function wk(d){if(!d)return null;const m=String(d).match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);if(!m)return null;const dt=new Date(Date.UTC(+m[1],+m[2]-1,+m[3]));if(isNaN(dt))return null;const sunOff=(7-dt.getUTCDay())%7;const sun=new Date(dt.getTime()+sunOff*86400000);return `${sun.getUTCFullYear()}-${String(sun.getUTCMonth()+1).padStart(2,'0')}-${String(sun.getUTCDate()).padStart(2,'0')}`;}

function isCritCandidate(i){return critReason(i).length>0;}

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
  // 시공업체별 집계(coAgg) — 같은 원본을 업체로 묶은 것. 표의 축 전환에 쓰이고 게시본에도 실려 뷰어가 같은 표를 본다.
  //   업체가 비어 있는 행은 '(미기재)'로 따로 센다 — 숨기면 합계가 안 맞는다.
  const _com={};
  for(const i of all){
    if(i.receiptDate>rmEnd)continue;
    const c=i.contractor||'(미기재)';
    const o=_com[c]||(_com[c]={c,r:0,res:0,u:0,lt:0,d0:0,d30:0,d60:0,tr:{},pu:0,plt:0});
    o.r++;
    const done=i.status==='처리'&&i.completionDate&&i.completionDate<=rmEnd;
    if(done)o.res++;else{o.u++;const dd=daysBetween(i.receiptDate,rmEnd);if(dd>=60){o.d60++;o.lt++;}else if(dd>=30){o.d30++;o.lt++;}else o.d0++;}
    const tr=i.trade||'기타';o.tr[tr]=(o.tr[tr]||0)+1;
  }
  for(const i of all){
    if(i.receiptDate>pmEnd)continue;
    const o=_com[i.contractor||'(미기재)'];if(!o)continue;
    const done=i.status==='처리'&&i.completionDate&&i.completionDate<=pmEnd;
    if(!done){o.pu++;if(daysBetween(i.receiptDate,pmEnd)>=30)o.plt++;}
  }
  const coAgg=Object.values(_com).sort((a,b)=>b.u-a.u).map(o=>({c:o.c,r:o.r,res:o.res,u:o.u,lt:o.lt,d0:o.d0,d30:o.d30,d60:o.d60,trTop:Object.entries(o.tr).sort((a,b)=>b[1]-a[1])[0]?.[0]||'-',trN:Object.keys(o.tr).length,pu:o.pu,plt:o.plt}));
  return{tR,res,unr,rate,lt,ltr,prev:{total:pT,res:pRes,unr:pUnr,rate:pRate,lt:pLt,ltr:pLtr,dd:[pd0,pd30,pd60]},weekly:calcW(ref,rmEnd,pmEnd),monthly:calcMo(all),top,topPrev,topLt,topLtPrev,dd:[d0,d30,d60],vT,vRes,vUnr,vRate,vLt,vUnits,vTop,vTopPrev,vacU,vacS,rpb,dtb,critT,critUnr,critPrevUnr,critUl,rm,pm,rmEnd,pmEnd,ul,lul,trAgg,coAgg};
}

// 상가 표기 감지 — 동/호 오타 변형 포함 ([강산살상성싱]+[가거기], 뒤에 숫자 허용)
// 상가 라벨 판별 — '상가'와 업로드 데이터에서 실제 관찰된 오타 변형을 넓게 매칭.
//   수용 리스크: 문자클래스 조합상 '살기' 등 우연 조합도 매치되지만, 검사 대상이 동·호 필드
//   (isVacStore에서 hasCommercial 현장 + 공용 하자 한정)라 실데이터 오탐 개연성은 낮음.
function isStoreLabel(s){return /[강산살상성싱][가거기]/.test(String(s||''));}

// capAm: 기준월말 시점 미처리 공종 분포 — rChartsImpl/buildSiteTradeDonut의 도넛 데이터와 동일 수식.
function capAm(defs,rm){
  const _rmP=rm.split('-').map(Number),_rmEnd=`${rm}-${String(new Date(_rmP[0],_rmP[1],0).getDate()).padStart(2,'0')}`;
  const am={};(defs||[]).filter(i=>i.receiptDate&&i.receiptDate<=_rmEnd&&!(i.status==='처리'&&i.completionDate&&i.completionDate<=_rmEnd)).forEach(i=>{am[i.trade||'기타']=(am[i.trade||'기타']||0)+1;});
  return am;
}

//   집계·판정 로직. DOM을 만지지 않으며 data·view·boot가 모두 쓰므로 최하위에 둔다.
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

// 공가세대/공가상가 하자건 판정 (둘 중 하나라도 해당하면 공가 건)
// - 공가세대 하자: (모든 현장) 하자구분='세대' AND 입주상태∈{미분양,미납}
// - 공가상가 하자: (공가상가 포함 현장만) 하자구분='공용' AND (동 또는 호에 상가 표기)
function isVacUnit(item){return item.defectClass==='세대'&&(item.saleStatus==='미분양'||item.saleStatus==='미납');}

function isVacStore(item,site){return !!site?.hasCommercial&&item.defectClass==='공용'&&(isStoreLabel(item.building)||isStoreLabel(item.unit));}

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

function maskPII(s){
  return String(s==null?'':s)
    .replace(/01[016789][ .-]?\d{3,4}[ .-]?\d{4}\b/g,'010-****-****')
    .replace(/\b0\d{1,2}[ .-]\d{3,4}[ .-]\d{4}\b/g,'0**-***-****')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,'***@***')
    .replace(/([가-힣]{2,4})(님|씨)(?![가-힣])/g,(m,name,h)=>_PII_ROLE.has(name)?m:'○○'+h);
  // 알려진 한계: '홍길동님이'처럼 님/씨 뒤에 조사가 바로 붙으면 매치하지 않음(의도 — 완화 시 '날씨가' 등
  // 일반 어휘 오탐이 발생). 인명 마스킹은 best-effort이며 고위험 PII(전화·이메일)는 위 규칙이 전담.
}

// ── 공용 UI 원시함수 (모달·토스트·차트 색) ──
//   상위 계층(data/view/boot)이 전부 쓰므로 최하위인 core에 둔다. 여기서 상위 함수를 부르지 않는다.
// MODAL / TOAST
// 모달 접근성: Esc 닫기 · Tab 포커스 순환(트랩) · role/aria · 열기 시 첫 포커스 이동, 닫을 때 이전 포커스 복귀
let _moPrevFocus=null,_moKeyBound=false;
function _moFocusables(){const mb=document.getElementById('mb');if(!mb)return [];return Array.prototype.slice.call(mb.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')).filter(el=>(el.offsetWidth>0||el.offsetHeight>0||el===document.activeElement));}
function _moKeydown(e){
  const mo=document.getElementById('mo');
  if(!mo||!mo.classList.contains('open'))return;
  if(e.key==='Escape'){e.preventDefault();closeMo();return;}
  if(e.key==='Tab'){
    const f=_moFocusables();if(!f.length)return;
    const first=f[0],last=f[f.length-1],a=document.activeElement,inside=mo.contains(a);
    if(e.shiftKey&&(a===first||!inside)){e.preventDefault();last.focus();}
    else if(!e.shiftKey&&(a===last||!inside)){e.preventDefault();first.focus();}
  }
}
function openMo(){
  const mo=document.getElementById('mo'),mb=document.getElementById('mb');
  if(mb)clearTimeout(mb._wideT);
  _moPrevFocus=document.activeElement;
  if(mb){mb.setAttribute('role','dialog');mb.setAttribute('aria-modal','true');mb.setAttribute('aria-labelledby','mt');if(!mb.hasAttribute('tabindex'))mb.setAttribute('tabindex','-1');}
  mo.classList.add('open');
  if(!_moKeyBound){_moKeyBound=true;document.addEventListener('keydown',_moKeydown,true);}
  // 초기 포커스는 모달 컨테이너로(첫 input에 두면 모바일에서 키보드가 즉시 떠 불편). Tab 시 내부 요소로 이동.
  setTimeout(()=>{try{if(mb&&mb.focus)mb.focus();}catch(_){}},30);
}
function closeMo(){
  const mo=document.getElementById('mo');if(mo)mo.classList.remove('open');
  if(window.__SNAPPICK__){const r=window.__SNAPPICK__;window.__SNAPPICK__=null;try{r(null);}catch(_){}} // 월 선택 대기 중이면 취소로 종결
  fireHook('modal.closed');   // 목록·피벗 메뉴 정리는 data가 받아서 처리
  window.__REC=null;
  // 닫힘 애니메이션(약 .22s)이 끝난 뒤 wide 해제 — 닫히는 도중 너비가 갑자기 줄어들지 않도록
  const mb=document.getElementById('mb');
  if(mb){mb.classList.remove('has-x');clearTimeout(mb._wideT);mb._wideT=setTimeout(()=>{mb.classList.remove('wide','narrow','rdw','wide-pick');},240);}
  try{if(_moPrevFocus&&_moPrevFocus.focus)_moPrevFocus.focus();}catch(_){}
  _moPrevFocus=null;
}
let _tt;
function toast(msg,dur){const el=document.getElementById('toast');el.classList.remove('has-action');el.textContent=msg;el.classList.add('show');clearTimeout(_tt);_tt=setTimeout(()=>el.classList.remove('show'),dur||2400);}
// 커스텀 확인 모달 + 실행취소 토스트 (네이티브 confirm 대체)
let _confirmCb=null,_undoDel=null;
function openConfirm(title,msgHTML,confirmLabel,onConfirm,danger){
  const mt=document.getElementById('mt'),mb=document.getElementById('mbody'),mf=document.getElementById('mf');
  if(!mt||!mb||!mf)return;
  mt.textContent=title;
  mb.innerHTML=`<p style="font-size:13.5px;color:var(--lbl2);line-height:1.65;margin:0">${msgHTML}</p>`;
  mf.innerHTML=`<button class="btn bg2 bsm" data-act="modal.close">취소</button><button class="btn bsm ${danger?'btn-danger':'bp'}" data-act="confirm.ok">${esc(confirmLabel)}</button>`;
  _confirmCb=onConfirm||null;
  openMo();
}
function toastAction(msg,actionLabel,onAction,dur){
  const el=document.getElementById('toast');if(!el)return;
  el.innerHTML=`<span>${esc(msg)}</span><button type="button" class="toast-btn">${esc(actionLabel)}</button>`;
  el.classList.add('show','has-action');
  const btn=el.querySelector('.toast-btn');
  const close=()=>{el.classList.remove('show','has-action');};
  if(btn)btn.onclick=()=>{close();try{onAction&&onAction();}catch(e){console.error(e);}};
  clearTimeout(_tt);_tt=setTimeout(close,dur||6000);
}
// 진행률 오버레이
function progShow(msg){const o=document.getElementById('uprog');if(!o)return;document.getElementById('uprogMsg').textContent=msg||'처리 중...';document.getElementById('uprogFill').style.width='0%';document.getElementById('uprogSub').textContent='';o.classList.add('show');}
function progSet(pct,sub){const f=document.getElementById('uprogFill');if(f)f.style.width=Math.max(0,Math.min(100,pct))+'%';if(sub!=null){const s=document.getElementById('uprogSub');if(s)s.textContent=sub;}}
function progMsg(msg){const m=document.getElementById('uprogMsg');if(m)m.textContent=msg;}
function progHide(){const o=document.getElementById('uprog');if(o)o.classList.remove('show');}
// 메인 스레드에 페인트 기회를 줘서 진행률 바가 실제로 갱신되게 함
function nextFrame(){return new Promise(r=>{let done=false;const fin=()=>{if(done)return;done=true;r();};requestAnimationFrame(()=>requestAnimationFrame(fin));setTimeout(fin,60);});}
// ── 차트 색상 ──
function chartInk(){return cvar('--lbl','#1C1C1E');}
function chartGrid(){return cvar('--ch-grid','rgba(0,0,0,.05)');}
function chartAxisTitle(){return cvar('--ch-axis','rgba(60,60,67,.42)');}
function chartSegBorder(){return cvar('--bg2','#fff');} // 다크에서는 카드 배경색 — 흰 테두리가 눈에 튀지 않도록
function dlBlue(){return cvar('--ch-dlr','#2C437C');}
function dlAmber(){return cvar('--ch-dld','#A0590A');}
function dlInk(){return cvar('--lbl','#1C1C1E');}
function dlStroke(){return cvar('--bg2','#fff');} // 라벨 외곽선 = 배경색
// 추이차트 데이터라벨 자동 조절 — 막대 실폭(catW)에 맞춰 폰트 크기·표시 정책 결정.
// 주차가 많아 막대가 좁아지면: 폰트 축소 → 막대 안 분해값(장기/일반) 생략 → 막대 위 총합 격주 표시.
// chartArea가 아직 없는 첫 프레임은 opacity 0이라 화면엔 안 보이므로 fallback 값으로 안전.
function moDLCfg(ctx){
  const ca=ctx.chart.chartArea,n=(ctx.chart.data.labels||[]).length||1;
  const catW=(ca&&ca.width)?ca.width/n:60;
  const size=catW>=50?11:catW>=42?10:catW>=34?9:catW>=27?8:7;
  return {size,catW,showInner:catW>=46,totalEvery:catW>=26?1:2};
}
// 도넛 팔레트 — 라이트·다크 동일(테마별로 색이 달라지면 같은 현장이 다른 색으로 보임)
function donutPalette(){return ['#1F2B4C','#2C437C','#304D9D','#3259B6','#3E71D2','#538CDE','#74ABE6','#A0C8F0','#C7DDF6','#DFEBFA','#EAF2FC','#B3C7DD'];} // 테마 무관 고정 — 같은 현장이 어디서나 같은 색

function applyChartTheme(){if(typeof Chart==='undefined')return;Chart.defaults.color=chartInk();Chart.defaults.borderColor=chartGrid();}

// ── 라이브러리 보장 — vendor/ 로컬 로드가 실패하면(미배포·경로 오류) CDN에서 한 번 더 시도한다.
//   과거 사고: vendor/ 폴더를 커밋하지 않아 4종이 404 → LZString 부재로 로컬 데이터가 '압축 해제 없이'
//   JSON.parse 되어 원인 불명 오류가 쏟아졌다. 실패를 조용히 넘기지 않고 명확히 알린다.
const VENDOR_LIBS=[
  {g:'LZString',        url:'https://cdn.jsdelivr.net/npm/lz-string@1.5.0/libs/lz-string.min.js',                             sri:'sha384-0d+Gr7vM4Drod8E3hXKgciWJSWbjD/opKLLygI9ktiWbuvlDwQLzU46wJ9s5gsp7', name:'데이터 압축'},
  {g:'DOMPurify',       url:'https://cdn.jsdelivr.net/npm/dompurify@3.2.4/dist/purify.min.js',                                 sri:'sha384-eEu5CTj3qGvu9PdJuS+YlkNi7d2XxQROAFYOr59zgObtlcux1ae1Il3u7jvdCSWu', name:'HTML 살균'},
  {g:'Chart',           url:'https://cdn.jsdelivr.net/npm/chart.js@4.5.1/dist/chart.umd.min.js',                               sri:'sha384-jb8JQMbMoBUzgWatfe6COACi2ljcDdZQ2OxczGA3bGNeWe+6DChMTBJemed7ZnvJ', name:'차트'},
  {g:'ChartDataLabels', url:'https://cdn.jsdelivr.net/npm/chartjs-plugin-datalabels@2.2.0/dist/chartjs-plugin-datalabels.min.js', sri:'sha384-y49Zu59jZHJL/PLKgZPv3k2WI9c0Yp3pWB76V8OBVCb0QBKS8l4Ff3YslzHVX76Y', name:'차트 라벨'},
];
function loadScriptOnce(url,integrity){
  return new Promise((res,rej)=>{
    const s=document.createElement('script');
    s.src=url;if(integrity){s.integrity=integrity;s.crossOrigin='anonymous';}
    s.onload=()=>res(true);s.onerror=()=>rej(new Error('load fail '+url));
    document.head.appendChild(s);
  });
}
async function ensureVendors(){
  const missing=VENDOR_LIBS.filter(l=>typeof window[l.g]==='undefined');
  if(!missing.length)return [];
  console.warn('[vendor] 로컬 로드 실패 — CDN 폴백 시도:',missing.map(l=>l.g).join(', '));
  for(const l of missing){
    try{await loadScriptOnce(l.url,l.sri);}catch(e){console.error('[vendor] 폴백 실패',l.g,e);}
  }
  const still=VENDOR_LIBS.filter(l=>typeof window[l.g]==='undefined');
  if(still.length){
    const names=still.map(l=>l.name).join(', ');
    setTimeout(()=>{try{toast('필수 라이브러리 로드 실패('+names+') · vendor 폴더가 배포되었는지, 사내망이 CDN을 막는지 확인하세요',9000);}catch(_){}} ,600);
  }
  return still;
}
// ── 새 모듈 전환 절차(2단계) ──
//   ① 마크업: on*="fn(args)" 제거 → data-act="모듈.액션" 부여 (+ 필요한 의미 data-* 부여, 동적값은 esc())
//   ② 등록:   registerActions('click'|'input'|'change'|'keydown', {'모듈.액션': (el,e)=>{ ... }})
//   this.value→el.value, this.checked→el.checked, event→e, this(요소)→el 로 매핑.
const _DELEGATED = Object.create(null);
function registerActions(type, map){
  if(!_DELEGATED[type]) _DELEGATED[type] = Object.create(null);
  Object.assign(_DELEGATED[type], map);
}
function _delegate(type, e){
  const t = e.target;
  if(!t || !t.closest) return;
  const el = t.closest('[data-act]');
  if(!el) return;
  const fn = _DELEGATED[type] && _DELEGATED[type][el.dataset.act];
  if(fn){ fn(el, e); return; }
  // 키보드 접근성: 전용 keydown 핸들러가 없는 data-act 요소에서 Enter/Space를 클릭 핸들러로 승격.
  //   tabindex 부여 요소 한정 + 폼 컨트롤·링크·버튼 제외(네이티브 동작 보존, Space 스크롤 오발동 방지).
  if(type==='keydown'&&(e.key==='Enter'||e.key===' ')&&el.hasAttribute('tabindex')){
    const tg=e.target.tagName;
    if(tg==='INPUT'||tg==='TEXTAREA'||tg==='SELECT'||tg==='BUTTON'||tg==='A'||e.target.isContentEditable)return;
    const cfn=_DELEGATED['click']&&_DELEGATED['click'][el.dataset.act];
    if(cfn){e.preventDefault();cfn(el,e);}
  }
}
let _delegationBound = false;
function bindDelegatedEvents(){
  if(_delegationBound) return; _delegationBound = true;
  ['click','input','change','keydown','dragover','dragleave','drop'].forEach(type=>{
    document.addEventListener(type, e=>_delegate(type, e));
  });
}

// ── [전환 완료] 내비게이션 모듈 ── (정적 사이드바 + 동적 rNav 항목)
// 처리계획 textarea 자동 높이 확장 — 엔터로 줄바꿈하면 즉시 키워지고, 내용 줄어들면 다시 축소.
function autoResize(el){if(el.offsetParent===null)return;el.style.height='auto';el.style.height=el.scrollHeight+'px';} // 숨김(display:none) 상태면 측정 불가 — 붕괴 방지 위해 생략
// 준공일 등 date 입력 — 연도가 4자리를 넘으면 4자리로 절삭
function clampYear(el){const v=el.value;if(!v)return;const m=v.match(/^(\d+)(-\d{2}-\d{2})$/);if(m&&m[1].length>4){el.value=m[1].slice(0,4)+m[2];}}
function autoSizeAll(root){(root||document).querySelectorAll('textarea.plan-ta').forEach(autoResize);}
function pM(ym){const[y,m]=ym.split('-').map(Number);return m===1?`${y-1}-12`:`${y}-${String(m-1).padStart(2,'0')}`;}
// 추이차트 툴팁 positioner — 호버한 요소(막대·선) 중 가장 위쪽 위에 일정 간격 띄움 (선이 막대보다 위에 있어도 가리지 않게)
if(typeof Chart!=='undefined'&&Chart.Tooltip&&!Chart.Tooltip.positioners.aboveAll){
  Chart.Tooltip.positioners.aboveAll=function(items,evt){
    if(!items.length)return false;
    let minY=Infinity,sumX=0;
    for(const it of items){const p=it.element.tooltipPosition();if(p.y<minY)minY=p.y;sumX+=p.x;}
    const x=sumX/items.length;
    const y=Math.max(this.chart.chartArea.top+4,minY-16);
    return{x,y};
  };
}

// 추이차트 표시연도 — 데이터에 존재하는 접수연도 + 기준월 연도(+최소 2026). 누계값은 cutoff 시점 전체 기준이라
// 시작연도만 바꿔도 전년도 이월 미처리가 그대로 반영된다.
function trendYearInfo(defs,stateKey){
  const ys=new Set();
  for(const i of defs){if(i&&i.receiptDate&&/^\d{4}/.test(i.receiptDate))ys.add(i.receiptDate.slice(0,4));}
  ys.add('2026');const curY=S.rm.slice(0,4);ys.add(curY);
  const years=[...ys].sort();const sel=S[stateKey];
  const year=(sel&&years.includes(sel))?sel:(years.includes(curY)?curY:years[years.length-1]);
  return {year,years};
}
function trendYrOptions(info){return info.years.map(y=>`<option value="${y}" ${y===info.year?'selected':''}>${y}년</option>`).join('');}
