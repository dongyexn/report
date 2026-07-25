// ─────────────────────────────────────────────────────────────────────────────
// app-core.js — 상태(S)·공용 유틸·이벤트 액션 디스패처와 등록. 다른 파일이 모두 여기에 의존하므로 가장 먼저 로드한다.
//   빌드 없이 여러 <script>로 나눠 로드한다(순서 고정: core → data → view → boot).
//   함수 선언은 전역에 올라가므로 파일 간 호출은 자유롭지만, **최상위 실행문은 순서에 의존**한다.
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
// 팀/현장 모델 보정: 팀이 없으면 기존 현장으로부터 기본 팀 구성(권역은 실제 현장 데이터에서 도출), 현장에 teamId 부여
function ensureTeams(){
  if(!Array.isArray(S.teams))S.teams=[];
  const orphanRegions=new Set();
  S.sites.forEach(s=>{if(!s.teamId)orphanRegions.add(s.region||'');});
  if(!S.teams.length){
    const t=makeDefaultTeam();
    orphanRegions.forEach(r=>{if(r&&!t.regions.includes(r))t.regions.push(r);});
    if(Array.isArray(S.regionOrder)&&S.regionOrder.length)t.regionOrder=S.regionOrder.slice();
    S.teams=[t];
  }
  if(!S.teamId||!S.teams.some(t=>t.id===S.teamId))S.teamId=S.teams[0].id;
  S.teams.forEach(tm=>{if(Array.isArray(tm.regions)&&tm.regions.includes(PERM_REGION))tm.regions=tm.regions.filter(r=>r!==PERM_REGION);});
  const fid=S.teams[0].id;
  const validIds=new Set(S.teams.map(t=>t.id));
  let changed=false;
  S.sites.forEach(s=>{if(!s.teamId||!validIds.has(s.teamId)){s.teamId=fid;changed=true;}});
  if(changed)lsSave();
}
function switchTeam(id){
  if(!S.teams.some(t=>t.id===id))return;
  S.teamId=id;S.smsort=null;S.dsort=null;
  if(S.view==='site'&&!teamSites().some(s=>s.id===S.sid)){go('dashboard');}
  else{rTeamSel();rNav();if(S.view==='manage')rManage();else rSMgr();if(S.view==='dashboard')rDash();if(S.view==='settings')loadSettings();}
}
// 사용자(viewer)는 현장/팀/권역 구조를 변경할 수 없음(읽기 전용). 관리자·로컬 모드만 변경 가능.
function manageLocked(){try{return FB2.role==='viewer';}catch(e){return false;}}
function addTeam(name){
  if(manageLocked()){toast('보기 전용입니다 · 관리자만 변경할 수 있습니다');return null;}
  name=(name||'').trim();if(!name){toast('팀 이름을 입력하세요');return null;}
  if(S.teams.some(t=>t.name===name)){toast('같은 이름의 팀이 있습니다');return null;}
  const t={id:uid('t'),name,regions:[],regionOrder:[]};
  S.teams.push(t);lsSave();return t;
}
function renameTeam(id,name){if(manageLocked())return;name=(name||'').trim();if(!name)return;const t=S.teams.find(x=>x.id===id);if(!t)return;t.name=name;lsSave();rTeamSel();}
function deleteTeam(id){
  if(manageLocked()){toast('보기 전용입니다 · 관리자만 변경할 수 있습니다');return;}
  if(S.teams.length<=1){toast('마지막 팀은 삭제할 수 없습니다');return;}
  const t=S.teams.find(x=>x.id===id);if(!t)return;
  const cnt=S.sites.filter(s=>s.teamId===id).length;
  openConfirm('팀 삭제',`<b>${esc(t.name)}</b> 팀을 삭제합니다.${cnt?` 소속 현장 <b>${cnt}개</b>와 하자 데이터도 함께 삭제됩니다.`:''}`,'삭제',()=>doDeleteTeam(id),true);
}
function doDeleteTeam(id){
  const t=S.teams.find(x=>x.id===id);if(!t)return;
  if(S.teams.length<=1)return;
  S.sites.filter(s=>s.teamId===id).forEach(s=>{delete S.def[s.id];delete S.cmt[s.id];delete S.ana[s.id];defDelete(s.id);});
  S.sites=S.sites.filter(s=>s.teamId!==id);
  S.teams=S.teams.filter(x=>x.id!==id);
  if(S.teamId===id)S.teamId=S.teams[0].id;
  lsSave();
  rTeamSel();rNav();if(S.view==='manage')rManage();else rSMgr();if(S.view==='dashboard')rDash();toast('팀 삭제됨');
}
function addRegion(name){if(manageLocked()){toast('보기 전용입니다 · 관리자만 변경할 수 있습니다');return;}const t=curTeam();if(!t)return;name=(name||'').trim();if(!name){toast('권역 이름을 입력하세요');return;}if(name===PERM_REGION){toast('고정 권역입니다');return;}if(t.regions.includes(name)){toast('이미 있는 권역입니다');return;}t.regions.push(name);lsSave();rNav();rSMgr();}
function renameRegion(oldName,name){if(manageLocked())return;const t=curTeam();if(!t)return;name=(name||'').trim();if(!name||oldName===name)return;if(oldName===PERM_REGION||name===PERM_REGION){toast('고정 권역은 변경할 수 없습니다');return;}if(t.regions.includes(name)){toast('이미 있는 권역입니다');return;}const i=t.regions.indexOf(oldName);if(i<0)return;t.regions[i]=name;t.regionOrder=(t.regionOrder||[]).map(r=>r===oldName?name:r);S.sites.forEach(s=>{if(s.teamId===t.id&&s.region===oldName)s.region=name;});lsSave();rNav();rSMgr();if(S.view==='dashboard')rDash();}
function deleteRegion(name){if(manageLocked()){toast('보기 전용입니다 · 관리자만 변경할 수 있습니다');return;}const t=curTeam();if(!t)return;if(name===PERM_REGION){toast('고정 권역은 삭제할 수 없습니다');return;}const used=S.sites.filter(s=>s.teamId===t.id&&s.region===name).length;if(used){toast('현장 '+used+'개가 사용 중이라 삭제할 수 없습니다');return;}t.regions=t.regions.filter(r=>r!==name);t.regionOrder=(t.regionOrder||[]).filter(r=>r!==name);lsSave();rNav();rSMgr();}
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
function rManage(){
  const el=document.getElementById('mgcontent');if(!el)return;
  const t=curTeam();
  const teamRows=S.teams.map(tm=>{
    const cnt=S.sites.filter(s=>s.teamId===tm.id).length;
    const active=tm.id===S.teamId;
    return `<div class="tm-row${active?' act':''}"><button class="tm-pick" data-act="team.pick" data-tid="${esc(tm.id)}" data-tt="이 팀 선택" aria-label="이 팀 선택">${active?ICON_RADIO_ON:ICON_RADIO_OFF}</button><input class="mg-inp tm-nameinp" value="${esc(tm.name)}" data-act="team.rename" data-tid="${esc(tm.id)}" aria-label="팀 이름"><span class="tm-cnt">${cnt}</span><button class="tm-x tm-del" data-act="team.del" data-tid="${esc(tm.id)}" data-tt="삭제" aria-label="삭제">${ICON_TRASH}</button></div>`;
  }).join('');
  const regRows=curRegions().map(r=>{
    const used=S.sites.filter(s=>s.teamId===t.id&&s.region===r).length;
    if(r===PERM_REGION)return `<div class="tm-row tm-locked"><span class="tm-nameinp tm-lockname">${esc(r)}</span><span class="tm-cnt">${used}</span><span class="tm-x tm-lockicon" data-tt="삭제·변경할 수 없는 고정 권역 · 대시보드 집계 제외" aria-label="삭제·변경할 수 없는 고정 권역 · 대시보드 집계 제외">${ICON_LOCK}</span></div>`;
    return `<div class="tm-row"><input class="mg-inp tm-nameinp" value="${esc(r)}" data-act="region.rename" data-rgn="${esc(r)}" aria-label="권역 이름"><span class="tm-cnt">${used}</span><button class="tm-x tm-del" data-act="region.del" data-rgn="${esc(r)}" data-tt="삭제" aria-label="삭제">${ICON_TRASH}</button></div>`;
  }).join('');
  el.innerHTML=`<div class="mg-grid"><div><div class="card mb12"><div class="tm-h"><span>팀</span><button class="btn bo bsm tm-add" data-act="team.addTeam">+ 팀 추가</button></div><div class="tm-list">${teamRows}</div></div><div class="card mb12"><div class="tm-h"><span>권역 <span style="color:var(--lbl3);font-weight:500;text-transform:none;letter-spacing:0">· ${esc(t?t.name:'')}</span></span><button class="btn bo bsm tm-add" data-act="team.addRegion">+ 권역 추가</button></div><div class="tm-list">${regRows}</div></div><div class="card tm-upcard"><div class="tm-h" style="margin-bottom:12px"><span>리스트 업로드</span></div><div id="uz" class="uz" data-act="uz"><div class="uzi"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 15V3M7 8l5-5 5 5M2 20h20"></path></svg></div><div class="uzt">Excel 업로드</div><div class="uzh">HCS 전체 하자리스트 드래그 앤 드롭</div></div><input type="file" id="fi" accept=".csv,.xlsx,.xls" style="display:none" data-act="uz.file" aria-label="데이터 파일 선택"><div class="ulex-sep"></div><div><label class="il ulex-lbl" for="ulex">제외 키워드 <span style="font-weight:400;color:var(--lbl3)">· 쉼표로 구분</span></label><input class="inp" id="ulex" style="font-size:12.5px;padding:7px 10px" value="${esc(S.exTk||'')}" placeholder="예: 공가세대점검, 시범세대" data-act="set.exToken"></div></div></div><div><div class="card"><div class="tm-h"><span>현장 <span style="color:var(--lbl3);font-weight:500;text-transform:none;letter-spacing:0">· ${esc(t?t.name:'')}</span></span><button class="btn bo bsm tm-add" data-act="site.addModal">+ 현장 추가</button></div><div id="mgsites"></div></div></div></div>`;
  rSMgr();
}
function uniqName(base,existing){let n=base,i=2;const set=new Set(existing);while(set.has(n)){n=base+' '+i;i++;}return n;}
function tmAddTeam(){const name=uniqName('새 팀',S.teams.map(t=>t.name));const t=addTeam(name);if(t)switchTeam(t.id);rManage();}
function updTeamName(id,val){renameTeam(id,val);rManage();}
function tmDeleteTeam(id){deleteTeam(id);rManage();}
function tmAddRegion(){const t=curTeam();if(!t)return;const name=uniqName('새 권역',t.regions);addRegion(name);rManage();}
function updRegionName(oldR,val){renameRegion(oldR,val);rManage();}
function tmDeleteRegion(r){deleteRegion(r);rManage();}
// 현장 인라인 수정 — 리스트 행에서 바로 편집 (모달 없이)
function updSite(id,field,value){
  if(manageLocked())return;
  const s=S.sites.find(x=>x.id===id);if(!s)return;
  if(field==='units'||field==='buildings'||field==='commercialUnits')s[field]=Number(value)||0;
  else if(field==='hasCommercial'||field==='showVacant')s[field]=!!value;
  else s[field]=value;
  lsSave();
  if(field==='hasCommercial'||field==='showVacant')fb2SiteConfigWrite(id);
  rNav();
  if((field==='name'||field==='region')&&S.view==='dashboard')rDash();
  if((field==='hasCommercial'||field==='showVacant')&&S.view==='site'&&S.sid===id)rSite(id);
}
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
  if(typeof themeRefresh==='function')themeRefresh(); // 차트는 생성 시 색을 굽기 때문에 재렌더 필요
}
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
registerActions('click', {
  'nav.toggle':      ()=>toggleSB(),
  'nav.mobileOpen':  ()=>openMobileSB(),
  'nav.mobileClose': ()=>closeMobileSB(),
  'nav.region':      (el)=>tRg(el),
  'nav.go':          (el)=>go(el.dataset.view),       // 정적 항목: data-view(dashboard/manage/settings)
  'nav.site':        (el)=>go('site', el.dataset.site) // 사이트 항목: 기존 data-site 재사용
});

// ── [전환 완료] 클릭 액션 (로그인/상단바/대시보드/설정/모달/팀/현장/패널) ──
registerActions('click', {
  'auth.login':()=>fbDoLogin(), 'auth.signup':()=>fbDoSignup(), 'auth.resend':()=>fbDoResend(),
  'top.month':()=>openMP(), 'top.print':()=>doPrint(),
  'dash.ai':()=>runDashAI(), 'dash.sort':(el)=>sortDT(el.dataset.key),
  'readme.tab':(el)=>{const i=el.dataset.i;const mb=document.getElementById('mbody');if(!mb)return;
    mb.querySelectorAll('.rd-navi').forEach(b=>b.classList.toggle('act',b.dataset.i===i));
    mb.querySelectorAll('.rd-sec').forEach((s,n)=>s.classList.toggle('act',String(n)===i));
    const sc=mb.querySelector('.md-scroll');if(sc)sc.scrollTop=0;},
  'snapPick.all':()=>{document.querySelectorAll('#mbody .snap-mo').forEach(c=>{c.checked=true;});},
  'snapPick.cancel':()=>{closeMo();},
  'snapPick.ok':()=>{const box=document.querySelectorAll('#mbody .snap-mo');
    const v=Array.from(document.querySelectorAll('#mbody .snap-mo:checked')).map(c=>c.value);
    if(box.length&&!v.length){toast('기준월을 한 개 이상 선택하세요');return;}
    const fc=document.getElementById('snapFontChk'),font=!!(fc&&fc.checked);
    try{if(font)localStorage.setItem('snapFont','1');else localStorage.removeItem('snapFont');}catch(_){} // 다음 내보내기 기본값으로 기억
    const r=window.__SNAPPICK__;window.__SNAPPICK__=null;closeMo();if(r)r({months:v,font:font});},
  'snap.rm':(el)=>snapSwitchMonth(el.value),
  'set.dark':(el)=>applyTheme(el.checked),
  'set.snapshot':()=>exportSnapshot(), 'set.publish':()=>fb2Publish(), 'set.viewerMode':()=>fb2ViewAsViewer(), 'set.readme':()=>openReadme(),
  'dash.insToggle':(el)=>{const grid=el.closest('.ins-grid');if(!grid)return;const was=el.classList.contains('exp');if(!was)grid.style.height=grid.offsetHeight+'px';/* 확장 전 자연 높이(카드 3개)를 고정 — absolute 이탈로 컨테이너가 줄어드는 것 방지 */grid.querySelectorAll('.ic.exp').forEach(c=>{c.classList.remove('exp');c.dataset.tt='펼치기';c.setAttribute('aria-expanded','false');}); /* 접을 때 툴팁도 원복 — 안 하면 '접기'가 남는다 */grid.classList.remove('ins-open');if(was)grid.style.height='';{const _t=document.getElementById('htooltip');if(_t)_t.classList.remove('show');} /* 표시 중이던 툴팁은 즉시 숨김 — 다음 호버에 새 문구가 뜨도록 */if(!was){el.classList.add('exp');el.dataset.tt='접기';el.setAttribute('aria-expanded','true');grid.classList.add('ins-open');const tc=el.querySelector('.ic-t');if(tc&&!tc.querySelector('.insd'))tc.insertAdjacentHTML('beforeend',insDetailHTML(el.dataset.instt||''));/* 신뢰 코드 생성 HTML(외부 문자열 esc 처리) — safeHTML은 insd 클래스·data-act를 제거하므로 미사용 */el.scrollTop=0;}}, // 주요 이슈 카드 확장/접기 — 상세는 최초 확장 시 생성
  'dash.insCollapse':()=>insCollapseAll(), // 상세 헤더의 접기 버튼
  'dash.insTr':(el)=>openRecList('__team',el.dataset.scope||'ul',el.dataset.tr||'',''), // 상세 공종 행 → 공종 필터 팀 목록
  'dash.insList':(el)=>{openRecList('__team',el.dataset.scope||'ul','','');const R=window.__REC;if(!R)return;const k=el.dataset.fk,v=el.dataset.fv;if(k&&v!=null){R.valueFilters[k]=new Set([v]);R.filterRow=true;recRenderModalBody();}}, // 팀 목록 열고 카드 주제(보수주체·유형·업체) 필터 적용
  'modal.close':()=>closeMo(), 'modal.stop':()=>{}, 'modal.confirmSM':(el)=>confirmSM(el.dataset.sid), 'modal.applyM':()=>applyM(),
  'rec.list':(el)=>openRecList(el.dataset.sid, el.dataset.scope||'ul', el.dataset.trade||'', el.dataset.vac||''),
  'confirm.ok':()=>{const cb=_confirmCb;_confirmCb=null;closeMo();if(cb){try{cb();}catch(e){console.error(e);}}},
  'rec.pivotPct':()=>{const R=window.__REC;if(!R)return;R.showPct=!R.showPct;recRenderModalBody();},
  'rec.copyTable':()=>{const R=window.__REC;if(!R)return;
    if(R.pivotOn){ // 피벗: 렌더된 표를 그대로 탭 구분 텍스트로 (% 병기·정렬 화살표는 제거)
      const t=document.querySelector('.pv-table');if(!t){toast('복사할 표가 없습니다');return;}
      const cl=t.cloneNode(true);cl.querySelectorAll('.pv-pct').forEach(x=>x.remove());
      const lines=[...cl.rows].map(r=>[...r.cells].map(c=>c.textContent.replace(/[▲▼]/g,'').trim()).join('\t'));
      ctxCopy(lines.join('\n'),'피벗 표가 복사되었습니다 · 엑셀에 붙여넣기(Ctrl+V)');
    }else{ // 목록: 현재 필터·정렬이 적용된 전체 결과 × 보이는 컬럼
      const rows=R.view||[];if(!rows.length){toast('복사할 건이 없습니다');return;}
      const cols=recVisCols();
      const lines=[cols.map(c=>c.label).join('\t')].concat(rows.map((i,idx)=>cols.map(c=>String(c.key==='__no'?(idx+1):recCell(i,c.key)).replace(/[\t\n]+/g,' ')).join('\t')));
      ctxCopy(lines.join('\n'),'목록 '+rows.length.toLocaleString()+'건이 복사되었습니다 · 엑셀에 붙여넣기(Ctrl+V)');
    }},
  'rec.export':()=>{const R=window.__REC;if(!R)return;if(R.pivotOn){recPivotExport();return;}const rows=R.view||[];if(!rows.length){toast('내보낼 건이 없습니다');return;}const headers=recCols().map(c=>c.label);const aoa=[headers].concat(rows.map((i,idx)=>recCols().map(c=>c.key==='__no'?(idx+1):recCell(i,c.key))));exportXlsx(`미처리목록_${(R.label||'').replace(/\s+/g,'')}_${S.rm}.xlsx`,aoa,'미처리');},
  'rec.limit':(el)=>{const R=window.__REC;if(!R)return;const n=+el.dataset.n;R.limit=n||Infinity;recRenderModalBody();},
  'rec.band':(el)=>{const R=window.__REC;if(!R)return;const k=el.dataset.band||'';R.band=(R.band===k||!k)?null:k;recRenderModalBody();},
  'rec.vac':(el)=>{const R=window.__REC;if(!R)return;const v=el.dataset.vac||'';R.vac=(R.vac===v||!v)?null:v;recRenderModalBody();},
  'rec.pivotVal':(el)=>{const r=el.getBoundingClientRect();recPivotValMenu(r.left,r.bottom+4);},
  'rec.pivotValPick':(el)=>{const R=window.__REC;if(!R)return;R.pivot.val=el.dataset.val;recClosePvMenu();recRenderModalBody();},
  'rec.sort':(el)=>{const R=window.__REC;if(!R)return;const k=el.dataset.key;if(R.sort.key===k){if(R.sort.dir===1){R.sort.key=null;R.sort.dir=-1;}else R.sort.dir=1;}else{R.sort.key=k;R.sort.dir=-1;}recRenderHead();recRenderBody();},
  'rec.menuToggleRow':()=>{const R=window.__REC;if(!R)return;R.filterRow=!R.filterRow;const fr=document.querySelector('.rl-frow');if(fr)fr.classList.toggle('open',R.filterRow);if(!R.filterRow){R.filters={};document.querySelectorAll('.rl-fin').forEach(i=>{i.value='';});recRenderBody();}recCloseMenu();},
  'rec.menuAll':(el)=>{const M=window.__RECMENU;if(!M)return;M.sel=el.checked?new Set(M.all):new Set();recMenuRenderList();},
  'rec.menuVal':(el)=>{const M=window.__RECMENU;if(!M)return;const v=el.dataset.val;if(el.checked)M.sel.add(v);else M.sel.delete(v);if(M.dateTree)recMenuRenderList();else recMenuSyncAll();},
  'rec.menuTreeToggle':(el)=>{const M=window.__RECMENU;if(!M)return;const n=el.dataset.node;if(M.expand.has(n))M.expand.delete(n);else M.expand.add(n);recMenuRenderList();},
  'rec.menuTreeCheck':(el)=>{const M=window.__RECMENU;if(!M||!M.dateTree)return;const leaves=recDateLeaves(M.dateTree,el.dataset.node);const st=recTri(leaves,M.sel);if(st==='all')leaves.forEach(v=>M.sel.delete(v));else leaves.forEach(v=>M.sel.add(v));recMenuRenderList();},
  'rec.menuApply':()=>{const R=window.__REC,M=window.__RECMENU;if(!R||!M)return;if(M.sel.size>=M.all.length)delete R.valueFilters[M.key];else R.valueFilters[M.key]=new Set(M.sel);recRenderBody();recCloseMenu();},
  'rec.menuClear':()=>{const R=window.__REC,M=window.__RECMENU;if(!R||!M)return;delete R.valueFilters[M.key];recRenderBody();recCloseMenu();},
  'rec.menuHideCol':()=>{const R=window.__REC,M=window.__RECMENU;if(!R||!M)return;if(!R.hidden)R.hidden=new Set();const col=recCols().find(c=>c.key===M.key);R.hidden.add(M.key);recCloseMenu();recRenderModalBody();toast(`「${col?col.label:M.key}」 열을 숨겼습니다 · 아무 열 헤더 우클릭으로 복원`);},
  'rec.menuShowCols':()=>{const R=window.__REC;if(!R||!R.hidden)return;R.hidden.clear();recCloseMenu();recRenderModalBody();},
  'rec.pivotToggle':()=>{const R=window.__REC;if(!R)return;R.pivotOn=!R.pivotOn;recRenderModalBody();const b=document.querySelector('[data-act="rec.pivotToggle"]');if(b)b.textContent=R.pivotOn?'목록':'피벗';const hd=document.querySelector('.rl-thead');if(hd)hd.classList.toggle('pivot-mode',R.pivotOn);},
  'rec.clearTrade':()=>{const R=window.__REC;if(!R||!R._args)return;openRecList(R._args.sid,R._args.scope,'',R._args.vac);}, // 공종 필터 해제 — 동일 범위 재오픈
  'rec.pivotAdd':(el)=>{const r=el.getBoundingClientRect();recPivotAddMenu(el.dataset.zone,r.left,r.bottom+4);},
  'rec.pivotPick':(el)=>{const R=window.__REC,M=window.__PVMENU;if(!R||!M)return;if(M.zone==='rows'){if(R.pivot.rows.length<3&&!R.pivot.rows.includes(el.dataset.key))R.pivot.rows.push(el.dataset.key);}else{R.pivot.col=el.dataset.key;}recClosePvMenu();recRenderModalBody();},
  'rec.pivotRemove':(el)=>{const R=window.__REC;if(!R)return;if(el.dataset.zone==='rows')R.pivot.rows.splice(+el.dataset.i,1);else R.pivot.col=null;recRenderModalBody();},
  'rec.pivotSort':(el)=>{const R=window.__REC;if(!R)return;const k=el.dataset.pk,P=R.pivot;if(P.sort.key===k){if(P.sort.dir===1)P.sort={key:'__total',dir:-1};else P.sort={key:k,dir:1};}else P.sort={key:k,dir:-1};const b=document.getElementById('pvBody');if(b)b.innerHTML=recPivotTableHTML();},
  'team.pick':(el)=>switchTeam(el.dataset.tid), 'team.del':(el)=>tmDeleteTeam(el.dataset.tid),
  'team.addTeam':()=>tmAddTeam(), 'team.addRegion':()=>tmAddRegion(), 'region.del':(el)=>tmDeleteRegion(el.dataset.rgn),
  'uz':()=>{const fi=document.getElementById('fi');if(fi)fi.click();},
  'smt.sort':(el)=>sortSMT(el.dataset.key), 'site.del':(el)=>delS(el.dataset.sid), 'site.addModal':()=>openSM(null),
  'panel.carryPlan':(el)=>{const sid=el.dataset.sid;const n=carryPlansForward(sid);if(n){toast('전월 계획 '+n+'건 복사됨');rSite(sid);}else toast('복사할 전월 계획이 없거나 이미 입력되어 있습니다');},
  'panel.tab':(el)=>setTab(el.dataset.tab), 'panel.ai':(el)=>runAI(el.dataset.sid), 'panel.sort':(el)=>sortPanel(el.dataset.tbl, el),
  'vac.edit':(el)=>openVacEdit(el.dataset.sid, el.dataset.vl, el.dataset.sf),
  'ul.cancel':()=>{cancelUL();closeMo();}, 'ul.confirmSite':(el)=>confirmNewSite(el.dataset.name, Number(el.dataset.idx), Number(el.dataset.total))
});
// ── [전환 완료] input 액션 ──
registerActions('input', {
  'set.aiKey':(el)=>{S.ck=el.value;localStorage.setItem('ck',el.value);},
  'rec.filter':(el)=>{const R=window.__REC;if(!R)return;R.filters[el.dataset.key]=el.value;clearTimeout(R._ft);R._ft=setTimeout(recRenderBody,150);}, // 디바운스 — 키스트로크마다 수천 행 재렌더 방지
  'rec.qsearch':(el)=>{const R=window.__REC;if(!R)return;R.q=el.value;clearTimeout(R._qt);R._qt=setTimeout(recRenderModalBody,150);}, // 목록 내 통합 검색(디바운스) — 피벗 모드도 함께 갱신
  'rec.menuSearch':(el)=>{const M=window.__RECMENU;if(!M)return;M.q=el.value;const q=M.q.trim().toLowerCase();if(q)M.sel=new Set(M.all.filter(v=>String(v).toLowerCase().includes(q)));recMenuRenderList();},
  'set.exToken':(el)=>{S.exTk=el.value;localStorage.setItem('exTk',el.value);},
  'site.upd':(el)=>updSite(el.dataset.sid, el.dataset.field, el.value),
  'site.completion':(el)=>clampYear(el), 'util.clampYear':(el)=>clampYear(el),
  'panel.plan':(el)=>{autoResize(el);schedulePlanSave(el);}
});
// ── [전환 완료] change 액션 (site.upd: 셀렉트도 동일 핸들러로 재사용) ──
registerActions('change', {
  'viewer.rm':(el)=>fb2SwitchReportMonth(el.value),
  'dash.monthYear':(el)=>setDashMonthYear(el.value),
  'dash.trendYear':(el)=>setTrendYear(el.value), 'site.trendYear':(el)=>setSiteTrendYear(el.value),
  'team.switch':(el)=>switchTeam(el.value), 'team.rename':(el)=>updTeamName(el.dataset.tid, el.value),
  'region.rename':(el)=>updRegionName(el.dataset.rgn, el.value), 'fb2.role':(el)=>fb2SetRole(el.dataset.uid, el.value),
  'site.upd':(el)=>updSite(el.dataset.sid, el.dataset.field, el.value),
  'site.completion':(el)=>updSite(el.dataset.sid, 'completionDate', el.value),
  'site.updc':(el)=>updSite(el.dataset.sid, el.dataset.field, el.checked),
  'panel.detailYear':(el)=>setDetailYear(el.value), 'uz.file':(el)=>onFile(el.files && el.files[0])
});
// ── [전환 완료] keydown 액션 ──
registerActions('keydown', {
  'auth.emailEnter':(el,e)=>{if(e.key==='Enter'){e.preventDefault();const p=document.getElementById('fbPw');if(p)p.focus();}},
  'auth.pwEnter':(el,e)=>{if(e.key==='Enter'){e.preventDefault();fbDoLogin();}},
  'vac.edit':(el,e)=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openVacEdit(el.dataset.sid, el.dataset.vl, el.dataset.sf);}}
});
// ── [전환 완료] 업로드 존 drag/drop (uz: 단일 data-act, 이벤트별 핸들러) ──
registerActions('dragover',  {'uz':(el,e)=>{e.preventDefault();el.classList.add('drag');}});
registerActions('dragleave', {'uz':(el)=>el.classList.remove('drag')});
registerActions('drop',      {'uz':(el,e)=>{e.preventDefault();el.classList.remove('drag');const f=e.dataTransfer&&e.dataTransfer.files[0];if(f)onFile(f);}});
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

// FILTER helpers
function setTab(t){S.tab=t;document.querySelectorAll('.tnav-i').forEach(b=>b.classList.toggle('act',b.dataset.tab===t));document.querySelectorAll('.tpane').forEach(p=>p.classList.toggle('act',p.dataset.tab===t));
  // pane이 display:block이 된 직후 동기 측정 → display:none일 때 scrollHeight=0으로 잘못 잡혔던
  // textarea 높이를 페인트 전에 즉시 교정 (첫 진입 시 "작았다 커지는" 깜빡임 방지).
  autoSizeAll(document.querySelector('.tpane.act'));
  setTimeout(()=>{if(S.sid)renderTabCharts(S.sid,S.lastSt);autoSizeAll(document.querySelector('.tpane.act'));},30);} // 차트 렌더로 폭이 바뀐 뒤 같은 프레임에서 재측정 — 높이 점프 방지
function setDetailYear(y){S.detailYear=y;if(S.sid)rSite(S.sid);}
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
function setTrendYear(y){S.trendYear=y;const all=dashSites().map(s=>({s,st:calc(S.def[s.id]||[],s,S.rm)}));try{rCharts(all);}catch(e){console.error('rCharts(year)',e);}}
function setSiteTrendYear(y){S.siteTrendYear=y;if(S.sid){dC('mo-'+S.sid);buildSiteTrend(S.sid,S.lastSt);}}
