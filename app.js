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
  'set.snapshot':()=>exportSnapshot(), 'set.publish':()=>fb2Publish(), 'set.viewerMode':()=>fb2ViewAsViewer(), 'set.readme':()=>openReadme(),
  'dash.insToggle':(el)=>{const grid=el.closest('.ins-grid');if(!grid)return;const was=el.classList.contains('exp');if(!was)grid.style.height=grid.offsetHeight+'px';/* 확장 전 자연 높이(카드 3개)를 고정 — absolute 이탈로 컨테이너가 줄어드는 것 방지 */grid.querySelectorAll('.ic.exp').forEach(c=>{c.classList.remove('exp');c.setAttribute('aria-expanded','false');});grid.classList.remove('ins-open');if(was)grid.style.height='';if(!was){el.classList.add('exp');el.setAttribute('aria-expanded','true');grid.classList.add('ins-open');const tc=el.querySelector('.ic-t');if(tc&&!tc.querySelector('.insd'))tc.insertAdjacentHTML('beforeend',insDetailHTML(el.dataset.instt||''));/* 신뢰 코드 생성 HTML(외부 문자열 esc 처리) — safeHTML은 insd 클래스·data-act를 제거하므로 미사용 */el.scrollTop=0;}}, // 주요 이슈 카드 확장/접기 — 상세는 최초 확장 시 생성
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

// SIDEBAR
function toggleSB(){S.mini=!S.mini;document.getElementById('sidebar').classList.toggle('mini',S.mini);}
let _sbScroll=0;
function _sbBlockTouch(e){if(!(e.target.closest&&e.target.closest('#sidebar')))e.preventDefault();}
function openMobileSB(){const c=document.getElementById('content');document.getElementById('sidebar').classList.add('mob-open');document.getElementById('scrim').classList.add('show');_sbScroll=c?c.scrollTop:0;if(c){c.style.position='fixed';c.style.top=(-_sbScroll)+'px';c.style.left='0';c.style.right='0';c.style.bottom='0';c.style.overflow='hidden';}document.body.classList.add('sb-locked');document.addEventListener('touchmove',_sbBlockTouch,{passive:false});}
function closeMobileSB(){const c=document.getElementById('content');document.getElementById('sidebar').classList.remove('mob-open');document.getElementById('scrim').classList.remove('show');if(c){c.style.position='';c.style.top='';c.style.left='';c.style.right='';c.style.bottom='';c.style.overflow='';c.scrollTop=_sbScroll;}document.body.classList.remove('sb-locked');document.removeEventListener('touchmove',_sbBlockTouch,{passive:false});}

// PERSISTENCE — IndexedDB(영구 로컬 저장: metaLoad/defLoadAll/lsSave) + Firebase(FB2: 멀티유저 실시간 동기화).
const LS_KEY='hdec_state_v1';// IndexedDB 마이그레이션용

// ===== IndexedDB =====
// 저장 구조:
//  - meta 스토어: { id:'state', sites, cmt, ana, rm } — 작은 메타데이터
//  - defects 스토어: { sid, data:<LZ-String 압축 JSON> } — 큰 하자 리스트 (현장별)
// def가 메모리에서 사라지지 않도록 부팅 시 모두 로드해 S.def에 채움.
const DB_NAME='hdec_db_v1',DB_VER=1;
let _db=null;
function dbOpen(){
  return new Promise((res,rej)=>{
    if(_db)return res(_db);
    let settled=false;
    const done=(fn,v)=>{if(settled)return;settled=true;fn(v);};
    // open이 onsuccess/onerror/onblocked 어느 것도 안 부르고 멈추는 경우 대비 (file:// 등)
    const to=setTimeout(()=>done(rej,new Error('indexedDB.open timeout')),5000);
    let req;
    try{req=indexedDB.open(DB_NAME,DB_VER);}
    catch(e){clearTimeout(to);return done(rej,e);}
    req.onupgradeneeded=e=>{
      const db=e.target.result;
      if(!db.objectStoreNames.contains('meta'))db.createObjectStore('meta',{keyPath:'id'});
      if(!db.objectStoreNames.contains('defects'))db.createObjectStore('defects',{keyPath:'sid'});
    };
    req.onsuccess=()=>{clearTimeout(to);_db=req.result;done(res,_db);};
    req.onerror=()=>{clearTimeout(to);done(rej,req.error);};
    req.onblocked=()=>{clearTimeout(to);done(rej,new Error('indexedDB.open blocked'));};
  });
}
function dbTx(store,mode){return dbOpen().then(db=>db.transaction(store,mode).objectStore(store));}
function dbGet(store,key){return dbTx(store,'readonly').then(os=>new Promise((res,rej)=>{const r=os.get(key);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);}));}
function dbPut(store,value){return dbTx(store,'readwrite').then(os=>new Promise((res,rej)=>{const r=os.put(value);r.onsuccess=()=>res();r.onerror=()=>rej(r.error);}));}
function dbDel(store,key){return dbTx(store,'readwrite').then(os=>new Promise((res,rej)=>{const r=os.delete(key);r.onsuccess=()=>res();r.onerror=()=>rej(r.error);}));}
function dbAll(store){return dbTx(store,'readonly').then(os=>new Promise((res,rej)=>{const r=os.getAll();r.onsuccess=()=>res(r.result||[]);r.onerror=()=>rej(r.error);}));}

// 메타 저장/로드 (sites/cmt/ana/rm). 동기 호환을 위해 in-memory 캐시 + 비동기 백그라운드 쓰기.
let _saveTimer=null,_saveQueued=false;
function lsSave(){
  // 디바운스 쓰기 — 연속 호출 시 마지막 한 번만 IndexedDB로 flush
  _saveQueued=true;
  if(_saveTimer)return;
  _saveTimer=setTimeout(async()=>{
    _saveTimer=null;_saveQueued=false;
    try{
      await dbPut('meta',{id:'state',sites:S.sites,cmt:S.cmt,ana:S.ana,rm:S.rm,teams:S.teams,teamId:S.teamId});
    }catch(e){console.warn('meta save failed',e);}
    if(_saveQueued)lsSave();// 그 사이에 또 호출됐으면 다시 예약
  },120);
}
async function metaLoad(){
  try{
    const o=await dbGet('meta','state');
    if(!o){
      // 마이그레이션: 이전 localStorage 버전이 있으면 한 번 흡수
      const raw=localStorage.getItem(LS_KEY);
      if(raw){try{const v=JSON.parse(raw);if(Array.isArray(v.sites))S.sites=v.sites;if(v.cmt)S.cmt=v.cmt;if(v.ana)S.ana=v.ana;if(typeof v.rm==='string'&&/^\d{4}-\d{2}$/.test(v.rm))S.rm=v.rm;await dbPut('meta',{id:'state',sites:S.sites,cmt:S.cmt,ana:S.ana,rm:S.rm,teams:S.teams,teamId:S.teamId});localStorage.removeItem(LS_KEY);}catch(e){console.warn('migration failed',e);}}
      return;
    }
    if(Array.isArray(o.sites))S.sites=o.sites;
    if(o.cmt)S.cmt=o.cmt;
    if(o.ana)S.ana=o.ana;
    if(typeof o.rm==='string'&&/^\d{4}-\d{2}$/.test(o.rm))S.rm=o.rm;
    if(Array.isArray(o.regionOrder))S.regionOrder=o.regionOrder;
    if(Array.isArray(o.teams))S.teams=o.teams;
    if(o.teamId)S.teamId=o.teamId;
    anaNormalize(); // 레거시 분석의견(문자열) → 현재 기준월 맵으로 승격 (rm 확정 이후 시점)
  }catch(e){console.warn('metaLoad failed',e);}
}

// def 저장/로드 — LZ-String 압축. 한 현장 ~95k행 → 압축 후 2~3MB.
// 압축 인코딩: Base64 사용 (A-Za-z0-9+/= 만 — HTML script 태그·JSON에 100% 안전).
// 기존 UTF-16 저장분과의 호환을 위해 enc 필드로 방식 기록.
function defEncode(json){
  if(typeof LZString==='undefined')return{data:json,enc:'raw'};
  return{data:LZString.compressToBase64(json),enc:'b64'};
}
function defDecode(row){
  if(!row)return null;
  if(typeof LZString==='undefined')return row.data;
  // enc 명시 우선, 없으면 과거 데이터(compressed:true=utf16) 추정
  const enc=row.enc||(row.compressed?'utf16':'raw');
  try{
    if(enc==='b64')return LZString.decompressFromBase64(row.data);
    if(enc==='utf16')return LZString.decompressFromUTF16(row.data);
    return row.data;
  }catch(e){console.warn('defDecode failed',e);return null;}
}
async function defSave(sid,items){
  try{
    const json=JSON.stringify(items||[]);
    const{data,enc}=defEncode(json);
    await dbPut('defects',{sid,data,enc,compressed:enc!=='raw',count:(items||[]).length,savedAt:Date.now()});
  }catch(e){console.error('defSave failed for',sid,e);toast('하자 데이터 저장 실패');}
}
async function defLoadAll(){
  try{
    const rows=await dbAll('defects');
    for(const row of rows){
      try{
        const raw=defDecode(row);
        if(raw)S.def[row.sid]=Object.freeze(JSON.parse(raw)); // freeze: 통째 교체 규약 강제 — push/splice 등 in-place 편집 시 무증상 캐시 스테일 차단
      }catch(e){console.warn('defLoad parse failed for',row.sid,e);}
    }
  }catch(e){console.warn('defLoadAll failed',e);}
}
async function defDelete(sid){try{await dbDel('defects',sid);}catch(e){console.warn('defDelete failed',e);}}


// ===== 화면 가림막(커버) — Firebase 인증 게이트가 사용 =====
function showCover(){const g=document.getElementById('coverGate');if(g)g.style.display='flex';}
function hideCover(){const g=document.getElementById('coverGate');if(g)g.style.display='none';}
// 입력 중(텍스트영역/인풋) 여부 — 실시간 동기화가 타이핑을 덮어쓰지 않도록 FB2가 사용
function shEditing(){const a=document.activeElement;return !!(a&&(a.tagName==='TEXTAREA'||a.tagName==='INPUT'||a.isContentEditable));}

// ===================================================================
// ===== 사내 Firebase 공유 (report-c29a1) — 인증 게이트 + 실시간 =====
// 정적 HTML은 데이터 0인 껍데기. 집계는 관리자가 report/{기준월}에 "게시",
// 처리계획·분석의견은 plans/·analysis/ 리프에 실시간 read/write.
// @hdec.co.kr + 이메일 인증 통과 계정만 데이터 수신(서버 규칙으로 강제).
// ===================================================================
const FB2={
  cfg:{
    apiKey:"AIzaSyDX5yANupr5xqLbCq_UcSVHc-iZvobRM3g",
    authDomain:"report-c29a1.firebaseapp.com",
    databaseURL:"https://report-c29a1-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId:"report-c29a1",
    storageBucket:"report-c29a1.firebasestorage.app",
    messagingSenderId:"625677240502",
    appId:"1:625677240502:web:f66c629db928c2b801fe17",
    measurementId:"G-YT6MVSE221"
  },
  app:null,auth:null,db:null,
  ready:false,role:null,user:null,_entering:false,_loginWatch:null,
  users:{},_usersBound:false,
  subs:[],_foBound:false,
  _siteSubs:[],_siteSubSid:null,
  _siteCfg:{},_siteCfgBound:false,
  _pendRerender:false,_pendReport:null,_pendReportRm:null
};
window.__FB2=FB2;
// App Check (선택) — Firebase 콘솔에서 reCAPTCHA Enterprise/v3 등록 후 사이트키를 넣으면 활성.
// 비워두면 비활성(현재 배포 유지). 활성 순서: ①사이트키 입력 → ②배포 → ③콘솔 앱 등록 → ④마지막에 '적용(enforcement)'.
const FB_APPCHECK_SITE_KEY="6Lcl5zctAAAAAPgvPJKKLxBwgENnAmogtVTqf61f";

// Firebase 금지문자(. # $ [ ] /) 회피용 키 인코딩 (공종명 등 키에 사용)
function fbEncKey(k){return encodeURIComponent(String(k==null?'':k)).replace(/\./g,'%2E');}
function fbDecKey(k){try{return decodeURIComponent(String(k));}catch(e){return String(k);}}
// Firebase 키 규칙(. $ # / [ ] 금지) 회피: 게시 payload의 중첩 맵 키를 재귀 인코딩/디코딩한다.
//   데이터 값이 키가 되는 맵(dtb 하자유형·rpb 보수주체·am/siteAm 공종)에 '/' 등이 들어가면 update 전체가 거부됨.
//   구조 키(영문)는 encodeURIComponent가 그대로 두므로 실제로는 한글/기호 키만 변환된다(쓰기·읽기 대칭).
function deepEncKeys(v){if(Array.isArray(v))return v.map(deepEncKeys);if(v&&typeof v==='object'){const o={};Object.keys(v).forEach(function(k){o[fbEncKey(k)]=deepEncKeys(v[k]);});return o;}return v;}
function deepDecKeys(v){if(Array.isArray(v))return v.map(deepDecKeys);if(v&&typeof v==='object'){const o={};Object.keys(v).forEach(function(k){o[fbDecKey(k)]=deepDecKeys(v[k]);});return o;}return v;}
function fbDomainOk(email){return /@hdec\.co\.kr$/i.test(String(email||'').trim());}
function fb2IsEditor(){return FB2.role==='editor';}

// ----- 게이트 메시지/입력 -----
function fbMsg(t,ok){const e=document.getElementById('cvMsg');if(e){e.textContent=t||'';e.style.color=ok?'#7CFC9A':'#ff8a80';}}
function fbReadCreds(){return{email:(document.getElementById('fbEmail')||{}).value||'',pw:(document.getElementById('fbPw')||{}).value||''};}
function showGateForm(){const ld=document.getElementById('cvLoading');if(ld)ld.style.display='none';const bd=document.getElementById('cvBody');if(bd)bd.style.display='';showCover();}
function fbAuthErr(e){
  const c=(e&&e.code)||'';
  const m={
    'auth/invalid-credential':'이메일 또는 비밀번호가 올바르지 않습니다',
    'auth/wrong-password':'비밀번호가 올바르지 않습니다',
    'auth/user-not-found':'가입되지 않은 계정입니다 · [신규 가입]을 눌러주세요',
    'auth/invalid-email':'이메일 형식이 올바르지 않습니다',
    'auth/email-already-in-use':'이미 가입된 계정입니다 · 로그인하세요',
    'auth/too-many-requests':'시도가 많습니다 · 잠시 후 다시 시도하세요',
    'auth/network-request-failed':'네트워크 오류 · 사내망에서 Firebase 접속이 허용되는지 확인하세요',
    'auth/weak-password':'비밀번호는 6자 이상이어야 합니다',
    'auth/operation-not-allowed':'이메일/비밀번호 로그인이 콘솔에서 활성화되지 않았습니다'
  };
  return m[c]||('오류: '+((e&&e.message)||c||'알 수 없음'));
}

// ----- 게이트 동작 (로그인/가입/인증재발송) -----
async function fbDoLogin(){
  if(!FB2.auth){fbMsg('네트워크에 연결할 수 없습니다.');return;}
  const c=fbReadCreds(),email=c.email.trim().toLowerCase();
  if(!fbDomainOk(email)){fbMsg('@hdec.co.kr 계정만 사용할 수 있습니다');return;}
  if((c.pw||'').length<6){fbMsg('비밀번호는 6자 이상이어야 합니다');return;}
  fbMsg('로그인 중…',true);
  // 안전망: 일정 시간 안에 진입(또는 인증 안내)에 도달하지 못하면 새로고침을 안내.
  //   signIn이 네트워크에서 멈추는 등 예기치 못한 경우까지 커버한다. (정상 진입 시 fb2OnAuth가 해제)
  clearTimeout(FB2._loginWatch);
  FB2._loginWatch=setTimeout(function(){if(!FB2.ready)fbMsg('로그인 처리가 지연되고 있습니다 · 페이지를 새로고침(F5)한 뒤 다시 시도해 주세요.');},9000);
  try{
    await FB2.auth.signInWithEmailAndPassword(email,c.pw);
    // ★가입 직후엔 이미 그 계정으로 자동 로그인된 상태라, 같은 계정으로 다시 [로그인]을 눌러도
    //   onAuthStateChanged가 재발화하지 않아 진입 로직이 돌지 않는다(→ 새로고침 전까지 무한 대기).
    //   사용자 상태를 reload()로 최신화(emailVerified 반영)한 뒤 진입 핸들러를 직접 호출한다.
    //   (일반 로그인에서 onAuthStateChanged가 함께 돌더라도 fb2Enter의 중복 진입 가드가 막아준다.)
    const u=FB2.auth.currentUser;
    if(u){try{await u.reload();}catch(_){}fb2OnAuth(FB2.auth.currentUser);}
  }
  catch(e){clearTimeout(FB2._loginWatch);fbMsg(fbAuthErr(e));}
}
async function fbDoSignup(){
  if(!FB2.auth){fbMsg('네트워크에 연결할 수 없습니다.');return;}
  const c=fbReadCreds(),email=c.email.trim().toLowerCase();
  if(!fbDomainOk(email)){fbMsg('@hdec.co.kr 계정만 가입할 수 있습니다');return;}
  if((c.pw||'').length<6){fbMsg('비밀번호는 6자 이상이어야 합니다');return;}
  fbMsg('가입 처리 중…',true);
  try{
    const cred=await FB2.auth.createUserWithEmailAndPassword(email,c.pw);
    try{await cred.user.sendEmailVerification();}catch(_){}
    fbMsg('인증메일을 보냈습니다. 메일의 링크를 클릭한 뒤 [로그인]을 눌러주세요.',true);
  }catch(e){fbMsg(fbAuthErr(e));}
}
async function fbDoResend(){
  if(!FB2.auth||!FB2.auth.currentUser){fbMsg('먼저 로그인 또는 가입을 진행하세요');return;}
  try{await FB2.auth.currentUser.sendEmailVerification();fbMsg('인증메일을 다시 보냈습니다. 받은 메일의 링크를 클릭하세요.',true);}
  catch(e){fbMsg(fbAuthErr(e));}
}
window.fbDoLogin=fbDoLogin;window.fbDoSignup=fbDoSignup;window.fbDoResend=fbDoResend;

// ----- 초기화 / 부팅 -----
function fb2Init(){
  if(typeof firebase==='undefined'||!firebase.initializeApp)return false;
  try{
    FB2.app=firebase.apps&&firebase.apps.length?firebase.app():firebase.initializeApp(FB2.cfg);
    if(FB_APPCHECK_SITE_KEY&&firebase.appCheck){
      try{
        // reCAPTCHA Enterprise 키 → Enterprise 제공자로 활성화.
        //   (문자열로 넘기면 v3(클래식)으로 취급돼 Enterprise 키와 불일치 → 토큰 발급 실패)
        var _EP=firebase.appCheck.ReCaptchaEnterpriseProvider;
        firebase.appCheck().activate(_EP?new _EP(FB_APPCHECK_SITE_KEY):FB_APPCHECK_SITE_KEY,true);
      }
      catch(e){console.warn('[FB2] appCheck activate 실패',e);}
    }
    FB2.auth=firebase.auth();
    FB2.db=firebase.database();
    return true;
  }catch(e){console.error('[FB2] init 실패',e);return false;}
}
function fb2Boot(){
  if(!fb2Init()){
    showGateForm();
    fbMsg('네트워크에 연결할 수 없습니다.');
    return;
  }
  FB2.auth.onAuthStateChanged(fb2OnAuth);
}
function fb2OnAuth(user){
  clearTimeout(FB2._loginWatch); // 인증 상태가 결정됨 — 로그인 지연 워치독 해제(인증 대기·진입·차단 등 모든 분기 공통)
  FB2.user=user;
  if(!user){ FB2.ready=false; FB2.role=null; try{fb2Cleanup();}catch(_){} try{fb2RenderAcct();}catch(_){} showGateForm(); return; }
  if(!fbDomainOk(user.email)){showGateForm();fbMsg('@hdec.co.kr 계정만 접근할 수 있습니다.');try{FB2.auth.signOut();}catch(_){}return;}
  if(!user.emailVerified){
    showGateForm();
    fbMsg('이메일 인증이 필요합니다. 받은 인증메일의 링크를 클릭한 뒤 [로그인]을 다시 누르세요. (메일이 없으면 [인증메일 재발송])');
    return;
  }
  fb2Enter(user);
}

// ----- 역할 해석 (users/{uid}) -----
// 관리자(editor)=모든 권한 / 사용자(viewer)=읽기·쓰기 / 차단(blocked)=전면 차단
// 최초 편집자는 콘솔에서 users/{uid}/role="editor"로 1회 부트스트랩.
async function fb2ResolveRole(user){
  const uid=user.uid, email=String(user.email||'').toLowerCase();
  const ref=FB2.db.ref('users/'+uid);
  let rec=null;
  try{const s=await ref.once('value');rec=s.val();}catch(e){console.warn('[FB2] role read',e);}
  if(!rec){
    // 최초 로그인 — 본인을 viewer로 자기 등록(규칙상 role은 viewer로만 생성 가능)
    rec={email:email,role:'viewer',createdAt:Date.now(),lastSeen:Date.now()};
    try{await ref.set(rec);}catch(e){console.warn('[FB2] self-register',e);}
  }else{
    try{await ref.child('lastSeen').set(Date.now());}catch(e){}
    if(rec.email!==email){try{await ref.child('email').set(email);}catch(e){}}
  }
  FB2.userRec=rec;
  const r=rec&&rec.role;
  return (r==='editor'||r==='viewer'||r==='blocked')?r:'viewer';
}
function fb2ShowBlocked(){
  FB2.ready=false;
  try{document.body.classList.remove('viewer');}catch(_){}
  showGateForm();
  fbMsg('이 계정은 접근이 차단되었습니다. 관리자에게 문의하세요.');
}
// 로그아웃 시 실시간 구독 해제 — 로그아웃→재로그인 반복 시 리스너가 누적되는 것을 방지.
//   subs 에 등록된 off() 들을 모두 실행하고, 그 리스너에 대응하는 재구독 가드(_usersBound·_siteCfgBound)를 리셋.
//   (focusout 리스너는 영구 등록이라 해제 대상이 아니며 _foBound 는 그대로 둬 중복 바인딩을 막는다.)
function fb2Cleanup(){
  try{(FB2.subs||[]).forEach(function(off){try{off();}catch(_){}});}catch(_){}
  FB2.subs=[];
  try{(FB2._siteSubs||[]).forEach(function(off){try{off();}catch(_){}});}catch(_){}
  FB2._siteSubs=[];FB2._siteSubSid=null;
  if(FB2._reportOff){try{FB2._reportOff();}catch(_){}FB2._reportOff=null;}
  FB2._usersBound=false;
  FB2._siteCfgBound=false;
  FB2.users={};FB2._siteCfg={};
}

// ----- 계정 관리 (편집자 전용) -----
function fb2SubUsers(){
  if(FB2._usersBound)return;FB2._usersBound=true;
  const ref=FB2.db.ref('users');
  const h=ref.on('value',function(snap){
    FB2.users=snap.val()||{};
    if(S.view==='settings'&&fb2IsEditor())fb2RenderUsers();
  });
  FB2.subs.push(function(){ref.off('value',h);});
}
function fb2RoleLabel(r){return r==='editor'?'관리자':(r==='blocked'?'차단':'사용자');}

// ===== 계정 카드(사이드바 하단) + 계정 모달(이름/비밀번호 변경·로그아웃) =====
function fb2AcctNick(){const u=FB2.user;if(!u)return'';const email=u.email||'';return String(u.displayName||(FB2.userRec&&FB2.userRec.name)||email.split('@')[0]||'').trim();}
function fb2RenderAcct(){
  const card=document.getElementById('sbAcct');if(!card)return;
  const u=FB2.user;
  if(!u||!FB2.ready){card.style.display='none';return;}
  const email=u.email||'', nick=fb2AcctNick()||'사용자', role=FB2.role||'viewer';
  card.style.display='';
  const nm=document.getElementById('sbAcctName');nm.textContent=nick;nm.title=nick;
  const ml=document.getElementById('sbAcctMail');ml.textContent=email;ml.title=email;
  const rb=document.getElementById('sbAcctRole');rb.textContent=fb2RoleLabel(role);
  rb.className='sb-acct-role '+(role==='editor'?'r-editor':'r-viewer');
}
function openAcctModal(){
  const u=FB2.user;if(!u){toast('로그인이 필요합니다');return;}
  const email=u.email||'', nick=fb2AcctNick(), role=FB2.role||'viewer';
  let last='';try{if(u.metadata&&u.metadata.lastSignInTime)last=new Date(u.metadata.lastSignInTime).toLocaleString('ko-KR');}catch(_){}
  document.getElementById('mt').textContent='계정';
  document.getElementById('mbody').innerHTML=`
    <div class="acct-head">
      <div class="acct-av"><svg viewBox="0 0 24 24" fill="#fff" aria-hidden="true"><circle cx="12" cy="8" r="3.5"/><path d="M12 13c-3.9 0-7 2.4-7 5.4 0 .9.5 1.6 1.6 1.6h10.8c1.1 0 1.6-.7 1.6-1.6 0-3-3.1-5.4-7-5.4z"/></svg></div>
      <div style="min-width:0;flex:1">
        <div class="acct-mail">${esc(email)}</div>
        <span class="acct-rolebadge ${role==='editor'?'r-editor':'r-viewer'}">${esc(fb2RoleLabel(role))}</span>
      </div>
    </div>
    <div class="acct-sep"></div>
    <label class="il" for="acctName">이름 (닉네임)</label>
    <div class="acct-row">
      <input class="inp" id="acctName" maxlength="60" value="${esc(nick)}" placeholder="표시할 이름" style="flex:1">
      <button class="acct-btn acct-btn-primary" data-act="acct.saveName">저장</button>
    </div>
    <div class="acct-sep"></div>
    <label class="il">비밀번호 변경</label>
    <input class="inp acct-gap" id="acctPwCur" type="password" autocomplete="current-password" placeholder="현재 비밀번호">
    <input class="inp acct-gap" id="acctPwNew" type="password" autocomplete="new-password" placeholder="새 비밀번호 (6자 이상)">
    <input class="inp acct-gap" id="acctPwNew2" type="password" autocomplete="new-password" placeholder="새 비밀번호 확인">
    <button class="acct-btn acct-btn-primary acct-btn-full" data-act="acct.changePw">비밀번호 변경</button>
    ${last?`<div class="acct-last">마지막 로그인 · ${esc(last)}</div>`:''}`;
  document.getElementById('mf').innerHTML=`<button class="acct-btn acct-btn-danger" data-act="acct.signout" style="margin-right:auto">로그아웃</button><button class="acct-btn acct-btn-ghost" data-act="modal.close">닫기</button>`;
  openMo();
}
async function acctSaveName(){
  const inp=document.getElementById('acctName');if(!inp)return;
  const name=inp.value.trim().slice(0,60);
  const u=FB2.auth&&FB2.auth.currentUser;if(!u){toast('로그인이 필요합니다');return;}
  try{await u.updateProfile({displayName:name});}catch(e){toast('이름 저장 실패 · '+(e.message||e));return;}
  try{await FB2.db.ref('users/'+u.uid+'/name').set(name);}catch(_){/* 규칙 미허용 시 조용히 무시 — 닉네임은 Auth displayName에 저장됨 */}
  FB2.user=u; if(FB2.userRec)FB2.userRec.name=name;
  fb2RenderAcct();
  if(typeof fb2RenderUsers==='function'){try{fb2RenderUsers();}catch(_){}}
  toast('이름이 저장되었습니다');
}
async function acctChangePw(){
  const u=FB2.auth&&FB2.auth.currentUser;if(!u){toast('로그인이 필요합니다');return;}
  const cur=(document.getElementById('acctPwCur')||{}).value||'';
  const n1=(document.getElementById('acctPwNew')||{}).value||'';
  const n2=(document.getElementById('acctPwNew2')||{}).value||'';
  if(!cur){toast('현재 비밀번호를 입력하세요');return;}
  if(n1.length<6){toast('새 비밀번호는 6자 이상이어야 합니다');return;}
  if(n1!==n2){toast('새 비밀번호 확인이 일치하지 않습니다');return;}
  if(n1===cur){toast('현재와 다른 비밀번호를 사용하세요');return;}
  try{
    const cred=firebase.auth.EmailAuthProvider.credential(u.email,cur);
    await u.reauthenticateWithCredential(cred);
    await u.updatePassword(n1);
    ['acctPwCur','acctPwNew','acctPwNew2'].forEach(id=>{const e=document.getElementById(id);if(e)e.value='';});
    toast('비밀번호가 변경되었습니다');
  }catch(e){toast(fbAuthErr(e));}
}
function acctSignout(){
  if(!confirm('로그아웃하시겠습니까?'))return;
  try{closeMo();}catch(_){}
  try{FB2.auth.signOut();}catch(e){toast('로그아웃 실패');}
}
registerActions('click', {'acct.open':()=>openAcctModal(),'acct.saveName':()=>acctSaveName(),'acct.changePw':()=>acctChangePw(),'acct.signout':()=>acctSignout()});
function fb2RenderUsers(){
  const box=document.getElementById('fbUserList');if(!box)return;
  const us=FB2.users||{},uids=Object.keys(us);
  const myUid=(FB2.user&&FB2.user.uid)||'';
  const editors=uids.filter(u=>us[u]&&us[u].role==='editor');
  if(!uids.length){box.innerHTML='<tr><td colspan="3" style="font-size:12px;color:var(--lbl3);padding:10px">아직 로그인한 계정이 없습니다.</td></tr>';return;}
  // 정렬: 관리자 → 사용자 → 차단, 그 안에서 이메일순
  const order={editor:0,viewer:1,blocked:2};
  uids.sort(function(a,b){const ra=order[us[a].role]??1,rb=order[us[b].role]??1;if(ra!==rb)return ra-rb;return String(us[a].email||'').localeCompare(String(us[b].email||''));});
  const PERSON='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.5"/><path d="M12 13c-3.9 0-7 2.4-7 5.4 0 .9.5 1.6 1.6 1.6h10.8c1.1 0 1.6-.7 1.6-1.6 0-3-3.1-5.4-7-5.4z"/></svg>';
  box.innerHTML=uids.map(function(uid){
    const u=us[uid]||{},role=u.role||'viewer',isMe=uid===myUid;
    const lastEditor=role==='editor'&&editors.length<=1; // 마지막 관리자 보호
    const lockReason=isMe?'본인 계정':(lastEditor?'마지막 관리자':'');
    const opt=function(v,t){return '<option value="'+v+'"'+(role===v?' selected':'')+'>'+t+'</option>';};
    const rc='r-'+role;
    const email=String(u.email||uid);
    const nick=esc(u.name||email.split('@')[0]||'—');
    const ctl=(isMe||lastEditor)
      ? (lockReason?'<span class="fbu-lock">'+lockReason+'</span> ':'')+'<span class="fbu-role '+rc+'">'+fb2RoleLabel(role)+'</span>'
      : '<select class="fbu-sel" data-act="fb2.role" data-uid="'+esc(uid)+'" aria-label="사용자 권한 선택">'+opt('editor','관리자')+opt('viewer','사용자')+opt('blocked','차단')+'</select>';
    return '<tr><td><div class="utbl-name"><div class="fbu-av '+rc+'">'+PERSON+'</div><span class="utbl-nick">'+nick+'</span></div></td>'
      +'<td><span class="utbl-mail">'+esc(email)+'</span>'+(isMe?'<span class="fbu-me">나</span>':'')+'</td>'
      +'<td class="utbl-r">'+ctl+'</td></tr>';
  }).join('');
}
async function fb2SetRole(uid,role){
  if(!fb2IsEditor()){toast('권한이 없습니다');return;}
  if(role!=='editor'&&role!=='viewer'&&role!=='blocked')return;
  if(uid===(FB2.user&&FB2.user.uid)){toast('자기 자신의 권한은 변경할 수 없습니다');fb2RenderUsers();return;}
  const us=FB2.users||{},editors=Object.keys(us).filter(u=>us[u]&&us[u].role==='editor');
  if(role!=='editor'&&editors.length<=1&&editors[0]===uid){toast('마지막 관리자는 변경할 수 없습니다');fb2RenderUsers();return;}
  try{await FB2.db.ref('users/'+uid+'/role').set(role);toast((us[uid]&&us[uid].email||'계정')+' → '+fb2RoleLabel(role));}
  catch(e){toast('변경 실패: '+((e&&e.message)||e));fb2RenderUsers();}
}
window.fb2SetRole=fb2SetRole;

// ----- 진입 (역할 분기: 관리자 / 사용자 / 차단) -----
async function fb2Enter(user){
  // 중복 진입 가드: ① 진입 처리 중 재호출 차단, ② 이미 같은 계정으로 진입 완료면 무시.
  //   (가입 직후 자동 로그인 등으로 onAuthStateChanged가 재발화하지 않을 때 fbDoLogin이 진입을
  //    직접 구동하는데, 일반 로그인에서는 onAuthStateChanged도 함께 돌 수 있어 가드가 필요하다.)
  if(FB2._entering)return;
  if(FB2.ready&&FB2.user&&user&&FB2.user.uid===user.uid)return;
  FB2._entering=true;
  // 진입 워치독: 자동 로그인 경로(onAuthStateChanged→fb2Enter)는 _loginWatch가 없어 서버 통신이
  // 막히면(App Check/네트워크/보안 프로그램) 커버가 로딩 상태로 영구 대기한다. 20초 내 진입 실패 시
  // 로그인 폼과 원인 안내를 노출한다. 진입 성공 시 기존 clearTimeout(FB2._loginWatch)이 해제.
  clearTimeout(FB2._loginWatch);
  FB2._loginWatch=setTimeout(function(){if(!FB2.ready){showGateForm();fbMsg('서버 연결이 지연되고 있습니다 · 개발자도구(F12) 콘솔의 차단 항목 확인 후 새로고침(F5)해 주세요.');}},20000);
  try{
    FB2.user=user;
    let role='viewer';
    try{role=await fb2ResolveRole(user);}catch(e){console.warn('[FB2] resolveRole',e);}
    FB2.role=role;
    if(role==='blocked'){fb2ShowBlocked();return;} // 데이터 구독 없음 — 전면 차단 (finally에서 _entering 해제)
    FB2.ready=true;
    clearTimeout(FB2._loginWatch); // 진입 성공 — 워치독 해제
    hideCover();
    // 첫 방문 안내 — 이 브라우저에서 처음 로그인한 사용자에게 사용 안내를 1회만 띄운다(이후엔 헤더 ? 버튼).
    try{if(!localStorage.getItem('rmSeen')){localStorage.setItem('rmSeen','1');setTimeout(()=>{try{openReadme();}catch(_){}},1400);}}catch(_){}
    fb2RenderAcct();
    fb2BindFocusout();
    fb2PrimePlansAnalysis(); // 1회 전체 병합(비동기) — 이후 실시간은 현장 단위 스코프 구독
    if(S.view==='site'&&S.sid)fb2ScopeSiteSubs(S.sid);
    fb2SubSiteConfig();
    if(role==='editor'){
      document.body.classList.remove('viewer');
      const fb=document.getElementById('set-fb');if(fb)fb.style.display='';
  const su=document.getElementById('set-users');if(su)su.style.display='';
      fb2SubUsers();
      fb2RefreshMeta();
      if(S.view==='settings')loadSettings();
    }else{
      await fb2EnterViewer();
    }
  }finally{
    FB2._entering=false;
  }
}
async function fb2EnterViewer(){
  try{
    const rep=await fb2LoadReportLatest();
    if(!rep){fb2ViewerEmpty();return;}
    fb2ApplyReport(rep.rm,rep.data);
    fb2SubReport(rep.rm);
    fb2InitViewerRmSel(rep.rm); // 기준월 아카이브 선택기 (게시월 2개 이상일 때 표시)
    fb2SubReportIndex(); // 새 게시월 등록 감지
  }catch(e){console.error('[FB2] viewer 진입 실패',e);fb2ViewerEmpty();}
}
// ── 편집자 '뷰어 시점으로 보기' (설정 > 사내 게시) ──
// 원본 하자 행은 업로드한 브라우저의 IndexedDB에만 있어, 다른 PC에서 업로드·게시한 내용은
// 이 PC의 편집자 화면(로컬 계산)에 반영되지 않는다(뷰어는 게시본을 보므로 정상 반영).
// 이 기능은 뷰어와 동일한 스냅샷 배선(fb2ApplyReport)으로 최신 게시본을 그대로 열람한다.
// 열람 중에는 편집 UI가 숨겨지며, 새로고침(F5)하면 로컬 편집 모드로 복귀(원본 IndexedDB 불변).
// 최신 게시본(report/{마지막 게시월}) 조회 — 뷰어 시점 열람과 스냅샷 내보내기가 공유
async function fb2FetchLatestReport(){
  if(!FB2.ready||!FB2.db)return null;
  const idxSnap=await FB2.db.ref('reportIndex').once('value');
  const idx=idxSnap.val()||{};
  const months=Object.keys(idx).filter(k=>/^\d{4}-\d{2}$/.test(k));
  let rm=months.length?months.reduce((a,b)=>(idx[a]>=idx[b]?a:b)):null; // 마지막으로 게시한 월
  let data=rm?(await FB2.db.ref('report/'+rm).once('value')).val():null;
  if(!data){ // 인덱스 도입 전 게시분 폴백
    const snap=await FB2.db.ref('report').orderByKey().limitToLast(1).once('value');
    const v=snap.val();if(v){rm=Object.keys(v)[0];data=v[rm];}
  }
  return (rm&&data)?{rm:rm,data:data}:null;
}
// 게시된 월 목록(최신순) — 스냅샷에 담을 월을 고를 때 사용
async function fb2ListReportMonths(){
  if(!FB2.ready||!FB2.db)return [];
  const snap=await FB2.db.ref('reportIndex').once('value');
  const idx=snap.val()||{};
  return Object.keys(idx).filter(k=>/^\d{4}-\d{2}$/.test(k)).sort().reverse();
}
// 스냅샷 내보내기 옵션 — 포함할 기준월(여러 달이면 파일 안에서 전환 가능)과 글꼴 포함 여부.
//   resolve: {months:[...], font:bool} / 취소 시 null. 모달을 닫아도(Esc·배경) 취소로 처리된다.
function pickSnapMonths(list,defRm){
  return new Promise(resolve=>{
    window.__SNAPPICK__=resolve;
    document.getElementById('mt').textContent='스냅샷 내보내기';
    let fontOn=false;try{fontOn=!!localStorage.getItem('snapFont');}catch(_){}
    const rows=list.map(m=>`<label class="share-row" style="cursor:pointer"><span class="share-info"><b>${esc(m)}</b>${m===defRm?'<span style="margin-left:8px;font-size:11px;color:var(--b700)">현재</span>':''}</span><input type="checkbox" class="snap-mo" value="${esc(m)}"${m===defRm?' checked':''} style="width:17px;height:17px;accent-color:var(--b600)"></label>`).join('<div class="share-sep"></div>');
    const moBlock=list.length>1
      ? '<p style="font-size:12.5px;color:var(--lbl2);line-height:1.6;margin:2px 0 10px">담을 <b>기준월</b>을 고르세요. 두 달 이상 담으면 파일 안에서 기준월을 바꿔가며 볼 수 있고, 그만큼 파일이 커집니다(월당 수백 KB~수 MB).</p>'+rows+'<div style="height:14px"></div>'
      : '';
    document.getElementById('mbody').innerHTML='<div class="md-scroll" style="max-height:52vh">'+moBlock+
      '<label class="share-row" style="cursor:pointer"><span class="share-info"><b>글꼴 포함</b><span>어느 PC에서 열어도 화면과 같은 글꼴로 보입니다 · 파일이 약 1.5MB 커집니다</span></span>'+
      '<input type="checkbox" id="snapFontChk"'+(fontOn?' checked':'')+' style="width:18px;height:18px;accent-color:var(--b600)"></label></div>';
    document.getElementById('mf').innerHTML=(list.length>1?'<button class="btn bo bsm" data-act="snapPick.all">전체 선택</button>':'')+'<div style="flex:1"></div><button class="btn bg2 bsm" data-act="snapPick.cancel">취소</button><button class="btn bp bsm" data-act="snapPick.ok">내보내기</button>';
    const mb=document.getElementById('mb');if(mb)mb.classList.add('wide');
    openMo();
  });
}
async function fb2ViewAsViewer(){
  try{
    if(!FB2.ready||!FB2.db){toast('네트워크에 연결할 수 없습니다');return;}
    const r=await fb2FetchLatestReport();
    if(!r){toast('아직 게시된 집계가 없습니다');return;}
    const rm=r.rm,data=r.data;
    fb2ApplyReport(rm,data);fb2SubReport(rm);fb2InitViewerRmSel(rm);fb2SubReportIndex();
    toast('뷰어 시점으로 열람 중 · 편집 모드로 돌아가려면 새로고침(F5)',7000);
  }catch(e){console.error('[FB2] 뷰어 시점 열람 실패',e);toast('게시본 열람 실패');}
}
function fb2ViewerEmpty(){
  document.body.classList.add('viewer');
  hideCover();
  toast('아직 게시된 집계가 없습니다. 관리자의 첫 등록을 기다려 주세요.',6000);
}

// ----- report/{기준월} 로드 → __SNAP__ 배선 재사용 -----
async function fb2LoadReportLatest(){
  // '최신' = 마지막으로 게시한 월(reportIndex의 값=게시시각이 최대인 키).
  // 구버전의 키 사전순(orderByKey.limitToLast)은 잘못 게시된 미래 월 노드가 남아 있으면
  // (예: 기준월 07 상태로 게시 → 06으로 재게시해도 report/07 잔존) 뷰어가 옛 07 게시본에
  // 고착되는 문제가 있어 게시 행위 시각 기준으로 판정한다. 인덱스가 비면 키순 폴백.
  try{
    const idxSnap=await FB2.db.ref('reportIndex').once('value');
    const idx=idxSnap.val()||{};
    const months=Object.keys(idx).filter(k=>/^\d{4}-\d{2}$/.test(k));
    if(months.length){
      const rm=months.reduce((a,b)=>(idx[a]>=idx[b]?a:b));
      const snap0=await FB2.db.ref('report/'+rm).once('value');
      const data=snap0.val();
      if(data)return{rm:rm,data:data};
    }
  }catch(e){console.warn('[FB2] reportIndex 최신월 판정 실패 — 키순 폴백',e);}
  const snap=await FB2.db.ref('report').orderByKey().limitToLast(1).once('value');
  const v=snap.val();if(!v)return null;
  const rm=Object.keys(v)[0];
  return{rm:rm,data:v[rm]||{}};
}
// 게시본(report/{rm}) → 뷰어가 보는 __SNAP__ 형태로 변환하는 순수 함수.
// 화면 상태를 전혀 건드리지 않으므로, 뷰어 적용(fb2ApplyReport)과 편집자의 스냅샷 내보내기가
// 같은 산출을 공유하면서도 후자는 편집 모드를 유지할 수 있다.
function buildSnapFromReport(rm,rep){
  rep=deepDecKeys(rep||{}); // 게시 시 인코딩된 중첩 맵 키(dtb/rpb/am/siteAm)를 원복 — 이후 st·am·siteAm은 정상 키
  const dash=rep._dash||{};
  const sites=Array.isArray(dash.sites)?dash.sites:[];
  const teams=Array.isArray(dash.teams)?dash.teams:[];
  const st={},siteWks={},siteAm={},vac={};
  for(const sid in rep){
    if(sid==='_dash'||sid==='_meta')continue;
    const n=rep[sid]||{};
    const k=st[sid]=n.kpi||{};
    // 전체 목록(압축 게시) 우선: ulz가 있으면 캡(300건) 배열을 대체해 편집자와 동일한 목록·피벗 제공.
    // 해제 실패 시 기존 캡 목록으로 폴백(표시 축소일 뿐 KPI 숫자는 게시값 그대로).
    if(typeof n.ulz==='string'&&n.ulz&&typeof LZString!=='undefined'){
      try{const full=JSON.parse(LZString.decompressFromBase64(n.ulz)||'null');if(Array.isArray(full)){k.ul=full;k.lul=null;}}
      catch(e){console.warn('[FB2] ulz 해제 실패 — 캡 목록 폴백',sid,e);}
    }
    deriveLul(k); // ulz 대체 후 또는 구버전 게시본(lul 빈 배열)에서 ul의 지연 30일+ 필터로 산출
    siteWks[sid]=n.siteWks||[];
    siteAm[sid]=n.siteAm||{};
    if(n.vac)vac[sid]=n.vac; // 공가/상가 상태(미분양·미키불출)는 게시 데이터 — 호출자가 cmt에 병합
  }
  const cmt={};Object.keys(S.cmt||{}).forEach(x=>{cmt[x]=Object.assign({},S.cmt[x]);}); // 사본 — 호출자 상태 불변
  Object.keys(vac).forEach(sid=>{const v=vac[sid];if(!cmt[sid])cmt[sid]={};if(v.vacantStatus)cmt[sid].vacantStatus=v.vacantStatus;if(v.commercialStatus)cmt[sid].commercialStatus=v.commercialStatus;});
  return {P:{rm:(/^\d{4}-\d{2}$/.test(rm)?rm:S.rm),sites:sites,teams:teams,cmt:cmt,ana:S.ana,st:st,wks:dash.wks||[],am:dash.am||{},siteWks:siteWks,siteAm:siteAm,insightsHTML:dash.insightsHTML||''},vac:vac};
}
function fb2ApplyReport(rm,rep){
  const built=buildSnapFromReport(rm,rep),P=built.P;
  S.sites=P.sites;S.teams=P.teams;
  if(/^\d{4}-\d{2}$/.test(rm))S.rm=rm;
  Object.keys(S.def).forEach(_k=>delete S.def[_k]); // 뷰어는 원본 행 없음 — 집계는 __SNAP__에서
  Object.keys(built.vac).forEach(sid=>{const v=built.vac[sid];if(!S.cmt[sid])S.cmt[sid]={};if(v.vacantStatus)S.cmt[sid].vacantStatus=v.vacantStatus;if(v.commercialStatus)S.cmt[sid].commercialStatus=v.commercialStatus;});
  P.cmt=S.cmt;P.ana=S.ana; // 실시간 처리계획·분석 갱신이 그대로 반영되도록 라이브 참조 유지
  window.__SNAP__=P;
  document.body.classList.add('viewer');
  ensureTeams();
  fb2ApplySiteCfg(); // 게시된 sites 위에 최신 토글(siteConfig) 덮어쓰기
  setRmChip();
  rTeamSel();rNav();
  if(S.view==='site'&&S.sid&&teamSites().some(s=>s.id===S.sid))rSite(S.sid);
  else go('dashboard');
  progHide();
}

// ----- 실시간 구독 -----
function fb2SubReport(rm){
  if(FB2._reportOff){try{FB2._reportOff();}catch(_){}} // 월 전환 시 이전 구독 해제(누적 방지)
  const ref=FB2.db.ref('report/'+rm);
  let first=true; // 최초 수신은 화면 구성 — 이후 수신만 '갱신'으로 알린다
  const h=ref.on('value',function(snap){
    const data=snap.val();if(!data)return;
    if(shEditing()){FB2._pendReport=data;FB2._pendReportRm=rm;return;}
    fb2ApplyReport(rm,data);
    if(first)first=false;
    else toast(rm+' 게시본이 갱신되었습니다 · 최신 집계로 표시 중',5000);
  });
  FB2._reportOff=function(){ref.off('value',h);};
}
// 게시월 인덱스 구독 — 열람 중 새 달이 등록되면 알리고 기준월 선택기를 갱신한다.
function fb2SubReportIndex(){
  if(FB2._idxBound)return;FB2._idxBound=true;
  const ref=FB2.db.ref('reportIndex');
  let known=null;
  const h=ref.on('value',function(snap){
    const idx=snap.val()||{};
    const months=Object.keys(idx).filter(k=>/^\d{4}-\d{2}$/.test(k)).sort();
    if(known===null){known=months;return;} // 최초 수신은 기준선만
    const added=months.filter(m=>known.indexOf(m)<0);
    known=months;
    if(!added.length)return;
    try{fb2InitViewerRmSel(S.rm);}catch(_){} // 선택기에 새 달 반영
    const newest=added.sort().reverse()[0];
    if(newest>S.rm)toastAction(newest+' 게시본이 새로 등록되었습니다','열기',()=>fb2SwitchReportMonth(newest),15000);
  });
  FB2.subs.push(function(){ref.off('value',h);});
}
// ── 뷰어 기준월 선택 — 월간보고 아카이브 열람 ──
async function fb2InitViewerRmSel(curRm){
  try{
    const snap=await FB2.db.ref('reportIndex').once('value');
    const idx=snap.val()||{};
    const months=Object.keys(idx).filter(k=>/^\d{4}-\d{2}$/.test(k));
    if(!months.includes(curRm))months.push(curRm); // 인덱스 도입 전 게시분 폴백
    months.sort().reverse();
    const mc=document.querySelector('.mc');if(!mc)return;
    let sel=document.getElementById('vrm');
    if(sel&&sel.parentNode===mc){mc.removeChild(sel);sel=null;} // 구버전 배치(칩 내부에 중첩) 정리
    if(!sel){sel=document.createElement('select');sel.id='vrm';sel.className='fbu-sel vrm-sel';sel.setAttribute('data-act','viewer.rm');sel.setAttribute('aria-label','열람할 기준월 선택');mc.parentNode.insertBefore(sel,mc.nextSibling);} // 칩과 나란히 — 칩 안에 넣으면 이중 캡슐이 됨
    sel.innerHTML=months.map(m=>`<option value="${m}" ${m===curRm?'selected':''}>${m}</option>`).join('');
    const _show=months.length>1;
    sel.style.display=_show?'':'none'; // 게시월이 1개면 숨김
    mc.style.display=_show?'none':''; // 선택기가 보이면 기준월 칩은 중복 정보 — 숨김
  }catch(e){console.warn('[FB2] reportIndex',e);}
}
async function fb2SwitchReportMonth(rm){
  if(!/^\d{4}-\d{2}$/.test(rm)||rm===S.rm)return;
  try{
    toast(rm+' 게시본 불러오는 중…');
    const snap=await FB2.db.ref('report/'+rm).once('value');
    const data=snap.val();
    if(!data){toast(rm+' 게시본이 없습니다');const sel=document.getElementById('vrm');if(sel)sel.value=S.rm;return;}
    fb2ApplyReport(rm,data);
    fb2SubReport(rm);
    fb2InitViewerRmSel(rm); // 칩 갱신 후 선택 상태 재동기화
  }catch(e){console.warn('[FB2] 월 전환 실패',e);toast('기준월 전환 실패');}
}
// ── P2: plans/analysis 구독 스코프 축소 ──
//   구버전은 루트 'value' 구독이라 누군가 키 하나를 수정할 때마다 전원이 전체 트리를 재전송받았다
//   (월버킷 복합키가 누적되면 키스트로크당 수백KB). 신버전: 진입 시 once로 1회 전체 병합(로컬 캐시 시드),
//   이후에는 현재 보고 있는 현장의 plans/{sid}·analysis/{sid}만 value 구독하고 현장 전환 시 off/재구독.
//   다른 현장의 원격 변경은 그 현장에 진입하는 순간(value 초기 발화) 병합된다.
// ★병합(교체 아님): Firebase 리프에 없는 로컬 키를 보존해야 다른 처리계획 칸이 사라지지 않음.
//   원격 값이 로컬과 다를 때만 changed=true → 자기 저장 에코 시에는 재렌더 생략(깜빡임 방지).
function _fb2MergePlanFields(sid,fields){
  const PF=['processingPlan','vacantProcessingPlan','commercialProcessingPlan'];
  let changed=false;
  if(!S.cmt[sid])S.cmt[sid]={};
  PF.forEach(function(f){
    const leaf=fields&&fields[f];
    if(leaf&&typeof leaf==='object'){
      if(!S.cmt[sid][f]||typeof S.cmt[sid][f]!=='object')S.cmt[sid][f]={};
      const tgt=S.cmt[sid][f];
      for(const ek in leaf){
        const dk=fbDecKey(ek);
        if(tgt[dk]!==leaf[ek]){tgt[dk]=leaf[ek];changed=true;}
      }
    }
  });
  return changed;
}
async function fb2PrimePlansAnalysis(){
  try{
    const pair=await Promise.all([FB2.db.ref('plans').once('value'),FB2.db.ref('analysis').once('value')]);
    let changed=false;
    const pv=pair[0].val()||{};
    for(const sid in pv){if(_fb2MergePlanFields(sid,pv[sid]))changed=true;}
    const av=pair[1].val()||{};
    for(const sid in av){
      const v=av[sid];
      if(typeof v==='string'){ // 레거시 단일 문자열 → 현재 기준월로 승격 + 원격도 월 노드로 재기록(하위 쓰기가 원시값 부모를 대체 — 멱등)
        if(v.length&&anaGet(sid)!==v){anaSet(sid,v);changed=true;try{if(/^\d{4}-\d{2}$/.test(S.rm))FB2.db.ref('analysis/'+sid+'/'+S.rm).set(v.slice(0,20000));}catch(_){}}
      }else if(v&&typeof v==='object'){
        for(const rm in v){if(typeof v[rm]==='string'&&anaGet(sid,rm)!==v[rm]){anaSet(sid,v[rm],rm);changed=true;}}
      }
    }
    if(changed){lsSave();fb2Rerender();}
  }catch(e){console.warn('[FB2] prime plans/analysis',e);}
}
function fb2ScopeSiteSubs(sid){
  sid=sid||null;
  if(FB2._siteSubSid===sid)return;
  (FB2._siteSubs||[]).forEach(function(off){try{off();}catch(_){}});
  FB2._siteSubs=[];FB2._siteSubSid=sid;
  if(!sid||!FB2.ready||!FB2.db)return;
  const pref=FB2.db.ref('plans/'+sid);
  const ph=pref.on('value',function(snap){
    if(_fb2MergePlanFields(sid,snap.val()||{})){lsSave();fb2Rerender();}
  });
  FB2._siteSubs.push(function(){pref.off('value',ph);});
  const aref=FB2.db.ref('analysis/'+sid);
  const ah=aref.on('value',function(snap){
    const v=snap.val();let ch=false,curTxt=null;
    if(typeof v==='string'){ // 레거시 → 현재 기준월 승격
      if(v.length&&anaGet(sid)!==v){anaSet(sid,v);ch=true;curTxt=v;}
    }else if(v&&typeof v==='object'){
      for(const rm in v){if(typeof v[rm]!=='string')continue;if(anaGet(sid,rm)!==v[rm]){anaSet(sid,v[rm],rm);ch=true;if(rm===S.rm)curTxt=v[rm];}}
    }
    if(!ch)return; // 자기 저장 에코 → 재렌더 생략(깜빡임 방지)
    lsSave();
    if(curTxt!=null&&S.view==='site'&&S.sid===sid&&!shEditing()){const el=document.getElementById('ait-'+sid);if(el)el.innerHTML=safeHTML(curTxt);}
    fb2Rerender();
  });
  FB2._siteSubs.push(function(){aref.off('value',ah);});
}
// ----- 현장 토글(공가세대 표시·공가상가 포함) 실시간 동기화 -----
// 편집자만 변경 가능. siteConfig/{sid} 리프에 저장 → 모든 사용자에게 실시간 반영.
function fb2SiteConfigWrite(sid){
  if(!FB2.ready||!FB2.db||!sid)return;
  if(!fb2IsEditor())return; // 토글은 관리자 전용
  const s=S.sites.find(x=>x.id===sid);if(!s)return;
  try{FB2.db.ref('siteConfig/'+sid).update({hasCommercial:!!s.hasCommercial,showVacant:s.showVacant!==false,updatedAt:Date.now()});}
  catch(e){console.warn('[FB2] siteConfigWrite',e);}
}
// 캐시된 siteConfig를 현재 S.sites에 병합. 변경이 있으면 true 반환.
function fb2ApplySiteCfg(){
  const cfg=FB2._siteCfg||{};let changed=false;
  for(const sid in cfg){
    const c=cfg[sid]||{},s=S.sites.find(x=>x.id===sid);if(!s)continue;
    if(typeof c.hasCommercial==='boolean'&&s.hasCommercial!==c.hasCommercial){s.hasCommercial=c.hasCommercial;changed=true;}
    if(typeof c.showVacant==='boolean'&&(s.showVacant!==false)!==c.showVacant){s.showVacant=c.showVacant;changed=true;}
  }
  return changed;
}
function fb2SubSiteConfig(){
  if(FB2._siteCfgBound)return;FB2._siteCfgBound=true;
  const ref=FB2.db.ref('siteConfig');
  const h=ref.on('value',function(snap){
    FB2._siteCfg=snap.val()||{};
    const changed=fb2ApplySiteCfg();
    if(changed){lsSave();fb2Rerender();} // 자기 토글 에코는 값이 같아 changed=false → 깜빡임 없음
  });
  FB2.subs.push(function(){ref.off('value',h);});
}
// ----- AI 분석 규칙 팀 공유 동기화 -----
// 규칙(추가 지침·중대하자 키워드·기본 규칙 override)을 DB 최상위 aiRules 노드에 저장 → 전 사용자 실시간 공유.
// 쓰기는 편집자 전용(클라이언트 게이트 + DB 보안규칙으로 강제 — siteConfig와 동일하게 aiRules 노드 규칙 추가 필요).
function fb2Rerender(){
  if(shEditing()){FB2._pendRerender=true;return;}
  FB2._pendRerender=false;
  try{rTeamSel();rNav();}catch(e){}
  if(S.view==='dashboard')rDash();
  else if(S.view==='site'&&S.sid)rSite(S.sid);
}
function fb2BindFocusout(){
  if(FB2._foBound)return;FB2._foBound=true;
  document.addEventListener('focusout',function(e){
    const t=e.target;
    if(t&&t.classList&&t.classList.contains('plan-ta')){try{commitPlanSave(t);}catch(_){}}
    setTimeout(function(){
      if(shEditing())return;
      if(FB2._pendReport){const d=FB2._pendReport,rm=FB2._pendReportRm;FB2._pendReport=null;FB2._pendReportRm=null;fb2ApplyReport(rm,d);}
      if(FB2._pendRerender){FB2._pendRerender=false;fb2Rerender();}
    },180);
  });
}

// ----- 리프 쓰기 (처리계획 / 분석의견 / meta) -----
function fb2PlanWrite(sid,field,key,value){
  if(!FB2.ready||!FB2.db)return;
  if(field!=='processingPlan'&&field!=='vacantProcessingPlan'&&field!=='commercialProcessingPlan')return;
  if(key==null||key==='')return;
  try{
    const v=String(value==null?'':value).slice(0,5000);
    FB2.db.ref('plans/'+sid+'/'+field+'/'+fbEncKey(key)).set(v);
    fb2TouchMeta(sid);
  }catch(e){console.warn('[FB2] planWrite',e);}
}
// ── 분석의견 월별 아카이브 — S.ana[sid] = { 'YYYY-MM': html } ──
//   처리계획(기준월@공종 키)과 대칭. 분석은 calc(기준월) 산출물이라 태생이 월간 문서인데
//   기존 단일 문자열 저장은 매월 재생성 시 전월 분석을 파괴했다. 레거시 문자열 값(로컬·원격)은
//   최초 조우 시 '현재 기준월' 항목으로 1회 승격한다(귀속 월 정보가 없어 현재월이 최선의 추정).
function anaNormalize(){let ch=false;for(const sid in S.ana){const v=S.ana[sid];if(typeof v==='string'){S.ana[sid]=v.length?{[S.rm]:v}:{};ch=true;}}return ch;}
function anaGet(sid,rm){const m=S.ana[sid];if(!m)return'';if(typeof m==='string')return m;const v=m[rm||S.rm];return typeof v==='string'?v:'';}
function anaSet(sid,txt,rm){if(!S.ana[sid]||typeof S.ana[sid]!=='object')S.ana[sid]={};S.ana[sid][rm||S.rm]=txt;}
function fb2AnaWrite(sid,txt){
  if(!FB2.ready||!FB2.db)return;
  if(!/^\d{4}-\d{2}$/.test(S.rm))return;
  try{FB2.db.ref('analysis/'+sid+'/'+S.rm).set(String(txt==null?'':txt).slice(0,20000));fb2TouchMeta(sid);}
  catch(e){console.warn('[FB2] anaWrite',e);}
}
function fb2TouchMeta(sid){
  if(!FB2.ready||!FB2.db)return;
  try{FB2.db.ref('meta/'+sid).set({updatedAt:Date.now(),updatedBy:String((FB2.user&&FB2.user.email)||'').slice(0,120)});}catch(e){}
}

// ----- 게시 (편집자 전용): 현재 집계를 report/{기준월}/{현장}에 set -----
async function fb2Publish(){
  if(!fb2IsEditor()){toast('등록 권한이 없습니다(편집자 전용)');return;}
  if(!FB2.ready||!FB2.db){toast('네트워크에 연결할 수 없습니다.');return;}
  if(!Object.keys(S.def||{}).length){toast('등록할 데이터가 없습니다 · 먼저 리스트를 업로드하세요');return;}
  const btn=document.getElementById('fbPubBtn');if(btn)btn.disabled=true;
  try{
    toast('등록 준비 중…');
    const cap=capAll(); // 순수 산출 — 렌더·타이머 의존 제거(P3): 느린 기기·백그라운드 탭 캡처 누락 불가
    if(S.view==='dashboard'&&rDash._flush)rDash._flush(); // 대시보드에 있으면 인사이트를 동기 최신화 후 캡처
    let insightsHTML=insCleanHTML(); // 확장 상세는 캡처에서 제외
    if(!insightsHTML.replace(/\s/g,'')){
      // 이 세션에서 대시보드를 열지 않고 설정에서 바로 게시한 경우 — 인사이트 지연 렌더(_late)는
      // 대시보드 뷰가 아니면 스킵하므로 DOM이 비어 있다. 스냅샷 내보내기와 동일하게 대시보드로
      // 이동해 동기 렌더 후 캡처한다(게시 직후 결과 확인 동선과도 자연스럽게 일치).
      try{go('dashboard');if(rDash._flush)rDash._flush();insightsHTML=insCleanHTML();}
      catch(e){console.warn('[FB2] 주요 이슈 사전 렌더 실패',e);}
    }
    const rm=S.rm;
    const upd={};
    upd['report/'+rm+'/_dash']={wks:cap.wks||[],am:cap.am||{},insightsHTML:insightsHTML,sites:S.sites,teams:S.teams};
    teamSites().forEach(function(s2){ // 인수 전 현장 포함 — '대시보드 집계 제외'는 유지되나 현장 개별 게시본은 전 현장에 제공
      const r=calc(S.def[s2.id]||[],s2,rm);
      const kpi=Object.assign({},r,{ul:redactUL(r.ul),lul:redactUL(r.lul),critUl:redactUL(r.critUl)}); // 캡(300) 목록 — ulz 해제 실패 시 폴백
      // 전체 미처리 목록(압축) — 만건 이상 현장도 뷰어가 편집자와 동일한 목록·피벗을 보도록
      // 표시·피벗에 쓰는 필드만 담아 LZ+Base64로 게시한다(접수내용·민원은 기존 정책대로 제외).
      // 규모 감: 1만건 ≈ JSON 1.5MB → 압축 후 수백KB (RTDB 문자열 한도 10MB 대비 여유).
      let ulz='';
      try{
        if(typeof LZString!=='undefined'){
          const slim=slimUL(r.ul);
          ulz=LZString.compressToBase64(JSON.stringify(slim));
        }
      }catch(e){console.warn('[FB2] ulz 압축 실패 — 캡 목록으로 게시',s2.id,e);ulz='';}
      const cm=S.cmt[s2.id]||{},vac={};
      if(cm.vacantStatus)vac.vacantStatus=cm.vacantStatus;
      if(cm.commercialStatus)vac.commercialStatus=cm.commercialStatus;
      upd['report/'+rm+'/'+s2.id]={kpi:kpi,ulz:ulz,siteWks:(cap.siteWks&&cap.siteWks[s2.id])||[],siteAm:(cap.siteAm&&cap.siteAm[s2.id])||{},vac:vac};
    });
    upd['report/'+rm+'/_meta']={publishedAt:Date.now(),publishedBy:String((FB2.user&&FB2.user.email)||'').slice(0,120),rm:rm};
    upd['reportIndex/'+rm]=Date.now(); // 게시월 인덱스 — 뷰어 기준월 선택기가 이 노드만 읽어 목록 구성(전체 report 다운로드 방지)
    Object.keys(upd).forEach(function(p){upd[p]=deepEncKeys(upd[p]);}); // 중첩 맵 키(하자유형/공종/보수주체 등)에 '/'·'.' 등이 있으면 거부되므로 인코딩
    await FB2.db.ref().update(upd);
    // 편집자가 로컬에만 갖고 있던 처리계획·분석의견을 리프로 시드(실시간 협업 시작점) — 실패해도 게시 자체는 완료.
    try{await fb2SeedPlansAnalysis();}catch(e){console.warn('[FB2] seed 실패',e);toast('처리계획·분석 시드 일부 실패 · 게시는 완료됨');}
    fb2RefreshMeta();
    toastAction('등록 완료 · '+rm+' · 현장 '+teamSites().length+'개','스냅샷 저장',()=>{try{exportSnapshot();}catch(e){console.error(e);}},12000);
    // 잔존 미래 게시월 정리: 기준월이 잘못 설정된 채 게시된 노드(예: 2026-07)가 남아 있으면
    // 뷰어 기준월 선택기에 계속 노출되고 과거엔 '최신'으로 오판되던 원인이므로 삭제를 제안한다.
    try{
      const _idxSnap=await FB2.db.ref('reportIndex').once('value');
      const _stale=Object.keys(_idxSnap.val()||{}).filter(k=>/^\d{4}-\d{2}$/.test(k)&&k>rm);
      if(_stale.length){
        toastAction('기준월('+rm+')보다 미래인 게시월 발견: '+_stale.join(', ')+' — 잘못 게시된 월이면 삭제하세요','삭제',async()=>{
          const del={};_stale.forEach(m=>{del['report/'+m]=null;del['reportIndex/'+m]=null;});
          try{await FB2.db.ref().update(del);toast('게시월 삭제 완료 · '+_stale.join(', '));}
          catch(e2){console.error('[FB2] 게시월 삭제 실패',e2);toast('삭제 실패: '+((e2&&e2.message)||e2));}
        },15000);
      }
    }catch(e){console.warn('[FB2] 미래 게시월 감지 실패',e);}
  }catch(e){console.error('[FB2] publish 실패',e);toast('등록 실패: '+((e&&e.message)||e));}
  finally{if(btn)btn.disabled=false;}
}
async function fb2SeedPlansAnalysis(){
  // 시드는 '원격에 없는 리프만' 채운다(add-only). 처리계획·분석의견은 뷰어 포함 MEMBER 전원이
  // 실시간으로 쓰는 협업 데이터인데, P2 이후 편집자 로컬은 안 보고 있던 현장에 대해 스테일일 수 있어
  // 무조건 덮어쓰면 게시 순간 동료가 쓴 값이 편집자의 옛 값으로 회귀한다. 원격 우선 + 빈 곳만 시드.
  const PF=['processingPlan','vacantProcessingPlan','commercialProcessingPlan'];
  const pair=await Promise.all([FB2.db.ref('plans').once('value'),FB2.db.ref('analysis').once('value')]);
  const remoteP=pair[0].val()||{},remoteA=pair[1].val()||{};
  const upd={};
  for(const sid in S.cmt){
    const cm=S.cmt[sid]||{};
    PF.forEach(function(f){
      const leaf=cm[f];
      if(leaf&&typeof leaf==='object'){
        for(const k in leaf){
          const v=leaf[k];if(typeof v!=='string'||!v.length)continue;
          const ek=fbEncKey(k);
          const rv=remoteP[sid]&&remoteP[sid][f]?remoteP[sid][f][ek]:undefined;
          if(rv!==undefined)continue; // 원격에 이미 존재 → 덮어쓰지 않음
          upd['plans/'+sid+'/'+f+'/'+ek]=v.slice(0,5000);
        }
      }
    });
  }
  for(const sid in S.ana){
    const m=S.ana[sid];if(!m||typeof m!=='object')continue; // 부팅 시 anaNormalize로 맵 보장
    const rnode=remoteA[sid];
    for(const rm in m){
      const v=m[rm];if(typeof v!=='string'||!v.length||!/^\d{4}-\d{2}$/.test(rm))continue;
      const rv=(rnode&&typeof rnode==='object')?rnode[rm]:(typeof rnode==='string'&&rm===S.rm?rnode:undefined);
      if(typeof rv==='string'&&rv.length)continue; // 원격 우선(add-only)
      upd['analysis/'+sid+'/'+rm]=v.slice(0,20000);
    }
  }
  if(Object.keys(upd).length)await FB2.db.ref().update(upd);
}
function fb2RefreshMeta(){
  if(FB2.ready&&FB2.db){
    FB2.db.ref('report/'+S.rm+'/_meta').once('value').then(function(s){
      const m=s.val(),el=document.getElementById('fbPubAt');
      if(el)el.textContent=(m&&m.publishedAt)?(new Date(m.publishedAt).toLocaleString('ko-KR')+(m.publishedBy?(' · '+m.publishedBy):'')):'미등록';
    }).catch(function(){});
  }
}
window.fb2Publish=fb2Publish;

// 처리계획 textarea — 디바운스 자동저장 + ✓ 인디케이터
const _planTimers=new WeakMap();
function schedulePlanSave(el){clearTimeout(_planTimers.get(el));_planTimers.set(el,setTimeout(()=>commitPlanSave(el),600));}
function commitPlanSave(el){
  const id=el.dataset.planId;if(!id)return;
  const parts=id.split('|');// 형식: cmt|{sid}|{field}|{key?}
  const [type,sid,field,key]=parts;
  const value=el.value;
  if(type==='cmt'){
    if(!S.cmt[sid])S.cmt[sid]={};
    if(key){if(!S.cmt[sid][field])S.cmt[sid][field]={};S.cmt[sid][field][key]=value;}
    else{S.cmt[sid][field]=value;}
  }
  lsSave();
  
  if(type==='cmt'&&key)fb2PlanWrite(sid,field,key,value); // 사내 Firebase 실시간 리프 쓰기
  showSaved(el);
}
function showSaved(el){
  let host=el.parentElement;if(!host)return;
  if(getComputedStyle(host).position==='static')host.style.position='relative';
  let ind=host.querySelector('.saved-mark');
  if(!ind){ind=document.createElement('span');ind.className='saved-mark';ind.textContent='✓ 저장됨';host.appendChild(ind);}
  ind.classList.remove('show');// 재트리거를 위해 reflow
  void ind.offsetWidth;
  ind.classList.add('show');
  clearTimeout(ind._t);ind._t=setTimeout(()=>ind.classList.remove('show'),1200);
}

// ── 미처리 레코드 드릴다운: 공종/지표 클릭 → 해당 미처리 건 목록(검색 가능) ──
// ── 미처리 레코드 드릴다운: 정렬 + 컬럼 필터 + 내보내기 ──
const REC_COLS=[
  {key:'__no',label:'No',type:'num',w:46},
  {key:'building',label:'동',type:'str',w:62},
  {key:'unit',label:'호',type:'str',w:62},
  {key:'receiptDate',label:'접수일',type:'str',w:132,filter:'dateRange'},
  {key:'defectClass',label:'하자구분',type:'str',w:84},
  {key:'space',label:'공간',type:'str',w:84},
  {key:'trade',label:'공종',type:'str',w:96},
  {key:'defectType',label:'하자유형',type:'str',w:96},
  {key:'receiptContent',label:'접수내용',type:'str',left:true,w:null},
  {key:'repairParty',label:'보수주체',type:'str',w:92},
  {key:'contractor',label:'시공업체',type:'str',w:120},
  {key:'repairContractor',label:'보수업체',type:'str',w:120},
  {key:'delayDays',label:'지연일',type:'num',w:78,filter:'numRange'}
];
function recCell(r,k){if(k==='__no')return '';const v=r[k];return v==null?'':v;}
// 팀 전체 목록(대시보드 진입)일 때만 No 옆에 '현장' 컬럼을 삽입 — 현장 단위 모달에선 기존 컬럼 그대로
const REC_SITE_COL={key:'siteName',label:'현장',type:'str',w:152};
function recCols(){const R=window.__REC;return (R&&R.withSite)?[REC_COLS[0],REC_SITE_COL].concat(REC_COLS.slice(1)):REC_COLS;}
// 렌더 전용 가시 컬럼 — 숨긴 열(R.hidden)을 제외. 필터·정렬·엑셀 내보내기는 recCols()(전체) 유지.
function recVisCols(){const R=window.__REC;const h=R&&R.hidden;return recCols().filter(c=>!(h&&h.has(c.key)));}
// 지연구간(밴드) 판정 — calc의 KPI 지연구간(d0/d30/d60)과 동일한 역산(기준월 말일 − 접수일). 원본 지연일 컬럼과 별개.
function recDelayDays(r,R){return Math.max(0,Math.round((new Date(R.rmEnd)-new Date(r.receiptDate))/86400000));}
function recBandOf(dd){return dd>=60?'d60':dd>=30?'d30':'d0';}
function recComputeView(){
  const R=window.__REC;if(!R)return [];
  let rows=R.all.slice();
  if(R.band)rows=rows.filter(r=>recBandOf(recDelayDays(r,R))===R.band); // 지연구간 칩 필터 (KPI와 동일 기준)
  if(R.vac)rows=rows.filter(r=>R.vac==='unit'?isVacUnit(r):isVacStore(r,{hasCommercial:(r.__hc!==undefined?r.__hc:R.vacHC)})); // 공가세대·공가상가 칩 필터
  if(R.q&&R.q.trim()){ // 통합 검색: 공백=AND, 'N동'/'N호'는 정밀, 그 외는 주요 필드 부분매치
    const toks=R.q.trim().split(/\s+/).filter(Boolean);
    rows=rows.filter(r=>toks.every(t=>{
      let m;
      if((m=t.match(/^(.+)동$/)))return String(r.building||'')===m[1]||String(r.building||'')===t;
      if((m=t.match(/^(.+)호$/)))return String(r.unit||'')===m[1]||String(r.unit||'')===t;
      const blob=(String(r.siteName||'')+'|'+String(r.building||'')+'|'+String(r.unit||'')+'|'+String(r.trade||'')+'|'+String(r.defectType||'')+'|'+String(r.space||'')+'|'+String(r.contractor||'')+'|'+String(r.receiptContent||'')+'|'+String(r.complaint||'')).toLowerCase();
      return blob.includes(t.toLowerCase());
    }));
  }
  for(const c of recCols()){
    if(c.key==='__no')continue;
    const raw=R.filters[c.key];
    if(raw!=null&&String(raw).trim()){
      const s=String(raw).trim();
      if(c.filter==='dateRange'){
        const[a,b]=s.split('~').map(x=>x.trim());
        if(a)rows=rows.filter(r=>{const v=String(recCell(r,c.key));return v&&v>=a;});
        if(b)rows=rows.filter(r=>{const v=String(recCell(r,c.key));return v&&v<=b;});
      }else if(c.filter==='numRange'){
        const[a,b]=s.split('~').map(x=>x.trim());
        const lo=(a&&!isNaN(+a))?+a:null,hi=(b&&!isNaN(+b))?+b:null;
        if(lo!=null)rows=rows.filter(r=>(+recCell(r,c.key)||0)>=lo);
        if(hi!=null)rows=rows.filter(r=>(+recCell(r,c.key)||0)<=hi);
      }else{
        const terms=s.split(';').map(x=>x.trim().toLowerCase()).filter(Boolean);
        if(terms.length)rows=rows.filter(r=>{const v=String(recCell(r,c.key)).toLowerCase();return terms.some(t=>v.includes(t));});
      }
    }
    const vf=R.valueFilters[c.key];
    if(vf instanceof Set)rows=rows.filter(r=>vf.has(String(recCell(r,c.key))));
  }
  if(R.sort.key&&R.sort.key!=='__no'){
    const col=recCols().find(c=>c.key===R.sort.key),dir=R.sort.dir;
    rows.sort((a,b)=>{const va=recCell(a,R.sort.key),vb=recCell(b,R.sort.key);
      if(col&&col.type==='num')return((+va||0)-(+vb||0))*dir;
      return String(va).localeCompare(String(vb),'ko')*dir;});
  }
  R.view=rows;return rows;
}
function recFilterCellHTML(c){
  if(c.key==='__no')return '<td class="rl-fc"></td>';
  const R=window.__REC;
  return html`<td class="rl-fc"><input class="rl-fin" data-key="${c.key}" data-act="rec.filter" value="${R.filters[c.key]||''}" autocomplete="off"></td>`;
}
// ── 헤더 우클릭 팝업(엑셀식 값 선택 필터 + 필터행 토글) ──
function recDistinct(key){
  const R=window.__REC,col=recCols().find(c=>c.key===key);
  const arr=[...new Set(R.all.map(r=>String(recCell(r,key))))];
  if(col&&col.type==='num')arr.sort((a,b)=>(+a||0)-(+b||0));else arr.sort((a,b)=>String(a).localeCompare(String(b),'ko'));
  return arr;
}
function recDateTree(vals){
  const years={},other=[];
  vals.forEach(v=>{const m=/^(\d{4})-(\d{2})-(\d{2})/.exec(v);if(!m){other.push(v);return;}const y=m[1],mo=m[2];(years[y]=years[y]||{});(years[y][mo]=years[y][mo]||[]);years[y][mo].push(v);});
  return {years,other};
}
function recDateLeaves(T,node){
  if(node[0]==='y')return Object.values(T.years[node.slice(2)]||{}).flat();
  const m=/^m:(\d{4})-(\d{2})/.exec(node);return m?((T.years[m[1]]||{})[m[2]]||[]):[];
}
function recTri(leaves,sel){let c=0;for(const v of leaves)if(sel.has(v))c++;return c===0?'none':(c===leaves.length?'all':'partial');}
function recMenuDateTreeHTML(){
  const M=window.__RECMENU,T=M.dateTree,q=(M.q||'').trim().toLowerCase();
  const hit=v=>!q||String(v).toLowerCase().includes(q);
  const cb=s=>s==='all'?'checked':'',tri=s=>s==='partial'?' data-tri="1"':'';
  const tog=(node,exp)=>`<button class="rl-tree-tog" data-act="rec.menuTreeToggle" data-node="${node}">${exp?'−':'+'}</button>`;
  const spacer='<span class="rl-tree-tog rl-tree-spacer">·</span>';
  const row=(pad,head,chkAttr,label,triS)=>`<div class="rl-tree-row" style="padding-left:${pad}px">${head}<label class="rl-tree-cl"><input type="checkbox" ${chkAttr}${tri(triS||'none')}><span class="rl-tree-lbl">${label}</span></label></div>`;
  let html=`<div class="rl-tree-row rl-tree-all"><span class="rl-tree-tog rl-tree-spacer">·</span><label class="rl-tree-cl"><input type="checkbox" data-act="rec.menuAll"><span class="rl-tree-lbl">(모두 선택)</span></label></div>`;
  Object.keys(T.years).sort((a,b)=>b.localeCompare(a)).forEach(y=>{
    const yl=Object.values(T.years[y]).flat();if(!yl.some(hit))return;
    const yExp=M.expand.has('y:'+y)||!!q,yState=recTri(yl,M.sel);
    html+=row(4,tog('y:'+y,yExp),`data-act="rec.menuTreeCheck" data-node="y:${y}" ${cb(yState)}`,y+'년',yState);
    if(!yExp)return;
    Object.keys(T.years[y]).sort().forEach(mo=>{
      const ml=T.years[y][mo];if(!ml.some(hit))return;
      const mExp=M.expand.has('m:'+y+'-'+mo)||!!q,mState=recTri(ml,M.sel);
      html+=row(26,tog('m:'+y+'-'+mo,mExp),`data-act="rec.menuTreeCheck" data-node="m:${y}-${mo}" ${cb(mState)}`,Number(mo)+'월',mState);
      if(!mExp)return;
      ml.slice().sort().forEach(v=>{if(!hit(v))return;html+=row(48,spacer,`data-act="rec.menuVal" data-val="${esc(v)}" ${M.sel.has(v)?'checked':''}`,Number(v.slice(8,10))+'일');});
    });
  });
  T.other.forEach(v=>{if(!hit(v))return;html+=row(4,spacer,`data-act="rec.menuVal" data-val="${esc(v)}" ${M.sel.has(v)?'checked':''}`,v===''?'(빈값)':esc(v));});
  return html;
}
function recMenuListHTML(){
  const M=window.__RECMENU;if(M.dateTree)return recMenuDateTreeHTML();
  const q=(M.q||'').trim().toLowerCase();
  let list=q?M.all.filter(v=>v.toLowerCase().includes(q)):M.all;
  const CAP=400,more=list.length>CAP;if(more)list=list.slice(0,CAP);
  const allc=M.sel.size===M.all.length&&M.all.length>0;
  const head=`<label class="rl-menu-item rl-menu-all"><input type="checkbox" data-act="rec.menuAll" ${allc?'checked':''}><span>(모두 선택)</span></label>`;
  const items=list.map(v=>`<label class="rl-menu-item"><input type="checkbox" data-act="rec.menuVal" data-val="${esc(v)}" ${M.sel.has(v)?'checked':''}><span>${v===''?'(빈값)':esc(v)}</span></label>`).join('');
  return head+items+(more?`<div class="rl-menu-note">상위 ${CAP}개 표시 · 검색으로 좁히세요</div>`:'');
}
function recMenuHTML(){
  const M=window.__RECMENU,col=recCols().find(c=>c.key===M.key);
  return `<div class="rl-menu-hd">${esc(col?col.label:'')} 필터</div><button class="rl-menu-row" data-act="rec.menuToggleRow">${window.__REC.filterRow?'필터행 숨기기':'필터행 표시'}</button><button class="rl-menu-row" data-act="rec.menuHideCol">이 열 숨기기</button>${(window.__REC.hidden&&window.__REC.hidden.size)?`<button class="rl-menu-row" data-act="rec.menuShowCols">숨긴 열 모두 표시 (${window.__REC.hidden.size})</button>`:''}<div class="rl-menu-sep"></div><input class="rl-menu-q" placeholder="검색" data-act="rec.menuSearch" value="${esc(M.q||'')}" autocomplete="off"><div class="rl-menu-list" id="rlMenuList">${recMenuListHTML()}</div><div class="rl-menu-foot"><button class="btn bg2 bsm" data-act="rec.menuClear">필터 해제</button><button class="btn bo bsm" data-act="rec.menuApply">적용</button></div>`;
}
function recMenuSyncAll(){
  const M=window.__RECMENU;if(!M)return;
  const a=document.querySelector('#rlMenu [data-act="rec.menuAll"]');
  if(a){const allc=M.sel.size===M.all.length&&M.all.length>0;a.checked=allc;a.indeterminate=M.sel.size>0&&!allc;}
}
function recMenuRenderList(){const l=document.getElementById('rlMenuList');if(l){l.innerHTML=recMenuListHTML();l.querySelectorAll('input[data-tri]').forEach(c=>{c.indeterminate=true;});}recMenuSyncAll();}
function recOpenMenu(key,x,y){
  const R=window.__REC;if(!R)return;
  const all=recDistinct(key),cur=R.valueFilters[key];
  const dv=all.filter(v=>/^\d{4}-\d{2}-\d{2}/.test(v)),nonEmpty=all.filter(v=>v!=='').length;
  const isDate=dv.length>1&&dv.length>=nonEmpty*0.7;
  window.__RECMENU={key,all,sel:(cur instanceof Set)?new Set(cur):new Set(all),q:'',dateTree:isDate?recDateTree(all):null,expand:new Set()};
  let m=document.getElementById('rlMenu');
  if(!m){m=document.createElement('div');m.id='rlMenu';m.className='rl-menu';document.body.appendChild(m);}
  m.innerHTML=recMenuHTML();m.style.display='block';
  const mw=244,mh=Math.min(400,window.innerHeight*0.7);
  m.style.left=Math.max(8,Math.min(x,window.innerWidth-mw-8))+'px';
  m.style.top=Math.max(8,Math.min(y,window.innerHeight-mh-8))+'px';
  const l=document.getElementById('rlMenuList');if(l)l.querySelectorAll('input[data-tri]').forEach(c=>{c.indeterminate=true;});
  recMenuSyncAll();
}
function recCloseMenu(){const m=document.getElementById('rlMenu');if(m)m.style.display='none';window.__RECMENU=null;}
// ── 피벗 테이블 (행 × 열 × 집계) ──
const PIVOT_FIELDS=[
  {key:'siteName',label:'현장'},
  {key:'__month',label:'접수월'},
  {key:'trade',label:'공종'},
  {key:'defectClass',label:'하자구분'},
  {key:'defectType',label:'하자유형'},
  {key:'repairParty',label:'보수주체'},
  {key:'contractor',label:'시공업체'},
  {key:'repairContractor',label:'보수업체'}
];
function pivotCell(r,k){return k==='__month'?String(r.receiptDate||'').slice(0,7):String(recCell(r,k));}
function pivotFieldLabel(k){const f=PIVOT_FIELDS.find(x=>x.key===k);return f?f.label:String(k||'');}
function recPivotData(){
  const R=window.__REC,P=R.pivot;
  recComputeView();
  const rows=R.view,rks=P.rows,ck=P.col,cset=new Set();
  const root={value:'전체',children:{},cells:{},cellsS:{},total:0,totalS:0,depth:-1};
  for(const r of rows){
    const cv=ck?(pivotCell(r,ck)||'(빈값)'):'__all';
    const dd=recDelayDays(r,R); // 평균 지연일용 — KPI 지연구간과 동일 역산
    cset.add(cv);
    root.total++;root.cells[cv]=(root.cells[cv]||0)+1;root.totalS+=dd;root.cellsS[cv]=(root.cellsS[cv]||0)+dd;
    let cur=root;
    for(const k of rks){
      const v=pivotCell(r,k)||'(빈값)';
      let ch=cur.children[v];if(!ch)ch=cur.children[v]={value:v,children:{},cells:{},cellsS:{},total:0,totalS:0,depth:cur.depth+1};
      ch.total++;ch.cells[cv]=(ch.cells[cv]||0)+1;ch.totalS+=dd;ch.cellsS[cv]=(ch.cellsS[cv]||0)+dd;cur=ch;
    }
  }
  const val=P.val||'count';
  // 열 정렬: 행처럼 값이 큰 열이 앞으로(건수=합계 내림차순, 평균지연=평균 내림차순). 동률은 가나다.
  // 예외: 접수월(__month) 열은 값순으로 섞으면 시간축이 깨지므로 시간순(가나다=연월순) 유지.
  const colsA=ck?[...cset].sort((a,b)=>{
    if(ck==='__month')return String(a).localeCompare(String(b),'ko');
    const ca=root.cells[a]||0,cb=root.cells[b]||0;
    const va=val==='avgDelay'?(ca?(root.cellsS[a]||0)/ca:0):ca;
    const vb=val==='avgDelay'?(cb?(root.cellsS[b]||0)/cb:0):cb;
    return (vb-va)||String(a).localeCompare(String(b),'ko');
  }):['__all'];
  const colTot={};colsA.forEach(cv=>colTot[cv]=root.cells[cv]||0);
  const colTotS={};colsA.forEach(cv=>colTotS[cv]=root.cellsS[cv]||0);
  return {root,colsA,colTot,colTotS,grand:root.total,grandS:root.totalS,hasCol:!!ck,rks,maxD:rks.length,val,sort:Object.assign({},P.sort||{key:'__total',dir:-1},{vm:val})};
}
function pivotSortNodes(nodes,sort){
  const k=sort.key,dir=sort.dir,vm=sort.vm;
  const val=n=>{const cc=k.slice(0,2)==='c:'?(n.cells[k.slice(2)]||0):n.total;if(vm!=='avgDelay')return cc;const ss=k.slice(0,2)==='c:'?((n.cellsS||{})[k.slice(2)]||0):(n.totalS||0);return cc?ss/cc:0;};
  return nodes.slice().sort((a,b)=>{
    if(k==='__label')return String(a.value).localeCompare(String(b.value),'ko')*dir;
    return (val(a)-val(b))*dir || String(a.value).localeCompare(String(b.value),'ko');
  });
}
function recPivotTableHTML(){
  const D=recPivotData();
  if(!D.grand)return '<div class="pv-empty">표시할 데이터가 없습니다</div>';
  const cd=cv=>cv==='(빈값)'?'(빈값)':esc(cv),arr=k=>D.sort.key===k?(D.sort.dir>0?' ▲':' ▼'):'';
  const showPct=!!(window.__REC&&window.__REC.showPct); // % 병기 토글(피벗 바 우측) — 기본 OFF
  const dsp=(c,sm)=>{ // 값 모드별 셀 표시 — 건수 모드는 토글 ON 시 전체(합계) 대비 비중 % 병기(구성비 파악용)
    if(D.val==='avgDelay')return c?Math.round(sm/c).toLocaleString():'·';
    if(!c)return '·';
    if(!showPct)return c.toLocaleString();
    const pct=D.grand?c/D.grand*100:0;
    return c.toLocaleString()+`<span class="pv-pct">${pct>=9.95?pct.toFixed(0):pct.toFixed(1)}%</span>`;
  };
  const lblHead=D.rks.length?D.rks.map(pivotFieldLabel).join(' › '):'전체';
  let h=`<thead><tr><th class="pv-rh pv-th" data-act="rec.pivotSort" data-pk="__label">${esc(lblHead)}${arr('__label')}</th>`;
  if(D.hasCol)D.colsA.forEach(cv=>h+=`<th class="pv-th" data-act="rec.pivotSort" data-pk="c:${esc(cv)}">${cd(cv)}${arr('c:'+cv)}</th>`);
  h+=`<th class="pv-tot pv-th" data-act="rec.pivotSort" data-pk="__total">${D.val==='avgDelay'?'전체 평균':'합계'}${arr('__total')}</th></tr></thead>`;
  let b='<tbody>';
  const emit=(node,path)=>{
    const isLeaf=node.depth>=D.maxD-1||!Object.keys(node.children).length;
    const ind=8+node.depth*16;
    const rp=path.concat([node.value]); // 우클릭 드릴다운용 행경로 — P.rows의 각 차원 값
    b+=`<tr class="pv-row${isLeaf?'':' pv-grp'}" data-rp="${esc(JSON.stringify(rp))}"><td class="pv-rh" style="padding-left:${ind}px">${cd(node.value)}</td>`;
    if(D.hasCol)D.colsA.forEach(cv=>{b+=`<td data-cv="${esc(cv)}">${dsp(node.cells[cv]||0,(node.cellsS||{})[cv]||0)}</td>`;});
    b+=`<td class="pv-tot">${dsp(node.total,node.totalS||0)}</td></tr>`;
    if(!isLeaf)pivotSortNodes(Object.values(node.children),D.sort).forEach(n=>emit(n,rp));
  };
  const top=pivotSortNodes(Object.values(D.root.children),D.sort);
  if(!top.length){b+=`<tr class="pv-row"><td class="pv-rh" style="padding-left:8px">전체</td>`;if(D.hasCol)D.colsA.forEach(cv=>{b+=`<td>${dsp(D.root.cells[cv]||0,D.root.cellsS[cv]||0)}</td>`;});b+=`<td class="pv-tot">${dsp(D.grand,D.grandS)}</td></tr>`;}
  top.forEach(n=>emit(n,[]));
  b+=`<tr class="pv-totrow"><td class="pv-rh">${D.val==='avgDelay'?'전체 평균':'합계'}</td>`;
  if(D.hasCol)D.colsA.forEach(cv=>b+=`<td data-cv="${esc(cv)}">${dsp(D.colTot[cv]||0,D.colTotS[cv]||0)}</td>`);
  b+=`<td class="pv-tot">${dsp(D.grand,D.grandS)}</td></tr></tbody>`;
  return `<table class="pv-table pv-outline">${h}${b}</table>`;
}
// FLIP: mutate 전후 위치 차이를 transform으로 보간해 부드럽게 슬라이드(드래그 중인 칩 제외)
function pvFlip(zone,mutate){
  const chips=[...zone.querySelectorAll('.pv-chip')].filter(c=>!c.classList.contains('pv-dragging'));
  const pos=new Map(chips.map(c=>[c,c.getBoundingClientRect().left]));
  mutate();
  chips.forEach(c=>{const o=pos.get(c);if(o==null)return;const dl=o-c.getBoundingClientRect().left;if(dl){c.style.transition='none';c.style.transform='translateX('+dl+'px)';requestAnimationFrame(()=>{c.style.transition='';c.style.transform='';});}});
}
// 행 칩 DOM 순서를 읽어 R.pivot.rows에 반영 (라이브 재정렬 후 커밋)
function pvCommitOrder(){
  const R=window.__REC;if(!R||!R.pivot)return false;
  const keys=[...document.querySelectorAll('.pv-bar .pv-chip[data-zone="rows"]')].map(c=>c.dataset.key).filter(Boolean);
  if(keys.length===R.pivot.rows.length&&JSON.stringify(keys)!==JSON.stringify(R.pivot.rows)){R.pivot.rows=keys;recRenderModalBody();return true;}
  return false;
}
function pvChips(zone){
  const R=window.__REC,P=R.pivot;
  const list=zone==='rows'?P.rows:(P.col?[P.col]:[]),max=zone==='rows'?3:1;
  const drag=zone==='rows'&&list.length>1;
  let html=list.map((k,i)=>`<span class="pv-chip${drag?' pv-drag':''}"${drag?` draggable="true" data-zone="${zone}" data-i="${i}" data-key="${esc(k)}"`:''}>${esc(pivotFieldLabel(k))}<button class="pv-chip-x" data-act="rec.pivotRemove" data-zone="${zone}" data-i="${i}" aria-label="제거">×</button></span>`).join('');
  if(list.length<max)html+=`<button class="pv-add" data-act="rec.pivotAdd" data-zone="${zone}" aria-label="필드 추가">+</button>`;
  return html;
}
function recPivotHTML(){
  return `<div class="pv-bar"><div class="pv-zone"><span class="pv-zlbl">행</span>${pvChips('rows')}</div><div class="pv-zone"><span class="pv-zlbl">열</span>${pvChips('col')}</div><div class="pv-zone"><span class="pv-zlbl">값</span><button class="pv-chip pv-val" data-act="rec.pivotVal"${(window.__REC.pivot.val||'count')==='avgDelay'?' data-tt="기준월 말일 − 접수일의 평균 (KPI 지연구간과 동일 기준)"':''}>${(window.__REC.pivot.val||'count')==='avgDelay'?'평균 지연일':'건수'} <span class="pv-caret">▾</span></button></div>${(window.__REC.pivot.val||'count')==='count'?`<div class="pv-zone" style="margin-left:auto"><button class="pv-chip pv-pct-tg${window.__REC.showPct?' on':''}" data-act="rec.pivotPct" data-tt="건수 옆에 전체 대비 비중(%) 표시" aria-pressed="${window.__REC.showPct?'true':'false'}">%</button></div>`:''}</div><div class="pv-scroll" id="pvBody">${recPivotTableHTML()}</div>`;
}
function recBandBarHTML(){
  const R=window.__REC;if(!R||!R.bandCnt)return'';
  const B=[{k:'',l:'전체',c:R.all.length},{k:'d60',l:'60일 이상',c:R.bandCnt.d60},{k:'d30',l:'30~59일',c:R.bandCnt.d30}];
  if(R.scope!=='lul')B.push({k:'d0',l:'30일 미만',c:R.bandCnt.d0}); // 장기미처리(30일+) 목록엔 30일 미만이 항상 0 — 숨김
  const lims=[[500,'500건'],[1000,'1,000건'],[5000,'5,000건'],[0,'전체']]; // 0=Infinity
  const cur=(R.limit===Infinity||!R.limit)?0:R.limit;
  const limHTML=R.pivotOn?'':`<span class="rl-lim-lbl">표시</span><span class="rl-lim">${lims.map(([n,l])=>`<button class="${cur===n?'on':''}" data-act="rec.limit" data-n="${n}">${l}</button>`).join('')}</span>`; // 피벗은 집계라 표시건수 무의미 — 숨김
  const vc=R.vacCnt||{unit:0,store:0};
  const vacHTML=`<span class="rl-vsep"></span><button class="rl-band${R.vac==='unit'?' on':''}" data-act="rec.vac" data-vac="unit" data-tt="공가세대(미분양·미납)만 표시">공가세대 <b>${vc.unit.toLocaleString()}</b></button>`+(R.hasHC?`<button class="rl-band${R.vac==='store'?' on':''}" data-act="rec.vac" data-vac="store" data-tt="공가상가만 표시">공가상가 <b>${vc.store.toLocaleString()}</b></button>`:'');
  return `<div class="rl-band-bar">`+B.map(b=>`<button class="rl-band${(R.band||'')===b.k?' on':''}${b.k?' '+b.k:''}" data-act="rec.band" data-band="${b.k}">${b.l} <b>${b.c.toLocaleString()}</b></button>`).join('')+vacHTML+limHTML+`</div>`;
}
function recRowsCapped(R){
  return recRowsHTML(R.view.slice(0,R.limit||Infinity)); // 표시 건수는 밴드 바 우측 필터로 제어
}
function recRenderModalBody(){
  const R=window.__REC;if(!R)return;const mb=document.getElementById('mbody');if(!mb)return;
  recClosePvMenu();
  mb.innerHTML=recBandBarHTML()+(R.pivotOn?recPivotHTML():recListBodyHTML());
  const cnt=document.getElementById('rlCnt');if(cnt)cnt.textContent=R.view.length.toLocaleString();
  {const tot=document.getElementById('rlTot');if(tot&&R.all)tot.textContent=R.all.length.toLocaleString();}
}
function recPivotExport(){
  const R=window.__REC,P=R.pivot,D=recPivotData();
  if(!D.grand){toast('내보낼 데이터가 없습니다');return;}
  const cd=cv=>cv==='(빈값)'?'(빈값)':cv;
  const nv=(c,sm)=>D.val==='avgDelay'?(c?Math.round(sm/c):0):c; // 값 모드별 수치
  const head=[D.rks.length?D.rks.map(pivotFieldLabel).join(' › '):'전체'];
  if(D.hasCol)D.colsA.forEach(cv=>head.push(cd(cv)));
  head.push(D.val==='avgDelay'?'전체 평균':'합계');
  const aoa=[head];
  const walk=node=>{
    const isLeaf=node.depth>=D.maxD-1||!Object.keys(node.children).length;
    const row=['  '.repeat(Math.max(0,node.depth))+cd(node.value)];
    if(D.hasCol)D.colsA.forEach(cv=>row.push(nv(node.cells[cv]||0,(node.cellsS||{})[cv]||0)));
    row.push(nv(node.total,node.totalS||0));aoa.push(row);
    if(!isLeaf)pivotSortNodes(Object.values(node.children),D.sort).forEach(walk);
  };
  const top=pivotSortNodes(Object.values(D.root.children),D.sort);
  if(!top.length){const row=['전체'];if(D.hasCol)D.colsA.forEach(cv=>row.push(nv(D.root.cells[cv]||0,D.root.cellsS[cv]||0)));row.push(nv(D.grand,D.grandS));aoa.push(row);}
  top.forEach(walk);
  const tr=[D.val==='avgDelay'?'전체 평균':'합계'];if(D.hasCol)D.colsA.forEach(cv=>tr.push(nv(D.colTot[cv]||0,D.colTotS[cv]||0)));tr.push(nv(D.grand,D.grandS));aoa.push(tr);
  exportXlsx(`피벗_${(R.label||'').replace(/\s+/g,'')}_${S.rm}.xlsx`,aoa,'피벗');
}
function recPivotAddMenu(zone,x,y){
  const R=window.__REC,P=R.pivot;
  const used=zone==='rows'?P.rows:(P.col?[P.col]:[]);
  const avail=PIVOT_FIELDS.filter(f=>!used.includes(f.key)&&(f.key!=='siteName'||(R&&R.withSite)));
  if(!avail.length){toast('추가할 필드가 없습니다');return;}
  window.__PVMENU={zone};
  let m=document.getElementById('pvMenu');
  if(!m){m=document.createElement('div');m.id='pvMenu';m.className='rl-menu';document.body.appendChild(m);}
  m.innerHTML=`<div class="rl-menu-hd">${zone==='rows'?'행':'열'} 필드 추가</div>`+avail.map(f=>`<button class="rl-menu-row" data-act="rec.pivotPick" data-key="${f.key}">${esc(f.label)}</button>`).join('');
  m.style.display='block';
  const mw=248,mh=Math.min(340,window.innerHeight*0.6);
  m.style.left=Math.max(8,Math.min(x,window.innerWidth-mw-8))+'px';
  m.style.top=Math.max(8,Math.min(y,window.innerHeight-mh-8))+'px';
}
function recPivotValMenu(x,y){
  const R=window.__REC;if(!R)return;
  window.__PVMENU={zone:'val'};
  let m=document.getElementById('pvMenu');
  if(!m){m=document.createElement('div');m.id='pvMenu';m.className='rl-menu';document.body.appendChild(m);}
  const cur=R.pivot.val||'count';
  m.innerHTML=`<div class="rl-menu-hd">값 집계</div>`+[['count','건수'],['avgDelay','평균 지연일']].map(([k,l])=>`<button class="rl-menu-row${cur===k?' on':''}" data-act="rec.pivotValPick" data-val="${k}">${l}${cur===k?' ✓':''}</button>`).join('');
  m.style.display='block';
  const mw=248,mh=Math.min(340,window.innerHeight*0.6);
  m.style.left=Math.max(8,Math.min(x,window.innerWidth-mw-8))+'px';
  m.style.top=Math.max(8,Math.min(y,window.innerHeight-mh-8))+'px';
}
function recClosePvMenu(){const m=document.getElementById('pvMenu');if(m)m.style.display='none';window.__PVMENU=null;}
function recHeadHTML(){
  const R=window.__REC;
  const ths=recVisCols().map(c=>{
    const sortable=c.key!=='__no';
    const arr=R.sort.key===c.key?(R.sort.dir>0?' ▲':' ▼'):'';
    const act=sortable?rawHTML(' tabindex="0" data-act="rec.sort"'):'';
    return html`<th class="${sortable?'rl-th':''}" data-key="${c.key}"${act}>${c.label}${arr}${rawHTML(`<span class="rl-rz" data-rzk="${esc(c.key)}" data-tt="드래그로 열 너비 조절"></span>`)}</th>`;
  }).join('');
  const fins=recVisCols().map(recFilterCellHTML).join('');
  return html`<thead><tr>${rawHTML(ths)}</tr><tr class="rl-frow${R.filterRow?' open':''}">${rawHTML(fins)}</tr></thead>`;
}
function recRowsHTML(rows){
  if(!rows||!rows.length)return `<tr><td colspan="${recVisCols().length}" style="text-align:center;padding:20px;color:var(--lbl3)">해당 조건의 건이 없습니다</td></tr>`;
  return rows.map((i,idx)=>{
    const cells=recVisCols().map(c=>{
      const v=c.key==='__no'?(idx+1):recCell(i,c.key);
      return html`<td class="${c.left?'rl-content':''}">${String(v)}</td>`;
    }).join('');
    return html`<tr>${rawHTML(cells)}</tr>`;
  }).join('');
}
function recRenderBody(){
  const R=window.__REC;if(!R)return;recComputeView();
  const b=document.getElementById('rlBody');if(b)b.innerHTML=recRowsCapped(R);
  const cnt=document.getElementById('rlCnt');if(cnt)cnt.textContent=R.view.length.toLocaleString();
  {const tot=document.getElementById('rlTot');if(tot&&R.all)tot.textContent=R.all.length.toLocaleString();}
}
function recRenderHead(){
  const R=window.__REC;if(!R)return;
  const t=document.querySelector('.rl-table');if(!t)return;
  const old=t.querySelector('thead');if(old)old.outerHTML=recHeadHTML();
}
function recListBodyHTML(){
  const R=window.__REC;recComputeView();
  const cols=recVisCols().map(c=>{const w=(R.colW&&R.colW[c.key])||c.w;return `<col${w?` style="width:${w}px"`:''}>`;}).join('');
  return `<div class="rl-scroll"><table class="dt rl-table"><colgroup>${cols}</colgroup>${recHeadHTML()}<tbody id="rlBody">${recRowsCapped(R)}</tbody></table></div>`;
}
function openRecList(sid,scope,trade,vac){
  let base,dispName;
  let expCnt=0; // 게시 KPI상 기대 건수 — 구게시본(전체 목록 미포함, 300건 캡)일 때 목록 축소 안내용
  let vacHC=false,hasHC=false; // 공가상가 판별용 — 단일 현장은 현장 플래그, 팀 병합은 행별 __hc 사용
  if(sid==='__team'){
    // 팀 전체 목록 — 대시보드 KPI에서 진입. 현장별 목록을 병합하고 각 행에 현장명을 부착.
    // 편집자는 calc(로컬 원본), 뷰어는 calc의 스냅샷 조기반환(게시 kpi.ul — ulz 전체본)이라 양쪽 동일 경로.
    const t=(S.teams||[]).find(x=>x.id===S.teamId)||(S.teams||[])[0]||{};
    dispName=(t.name||'전체')+' 전체현장';
    base=[];
    dashSites().forEach(s2=>{
      const st2=calc(S.def[s2.id]||[],s2,S.rm);
      expCnt+=(scope==='lul'?st2.lt:st2.unr)||0;
      const _sn=String(s2.name||'').replace(/힐스테이트/g,'HS').replace(/\s+/g,' ').trim(); // 목록·피벗 표시용 축약
      if(s2.hasCommercial)hasHC=true;
      ((scope==='lul'?st2.lul:st2.ul)||[]).forEach(i=>base.push(Object.assign({},i,{siteName:_sn,__hc:!!s2.hasCommercial})));
    });
  }else{
    const site=S.sites.find(s=>s.id===sid);if(!site)return;
    const st=calc(S.def[sid]||[],site,S.rm);
    base=(scope==='lul'?st.lul:st.ul)||[];
    expCnt=(scope==='lul'?st.lt:st.unr)||0;
    dispName=site.name||'';
    vacHC=hasHC=!!site.hasCommercial;
  }
  const rows=(trade?base.filter(i=>(i.trade||'기타')===trade):base.slice())
    .sort((a,b)=>String(a.receiptDate||'').localeCompare(String(b.receiptDate||''))); // 해제 시 복귀할 기준 순서(접수일 오름차순)
  const _rmP=S.rm.split('-').map(Number),_rmEnd=`${S.rm}-${String(new Date(_rmP[0],_rmP[1],0).getDate()).padStart(2,'0')}`;
  window.__REC={all:rows,view:rows,filters:{},valueFilters:{},sort:{key:null,dir:-1},filterRow:false,pivotOn:false,pivot:(sid==='__team'?{rows:['siteName'],col:'trade',sort:{key:'__total',dir:-1},val:'count'}:{rows:['contractor','trade'],col:null,sort:{key:'__total',dir:-1},val:'count'}),label:dispName+(trade?('_'+trade):''),scope:scope,rmEnd:_rmEnd,band:null,limit:500,withSite:sid==='__team',hidden:new Set(),colW:{},vac:(vac==='unit'||vac==='store')?vac:null,vacHC:vacHC,hasHC:hasHC};
  window.__REC._args={sid:sid,scope:scope,vac:vac||''}; // 공종 필터 해제 칩이 동일 목록을 필터 없이 재오픈할 때 사용
  {const R=window.__REC,bc={d0:0,d30:0,d60:0},vc={unit:0,store:0};
   rows.forEach(r=>{bc[recBandOf(recDelayDays(r,R))]++;if(isVacUnit(r))vc.unit++;if(isVacStore(r,{hasCommercial:(r.__hc!==undefined?r.__hc:R.vacHC)}))vc.store++;});
   R.bandCnt=bc;R.vacCnt=vc;}
  const scopeLabel=scope==='lul'?'장기미처리(30일+)':'미처리';
  const title=`${esc(dispName)} · ${scopeLabel}${trade?(` · <button class="rl-fchip" data-act="rec.clearTrade" data-tt="공종 필터 해제 — 전체 목록으로">${esc(trade)} ×</button>`):''}`;
  document.getElementById('mt').innerHTML=`<div class="rl-thead"><span class="rl-title">${title}</span><label class="rl-qsrch no-print"><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/></svg><input type="search" enterkeyhint="search" placeholder="동·호·공종·내용 검색" aria-label="목록 내 검색 — 동, 호, 공종, 접수내용" data-act="rec.qsearch" value=""></label><span class="rl-count">결과 <b id="rlCnt">${rows.length.toLocaleString()}</b> / 전체 <b id="rlTot">${rows.length.toLocaleString()}</b></span><button class="btn bo bsm no-print" data-act="rec.copyTable" data-tt="현재 표를 클립보드로 복사 — 엑셀·메일에 바로 붙여넣기(Ctrl+V)">표 복사</button><button class="btn bo bsm rl-list-export" data-act="rec.export">엑셀</button><button class="btn bo bsm" data-act="rec.pivotToggle">피벗</button><button class="btn bg2 bsm" data-act="modal.close">닫기</button></div>`;
  recRenderModalBody();
  document.getElementById('mf').innerHTML='';
  const mb=document.getElementById('mb');if(mb)mb.classList.add('wide');
  openMo();
  // 구게시본(전체 목록 미포함) 안내 — KPI 건수와 목록 행수 불일치 혼선 방지. 최신 빌드로 재게시하면 전체 포함.
  if(window.__SNAP__&&expCnt>base.length)toast(`목록 ${base.length.toLocaleString()}건 / 집계 ${expCnt.toLocaleString()}건 — 이 게시본에는 전체 목록이 포함되어 있지 않아 일부만 표시됩니다`,8000);
}
// ── 표 내보내기 (xlsx · SheetJS) ──
// XLSX(SheetJS) 지연 로드 — 부팅엔 불필요(업로드·내보내기 시점에만 필요). 초기 로드에서 ~900KB 제거.
//   같은 파서(0.18.5)·같은 SRI 해시 유지 → 포맷 지원 회귀 0. CSP의 script-src에 cdn.jsdelivr.net 이미 허용됨.
let _xlsxPromise=null;
// ── 사용 안내(README) 뷰어 — 설정 > 대시보드 공유 ──
// 저장소의 README.md(동일 출처)를 fetch해 marked(SRI 고정, 지연 로드)로 렌더하고 DOMPurify로 살균해
// 모달에 표시한다. 파일이 배포에 없으면(404) 안내 토스트. connect-src 'self' 라 CSP 추가 불필요.
let _markedPromise=null;
// ══ 우클릭 컨텍스트 메뉴 ══════════════════════════════════════════════
// 원칙: ① 입력 요소·텍스트 선택 중에는 브라우저 기본 메뉴 유지 ② 기존 필터 메뉴와 동일한 시각 문법
//       ③ 데스크톱 위주(모바일 롱프레스는 OS별 편차가 커서 개입하지 않음)
let _ctxEl=null;
let _ctxEsc=null;
function closeCtx(){if(_ctxEl){_ctxEl.remove();_ctxEl=null;document.removeEventListener('click',closeCtx);document.removeEventListener('scroll',closeCtx,true);if(_ctxEsc){document.removeEventListener('keydown',_ctxEsc);_ctxEsc=null;}}}
function openCtx(x,y,items){
  closeCtx();
  const el=document.createElement('div');el.className='ctxmenu';el.setAttribute('role','menu');
  el.innerHTML=items.map((it,i)=>it.sep?'<div class="ctx-sep"></div>':`<button class="ctx-it" role="menuitem" data-ci="${i}">${esc(it.label)}</button>`).join('');
  document.body.appendChild(el);
  const r=el.getBoundingClientRect();
  el.style.left=Math.max(6,Math.min(x,innerWidth-r.width-8))+'px';
  el.style.top=Math.max(6,Math.min(y,innerHeight-r.height-8))+'px';
  el.addEventListener('click',e=>{const b=e.target.closest('.ctx-it');if(!b)return;e.stopPropagation();const it=items[+b.dataset.ci];closeCtx();if(it&&it.act)it.act();});
  el.addEventListener('contextmenu',e=>e.preventDefault());
  _ctxEl=el;
  setTimeout(()=>{document.addEventListener('click',closeCtx);document.addEventListener('scroll',closeCtx,true);},0);
  _ctxEsc=function(e){if(e.key==='Escape')closeCtx();};
  document.addEventListener('keydown',_ctxEsc);
}
function ctxCopy(t,msg){
  const done=()=>toast(msg||('복사됨 · '+(String(t).length>24?String(t).slice(0,24)+'…':t)));
  if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(String(t)).then(done).catch(()=>toast('복사 실패'));
  else{const ta=document.createElement('textarea');ta.value=String(t);document.body.appendChild(ta);ta.select();try{document.execCommand('copy');done();}catch(e){toast('복사 실패');}ta.remove();}
}
function _canvasWhite(cv){const c=document.createElement('canvas');c.width=cv.width;c.height=cv.height;const g=c.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,c.width,c.height);g.drawImage(cv,0,0);return c;}
function ctxCopyCanvas(cv){
  const c=_canvasWhite(cv);
  if(navigator.clipboard&&window.ClipboardItem){
    c.toBlob(b=>{if(!b){toast('이미지 생성 실패');return;}
      navigator.clipboard.write([new ClipboardItem({'image/png':b})]).then(()=>toast('차트 이미지가 복사되었습니다 · 보고서에 붙여넣기(Ctrl+V) 하세요')).catch(()=>{ctxSaveCanvas(cv);});
    },'image/png');
  }else ctxSaveCanvas(cv); // 클립보드 이미지 미지원 브라우저 — 저장으로 폴백
}
function ctxSaveCanvas(cv){
  const a=document.createElement('a');a.href=_canvasWhite(cv).toDataURL('image/png');a.download='chart_'+S.rm+'.png';a.click();toast('PNG로 저장했습니다');
}
// 열 너비 드래그 조절 — colgroup(table-layout:fixed) 폭을 실시간 갱신, 재렌더 시 R.colW로 복원
// 단축키: 목록 모달이 열려 있으면 Ctrl+F(또는 '/')가 브라우저 찾기 대신 통합검색으로
document.addEventListener('keydown',function(e){
  const mo=document.getElementById('mo');
  if(!mo||!mo.classList.contains('open')||!window.__REC)return;
  const inp=document.querySelector('.rl-qsrch input');if(!inp)return;
  const typing=/^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement||{}).tagName);
  if((e.ctrlKey||e.metaKey)&&(e.key==='f'||e.key==='F')){e.preventDefault();inp.focus();inp.select();return;}
  if(e.key==='/'&&!typing){e.preventDefault();inp.focus();inp.select();}
},true);
document.addEventListener('pointerdown',function(e){
  const h=e.target.closest('.rl-rz');if(!h||!window.__REC)return;
  e.preventDefault();e.stopPropagation();
  const R=window.__REC,key=h.dataset.rzk;
  const th=h.closest('th'),table=th&&th.closest('table');if(!table)return;
  const ix=[...th.parentNode.children].indexOf(th);
  const colEl=table.querySelectorAll('colgroup col')[ix];
  const startX=e.clientX,startW=th.getBoundingClientRect().width;
  const mv=ev=>{const w=Math.max(44,Math.round(startW+(ev.clientX-startX)));R.colW[key]=w;if(colEl)colEl.style.width=w+'px';};
  const up=()=>{document.removeEventListener('pointermove',mv);document.removeEventListener('pointerup',up);document.removeEventListener('pointercancel',up);};
  document.addEventListener('pointermove',mv);document.addEventListener('pointerup',up);document.addEventListener('pointercancel',up);
});
document.addEventListener('click',function(e){if(e.target.closest('.rl-rz')){e.stopPropagation();e.preventDefault();}},true); // 핸들 클릭이 헤더 정렬로 전파되는 것 차단
// 화면 표를 탭 구분 텍스트로 복사(엑셀·메일 Ctrl+V) — 정렬 화살표·버튼 등 화면전용 요소 제외, 처리계획 등 입력칸은 입력값 사용
function ctxCopyTable(tbl){
  if(!tbl)return;
  const rows=[];
  tbl.querySelectorAll('tr').forEach(tr=>{
    if(tr.closest('table')!==tbl)return; // 중첩 표 방어
    const cells=[...tr.children].filter(c=>c.tagName==='TD'||c.tagName==='TH');
    if(!cells.length)return;
    rows.push(cells.map(c=>{
      const f=c.querySelector('textarea,input');
      let t;
      if(f)t=String(f.value||'');
      else{const cl=c.cloneNode(true);cl.querySelectorAll('.sortmk,.no-print,button,svg').forEach(x=>x.remove());t=cl.textContent;}
      return t.replace(/\s+/g,' ').trim();
    }).join('\t'));
  });
  ctxCopy(rows.join('\n'),'표를 복사했습니다 · 엑셀·메일에 붙여넣기(Ctrl+V)');
}
document.addEventListener('contextmenu',function(e){
  if(e.target.closest('input,textarea,select,[contenteditable="true"]'))return; // 입력 요소 — 기본 메뉴 유지(붙여넣기·맞춤법)
  if(window.getSelection&&String(window.getSelection())!=='')return; // 텍스트 선택 중 — 기본 복사 메뉴 유지
  // ① 피벗 셀 — 드릴다운(해당 조합의 원본 목록) + 값 복사
  const ptd=e.target.closest('.pv-table td');
  if(ptd&&window.__REC){
    const R=window.__REC,P=R.pivot||{};
    const tr=ptd.closest('tr');
    const rp=(tr&&tr.dataset.rp)?(()=>{try{return JSON.parse(tr.dataset.rp);}catch(_){return null;}})():null;
    const cvv=(ptd.dataset.cv!=null&&P.col)?ptd.dataset.cv:null;
    const items=[];
    if(rp||cvv!=null){
      items.push({label:'해당 목록 보기',act:()=>{
        R.pivotOn=false;R.filterRow=true;
        if(rp)rp.forEach((v,i)=>{const k=(P.rows||[])[i];if(k)R.valueFilters[k]=new Set([v==='(빈값)'?'':String(v)]);});
        if(cvv!=null)R.valueFilters[P.col]=new Set([cvv==='(빈값)'?'':String(cvv)]);
        recRenderModalBody();
        toast('피벗 조건으로 목록을 필터했습니다 · 헤더의 필터 표시에서 해제 가능');
      }});
      items.push({sep:true});
    }
    items.push({label:'값 복사',act:()=>ctxCopy(ptd.textContent.trim())});
    e.preventDefault();openCtx(e.clientX,e.clientY,items);return;
  }
  // ② 목록 셀 — 이 값으로 필터 / 제외 / 복사
  const rtd=e.target.closest('#rlBody td');
  if(rtd&&window.__REC){
    const R=window.__REC,col=recVisCols()[rtd.cellIndex]||{};
    const v=rtd.textContent;
    const short=v.length>14?v.slice(0,14)+'…':(v||'(빈값)');
    const items=[];
    if(col.key&&col.key!=='__no'){
      items.push({label:`"${short}" 값으로 필터`,act:()=>{R.valueFilters[col.key]=new Set([v]);R.filterRow=true;recRenderModalBody();}});
      items.push({label:`"${short}" 제외`,act:()=>{let vf=R.valueFilters[col.key];if(!(vf instanceof Set))vf=new Set(recDistinct(col.key));vf.delete(v);R.valueFilters[col.key]=vf;R.filterRow=true;recRenderModalBody();}});
      items.push({sep:true});
    }
    items.push({label:'셀 값 복사',act:()=>ctxCopy(v)});
    e.preventDefault();openCtx(e.clientX,e.clientY,items);return;
  }
  // ③ 대시보드 현장별 현황 행 — 현장 열기 / 목록 바로가기
  const dtr=e.target.closest('#dtbody tr');
  if(dtr){
    const a=dtr.querySelector('[data-site]');
    if(a){
      const sid=a.dataset.site;
      e.preventDefault();
      openCtx(e.clientX,e.clientY,[
        {label:'현장 화면 열기',act:()=>go('site',sid)},
        {sep:true},
        {label:'미처리 목록',act:()=>openRecList(sid,'ul')},
        {label:'장기미처리 목록',act:()=>openRecList(sid,'lul')},
        {sep:true},
        {label:'셀 값 복사',act:()=>ctxCopy((e.target.closest('td')||dtr).textContent.trim())},
        {label:'표 복사',act:()=>ctxCopyTable(dtr.closest('table'))},
      ]);return;
    }
  }
  // ⑤ 사이드바 현장 항목 — 현장 열기/목록 바로가기(+편집자: 현장 정보 수정) · 대시보드 행 메뉴(③)와 대칭
  const sti=e.target.closest('.sti[data-site]');
  if(sti){
    const sid=sti.dataset.site;
    const items=[
      {label:'현장 화면 열기',act:()=>go('site',sid)},
      {sep:true},
      {label:'미처리 목록',act:()=>openRecList(sid,'ul')},
      {label:'장기미처리 목록',act:()=>openRecList(sid,'lul')},
    ];
    if(!manageLocked()){items.push({sep:true});items.push({label:'현장 정보 수정',act:()=>openSM(sid)});}
    e.preventDefault();openCtx(e.clientX,e.clientY,items);return;
  }
  // ⑥ 현장 종합 분석(AI) 영역 — 텍스트 복사/재생성
  const ait=e.target.closest('.ait[id^="ait-"]');
  if(ait){
    const sid=ait.id.slice(4);
    e.preventDefault();openCtx(e.clientX,e.clientY,[
      {label:'분석 텍스트 복사',act:()=>ctxCopy(ait.innerText.trim())},
      {sep:true},
      {label:'AI 분석 재생성',act:()=>runAI(sid)},
    ]);return;
  }
  // ⑦ 대시보드 주요 이슈 카드 — 텍스트 복사/AI 재작성
  const ins=e.target.closest('#d-insight');
  if(ins){
    e.preventDefault();openCtx(e.clientX,e.clientY,[
      {label:'이슈 텍스트 복사',act:()=>ctxCopy(ins.innerText.trim())},
      {sep:true},
      {label:'AI로 재작성',act:()=>runDashAI()},
    ]);return;
  }
  // ⑧ 현장 화면 공종 표 행 — 공종 필터 드릴다운(미처리/장기미처리) + 복사. 기존 공종 셀 클릭(rl-link)은 한 종류 고정이라 우클릭이 보완
  const ttr=e.target.closest('table[id^="trade-"] tbody tr, table[id^="ttop-"] tbody tr, table[id^="vtop-"] tbody tr');
  if(ttr&&ttr.cells&&ttr.cells.length>2){
    const tbl=ttr.closest('table'),parts=tbl.id.split('-');
    const isV=parts[0]==='vtop';
    const sid=isV?parts.slice(2).join('-'):parts.slice(1).join('-');
    const link=ttr.querySelector('.rl-link');
    const trade=(link&&link.dataset.trade)||(ttr.cells[1]?ttr.cells[1].textContent.trim():'');
    const vac=isV?((link&&link.dataset.vac)||parts[1]):''; // 공가 표는 공가 필터 유지
    const items=[];
    if(trade&&trade!=='합계'){
      const short=trade.length>10?trade.slice(0,10)+'…':trade;
      items.push({label:`"${short}" 미처리 목록`,act:()=>openRecList(sid,'ul',trade,vac)});
      items.push({label:`"${short}" 장기미처리 목록`,act:()=>openRecList(sid,'lul',trade,vac)});
      items.push({sep:true});
    }
    const cell=e.target.closest('td');
    if(cell)items.push({label:'셀 값 복사',act:()=>ctxCopy(cell.textContent.trim())});
    items.push({label:'표 복사',act:()=>ctxCopyTable(tbl)});
    e.preventDefault();openCtx(e.clientX,e.clientY,items);return;
  }
  // ⑨ 일반 표(.dt) — 표 복사(엑셀 붙여넣기)/셀 값 복사. 목록(rl-table)·피벗(pv-table)은 전용 메뉴(①②·헤더)가 담당
  const gt=e.target.closest('table.dt');
  if(gt&&!gt.classList.contains('rl-table')&&!gt.classList.contains('pv-table')){
    const cell=e.target.closest('td,th');
    const items=[];
    if(cell)items.push({label:'셀 값 복사',act:()=>ctxCopy(cell.textContent.trim())});
    items.push({label:'표 복사',act:()=>ctxCopyTable(gt)});
    e.preventDefault();openCtx(e.clientX,e.clientY,items);return;
  }
  // ④ 차트 — 이미지 복사(보고서 붙여넣기용) / PNG 저장
  const cnv=e.target.closest('canvas');
  if(cnv){
    e.preventDefault();
    openCtx(e.clientX,e.clientY,[
      {label:'차트 이미지 복사',act:()=>ctxCopyCanvas(cnv)},
      {label:'PNG로 저장',act:()=>ctxSaveCanvas(cnv)},
    ]);return;
  }
});
function loadMarked(){
  if(typeof marked!=='undefined')return Promise.resolve(true);
  if(_markedPromise)return _markedPromise;
  _markedPromise=new Promise((resolve,reject)=>{
    const s=document.createElement('script');
    s.src='https://cdn.jsdelivr.net/npm/marked@4.3.0/marked.min.js';
    s.integrity='sha384-QsSpx6a0USazT7nK7w8qXDgpSAPhFsb2XtpoLFQ5+X2yFN6hvCKnwEzN8M5FWaJb';
    s.crossOrigin='anonymous';
    s.onload=()=>resolve(true);
    s.onerror=()=>{_markedPromise=null;reject(new Error('marked load failed'));};
    document.head.appendChild(s);
  });
  return _markedPromise;
}
async function openReadme(){
  try{
    const res=await fetch('README.md',{cache:'no-cache'});
    if(!res.ok)throw new Error('HTTP '+res.status);
    const md=await res.text();
    await loadMarked();
    const html=DOMPurify.sanitize(marked.parse(md));
    // 장(h2) 단위로 쪼개 좌측 목차 + 본문 한 장씩 — 문서가 길어 세로 스크롤만으로는 찾기 어렵다.
    const src=document.createElement('div');src.innerHTML=html;
    const secs=[];let cur={t:'소개',nodes:[]};
    Array.from(src.childNodes).forEach(n=>{
      if(n.nodeType===1&&n.tagName==='H2'){if(cur.nodes.length)secs.push(cur);cur={t:n.textContent.trim(),nodes:[n]};}
      else cur.nodes.push(n);
    });
    if(cur.nodes.length)secs.push(cur);
    const wrap=document.createElement('div');wrap.className='rd-wrap';
    const nav=document.createElement('nav');nav.className='rd-nav';nav.setAttribute('aria-label','사용 안내 목차');
    nav.innerHTML=secs.map((s,i)=>`<button type="button" class="rd-navi${i===0?' act':''}" data-act="readme.tab" data-i="${i}">${esc(s.t)}</button>`).join('');
    const body=document.createElement('div');body.className='rd-body md-doc';
    secs.forEach((s,i)=>{const d=document.createElement('div');d.className='rd-sec'+(i===0?' act':'');s.nodes.forEach(n=>d.appendChild(n));
      d.querySelectorAll('table').forEach(tb=>{const w=document.createElement('div');w.className='md-tw';tb.parentNode.insertBefore(w,tb);w.appendChild(tb);}); // 좁은 화면에서 표만 가로 스크롤
      body.appendChild(d);});
    wrap.appendChild(nav);wrap.appendChild(body);
    document.getElementById('mt').textContent='사용 안내 (README)';
    const mbody=document.getElementById('mbody');
    mbody.innerHTML='<div class="md-scroll"></div>';
    mbody.firstChild.appendChild(wrap);
    document.getElementById('mf').innerHTML='';
    const mb=document.getElementById('mb');if(mb)mb.classList.add('wide');
    openMo();
  }catch(e){
    console.warn('[README] 열기 실패',e);
    toast('사용 안내를 불러오지 못했습니다 · 저장소에 README.md가 배포되어 있는지 확인하세요');
  }
}
function loadXLSX(){
  if(typeof XLSX!=='undefined')return Promise.resolve(true);
  if(_xlsxPromise)return _xlsxPromise;
  // 1차: 저장소 자체 호스팅 최신판 ./xlsx.full.min.js (SheetJS 0.20.x — cdn.sheetjs.com에서 내려받아 커밋).
  //      script-src 'self'로 허용되어 CSP 호스트 추가·SRI 불필요, CDN 의존 제거 + 구버전 CVE(2023-30533·2024-22363) 해소.
  // 2차 폴백: 로컬 파일 미배치·미배포 시 기존 jsdelivr 0.18.5(+SRI). 이 폴백 경로가 남아있는 동안
  //      readWorkbookSafe의 프로토타입 오염 완화는 제거하지 말 것(구버전 CVE 방어선 겸 심층 방어).
  const tryLoad=(src,integrity)=>new Promise((resolve,reject)=>{
    const s=document.createElement('script');
    s.src=src;
    if(integrity){s.integrity=integrity;s.crossOrigin='anonymous';}
    s.onload=()=>resolve(true);
    s.onerror=()=>{s.remove();reject(new Error('xlsx load failed: '+src));};
    document.head.appendChild(s);
  });
  _xlsxPromise=tryLoad('./xlsx.full.min.js')
    .catch(()=>tryLoad('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js','sha384-vtjasyidUo0kW94K5MXDXntzOJpQgBKXmE7e2Ga4LG0skTTLeBi97eFAXsqewJjw'))
    .catch(err=>{_xlsxPromise=null;throw err;});
  return _xlsxPromise;
}
async function exportXlsx(filename,aoa,sheetName){
  try{await loadXLSX();}catch(e){toast('엑셀 모듈을 불러오지 못했습니다 · 네트워크 확인');return;}
  try{
    const ws=XLSX.utils.aoa_to_sheet(aoa);
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,ws,(sheetName||'Sheet1').slice(0,31));
    XLSX.writeFile(wb,filename);
    toast('엑셀로 내보냈습니다');
  }catch(e){console.error('exportXlsx',e);toast('내보내기 실패');}
}

// ── 처리계획 월별 종속(1회 마이그레이션): 기존 평면 키(공종) → 현재 기준월 버킷(기준월@공종) ──
//   Firebase plans/{sid}/{field}/{key} 구조는 그대로 두고 key만 '기준월@공종' 복합키로 사용한다.
function migratePlansMonthly(){
  try{if(localStorage.getItem('planMM')==='1')return;}catch(e){return;}
  const land=S.rm,PF=['processingPlan','vacantProcessingPlan','commercialProcessingPlan'];let touched=false;
  for(const sid in S.cmt){const cm=S.cmt[sid];if(!cm||typeof cm!=='object')continue;
    PF.forEach(f=>{const m=cm[f];if(!m||typeof m!=='object')return;
      Object.keys(m).forEach(k=>{
        if(k.indexOf('@')>=0)return;             // 이미 월 복합키
        const v=m[k];if(typeof v!=='string'||!v)return;
        const ck=land+'@'+k;if(m[ck]==null){m[ck]=v;touched=true;} // 평면→월버킷 복사(원본 보존, 신규 리더는 무시)
      });
    });
  }
  try{localStorage.setItem('planMM','1');}catch(e){}
  if(touched)lsSave();
}

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
function attachLtrTip(){if(window._ltrTipAttached)return;window._ltrTipAttached=true;const tip=document.getElementById('htooltip');if(!tip)return;const show=(e,bar)=>{const[nm,unrS,d60S,d30S,d0S]=bar.dataset.tip.split('|'),unr=Number(unrS)||0,d60=Number(d60S)||0,d30=Number(d30S)||0,d0=Number(d0S)||0,pct=n=>unr>0?(n/unr*100).toFixed(1)+'%':'0%';tip.innerHTML=`<div class="trow"><span class="tmark" style="background:#DA6A60"></span><span class="tlabel">60일 이상</span><span class="tval">${d60.toLocaleString()}건 (${pct(d60)})</span></div><div class="trow"><span class="tmark" style="background:#E89C9A"></span><span class="tlabel">30~59일</span><span class="tval">${d30.toLocaleString()}건 (${pct(d30)})</span></div><div class="trow"><span class="tmark" style="background:#B3C7DD"></span><span class="tlabel">30일 미만</span><span class="tval">${d0.toLocaleString()}건 (${pct(d0)})</span></div>`;tip.style.left=e.clientX+'px';tip.style.top=e.clientY+'px';tip.classList.remove('gl');tip.classList.remove('sb-mode');tip.classList.add('show');};const hide=()=>tip.classList.remove('show');// document 전체 위임 — 대시보드 + 현장 패널 모든 ltrbar 커버
document.addEventListener('mouseover',e=>{const bar=e.target.closest('.ltrbar');if(bar&&bar.dataset.tip)show(e,bar);});document.addEventListener('mousemove',e=>{if(tip.classList.contains('show')){tip.style.left=e.clientX+'px';tip.style.top=e.clientY+'px';}});document.addEventListener('mouseout',e=>{const bar=e.target.closest('.ltrbar');if(bar&&!e.relatedTarget?.closest('.ltrbar'))hide();});
  // 장기미처리 비율 현황 바 — 세그먼트별 개별 툴팁
  const showSeg=(e,seg)=>{const[lbl,band,cntS,totS]=seg.dataset.tip.split('|'),cnt=Number(cntS)||0,tot=Number(totS)||0,pc=tot>0?(cnt/tot*100).toFixed(1):'0.0',bg=seg.classList.contains('s60')?'#DA6A60':seg.classList.contains('s30')?'#E89C9A':'#B3C7DD';tip.innerHTML=`<div class="trow"><span class="tmark" style="background:${bg}"></span><span class="tlabel">${esc(lbl)} · ${esc(band)}</span><span class="tval">${cnt.toLocaleString()}건 (${pc}%)</span></div>`;tip.style.left=e.clientX+'px';tip.style.top=e.clientY+'px';tip.classList.remove('gl');tip.classList.remove('sb-mode');tip.classList.add('show');};
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
  document.getElementById('dtbody').innerHTML=sortDR(all).map(({s,st})=>{const ld=st.lt-st.prev.lt,isUp=ld>0,isFlat=ld===0,p60=st.unr>0?Math.min(st.dd[2]/st.unr*100,100):0,p30=st.unr>0?Math.min(st.dd[1]/st.unr*100,100):0,p0=st.unr>0?Math.min(st.dd[0]/st.unr*100,100):0,arrow=isFlat?'─':isUp?'▲':'▼',sign=isFlat?'':isUp?'+':'−',badge=isFlat?'bgr':isUp?'brd':'bgn';const uD=st.unr-st.prev.unr,uArrow=uD===0?'─':uD>0?'▲':'▼',uSign=uD>0?'+':uD<0?'−':'',uBadge=uD===0?'bgr':uD>0?'brd':'bgn';return`<tr><td class="cc" style="white-space:nowrap"><span class="ba bbl">${esc(s.region)}</span></td><td><b style="color:var(--b700);cursor:pointer" data-act="nav.site" data-site="${esc(s.id)}">${esc(s.name)}</b></td><td class="n">${s.units.toLocaleString()}</td><td class="n">${st.tR.toLocaleString()}</td><td class="n" style="color:var(--gn)">${st.res.toLocaleString()}</td><td class="n" style="font-weight:600">${st.rate.toFixed(1)}%</td><td class="n" style="color:var(--am)">${st.unr.toLocaleString()}</td><td class="cc" style="white-space:nowrap"><span class="ba ${uBadge}" data-tt="전월 ${st.prev.unr.toLocaleString()} → 금월 ${st.unr.toLocaleString()}" aria-label="전월 ${st.prev.unr.toLocaleString()} → 금월 ${st.unr.toLocaleString()}">${uArrow} ${uSign}${Math.abs(uD).toLocaleString()}</span></td><td class="n" style="color:var(--rd)">${st.lt.toLocaleString()}</td><td><div class="ltrbar-wrap"><div class="ltrbar" data-tip="${esc(s.name)}|${st.unr}|${st.dd[2]}|${st.dd[1]}|${st.dd[0]}|${st.ltr.toFixed(1)}"><div class="seg s60" style="width:${p60}%"></div><div class="seg s30" style="width:${p30}%"></div><div class="seg s0" style="width:${p0}%"></div></div><span class="ltrbar-pct">${st.ltr.toFixed(1)}%</span></div></td><td class="cc" style="white-space:nowrap"><span class="ba ${badge}" data-tt="전월 ${st.prev.lt.toLocaleString()} → 금월 ${st.lt.toLocaleString()}" aria-label="전월 ${st.prev.lt.toLocaleString()} → 금월 ${st.lt.toLocaleString()}">${arrow} ${sign}${Math.abs(ld).toLocaleString()}</span></td></tr>`;}).join('')||'<tr><td colspan="11" style="text-align:center;padding:24px;color:var(--lbl3)">현장리스트에서 현장을 추가하고 리스트를 업로드하세요.</td></tr>';
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
function insCollapseAll(){const g=document.getElementById('d-insight');if(!g)return false;const c=g.querySelector('.ic.exp');if(!c)return false;c.classList.remove('exp');c.setAttribute('aria-expanded','false');g.classList.remove('ins-open');g.style.height='';return true;}
function insBindCards(){
  const el=document.getElementById('d-insight');if(!el)return;
  el.classList.remove('ins-open');el.style.height=''; // 재렌더 시 확장 잔여 상태 초기화 — 남으면 전 카드가 투명·클릭불가로 잠김
  el.querySelectorAll('.ic').forEach(c=>{
    const tt=c.querySelector('.ic-ttl');if(!tt)return;
    const t=tt.textContent.trim();
    if(t==='데이터 없음'||t==='주요 이슈 없음')return; // 안내 카드는 확장 대상 아님
    c.dataset.act='dash.insToggle';c.dataset.instt=t;
    c.setAttribute('role','button');c.setAttribute('tabindex','0');c.setAttribute('aria-expanded','false');
  });
}
// 게시·스냅샷 캡처용 — 확장 상태(.exp)·상세(.insd)와 DOM 부착 토글 속성을 제거한 정적 HTML
function insCleanHTML(){const el=document.getElementById('d-insight');if(!el)return '';const c=el.cloneNode(true);c.querySelectorAll('.insd').forEach(x=>x.remove());c.querySelectorAll('.ic').forEach(x=>{x.classList.remove('exp');x.removeAttribute('data-act');x.removeAttribute('data-instt');x.removeAttribute('role');x.removeAttribute('tabindex');x.removeAttribute('aria-expanded');});c.classList.remove('ins-open');return c.innerHTML;}
function rInsights(all,tR,tRes,tU,tLt,rate,pRate){
  const el=document.getElementById('d-insight');if(!el)return;
  if(window.__SNAP__){ // 스냅샷: 임베드 인사이트(살균) — 비어 있으면(구게시본·대시보드 미방문 게시) 안내 표시
    const _ih=window.__SNAP__.insightsHTML||'';
    el.innerHTML=_ih.replace(/\s/g,'')?safeHTML(_ih):'<div class="ic warn"><div class="ic-t"><div class="ic-ttl">주요 이슈 없음</div><div class="ic-sub">이 게시본에는 주요 이슈가 포함되지 않았습니다 · 재게시하면 표시됩니다.</div></div></div>';
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
  el.innerHTML=safeHTML(items.map(x=>`<div class="ic ${x.cls}"><div class="ic-i">${icoSVG(x.icon)}</div><div class="ic-t"><div class="ic-ttl">${x.ttl}</div><div class="ic-sub">${x.sub}</div></div></div>`).join(''));
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
  if(!Chart.__ctReg){Chart.register({id:'centerText',afterDraw(chart,_,opts){if(!opts||!opts.display)return;const{ctx,chartArea:{left,right,top,bottom}}=chart;const cx=(left+right)/2,cy=(top+bottom)/2;ctx.save();ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle=opts.valueColor||'#1C1C1E';ctx.font=`700 ${opts.valueSize||16}px 'Pretendard Variable',Pretendard,sans-serif`;ctx.fillText(opts.value||'',cx,cy-2);ctx.fillStyle=opts.labelColor||'rgba(60,60,67,.58)';ctx.font=`600 ${opts.labelSize||11}px 'Pretendard Variable',Pretendard,sans-serif`;ctx.fillText(opts.label||'',cx,cy+14);ctx.restore();}});Chart.__ctReg=true;}
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
    {type:'bar',label:'60일 이상',data:wks.map(x=>x.lt60||0),backgroundColor:'#DA6A60',hoverBackgroundColor:'#C65A50',pointStyle:'rectRounded',stack:'u',borderRadius:0,borderSkipped:false,yAxisID:'y',order:3,animations:_barAnim,datalabels:{display:ctx=>window.innerWidth>768&&moDLCfg(ctx).showInner&&ctx.dataset.data[ctx.dataIndex]>0,opacity:_opIn,anchor:'center',align:'center',color:'#fff',font:ctx=>({size:moDLCfg(ctx).size,weight:600}),formatter:v=>v.toLocaleString()}},
    {type:'bar',label:'30~59일',data:wks.map(x=>x.lt-(x.lt60||0)),backgroundColor:'#E89C9A',hoverBackgroundColor:'#C76F6D',pointStyle:'rectRounded',stack:'u',borderRadius:0,borderSkipped:false,yAxisID:'y',order:3,animations:_barAnim,datalabels:{display:ctx=>window.innerWidth>768&&moDLCfg(ctx).showInner&&ctx.dataset.data[ctx.dataIndex]>0,opacity:_opIn,anchor:'center',align:'center',color:'#7a3434',font:ctx=>({size:moDLCfg(ctx).size,weight:600}),formatter:v=>v.toLocaleString()}},
    {type:'bar',label:'30일 미만',data:wks.map(x=>x.u-x.lt),backgroundColor:'#B3C7DD',hoverBackgroundColor:'#7E9BBC',pointStyle:'rectRounded',stack:'u',borderRadius:0,borderSkipped:false,yAxisID:'y',order:3,animations:_barAnim,datalabels:{labels:{value:{display:ctx=>window.innerWidth>768&&moDLCfg(ctx).showInner&&ctx.dataset.data[ctx.dataIndex]>0,opacity:_opIn,anchor:'center',align:'center',color:'#1F2B4C',font:ctx=>({size:moDLCfg(ctx).size,weight:600}),formatter:v=>v.toLocaleString()},total:{display:ctx=>{if(window.innerWidth<=768)return false;const t=wks[ctx.dataIndex]?.u||0;if(t<=0)return false;const c=moDLCfg(ctx),n=ctx.chart.data.labels.length;return c.totalEvery===1||ctx.dataIndex%c.totalEvery===0||ctx.dataIndex===n-1;},opacity:_op,anchor:'end',align:'end',offset:2,clip:false,color:dlInk(),font:ctx=>({size:moDLCfg(ctx).size,weight:700}),textStrokeColor:dlStroke(),textStrokeWidth:4,formatter:(v,ctx)=>{const t=wks[ctx.dataIndex].u;return t>0?t.toLocaleString():'';}}}}},
    {type:'line',label:'전체 접수',data:cumR,borderColor:'#3E71D2',backgroundColor:'#fff',pointBackgroundColor:'#fff',pointBorderColor:'#3E71D2',pointBorderWidth:2,tension:.4,pointRadius:4,pointHoverRadius:8,pointHoverBorderWidth:3,pointHoverBackgroundColor:'#3E71D2',pointHoverBorderColor:'#fff',hoverBorderWidth:3.5,borderWidth:2.5,fill:false,yAxisID:'y1',order:1,animations:_lineAnim,datalabels:{display:ctx=>window.innerWidth>768&&(ctx.dataIndex===0||ctx.dataIndex===ctx.dataset.data.length-1),opacity:_op,anchor:'center',align:ctx=>ctx.dataIndex===0?'right':'left',offset:8,clip:false,color:dlBlue(),font:{size:11,weight:700},textStrokeColor:dlStroke(),textStrokeWidth:4,textShadowColor:'rgba(0,0,0,.2)',textShadowBlur:3,formatter:v=>v.toLocaleString()}},
    {type:'line',label:'처리 완료',data:cumRes,borderColor:'#F0B144',backgroundColor:'#fff',pointBackgroundColor:'#fff',pointBorderColor:'#F0B144',pointBorderWidth:2,tension:.4,pointRadius:4,pointHoverRadius:8,pointHoverBorderWidth:3,pointHoverBackgroundColor:'#F0B144',pointHoverBorderColor:'#fff',hoverBorderWidth:3.5,borderWidth:2.5,fill:false,yAxisID:'y1',order:0,animations:_lineAnim,datalabels:{display:ctx=>window.innerWidth>768&&(ctx.dataIndex===0||ctx.dataIndex===ctx.dataset.data.length-1),opacity:_op,anchor:'center',align:ctx=>ctx.dataIndex===0?'right':'left',offset:8,clip:false,color:dlAmber(),font:{size:11,weight:700},textStrokeColor:dlStroke(),textStrokeWidth:4,textShadowColor:'rgba(0,0,0,.2)',textShadowBlur:3,formatter:v=>v.toLocaleString()}}
  ];
  const _atSize=(typeof window!=='undefined'&&window.innerWidth<=768)?10:13;const _tkSize=(typeof window!=='undefined'&&window.innerWidth<=768)?9:12;
  S.charts['mo']=new Chart(document.getElementById('c-mo'),{data:{labels:wks.map(x=>`${x.m}월\n${x.w}주`),datasets:moDs},options:{responsive:true,maintainAspectRatio:false,animation:{duration:MO_DUR,easing:'easeOutQuart',onComplete(ac){if(!ac.initial||ac.chart.$dlShown)return;ac.chart.$dlShown=true;const ch=ac.chart,t0=performance.now(),fd=350;const tick=()=>{if(!ch||ch.$destroyed||!ch.ctx)return;try{const p=Math.min(1,(performance.now()-t0)/fd);ch.$la=p*p*(3-2*p);ch.update('none');if(p<1)requestAnimationFrame(tick);}catch(e){console.warn('label fade tick aborted',e);}};requestAnimationFrame(tick);}},plugins:{legend:{display:false},tooltip:{mode:'index',intersect:false,position:'aboveAll',yAlign:'top',caretPadding:6,padding:12,usePointStyle:true,boxWidth:10,boxHeight:10,boxPadding:6,callbacks:{label:ctx=>`${ctx.dataset.label}: ${(ctx.parsed.y??ctx.parsed??0).toLocaleString()}건`}}},scales:{x:{grid:{display:false},ticks:{font:{size:10},color:chartInk(),callback:function(v){return this.getLabelForValue(v).split('\n');}}},y:{beginAtZero:true,position:'left',grace:'25%',grid:{color:chartGrid()},ticks:{font:{size:_tkSize}},title:{display:true,text:'미처리(건)',font:{size:_atSize,weight:600},color:chartAxisTitle()}},y1:{beginAtZero:false,min:_y1min,max:_y1max,position:'right',grid:{display:false},ticks:{font:{size:_tkSize}},title:{display:true,text:'접수·처리(건)',font:{size:_atSize,weight:600},color:chartAxisTitle()}}}}});
  // Custom HTML legend for c-mo
  const lgMo=document.getElementById('c-mo-lg');if(lgMo)lgMo.innerHTML=[
    {label:'60일 이상',type:'bar',color:'#DA6A60'},
    {label:'30~59일',type:'bar',color:'#E89C9A'},
    {label:'30일 미만',type:'bar',color:'#B3C7DD'},
    {label:'전체 접수',type:'line',color:'#3E71D2'},
    {label:'처리 완료',type:'line',color:'#F0B144'}
  ].map(d=>`<div class="li"><span class="${d.type==='bar'?'mk-bar':'mk-ln'}" style="${d.type==='bar'?'background':'border-color'}:${d.color}"></span>${d.label}</div>`).join('');
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
    return`<tr><td class="cc"><b>${i+1}</b></td><td class="rl-link" data-act="rec.list" data-sid="${esc(sid)}" data-scope="ul" data-trade="${esc(t.t)}" data-vac="${_vk}"><b>${esc(t.t)}</b></td><td>${coCell}</td><td class="n">${pc.toLocaleString()}</td><td class="n" style="color:var(--b600);font-weight:700">${t.c.toLocaleString()}</td><td class="cc" style="white-space:nowrap"><span class="ba ${dBadge}" data-tt="전월 ${pc.toLocaleString()} → 금월 ${t.c.toLocaleString()}" aria-label="전월 ${pc.toLocaleString()} → 금월 ${t.c.toLocaleString()}">${dArrow} ${dTxt}</span></td><td class="cc" style="font-weight:600">${ratio}%</td><td style="padding-left:20px"><textarea class="inp plan-ta" maxlength="5000" aria-label="처리계획" name="plan-${sid}-${planField}-${esc(t.t)}" data-plan-id="cmt|${sid}|${planField}|${esc(S.rm+'@'+t.t)}" style="padding:5px 9px;font-size:11.5px;min-height:32px;resize:none;font-family:inherit;width:100%;overflow:hidden" placeholder="" data-act="panel.plan">${esc(plan)}</textarea></td></tr>`;
  };
  const etcFn=(etc)=>{
    if(!etc)return'';
    const pc=(etc.keys||[]).reduce((a,k)=>a+(topPrev[k]||0),0),dN=etc.c-pc;
    const dArrow=dN===0?'─':dN>0?'▲':'▼',dBadge=dN===0?'bgr':dN>0?'brd':'bgn';
    const dTxt=dN===0?'0':`${dN>0?'+':'−'}${Math.abs(dN).toLocaleString()}`;
    const ratio=unr>0?(etc.c/unr*100).toFixed(1):'0.0';
    const coCell=etc.coN>0?`외 ${etc.coN.toLocaleString()}개 업체`:'-';
    const planE=cm[planField]?.[S.rm+'@기타']||'';
    return`<tr data-fixed="1"><td class="cc"></td><td><b>기타</b></td><td>${coCell}</td><td class="n">${pc.toLocaleString()}</td><td class="n" style="color:var(--b600);font-weight:700">${etc.c.toLocaleString()}</td><td class="cc" style="white-space:nowrap"><span class="ba ${dBadge}" data-tt="전월 ${pc.toLocaleString()} → 금월 ${etc.c.toLocaleString()}" aria-label="전월 ${pc.toLocaleString()} → 금월 ${etc.c.toLocaleString()}">${dArrow} ${dTxt}</span></td><td class="cc" style="font-weight:600">${ratio}%</td><td style="padding-left:20px"><textarea class="inp plan-ta" maxlength="5000" aria-label="처리계획" name="plan-${sid}-${planField}-기타" data-plan-id="cmt|${sid}|${planField}|${esc(S.rm+'@기타')}" style="padding:5px 9px;font-size:11.5px;min-height:32px;resize:none;font-family:inherit;width:100%;overflow:hidden" placeholder="" data-act="panel.plan">${esc(planE)}</textarea></td></tr>`;
  };
  const totFn=(tot,prevTot)=>{
    if(!tot)return'';
    const dN=tot.c-prevTot,dArrow=dN===0?'─':dN>0?'▲':'▼',dBadge=dN===0?'bgr':dN>0?'brd':'bgn';
    const dTxt=dN===0?'0':`${dN>0?'+':'−'}${Math.abs(dN).toLocaleString()}`;
    return`<tr class="tot"><td class="cc"></td><td><b>합계</b></td><td></td><td class="n"><b>${prevTot.toLocaleString()}</b></td><td class="n" style="color:var(--b600)"><b>${tot.c.toLocaleString()}</b></td><td class="cc" style="white-space:nowrap"><span class="ba ${dBadge}" data-tt="전월 ${prevTot.toLocaleString()} → 금월 ${tot.c.toLocaleString()}" aria-label="전월 ${prevTot.toLocaleString()} → 금월 ${tot.c.toLocaleString()}">${dArrow} ${dTxt}</span></td><td class="cc"><b>100.0%</b></td><td style="padding-left:20px"><div style="min-height:32px"></div></td></tr>`;
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
  const _legend=`<div class="ltrmom-lg"><div class="li"><span class="mk" style="background:#DA6A60"></span>60일 이상</div><div class="li"><span class="mk" style="background:#E89C9A"></span>30~59일</div><div class="li"><span class="mk" style="background:#B3C7DD"></span>30일 미만</div></div>`;
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
    return`<tr><td class="cc"><b>${i+1}</b></td><td class="rl-link" data-act="rec.list" data-sid="${esc(sid)}" data-scope="lul" data-trade="${esc(t.t)}"><b>${esc(t.t)}</b></td><td>${coCell}</td><td class="n">${pc.toLocaleString()}</td><td class="n" style="color:var(--b600);font-weight:700">${t.c.toLocaleString()}</td><td class="cc" style="white-space:nowrap"><span class="ba ${dBadge}" data-tt="전월 ${pc.toLocaleString()} → 금월 ${t.c.toLocaleString()}" aria-label="전월 ${pc.toLocaleString()} → 금월 ${t.c.toLocaleString()}">${dArrow} ${dTxt}</span></td><td class="cc" style="font-weight:600">${ratio}%</td><td style="padding-left:20px"><textarea class="inp plan-ta" maxlength="5000" aria-label="처리계획" name="plan-${sid}-${planKey}-${esc(t.t)}" data-plan-id="cmt|${sid}|${planKey==='pp'?'processingPlan':'vacantProcessingPlan'}|${esc(S.rm+'@'+t.t)}" style="padding:5px 9px;font-size:11.5px;min-height:32px;resize:none;font-family:inherit;width:100%;overflow:hidden" placeholder="" data-act="panel.plan">${esc(plan)}</textarea></td></tr>`;
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
    return`<tr data-fixed="1"><td class="cc"></td><td><b>기타</b></td><td>${coCell}</td><td class="n">${pc.toLocaleString()}</td><td class="n" style="color:var(--b600);font-weight:700">${etc.c.toLocaleString()}</td><td class="cc" style="white-space:nowrap"><span class="ba ${dBadge}" data-tt="전월 ${pc.toLocaleString()} → 금월 ${etc.c.toLocaleString()}" aria-label="전월 ${pc.toLocaleString()} → 금월 ${etc.c.toLocaleString()}">${dArrow} ${dTxt}</span></td><td class="cc" style="font-weight:600">${ratio}%</td><td style="padding-left:20px"><textarea class="inp plan-ta" maxlength="5000" aria-label="처리계획" name="plan-${sid}-pp-기타" data-plan-id="cmt|${sid}|processingPlan|${esc(S.rm+'@기타')}" style="padding:5px 9px;font-size:11.5px;min-height:32px;resize:none;font-family:inherit;width:100%;overflow:hidden" placeholder="" data-act="panel.plan">${esc(planEtc)}</textarea></td></tr>`;
  };
  // 합계 행
  const trTotFn=(tot,prevTot)=>{
    if(!tot)return'';
    const dN=tot.c-prevTot,dArrow=dN===0?'─':dN>0?'▲':'▼',dBadge=dN===0?'bgr':dN>0?'brd':'bgn';
    const dTxt=dN===0?'0':`${dN>0?'+':'−'}${Math.abs(dN).toLocaleString()}`;
    return`<tr class="tot"><td class="cc"></td><td><b>합계</b></td><td></td><td class="n"><b>${prevTot.toLocaleString()}</b></td><td class="n" style="color:var(--b600)"><b>${tot.c.toLocaleString()}</b></td><td class="cc" style="white-space:nowrap"><span class="ba ${dBadge}" data-tt="전월 ${prevTot.toLocaleString()} → 금월 ${tot.c.toLocaleString()}" aria-label="전월 ${prevTot.toLocaleString()} → 금월 ${tot.c.toLocaleString()}">${dArrow} ${dTxt}</span></td><td class="cc"><b>100.0%</b></td><td style="padding-left:20px"><div style="min-height:32px"></div></td></tr>`;
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
    <div class="card main-chart-card" data-print="ov-chart"><div class="sh" style="margin-bottom:6px;flex-shrink:0"><div class="ct cardttl">하자접수 · 처리 주차별 추이</div><select class="yr-sel no-print" id="strend-yr" data-act="site.trendYear" aria-label="현장 추이 연도 선택"></select></div><div class="cw" style="flex:1;min-height:0"><canvas id="c-mo-${sid}"></canvas></div><div id="c-mo-lg-${sid}" class="chart-lg" style="padding-left:48px;flex-shrink:0"><div class="li"><span class="mk-bar" style="background:#DA6A60"></span>60일 이상</div><div class="li"><span class="mk-bar" style="background:#E89C9A"></span>30~59일</div><div class="li"><span class="mk-bar" style="background:#B3C7DD"></span>30일 미만</div><div class="li"><span class="mk-ln" style="border-color:#3E71D2"></span>전체 접수</div><div class="li"><span class="mk-ln" style="border-color:#F0B144"></span>처리 완료</div></div></div>
    <div class="opsr" style="margin-bottom:0" data-print="ov-opsr">
      <div class="card"><div class="ct cardttl">전월대비 실적 현황</div><div id="c-mom-${sid}" class="mom-wrap"></div></div>
      <div class="card"><div class="ct cardttl">공종별 미처리 분포</div><div class="dn-side"><div class="canv" style="padding:0px"><canvas id="c-mx-${sid}"></canvas></div><div class="lg lg-2col" id="c-mx-lg-${sid}"></div></div></div>
    </div>
    <div class="card" data-print="ov-analysis"><div class="sh"><div class="st cardttl">종합 분석 의견</div><button class="btn bo bsm" data-act="panel.ai" data-sid="${esc(sid)}">AI 분석 생성</button></div><div class="aib"><div class="ail">AI 분석</div><div id="ait-${sid}" class="ait">${ai?safeHTML(ai):'<p style="color:var(--lbl3)">AI 분석 생성 버튼을 클릭하세요. (설정에서 Gemini API 키 필요)</p>'}</div></div></div>
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
    {type:'bar',label:'60일 이상',data:wks.map(x=>x.lt60||0),backgroundColor:'#DA6A60',hoverBackgroundColor:'#C65A50',stack:'u',borderRadius:0,borderSkipped:false,yAxisID:'y',order:3,animations:_barAnim,datalabels:{display:ctx=>window.innerWidth>768&&moDLCfg(ctx).showInner&&ctx.dataset.data[ctx.dataIndex]>0,opacity:_opIn,anchor:'center',align:'center',color:'#fff',font:ctx=>({size:moDLCfg(ctx).size,weight:600}),formatter:v=>v.toLocaleString()}},
    {type:'bar',label:'30~59일',data:wks.map(x=>x.lt-(x.lt60||0)),backgroundColor:'#E89C9A',hoverBackgroundColor:'#C76F6D',stack:'u',borderRadius:0,borderSkipped:false,yAxisID:'y',order:3,animations:_barAnim,datalabels:{display:ctx=>window.innerWidth>768&&moDLCfg(ctx).showInner&&ctx.dataset.data[ctx.dataIndex]>0,opacity:_opIn,anchor:'center',align:'center',color:'#7a3434',font:ctx=>({size:moDLCfg(ctx).size,weight:600}),formatter:v=>v.toLocaleString()}},
    {type:'bar',label:'30일 미만',data:wks.map(x=>x.u-x.lt),backgroundColor:'#B3C7DD',hoverBackgroundColor:'#7E9BBC',stack:'u',borderRadius:0,borderSkipped:false,yAxisID:'y',order:3,animations:_barAnim,datalabels:{labels:{value:{display:ctx=>window.innerWidth>768&&moDLCfg(ctx).showInner&&ctx.dataset.data[ctx.dataIndex]>0,opacity:_opIn,anchor:'center',align:'center',color:'#1F2B4C',font:ctx=>({size:moDLCfg(ctx).size,weight:600}),formatter:v=>v.toLocaleString()},total:{display:ctx=>{if(window.innerWidth<=768)return false;const t=wks[ctx.dataIndex]?.u||0;if(t<=0)return false;const c=moDLCfg(ctx),n=ctx.chart.data.labels.length;return c.totalEvery===1||ctx.dataIndex%c.totalEvery===0||ctx.dataIndex===n-1;},opacity:_op,anchor:'end',align:'end',offset:2,clip:false,color:dlInk(),font:ctx=>({size:moDLCfg(ctx).size,weight:700}),textStrokeColor:dlStroke(),textStrokeWidth:4,formatter:(v,ctx)=>{const t=wks[ctx.dataIndex].u;return t>0?t.toLocaleString():'';}}}}},
    {type:'line',label:'전체 접수',data:cumR,borderColor:'#3E71D2',backgroundColor:'#fff',pointBackgroundColor:'#fff',pointBorderColor:'#3E71D2',pointBorderWidth:2,tension:.4,pointRadius:4,pointHoverRadius:8,borderWidth:2.5,fill:false,yAxisID:'y1',order:1,animations:_lineAnim,datalabels:{display:ctx=>window.innerWidth>768&&(ctx.dataIndex===0||ctx.dataIndex===ctx.dataset.data.length-1),opacity:_op,anchor:'center',align:ctx=>ctx.dataIndex===0?'right':'left',offset:8,clip:false,color:dlBlue(),font:{size:11,weight:700},textStrokeColor:dlStroke(),textStrokeWidth:4,formatter:v=>v.toLocaleString()}},
    {type:'line',label:'처리 완료',data:cumRes,borderColor:'#F0B144',backgroundColor:'#fff',pointBackgroundColor:'#fff',pointBorderColor:'#F0B144',pointBorderWidth:2,tension:.4,pointRadius:4,pointHoverRadius:8,borderWidth:2.5,fill:false,yAxisID:'y1',order:0,animations:_lineAnim,datalabels:{display:ctx=>window.innerWidth>768&&(ctx.dataIndex===0||ctx.dataIndex===ctx.dataset.data.length-1),opacity:_op,anchor:'center',align:ctx=>ctx.dataIndex===0?'right':'left',offset:8,clip:false,color:dlAmber(),font:{size:11,weight:700},textStrokeColor:dlStroke(),textStrokeWidth:4,formatter:v=>v.toLocaleString()}}
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
  if(!Chart.__ctReg){Chart.register({id:'centerText',afterDraw(chart,_,opts){if(!opts||!opts.display)return;const{ctx,chartArea:{left,right,top,bottom}}=chart;const cx=(left+right)/2,cy=(top+bottom)/2;ctx.save();ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle=opts.valueColor||'#1C1C1E';ctx.font=`700 ${opts.valueSize||16}px 'Pretendard Variable',Pretendard,sans-serif`;ctx.fillText(opts.value||'',cx,cy-2);ctx.fillStyle=opts.labelColor||'rgba(60,60,67,.58)';ctx.font=`600 ${opts.labelSize||11}px 'Pretendard Variable',Pretendard,sans-serif`;ctx.fillText(opts.label||'',cx,cy+14);ctx.restore();}});Chart.__ctReg=true;}
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
try{const url=`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`;const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':S.ck},body:JSON.stringify({systemInstruction:{parts:[{text:systemInstruction}]},contents:[{parts:[{text:p}]}],generationConfig:{maxOutputTokens:4096,temperature:0.4,thinkingConfig:{thinkingBudget:0}}})});const d=await r.json();if(d.error)throw new Error(d.error.message||'API 오류');let txt=d.candidates?.[0]?.content?.parts?.[0]?.text||'분석 결과를 불러올 수 없습니다.';txt=txt.replace(/^```html\s*/i,'').replace(/```$/,'').trim();anaSet(sid,txt);lsSave();fb2AnaWrite(sid,txt);if(el)el.innerHTML=safeHTML(txt);toast('AI 분석 완료');}
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
    el.innerHTML=safeHTML(items.map(x=>`<div class="ic ${x.cls}"><div class="ic-i">${icoSVG(x.icon)}</div><div class="ic-t"><div class="ic-ttl">${x.ttl}</div><div class="ic-sub">${x.sub}</div></div></div>`).join(''));
    insBindCards();
    toast('AI 분석 실패: '+e.message);
  }
}

// UPLOAD
const COLS_REQ=['접수일','처리상태','공종'];
// 경고 컬럼(누락 시 차단 없이 경고): norm()이 읽는 HCS 표준 컬럼. HCS가 컬럼명을 바꾸면 값이
// 조용히 비어 집계가 어긋나는 사일런트 실패였음 → 업로드 시점에 시끄럽게 알린다. 대체명은 배열로 묶음.
const COLS_WARN=[['현장'],['현장코드'],['동'],['호'],['접수번호'],['처리확인일'],['하자유형'],['하자구분'],['중대하자유형','중대하자'],['지연일','지연일수'],['보수주체'],['시공업체'],['보수업체'],['입주상태','분양상태'],['공간'],['접수내용'],['민원']];
// 헤더 행 자동 감지 — 첫 20행 안에서 '접수일' 또는 '공종' 같은 필수 헤더가 있는 행 찾기
function findHeaderRow(rows){const sniff=['접수일','공종','처리상태','보수주체'];for(let i=0;i<Math.min(rows.length,20);i++){const r=rows[i]||[];const cells=r.map(c=>String(c||'').trim());let hits=0;for(const s of sniff)if(cells.includes(s))hits++;if(hits>=2)return i;}return 0;}
// AOA(array-of-arrays)를 헤더 매핑된 객체 배열로 변환
function rowsToObjs(aoa){const hi=findHeaderRow(aoa),hs=(aoa[hi]||[]).map(c=>String(c||'').trim());const objs=[];for(let i=hi+1;i<aoa.length;i++){const row=aoa[i]||[];if(row.every(c=>c===''||c==null))continue;const o={};hs.forEach((h,j)=>{if(h&&h!=='__proto__'&&h!=='constructor'&&h!=='prototype')o[h]=row[j]!=null?row[j]:'';});objs.push(o);}return{rows:objs,headers:hs.filter(Boolean)};}
function setStep(n){document.querySelectorAll('#upstepper .step').forEach((s,i)=>{const j=i+1;s.classList.toggle('done',j<n);s.classList.toggle('act',j===n);if(j<n)s.querySelector('.step-c').innerHTML='<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M3 8l3 3 7-7"/></svg>';else s.querySelector('.step-c').textContent=String(j);});}
function onFile(f){
  if(manageLocked()){toast('보기 전용입니다 · 관리자만 업로드할 수 있습니다');return;}
  if(!f){console.warn('[upload] onFile called without file');return;}
  const e=f.name.split('.').pop().toLowerCase();
  if(e==='csv')rCSV(f);
  else if(['xlsx','xls'].includes(e))rXLSX(f);
  else toast('지원하지 않는 형식: '+e);
  // 같은 파일 재선택 시 onchange가 안 뜨는 브라우저 동작 대응
  const fi=document.getElementById('fi');if(fi)fi.value='';
}
// CSV 인코딩 자동 판별 — UTF-8 우선, 실패 시 CP949(EUC-KR). 한국 엑셀 'CSV로 저장'은 보통 CP949.
function csvDecode(buf){
  const u=new Uint8Array(buf);
  if(u.length>=3&&u[0]===0xEF&&u[1]===0xBB&&u[2]===0xBF)return new TextDecoder('utf-8').decode(u.subarray(3)); // UTF-8 BOM
  try{return new TextDecoder('utf-8',{fatal:true}).decode(u);}           // 유효 UTF-8이면 그대로
  catch(_){try{return new TextDecoder('euc-kr').decode(u);}catch(__){return new TextDecoder('utf-8').decode(u);}} // 아니면 CP949
}
// RFC4180 CSV 파서 — 따옴표 내부의 쉼표·줄바꿈·이스케이프("") 처리(단순 split의 컬럼 밀림 방지)
function csvToAoA(text){
  text=text.replace(/^\uFEFF/,'');
  const rows=[];let row=[],fld='',q=false;
  for(let i=0;i<text.length;i++){const c=text[i];
    if(q){ if(c==='"'){ if(text[i+1]==='"'){fld+='"';i++;} else q=false; } else fld+=c; continue; }
    if(c==='"'){q=true;continue;}
    if(c===','){row.push(fld);fld='';continue;}
    if(c==='\n'){row.push(fld);rows.push(row);row=[];fld='';continue;}
    if(c==='\r')continue;
    fld+=c;
  }
  if(fld.length||row.length){row.push(fld);rows.push(row);}
  return rows.map(r=>r.map(c=>c.trim())).filter(r=>r.some(c=>c!==''));
}
function rCSV(f){
  const r=new FileReader();
  r.onerror=err=>{console.error('[upload] CSV read error',err);toast('CSV 읽기 실패');};
  r.onload=e=>{
    try{
      const aoa=csvToAoA(csvDecode(e.target.result));
      const{rows,headers}=rowsToObjs(aoa);
      handleParsed(rows,headers);
    }catch(err){console.error('[upload] CSV parse error',err);toast('CSV 파싱 실패: '+err.message);}
  };
  r.readAsArrayBuffer(f);
}
// SheetJS 프로토타입 오염 완화 (CVE-2023-30533 · xlsx<0.19.3) — XLSX.read 전후 Object.prototype을
// 비교해 악성 파일이 주입한 신규 프로토타입 속성을 제거. 정식 해결은 SheetJS 최신판 업그레이드(별도).
function readWorkbookSafe(data,opts){
  const before=new Set(Object.getOwnPropertyNames(Object.prototype));
  try{return XLSX.read(data,opts);}
  finally{
    for(const k of Object.getOwnPropertyNames(Object.prototype)){
      if(!before.has(k)){try{delete Object.prototype[k];}catch(_){}}
    }
  }
}
async function rXLSX(f){
  try{await loadXLSX();}catch(e){toast('엑셀 모듈 로딩 실패 · 네트워크/CDN 차단 확인');return;}
  const r=new FileReader();
  r.onerror=err=>{console.error('[upload] XLSX read error',err);toast('파일 읽기 실패');};
  r.onload=e=>{
    try{
      const wb=readWorkbookSafe(e.target.result,{type:'array',cellDates:true});
      const sh=wb.Sheets[wb.SheetNames[0]];
      const aoa=XLSX.utils.sheet_to_json(sh,{header:1,defval:'',raw:false,dateNF:'yyyy-mm-dd'});
      const{rows,headers}=rowsToObjs(aoa);
      handleParsed(rows,headers);
    }catch(err){
      console.error('[upload] XLSX parse error',err);
      const msg=String(err.message||err);
      if(/Encrypted|EncryptionInfo|ECMA-376/i.test(msg)){
        toast('암호로 보호된 엑셀입니다.',5000);
      }else{
        toast('Excel 파싱 실패: '+msg);
      }
    }
  };
  r.readAsArrayBuffer(f);
}
function handleParsed(rowsRaw,hs){
  // 제외 키워드 적용: 대소문자/공백 무시. 여러 키워드는 쉼표로 구분.
  const exTk=(S.exTk||'').split(',').map(t=>t.replace(/\s+/g,'').toLowerCase()).filter(Boolean);
  let excluded=0,rows=rowsRaw;
  if(exTk.length){const matchRow=r=>{const blob=Object.values(r).map(v=>String(v??'').replace(/\s+/g,'').toLowerCase()).join('|');return exTk.some(t=>blob.includes(t));};rows=rowsRaw.filter(r=>{if(matchRow(r)){excluded++;return false;}return true;});}
  // 필수 컬럼 검증
  const missing=COLS_REQ.filter(c=>!hs.includes(c));
  if(missing.length){toast('필수 컬럼 누락: '+missing.join(', '),5000);return;}
  // 경고 컬럼 점검(차단 아님): 대체명 중 하나도 없으면 해당 값이 전부 비어 집계됨 → HCS 컬럼명 변경 신호
  const warnMiss=COLS_WARN.filter(alts=>!alts.some(c=>hs.includes(c))).map(alts=>alts[0]);
  if(warnMiss.length&&!confirm('다음 컬럼이 엑셀에 없어 해당 값이 전부 빈 채로 집계됩니다.\n(HCS 컬럼명 변경 가능성 — 원본 헤더를 확인하세요)\n\n· '+warnMiss.join('  · ')+'\n\n그대로 진행하시겠습니까?'))return;
  if(!rows.length){toast('처리할 데이터가 없습니다');return;}
  S.ubuf=rows;
  if(excluded)toast(`제외 ${excluded.toLocaleString()}건 적용 · ${rows.length.toLocaleString()}건 처리`);
  confirmUL();
}
// 업로드 데이터 이상 징후 점검 — 회의자료 신뢰성 보호용. 차단이 아니라 경고(진행 여부는 사용자가 결정).
// 점검: ① 미래 접수일/완료일(KST 오늘 이후) ② 중복 접수번호(공백 제외, 2회 이상) ③ 접수일 없음(집계에서 제외되는 행)
function auditUpload(items){
  const today=new Date(Date.now()+9*36e5).toISOString().slice(0,10); // KST 기준 오늘 YYYY-MM-DD
  let futR=0,futC=0,noDate=0;const rn=new Map();
  for(const i of items){
    if(!i.receiptDate)noDate++;else if(i.receiptDate>today)futR++;
    if(i.completionDate&&i.completionDate>today)futC++;
    const k=(i.receiptNo||'').trim();if(k)rn.set(k,(rn.get(k)||0)+1);
  }
  let dupKeys=0,dupRows=0;rn.forEach(c=>{if(c>1){dupKeys++;dupRows+=c;}});
  const L=[];
  if(futR)L.push(`· 미래 접수일(오늘 이후): ${futR.toLocaleString()}건`);
  if(futC)L.push(`· 미래 완료일(오늘 이후): ${futC.toLocaleString()}건`);
  if(dupKeys)L.push(`· 중복 접수번호: ${dupKeys.toLocaleString()}종 ${dupRows.toLocaleString()}건`);
  if(noDate)L.push(`· 접수일 없음(집계 제외): ${noDate.toLocaleString()}건`);
  if(!L.length)return '';
  return `업로드 데이터에서 이상 징후가 발견되었습니다.\n\n${L.join('\n')}\n\n그대로 진행하면 회의자료 수치에 영향을 줄 수 있습니다. 계속 진행하시겠습니까?\n(취소 후 원본 파일을 수정하는 것을 권장합니다)`;
}
async function confirmUL(){
  if(!S.ubuf){toast('파일을 먼저 업로드하세요');return;}
  progShow('데이터 정규화 중...');
  await nextFrame();
  // 정규화 + 현장명별 그룹핑 — 청크 단위로 처리해 진행률 표시
  const src=S.ubuf,total=src.length,items=new Array(total);
  const CHUNK=5000;
  for(let i=0;i<total;i+=CHUNK){
    const end=Math.min(i+CHUNK,total);
    for(let j=i;j<end;j++)items[j]=norm(src[j]);
    progSet(end/total*100,`${end.toLocaleString()} / ${total.toLocaleString()}행`);
    await nextFrame();
  }
  // 이상 징후 점검(차단 아님 — 진행 여부는 사용자 판단)
  const _audit=auditUpload(items);
  if(_audit){progHide();if(!confirm(_audit)){cancelUL();return;}progShow('데이터 저장 준비 중...');await nextFrame();}
  const byName={},rawByName={};
  for(let i=0;i<items.length;i++){const it=items[i];const k=it.siteName||'(미지정)';(byName[k]=byName[k]||[]).push(it);(rawByName[k]=rawByName[k]||[]).push(src[i]);}
  S._uploadRaw=rawByName;
  const names=Object.keys(byName);
  if(!names.length||(names.length===1&&names[0]==='(미지정)')){progHide();toast('현장명이 식별되지 않습니다. 엑셀의 "현장" 컬럼을 확인하세요');return;}
  // 신규 현장 추출
  const unknown=names.filter(n=>n!=='(미지정)'&&!teamSites().some(s=>s.name===n));
  if(unknown.length){
    progHide();
    // 신규 현장 순차 등록 wizard. 마지막 현장 등록 후 doSaveUL 호출
    openNewSiteWizard(unknown,0,byName,items);
    return;
  }
  await doSaveUL(byName,items);
}
function openNewSiteWizard(unknown,idx,byName,allItems){
  if(idx>=unknown.length){doSaveUL(byName,allItems);return;}
  const name=unknown[idx];
  const sample=byName[name]||[];
  // 엑셀에서 추출 가능한 힌트: 동의 최댓값을 동수 후보로 사용
  const bldgs=new Set(sample.map(i=>i.building).filter(Boolean));
  const bldgHint=bldgs.size||'';
  document.getElementById('mt').textContent=`신규 현장 등록 (${idx+1}/${unknown.length})`;
  document.getElementById('mbody').innerHTML=`<p style="font-size:12.5px;color:var(--lbl2);margin-bottom:14px">"<b style="color:var(--b700)">${esc(name)}</b>" 현장이 등록되어 있지 않습니다. 정보를 입력하세요.</p>
    <div class="g2"><div class="ig2"><label class="il" for="mr">권역 *</label><select class="sel" id="mr">${curRegions().map(r=>`<option>${r}</option>`).join('')}</select></div>
    <div class="ig2"><label class="il" for="mu">세대수</label><input class="inp" id="mu" type="number" placeholder="세대수"></div>
    <div class="ig2"><label class="il" for="mb2">동수</label><input class="inp" id="mb2" type="number" value="${bldgHint}" placeholder="동수"></div>
    <div class="ig2"><label class="il" for="mcu">상가수</label><input class="inp" id="mcu" type="number" placeholder="상가수"></div>
    <div class="ig2"><label class="il" for="mc">준공일</label><input class="inp" id="mc" type="date" max="9999-12-31" data-act="util.clampYear"></div></div>
    <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;margin-top:10px"><input type="checkbox" id="mco" aria-label="공가상가 포함 현장"> 공가상가 포함 현장</label>`;
  document.getElementById('mf').innerHTML=`<button class="btn bg2 bsm" data-act="ul.cancel">전체 취소</button><button class="btn bp bsm" data-act="ul.confirmSite" data-name="${esc(name)}" data-idx="${idx}" data-total="${unknown.length}">${idx+1<unknown.length?'다음':'완료 및 저장'}</button>`;
  openMo();
  // wizard 상태 보관
  S._wiz={unknown,byName,allItems};
}
async function confirmNewSite(name,idx,total){
  const w=S._wiz;if(!w){closeMo();return;}
  const region=document.getElementById('mr').value;
  const units=Number(document.getElementById('mu').value)||0;
  const buildings=Number(document.getElementById('mb2').value)||0;
  const commercialUnits=Number(document.getElementById('mcu').value)||0;
  const completionDate=document.getElementById('mc').value;
  const hasCommercial=document.getElementById('mco').checked;
  const id='s'+Date.now()+'_'+idx;
  const newSite={id,name,region,units,buildings,commercialUnits,completionDate,hasCommercial,teamId:S.teamId};
  S.sites.push(newSite);
  lsSave();
  
  rNav();rSMgr();
  if(idx+1<total){openNewSiteWizard(w.unknown,idx+1,w.byName,w.allItems);}
  else{closeMo();await doSaveUL(w.byName,w.allItems);S._wiz=null;}
}
async function doSaveUL(byName,allItems){
  S._importing=true;
  progShow('하자 데이터 저장 중...');
  await nextFrame();
  // 기준월 자동 결정: 모든 receiptDate의 최댓값이 속한 월
  const dates=allItems.map(i=>i.receiptDate).filter(Boolean).sort();
  const maxDate=dates[dates.length-1]||'';
  const autoRm=maxDate.slice(0,7);
  // 기준월 자동값 상한 = 전월. 월간보고는 '전월 말일까지' 기준인데, 월초 HCS 추출본에는
  // 당월 접수분이 몇 건 섞여 들어와 기준월이 당월로 튀고, 그 상태로 게시하면 미래 월
  // 게시본이 생겨 뷰어 전원이 잘못된 기준월을 보게 된다. 수동 변경(기준월 칩)은 그대로 가능.
  const _capRm=pM(todayYM());
  const effRm=(autoRm&&autoRm>_capRm)?_capRm:autoRm;
  if(effRm){S.rm=effRm;lsSave();}
  // 현장별 저장 (메모리 + IndexedDB 압축). 순차 처리로 진행률 표시.
  let savedCount=0,savedSites=0,firstSid=null;
  const entries=Object.entries(byName).filter(([name])=>name!=='(미지정)');
  for(let k=0;k<entries.length;k++){
    const[name,its]=entries[k];
    const site=teamSites().find(s=>s.name===name);if(!site)continue;
    progMsg(`저장 중: ${name}`);
    progSet(k/entries.length*100,`${k+1} / ${entries.length}개 현장 · ${its.length.toLocaleString()}건 압축`);
    await nextFrame();
    S.def[site.id]=Object.freeze(its); // freeze: 통째 교체 규약 강제
    site.lastUploadedAt=new Date().toISOString();
    await defSave(site.id,its);// 현장 단위로 압축+IndexedDB 쓰기
    savedCount+=its.length;savedSites++;
    if(!firstSid)firstSid=site.id;
  }
  progSet(100,'완료');
  await nextFrame();
  progHide();
  S._uploadRaw=null;
  
  setRmChip();
  toast(`${savedCount.toLocaleString()}건 · ${savedSites}개 현장 저장 완료`);
  S.ubuf=null;setStep(3);
  setTimeout(()=>{
    setStep(1);
    S._importing=false;
    if(savedSites===1&&firstSid)go('site',firstSid);else go('dashboard');
  },600);
}
function cancelUL(){S.ubuf=null;S._uploadRaw=null;S._importing=false;}
function norm(r){
  const pick=(...keys)=>{for(const k of keys){const v=r[k];if(v!=null&&String(v).trim()!=='')return v;}return '';};
  // 처리상태: '처리','미처리','처리완료' 등을 정규화. 처리확인일이 있으면 처리로 간주
  // 처리일 기준 = 처리확인일 단독 (업체처리일·처리완료일 폴백 제거 → 전 계산 일관)
  const rawStatus=String(pick('처리상태')).trim();
  const compRaw=pick('처리확인일');
  const comp=nd(compRaw);
  let status='미처리';
  if(rawStatus==='처리'||rawStatus==='처리완료'||rawStatus==='완료')status='처리';
  else if(rawStatus==='미처리')status='미처리';
  else if(comp)status='처리';
  return{
    // 메모리=슬림 원칙: 원본 전 컬럼은 공유폴더 압축 파일(defects/{id}.json)에만 보존하고
    // 메모리/IndexedDB에는 표시용 필드만 올린다. (70만 건 규모에서 ...r 전개는 메모리 과부하)
    receiptNo:String(pick('접수번호')||''),
    building:String(pick('동')||''),
    unit:String(pick('호')||''),
    trade:String(pick('공종')||''),
    defectType:String(pick('하자유형')||''),
    criticalType:String(pick('중대하자유형','중대하자')||'').trim(), // 중대하자유형 — AI 분석용(비어있지 않으면 중대하자)
    defectClass:String(pick('하자구분')||'').trim(),
    receiptDate:nd(pick('접수일')),
    completionDate:comp,
    status,
    delayDays:Number(pick('지연일','지연일수'))||0,
    repairParty:String(pick('보수주체')||''),
    contractor:String(pick('시공업체')||''),       // 시공업체 — 더 이상 보수업체와 병합하지 않음
    repairContractor:String(pick('보수업체')||''), // 보수업체 별도 보존
    saleStatus:String(pick('입주상태','분양상태')||'입주완료'),
    unitType:String(pick('세대구분')||'세대'),
    moveIn:String(pick('입점여부')||'Y'),
    space:String(pick('공간')||'').trim(),
    receiptContent:String(pick('접수내용')||'').trim(),
    complaint:String(pick('민원')||'').trim(),
    siteName:String(pick('현장')||'').trim(),
    siteCode:String(pick('현장코드')||'').trim()
  };
}
function nd(v){
  if(v==null||v==='')return '';
  // Excel Date 객체 (cellDates:true 사용 시)
  if(v instanceof Date){const y=v.getFullYear();if(y<1900||y>2100)return '';return`${y}-${String(v.getMonth()+1).padStart(2,'0')}-${String(v.getDate()).padStart(2,'0')}`;}
  // Excel 시리얼 숫자 (1899-12-30 기준)
  if(typeof v==='number'&&v>1&&v<60000){const d=new Date(Math.round((v-25569)*86400*1000));if(!isNaN(d))return`${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;}
  const s=String(v).trim();
  // 'YYYY-MM-DD 오전 12:00:00' 같은 한국식 시각 포함도 슬라이스로 처리
  const m=s.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
  if(m)return`${m[1]}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`;
  if(/^\d{8}$/.test(s))return`${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`;
  return '';
}

// SETTINGS
function loadSettings(){
  document.getElementById('cfgc').value=S.ck||'';
  try{const fb=document.getElementById('set-fb');if(fb)fb.style.display=fb2IsEditor()?'':'none';if(typeof fb2RefreshMeta==='function'&&FB2.ready)fb2RefreshMeta();}catch(e){}
  try{const su=document.getElementById('set-users');if(su)su.style.display=fb2IsEditor()?'':'none';if(fb2IsEditor()){if(typeof fb2SubUsers==='function')fb2SubUsers();if(typeof fb2RenderUsers==='function')fb2RenderUsers();}}catch(e){}
}
function openSM(sid){const site=sid?S.sites.find(s=>s.id===sid):null;document.getElementById('mt').textContent=site?'현장 수정':'현장 추가';document.getElementById('mbody').innerHTML=`<div class="g2"><div class="ig2"><label class="il" for="mr">권역 *</label><select class="sel" id="mr">${curRegions().map(r=>`<option ${site?.region===r?'selected':''}>${esc(r)}</option>`).join('')}</select></div><div class="ig2"><label class="il" for="mn">현장명 *</label><input class="inp" id="mn" value="${esc(site?.name||'')}"></div><div class="ig2"><label class="il" for="mu">세대수</label><input class="inp" id="mu" type="number" value="${site?.units||''}"></div><div class="ig2"><label class="il" for="mb2">동수</label><input class="inp" id="mb2" type="number" value="${site?.buildings||''}"></div><div class="ig2"><label class="il" for="mcu">상가수</label><input class="inp" id="mcu" type="number" value="${site?.commercialUnits||''}"></div><div class="ig2"><label class="il" for="mc">준공일</label><input class="inp" id="mc" type="date" max="9999-12-31" data-act="util.clampYear" value="${site?.completionDate||''}"></div></div><label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;margin-top:6px"><input type="checkbox" id="mco" ${site?.hasCommercial?'checked':''} aria-label="공가상가 포함 현장"> 공가상가 포함 현장</label><label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;margin-top:8px"><input type="checkbox" id="mcv" ${site?.showVacant!==false?'checked':''} aria-label="공가세대 탭 표시"> 공가세대 탭 표시</label>`;document.getElementById('mf').innerHTML=`<button class="btn bg2 bsm" data-act="modal.close">취소</button><button class="btn bp bsm" data-act="modal.confirmSM" data-sid="${esc(sid||'')}">저장</button>`;openMo();}
function confirmSM(eid){if(manageLocked()){toast('보기 전용입니다 · 관리자만 변경할 수 있습니다');return;}const d={name:document.getElementById('mn').value.trim(),region:document.getElementById('mr').value,units:Number(document.getElementById('mu').value)||0,buildings:Number(document.getElementById('mb2').value)||0,commercialUnits:Number(document.getElementById('mcu').value)||0,completionDate:document.getElementById('mc').value,hasCommercial:document.getElementById('mco').checked,showVacant:document.getElementById('mcv')?document.getElementById('mcv').checked:true};if(!d.name){toast('현장명을 입력하세요');return;}if(eid){const old=S.sites.find(s=>s.id===eid);d.id=eid;d.teamId=old?old.teamId:S.teamId;if(old&&old.lastUploadedAt)d.lastUploadedAt=old.lastUploadedAt;const idx=S.sites.findIndex(s=>s.id===eid);if(idx>=0)S.sites[idx]=d;}else{const id='s'+Date.now();d.id=id;d.teamId=S.teamId;S.sites.push(d);}lsSave();fb2SiteConfigWrite(d.id);rNav();if(S.view==='manage')rManage();else rSMgr();closeMo();toast('현장 저장됨');}
function delS(sid){
  if(manageLocked()){toast('보기 전용입니다 · 관리자만 변경할 수 있습니다');return;}
  const site=S.sites.find(s=>s.id===sid);if(!site)return;
  const cnt=(S.def[sid]||[]).length;
  openConfirm('현장 삭제',`<b>${esc(site.name)}</b> 현장을 삭제합니다.${cnt?` 업로드된 하자 <b>${cnt.toLocaleString()}건</b>도 함께 삭제됩니다.`:''}<br>삭제 직후 잠시 동안 실행취소할 수 있습니다.`,'삭제',()=>doDelS(sid),true);
}
function doDelS(sid){
  const site=S.sites.find(s=>s.id===sid);if(!site)return;
  const snap={site:JSON.parse(JSON.stringify(site)),def:S.def[sid]?JSON.parse(JSON.stringify(S.def[sid])):null,cmt:S.cmt[sid]?JSON.parse(JSON.stringify(S.cmt[sid])):null,ana:S.ana[sid]?JSON.parse(JSON.stringify(S.ana[sid])):null};
  S.sites=S.sites.filter(s=>s.id!==sid);
  delete S.def[sid];delete S.cmt[sid];delete S.ana[sid];
  defDelete(sid);lsSave();rNav();
  if(S.view==='manage')rManage();else rSMgr();
  if(S.view==='site'&&S.sid===sid)go('dashboard');
  _undoDel=snap;
  toastAction('현장 삭제됨 · '+snap.site.name,'실행취소',()=>undoDelS(),7000);
}
function undoDelS(){
  const snap=_undoDel;if(!snap)return;_undoDel=null;
  if(S.sites.some(s=>s.id===snap.site.id)){toast('이미 복원되어 있습니다');return;}
  S.sites.push(snap.site);
  if(snap.def){S.def[snap.site.id]=Object.freeze(snap.def);defSave(snap.site.id,snap.def);}
  if(snap.cmt)S.cmt[snap.site.id]=snap.cmt;
  if(snap.ana!=null)S.ana[snap.site.id]=snap.ana;
  ensureTeams();lsSave();rNav();
  if(S.view==='manage')rManage();else rSMgr();
  toast('삭제 취소됨 · '+snap.site.name);
}

// MONTH PICKER
function openMP(){
  if(document.body.classList.contains('snap')){toast('스냅샷은 내보낸 시점의 기준월로 고정된 문서입니다');return;}
  if(document.body.classList.contains('viewer')){toast('게시본은 기준월 선택기로 전환하세요');return;}
  document.getElementById('mt').textContent='기준월 변경';document.getElementById('mbody').innerHTML=`<p style="font-size:12px;color:var(--lbl2);margin-bottom:12px">월초 회의 기준으로 직전 달 전체 데이터를 분석합니다.</p><div class="ig2"><label class="il" for="mmo">기준월</label><input type="month" class="inp" id="mmo" value="${S.rm}"></div>`;document.getElementById('mf').innerHTML=`<button class="btn bg2 bsm" data-act="modal.close">취소</button><button class="btn bp bsm" data-act="modal.applyM">적용</button>`;openMo();}
function applyM(){const v=document.getElementById('mmo').value;if(v){S.rm=v;setRmChip();lsSave();}closeMo();if(S.view==='dashboard')rDash();if(S.view==='site')rSite(S.sid);}
function stepMonth(delta){
  if(document.body.classList.contains('snap')||document.body.classList.contains('viewer'))return; // 게시본·스냅샷은 기준월 고정(집계가 박제됨)
  const [y,m]=S.rm.split('-').map(Number);
  const d=new Date(y,m-1+delta,1);
  const ym=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  S.rm=ym;
  setRmChip();
  lsSave();
  if(S.view==='dashboard')rDash();
  if(S.view==='site'&&S.sid)rSite(S.sid);
}
function toggleShortcutHelp(){
  const mt=document.getElementById('mt'),mb=document.getElementById('mbody'),mf=document.getElementById('mf');
  if(!mt||!mb||!mf)return;
  mt.textContent='단축키';
  mb.innerHTML=`<div style="font-size:13px;line-height:2.1"><div><kbd>[</kbd> <kbd>]</kbd> &nbsp;기준월 이전 / 다음</div><div><kbd>Esc</kbd> &nbsp;창 닫기</div><div><kbd>?</kbd> &nbsp;이 도움말</div></div><p style="margin-top:12px;font-size:12px;color:var(--lbl3)">입력 중에는 단축키가 동작하지 않습니다.</p>`;
  mf.innerHTML='<button class="btn bg2 bsm" data-act="modal.close">닫기</button>';
  openMo();
}


// 인쇄 헤더(팀명·제목·기준일)를 현재 상태로 갱신 — 앱 인쇄버튼/브라우저 Ctrl+P 모두에서 호출
function updatePrintHeader(){
  const pteam=document.querySelector('#printhdr .ph-team');if(pteam){const tm=curTeam();pteam.textContent=(tm&&tm.name?tm.name:'H서비스센터')+' 하자처리 현황';}
  const t=document.getElementById('ph-title');if(t){const sid=S.sid,site=sid?S.sites.find(s=>s.id===sid):null;t.textContent=S.view==='site'&&site?`${site.region} · ${site.name}`:'전체 현황 대시보드';}
  const d=document.getElementById('ph-date');if(d){const ym=S.rm||new Date().toISOString().slice(0,7),[y,m]=ym.split('-'),lastDay=new Date(Number(y),Number(m),0).getDate();d.textContent=`${y}.${m}.${String(lastDay).padStart(2,'0')}`;}
}
if(typeof window!=='undefined')window.addEventListener('beforeprint',updatePrintHeader);

// PRINT — 화면을 그대로 A4 세로로 출력
function doPrint(){
  updatePrintHeader();

  // 현장패널 인쇄: 4페이지 레이아웃 구성
  const viewSite=document.getElementById('view-site');
  if(S.view==='site'&&viewSite){
    const sc=document.getElementById('scontent');
    if(sc){
      // 1) #view-site에 .printing 클래스 → CSS가 탭 전체 표시
      viewSite.classList.add('printing');
      // 인쇄 헤더를 모든 페이지에 반복하기 위해 #content에 모드 클래스
      const _contentEl=document.getElementById('content');
      if(_contentEl)_contentEl.classList.add('sp-print-mode');

      // 탭 패널 참조
      const pOverview=sc.querySelector('.tpane[data-tab="overview"]');
      const pTrade   =sc.querySelector('.tpane[data-tab="trade"]');
      const pVacant  =sc.querySelector('.tpane[data-tab="vacant"]');
      const pCommercial=sc.querySelector('.tpane[data-tab="commercial"]');
      const pTimeline=sc.querySelector('.tpane[data-tab="timeline"]');

      // ── 고정 4페이지 레이아웃 구성 ──
      //  1p: 헤더, KPI, 추이차트, 전월대비 실적, 공종별 미처리 분포, 월별 현황
      //  2p: 장기미처리 비율 현황, 장기미처리 상위5, 공가세대 현황, 공가세대 미처리 상위5
      //  3p: 공종별 전체 처리 현황
      //  4p: 종합 분석 의견
      // 각 탭 카드 참조 확보 — data-print 명명 속성으로 조회(탭 스코프). 카드 순서가 바뀌어도 안 깨짐.
      //   (구버전: .as 자식 배열의 인덱스로 추출 → 카드 재배치 시 인쇄 조용히 깨지던 위치 의존 제거)
      const qP=(pane,name)=>pane?pane.querySelector('[data-print="'+name+'"]'):null;
      const _printSite=S.sites.find(s=>s.id===S.sid);
      const _printShowVac=!_printSite||_printSite.showVacant!==false;
      const _printShowSangga=!!(_printSite&&_printSite.hasCommercial);

      // overview: 추이차트 / 전월대비+미처리분포(opsr) / 종합분석의견
      const chartCard   =qP(pOverview,'ov-chart');
      const opsrCard    =qP(pOverview,'ov-opsr');
      const analysisCard=qP(pOverview,'ov-analysis');
      // trade: 장기미처리비율 / 장기미처리상위5 / 공종별전체처리현황
      const ltrRatioCard=qP(pTrade,'tr-ltr');
      const top5Card    =qP(pTrade,'tr-top5');
      const tradeAllCard=qP(pTrade,'tr-all');
      // vacant / commercial: 현황 / 미처리상위5 (두 탭이 같은 data-print를 쓰므로 탭 스코프로 조회)
      const vacStatusCard=_printShowVac?qP(pVacant,'vac-status'):null;
      const vacTop5Card  =_printShowVac?qP(pVacant,'vac-top5'):null;
      const comStatusCard=_printShowSangga?qP(pCommercial,'vac-status'):null;
      const comTop5Card  =_printShowSangga?qP(pCommercial,'vac-top5'):null;
      // timeline: 월별현황 / 주차별현황
      const monthCard=qP(pTimeline,'tl-month');
      const weekCard =qP(pTimeline,'tl-week');
      // 인쇄 전용 마커 클래스
      if(monthCard)monthCard.classList.add('sp-month-card');
      if(tradeAllCard)tradeAllCard.classList.add('sp-trade-card');
      if(ltrRatioCard)ltrRatioCard.classList.add('sp-ltr-card');
      if(top5Card)top5Card.classList.add('sp-top5-card');
      if(vacStatusCard)vacStatusCard.classList.add('sp-vac-card');
      if(vacTop5Card)vacTop5Card.classList.add('sp-vactop5-card');
      if(comStatusCard)comStatusCard.classList.add('sp-vac-card');
      if(comTop5Card)comTop5Card.classList.add('sp-vactop5-card');

      // 복원용: 각 카드의 원래 부모/위치 기록 — 부모는 카드 자신의 parentNode에서 도출(재배치 전 시점)
      const _orig=[];
      const _track=(card)=>{if(card&&card.parentNode)_orig.push({card,parent:card.parentNode,next:card.nextSibling});};
      _track(chartCard);_track(opsrCard);_track(analysisCard);
      _track(ltrRatioCard);_track(top5Card);_track(tradeAllCard);
      _track(vacStatusCard);_track(vacTop5Card);
      _track(comStatusCard);_track(comTop5Card);
      _track(monthCard);_track(weekCard);

      // 인쇄 페이지 동적 구성
      const mkPage=(id,brk,cls)=>{const p=document.createElement('div');p.id=id;p.className='sp-print-page'+(brk?' sp-page-break-before':'')+(cls?' '+cls:'');p.dataset.spPrint='1';return p;};
      const hdrSrc=document.getElementById('printhdr');
      const mkHdr=()=>{const h=hdrSrc.cloneNode(true);h.removeAttribute('id');h.className='sp-page-hdr';return h;};
      const akpi=sc.querySelector('.akpi');
      _orig.push({card:akpi,parent:sc,next:akpi?akpi.nextSibling:null});
      const _pages=[];
      const addPage=p=>{_pages.push(p);return p;};

      // 1p: [헤더] KPI 추이차트, 전월대비+미처리분포, 월별 현황
      const p1=addPage(mkPage('_sp_p1',false));
      p1.appendChild(mkHdr());
      if(akpi)p1.appendChild(akpi);
      [chartCard,opsrCard,monthCard].forEach(c=>{if(c)p1.appendChild(c);});
      // 장기미처리 페이지: 비율 현황 + 상위5
      if(ltrRatioCard||top5Card){
        const pp=addPage(mkPage('_sp_ltr',true,'sp-p2'));
        pp.appendChild(mkHdr());
        [ltrRatioCard,top5Card].forEach(c=>{if(c)pp.appendChild(c);});
      }
      // 공가세대 페이지: 현황 + 상위5
      if(vacStatusCard||vacTop5Card){
        const pp=addPage(mkPage('_sp_sedae',true,'sp-p2'));
        pp.appendChild(mkHdr());
        [vacStatusCard,vacTop5Card].forEach(c=>{if(c)pp.appendChild(c);});
      }
      // 공가상가 페이지: 현황 + 상위5
      if(comStatusCard||comTop5Card){
        const pp=addPage(mkPage('_sp_sangga',true,'sp-p2'));
        pp.appendChild(mkHdr());
        [comStatusCard,comTop5Card].forEach(c=>{if(c)pp.appendChild(c);});
      }
      // 공종별 전체 처리 현황 페이지
      const p3=addPage(mkPage('_sp_p3',true));
      p3.appendChild(mkHdr());
      if(tradeAllCard)p3.appendChild(tradeAllCard);
      // 종합 분석 의견 페이지
      const p4=addPage(mkPage('_sp_p4',true));
      p4.appendChild(mkHdr());
      if(analysisCard)p4.appendChild(analysisCard);

      // 처리계획 textarea는 인쇄 시 숨겨지므로, 값을 인쇄용 텍스트로 복제 삽입
      const _planNodes=[];
      [top5Card,vacTop5Card,comTop5Card].forEach(card=>{
        if(!card)return;
        card.querySelectorAll('textarea.plan-ta').forEach(ta=>{
          const div=document.createElement('div');
          div.className='plan-print';
          div.textContent=ta.value||'';
          ta.parentNode.insertBefore(div,ta.nextSibling);
          _planNodes.push(div);
        });
      });

      // 인쇄 페이지를 scontent에 순서대로 추가
      _pages.forEach(p=>sc.appendChild(p));

      // 공종별 전체처리현황 NO25 이후 행 숨김
      if(tradeAllCard){
        const tradeTbody=tradeAllCard.querySelector('[id^="trade-"] tbody');
        if(tradeTbody)[...tradeTbody.querySelectorAll('tr')].forEach((tr,i)=>{if(i>=25)tr.classList.add('sp-hide-print');});
      }
      // 주차별 현황(weekCard)은 사용하지 않음 → 원위치 유지(인쇄 시 빈 timeline 탭째 숨김)

      // 인쇄 실행 후 DOM 복원
      const _restore=()=>{
        viewSite.classList.remove('printing');
        if(_contentEl)_contentEl.classList.remove('sp-print-mode');
        // 마커 클래스 제거
        if(monthCard)monthCard.classList.remove('sp-month-card');
        if(tradeAllCard)tradeAllCard.classList.remove('sp-trade-card');
        if(ltrRatioCard)ltrRatioCard.classList.remove('sp-ltr-card');
        if(top5Card)top5Card.classList.remove('sp-top5-card');
        if(vacStatusCard)vacStatusCard.classList.remove('sp-vac-card');
        if(vacTop5Card)vacTop5Card.classList.remove('sp-vactop5-card');
        if(comStatusCard)comStatusCard.classList.remove('sp-vac-card');
        if(comTop5Card)comTop5Card.classList.remove('sp-vactop5-card');
        // 카드 원위치 복원
        _orig.forEach(({card,parent,next})=>{if(card)parent.insertBefore(card,next);});
        // 인쇄용 처리계획 텍스트 노드 제거
        _planNodes.forEach(n=>{if(n&&n.parentNode)n.parentNode.removeChild(n);});
        // 인쇄 페이지 컨테이너 제거
        _pages.forEach(p=>{if(p&&p.parentNode)p.parentNode.removeChild(p);});
        // trade tbody 행 복원
        if(tradeAllCard){const tb=tradeAllCard.querySelector('[id^="trade-"] tbody');if(tb)[...tb.querySelectorAll('tr')].forEach(tr=>tr.classList.remove('sp-hide-print'));}
      };
      setTimeout(()=>{window.print();setTimeout(_restore,500);},80);
      return;
    }
  }
  // ── 대시보드 인쇄: 헤더를 인쇄 제목으로 (페이지마다 반복) ──
  const viewDash=document.getElementById('view-dashboard');
  if(S.view==='dashboard'&&viewDash){
    const _contentEl=document.getElementById('content');
    if(_contentEl)_contentEl.classList.add('sp-print-mode');
    viewDash.classList.add('printing');
    const hdrSrc=document.getElementById('printhdr');
    const mkHdr=()=>{const h=hdrSrc.cloneNode(true);h.removeAttribute('id');h.className='sp-page-hdr';return h;};
    // 페이지 시작 카드 참조
    const moCard=viewDash.querySelector('#dmo-table')?.closest('.card');
    const siteCard=viewDash.querySelector('#dtable')?.closest('.card');
    // 1페이지 최상단 헤더(KPI 위)
    const firstChild=viewDash.firstElementChild;
    const topHdr=mkHdr();topHdr.dataset.spDashHdr='1';
    viewDash.insertBefore(topHdr,firstChild);
    const _added=[topHdr];
    // 2페이지: 월별 + 현장별 표를 같은 페이지에 (월별 앞에만 헤더+페이지브레이크)
    if(moCard){
      const h=mkHdr();h.dataset.spDashHdr='1';h.classList.add('sp-page-break-before');
      moCard.parentNode.insertBefore(h,moCard);
      _added.push(h);
      moCard.classList.add('sp-dash-month');
    }
    const _restoreDash=()=>{
      if(_contentEl)_contentEl.classList.remove('sp-print-mode');
      viewDash.classList.remove('printing');
      if(moCard)moCard.classList.remove('sp-dash-month');
      _added.forEach(n=>{if(n&&n.parentNode)n.parentNode.removeChild(n);});
    };
    setTimeout(()=>{window.print();setTimeout(_restoreDash,500);},80);
    return;
  }
  window.print();
}

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
  if(typeof recCloseMenu==='function')recCloseMenu();
  if(typeof recClosePvMenu==='function')recClosePvMenu();
  window.__REC=null;
  // 닫힘 애니메이션(약 .22s)이 끝난 뒤 wide 해제 — 닫히는 도중 너비가 갑자기 줄어들지 않도록
  const mb=document.getElementById('mb');
  if(mb){clearTimeout(mb._wideT);mb._wideT=setTimeout(()=>{mb.classList.remove('wide');},240);}
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
function chartInk(){return '#3C3C43';}
function chartGrid(){return 'rgba(0,0,0,.05)';}
function chartAxisTitle(){return 'rgba(60,60,67,.42)';}
function chartSegBorder(){return '#fff';}
function dlBlue(){return '#2C437C';}
function dlAmber(){return '#A0590A';}
function dlInk(){return '#1C1C1E';}
function dlStroke(){return '#fff';}
// 추이차트 데이터라벨 자동 조절 — 막대 실폭(catW)에 맞춰 폰트 크기·표시 정책 결정.
// 주차가 많아 막대가 좁아지면: 폰트 축소 → 막대 안 분해값(장기/일반) 생략 → 막대 위 총합 격주 표시.
// chartArea가 아직 없는 첫 프레임은 opacity 0이라 화면엔 안 보이므로 fallback 값으로 안전.
function moDLCfg(ctx){
  const ca=ctx.chart.chartArea,n=(ctx.chart.data.labels||[]).length||1;
  const catW=(ca&&ca.width)?ca.width/n:60;
  const size=catW>=50?11:catW>=42?10:catW>=34?9:catW>=27?8:7;
  return {size,catW,showInner:catW>=46,totalEvery:catW>=26?1:2};
}
function donutPalette(){return ['#1F2B4C','#2C437C','#304D9D','#3259B6','#3E71D2','#538CDE','#74ABE6','#A0C8F0','#C7DDF6','#DFEBFA','#EAF2FC','#B3C7DD'];}
function applyChartTheme(){if(typeof Chart==='undefined')return;Chart.defaults.color=chartInk();Chart.defaults.borderColor=chartGrid();}

// INIT
async function exportSnapshot(){
  try{
    if(typeof LZString==='undefined'){toast('스냅샷 생성 불가 · 데이터 압축 라이브러리(lz-string CDN) 미로드');return;}
    // 기준 데이터는 '사내 게시본' — 뷰어가 실제로 보는 것과 같은 파일을 만들기 위함.
    //   로컬 원본(S.def)은 업로드한 PC의 IndexedDB에만 있어, 다른 PC에서 만들면 뷰어와 내용이 어긋난다.
    //   이미 게시본을 보고 있으면(뷰어·게시본 열람) 그대로 쓰고, 편집 모드면 게시본을 '조회만' 해서 쓴다.
    //   (과거엔 뷰어 시점으로 전환했는데, 편집자가 화면을 잃어 새로고침이 필요했다 — 상태는 건드리지 않는다.)
    const _stripLul=Q=>{const st={};for(const sid in (Q.st||{})){const k=Object.assign({},Q.st[sid]);k.lul=null;st[sid]=k;}Q.st=st;return Q;}; // 장기미처리는 열 때 파생
    let pub=null,months=null,defRm=null,list=[];
    if(FB2.ready&&FB2.db){try{list=await fb2ListReportMonths();}catch(e){console.warn('[snap] 게시월 목록 조회 실패',e);}}
    // 담을 것이 하나도 없으면 옵션 창을 띄우기 전에 알린다(빈 창을 보여주지 않기 위해)
    if(!list.length&&!window.__SNAP__&&!Object.keys(S.def||{}).length){
      toast('내보낼 데이터가 없습니다 · 게시본이 없으면 먼저 리스트를 업로드하거나 사내 게시를 등록하세요',7000);return;
    }
    const cur=(window.__SNAP__&&window.__SNAP__.rm)||S.rm;
    const opt=await pickSnapMonths(list,list.includes(cur)?cur:(list[0]||cur)); // 옵션 모달(기준월·글꼴)
    if(!opt)return; // 취소
    const _fontOn=!!opt.font;
    if(opt.months&&opt.months.length>1){ // 두 달 이상 → 파일 안에서 전환 가능한 구조
      toast('게시본을 불러오는 중…');
      months={};
      for(const rm of opt.months){
        const d=(await FB2.db.ref('report/'+rm).once('value')).val();
        if(d)months[rm]=_stripLul(buildSnapFromReport(rm,d).P);
      }
      const keys=Object.keys(months);
      if(!keys.length){toast('선택한 월의 게시본을 불러오지 못했습니다');return;}
      defRm=keys.includes(cur)?cur:keys.sort().reverse()[0];
      if(keys.length===1){pub=months[defRm];months=null;}
    }else if(opt.months&&opt.months.length===1&&FB2.ready&&FB2.db){
      toast('게시본을 불러오는 중…');
      try{const d=(await FB2.db.ref('report/'+opt.months[0]).once('value')).val();
          if(d)pub=buildSnapFromReport(opt.months[0],d).P;}catch(e){console.warn('[snap] 게시본 로드 실패',e);}
    }
    if(!months&&!pub&&!window.__SNAP__&&FB2.ready&&FB2.db){
      toast('게시본을 불러오는 중…');
      try{const r=await fb2FetchLatestReport();if(r)pub=buildSnapFromReport(r.rm,r.data).P;}
      catch(e){console.warn('[snap] 게시본 로드 실패',e);}
    }
    const P=months?months[defRm]:(window.__SNAP__||pub);
    if(!P&&!Object.keys(S.def||{}).length){toast('내보낼 데이터가 없습니다 · 게시본이 없으면 먼저 리스트를 업로드하거나 사내 게시를 등록하세요',7000);return;}
    toast('스냅샷 생성 중…');
    let payload;
    if(months){
      // 여러 달 — 월별 게시본을 그대로 담는다(파일 안에서 기준월 전환).
      payload={rm:defRm,months:months};
    }else if(P){
      // 게시본 기준 — 뷰어가 보고 있는 집계·목록을 재계산 없이 그대로 담는다(수치 불일치 원천 차단).
      const st={};
      for(const sid in (P.st||{})){const k=Object.assign({},P.st[sid]);k.lul=null;st[sid]=k;} // lul은 열 때 ul에서 파생
      payload={rm:P.rm||S.rm,sites:P.sites||S.sites,teams:P.teams||S.teams,cmt:P.cmt||S.cmt,ana:P.ana||S.ana,st,wks:P.wks||[],am:P.am||{},siteWks:P.siteWks||{},siteAm:P.siteAm||{},insightsHTML:P.insightsHTML||''}; // cmt는 게시본의 공가·상가 상태가 병합된 P.cmt 사용(편집자 로컬 cmt 아님)
    }else{
      // 폴백 — 네트워크 불가·미게시 상태에서는 이 PC의 로컬 원본으로 계산(내용이 뷰어와 다를 수 있음).
      toast('게시본에 연결할 수 없어 이 PC의 로컬 데이터로 생성합니다',6000);
      const cap=capAll(); // 순수 산출 — 렌더·타이머 의존 제거(P3)
      go('dashboard');if(rDash._flush)rDash._flush(); // 인사이트 DOM 동기 최신화
      await nextFrame();
      const insightsHTML=insCleanHTML(); // 확장 상세는 캡처에서 제외
      const st={};
      // 뷰어 시점과 동일한 정보량만 담는다 — 목록은 슬림 필드, lul은 열 때 ul에서 파생(중복 저장 금지), critUl은 뷰어와 같은 캡(300).
      teamSites().forEach(s2=>{const r=calc(S.def[s2.id]||[],s2,S.rm);st[s2.id]=Object.assign({},r,{ul:slimUL(r.ul),lul:null,critUl:redactUL(r.critUl)});}); // 인수 전 현장 포함 · PII 마스킹
      payload={rm:S.rm,sites:S.sites,teams:S.teams,cmt:S.cmt,ana:S.ana,st,wks:cap.wks||[],am:cap.am||{},siteWks:cap.siteWks||{},siteAm:cap.siteAm||{},insightsHTML};
    }
    // 뷰어 동등 정보량 — 게시본(ulz)과 같은 LZ 압축으로 임베드. 비압축 JSON은 수십 MB로 커져 파일이 사실상 못 쓰게 됨.
    const packed=LZString.compressToBase64(JSON.stringify(payload)); // base64 — <, U+2028/9, $& 등 위험 문자 원천 배제
    // 골격은 라이브 DOM 직렬화가 아니라 배포 원본을 새로 fetch — 라이브 DOM에는 reCAPTCHA가 런타임에
    // 주입한 스크립트·배지, 렌더 잔재, 모달 상태가 섞여 스냅샷에 그대로 박제되는 문제가 있었음.
    let docHtml,appTxt;
    try{
      docHtml=await(await fetch('index.html',{cache:'no-cache'})).text();
      appTxt=await(await fetch('app.js',{cache:'no-cache'})).text();
    }catch(e){console.error('[snap] 원본 fetch 실패',e);toast('스냅샷 생성 실패 · index.html/app.js 로드 불가');return;}
    // ⚠ CSP 해시는 HTML 파서의 줄바꿈 정규화(CRLF→LF) "이후" 본문을 기준으로 검사된다.
    //   CRLF 그대로 해시하면 브라우저 계산값과 어긋나 인라인 앱이 차단됨(스냅샷 전체 먹통의 근본 원인이었음).
    //   → 해시 대상과 삽입 본문을 모두 LF로 정규화해 일치시킨다.
    //   HTML 파서는 CR·CRLF를 모두 LF로 정규화하므로 /\r\n?/ 로 동일하게 맞춘다(\r\n만 치환하면 \r\r\n·단독 CR이 남아 해시가 어긋남).
    docHtml=docHtml.replace(/\r\n?/g,'\n');
    appTxt=appTxt.replace(/\r\n?/g,'\n').replace(/<\/script/gi,'<\\/script'); // 종료태그 방어(현재 0건 — 안전망)
    // 스냅샷은 Firebase를 전혀 쓰지 않음(부팅이 __SNAP__ 분기로 빠짐) — SDK·App Check 태그 제거로 reCAPTCHA 원천 차단
    docHtml=docHtml.replace(/[ \t]*<script[^>]*firebase-(?:app|auth|database|app-check)-compat\.js[^>]*><\/script>\n?/g,'');
    if(docHtml.indexOf('<script src="./app.js"></script>')<0){toast('스냅샷 생성 실패 · index.html 구조 불일치(app.js 태그 없음)');return;}
    // 글꼴 포함(옵션) — 스냅샷은 단일 파일이라 상대경로 woff2를 못 찾고 시스템 글꼴로 폴백된다.
    //   켜져 있으면 base64로 심어 어느 PC에서나 화면과 같은 모양이 되게 한다(파일이 커짐).
    if(_fontOn&&docHtml.indexOf("url('./PretendardVariable.woff2')")>=0){
      try{
        const fb=await(await fetch('./PretendardVariable.woff2',{cache:'force-cache'})).arrayBuffer();
        let bin='';const u8=new Uint8Array(fb);const CH=0x8000;
        for(let i=0;i<u8.length;i+=CH)bin+=String.fromCharCode.apply(null,u8.subarray(i,i+CH));
        docHtml=docHtml.replace("url('./PretendardVariable.woff2')",()=>"url('data:font/woff2;base64,"+btoa(bin)+"')");
      }catch(e){console.warn('[snap] 글꼴 포함 실패 — 시스템 글꼴로 표시됩니다',e);}
    }
    const injectBody='window.__SNAPZ__='+JSON.stringify(packed)+';'; // 한 줄 — 줄바꿈 정규화 무관
    const _h256=async s=>{const d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s));return btoa(String.fromCharCode.apply(null,new Uint8Array(d)));};
    const hApp=await _h256(appTxt),hInj=await _h256(injectBody);
    docHtml=docHtml.replace('<script src="./app.js"></script>',()=>'<scr'+'ipt>'+appTxt+'</scr'+'ipt>'); // 함수 치환 필수 — appTxt 안의 $& 등 replace 특수 패턴 무력화
    docHtml=docHtml.replace("script-src 'self' ","script-src 'self' 'sha256-"+hInj+"' 'sha256-"+hApp+"' ");
    const html=docHtml.replace('</head>',()=>'<scr'+'ipt>'+injectBody+'</scr'+'ipt>\n</head>'); // 함수 치환 — 방어적 유지
    const blob=new Blob([html],{type:'text/html;charset=utf-8'});
    const _mk=months?Object.keys(months).sort():null;
    const _label=_mk?(_mk.length>1?_mk[0]+'~'+_mk[_mk.length-1]:_mk[0]):(payload.rm||S.rm);
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='하자대시보드_스냅샷_'+_label+'.html';
    document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(a.href),4000);
    toast('스냅샷 저장됨 · '+(P?'게시본':'로컬 데이터')+' 기준 '+_label+(months?(' · '+Object.keys(months).length+'개월'):'')+' · '+(html.length/1048576).toFixed(2)+'MB',6000);
  }catch(e){console.error('[snap] export 실패',e);toast('스냅샷 생성 실패');}
}
window.exportSnapshot=exportSnapshot;
// ====================================================================
// ===== 자체 점검(셀프테스트) — index.html?selftest=1 로 실행 =========
// 빌드/모듈 없이도 핵심 순수 로직(날짜 정규화·직전월·주차·역산 집계)의 "현재 동작"을 고정한다.
// 실제 함수를 그대로 호출하므로 사본 불일치(drift)가 없다. 일반 부팅에는 영향 없음.
// 향후 리팩터링·최적화 시 회귀를 즉시 잡는 1차 안전망. 케이스는 자유롭게 추가할 것.
// ====================================================================
function __runSelfTest(){
  const R=[];
  const eq=(name,got,exp)=>R.push({name,ok:JSON.stringify(got)===JSON.stringify(exp),got,exp});
  const ok=(name,cond)=>R.push({name,ok:!!cond,got:!!cond,exp:true});
  try{
    // --- nd(): 날짜 정규화 (다양한 입력 → YYYY-MM-DD) ---
    eq('band 60+',recBandOf(75),'d60');
    eq('band 경계60',recBandOf(60),'d60');
    eq('band 30~59',recBandOf(45),'d30');
    eq('band 경계30',recBandOf(30),'d30');
    eq('band 30미만',recBandOf(3),'d0');
    eq('nd 하이픈',nd('2026-05-01'),'2026-05-01');
    eq('nd 점구분',nd('2026.5.1'),'2026-05-01');
    eq('nd 슬래시',nd('2026/5/1'),'2026-05-01');
    eq('nd 8자리',nd('20260501'),'2026-05-01');
    eq('nd 한국식시각',nd('2026-05-01 오전 12:00:00'),'2026-05-01');
    eq('nd 빈문자열',nd(''),'');
    // --- maskPII(): 외부 AI 전송 전 개인정보 마스킹 (P4) ---
    eq('mask 휴대폰',maskPII('연락처 010-1234-5678 입니다'),'연락처 010-****-**** 입니다');
    eq('mask 휴대폰 무구분',maskPII('01012345678 연락'),'010-****-**** 연락');
    eq('mask 일반전화',maskPII('사무실 02-123-4567'),'사무실 0**-***-****');
    eq('mask 이메일',maskPII('kim@hdec.co.kr 회신'),'***@*** 회신');
    eq('mask 인명호칭',maskPII('홍길동님 요청사항'),'○○님 요청사항');
    eq('mask 역할명 보존',maskPII('고객님 및 담당자님 협의'),'고객님 및 담당자님 협의');
    eq('mask 동호수 보존',maskPII('101동 1203호 주방 누수'),'101동 1203호 주방 누수');
    // --- 분석의견 월별 아카이브 (anaGet/anaSet/anaNormalize) ---
    {const _rm0=S.rm,_bak=S.ana['__t'];S.rm='2026-05';
     S.ana['__t']='레거시 문자열';anaNormalize();
     eq('ana 레거시 승격',anaGet('__t','2026-05'),'레거시 문자열');
     anaSet('__t','6월 분석','2026-06');
     eq('ana 월별 독립',anaGet('__t','2026-05'),'레거시 문자열');
     eq('ana 월별 조회',anaGet('__t','2026-06'),'6월 분석');
     eq('ana 빈 월',anaGet('__t','2026-07'),'');
     if(_bak===undefined)delete S.ana['__t'];else S.ana['__t']=_bak;S.rm=_rm0;}
    // --- 처리계획 전월 이월 (carryPlansForward: add-only) ---
    {const _rm0=S.rm,_bak=S.cmt['__t'];S.rm='2026-06';
     S.cmt['__t']={processingPlan:{'2026-05@도배':'전월 계획','2026-05@타일':'전월 타일','2026-06@타일':'이미 입력됨'}};
     const _fbW=window.fb2PlanWrite;window.fb2PlanWrite=function(){};
     const n=carryPlansForward('__t');
     window.fb2PlanWrite=_fbW;
     eq('이월 add-only 건수',n,1);
     eq('이월 빈칸 복사',S.cmt['__t'].processingPlan['2026-06@도배'],'전월 계획');
     eq('이월 기존값 보존',S.cmt['__t'].processingPlan['2026-06@타일'],'이미 입력됨');
     if(_bak===undefined)delete S.cmt['__t'];else S.cmt['__t']=_bak;S.rm=_rm0;}
    eq('nd null',nd(null),'');
    eq('nd Date객체',nd(new Date(2026,4,1)),'2026-05-01');
    // --- pM(): 직전 월(연 경계 포함) ---
    eq('pM 1월→전년12월',pM('2026-01'),'2025-12');
    eq('pM 3월→2월',pM('2026-03'),'2026-02');
    // --- wk(): 주차 cutoff는 항상 일요일(불변식) ---
    ok('wk 결과는 일요일',(()=>{const s=wk('2026-06-09');return !!s&&new Date(s+'T00:00:00Z').getUTCDay()===0;})());
    eq('wk 빈값',wk(''),null);
    // --- _calcImpl(): 역산 집계 (완료일 기준 미처리/처리) ---
    const site={id:'__selftest',name:'테스트',region:'테스트',units:100,buildings:1,hasCommercial:false};
    const items=[
      {receiptDate:'2026-05-01',status:'처리',completionDate:'2026-05-10',trade:'타일'}, // 5월말 이전 완료
      {receiptDate:'2026-05-02',status:'미처리',trade:'도배'},                              // 미처리
      {receiptDate:'2026-05-03',status:'처리',completionDate:'2026-06-15',trade:'설비'}     // 완료가 5월말 이후 → 5월 기준 미처리
    ];
    const a=_calcImpl(items,site,'2026-05');
    eq('calc 전체접수',a.tR,3);
    eq('calc 처리(5월기준)',a.res,1);
    eq('calc 미처리(5월기준)',a.unr,2);
    ok('calc 처리+미처리=전체',a.res+a.unr===a.tR);
    // 역산 검증: 6월 기준이면 3번 완료가 잡혀 처리=2 (완료일 기준 역산이 핵심 불변식)
    const b=_calcImpl(items,site,'2026-06');
    eq('calc 역산 처리(6월기준)',b.res,2);
    eq('calc 역산 미처리(6월기준)',b.unr,1);
    // --- calcW(): 주차 누적은 단조증가(접수·처리 모두 감소 없음) ---
    const w=a.weekly||[];
    ok('calcW 누적접수 단조증가',(()=>{for(let i=1;i<w.length;i++)if(w[i].r<w[i-1].r)return false;return true;})());
    ok('calcW 누적처리 단조증가',(()=>{for(let i=1;i<w.length;i++)if(w[i].res<w[i-1].res)return false;return true;})());
    // --- calcW(): 월말 컷 == KPI (월별 표·KPI·도넛 일치의 핵심 불변식) ---
    const wme=w.find(x=>x.week===a.rmEnd);
    ok('calcW 기준월말 컷 존재',!!wme);
    eq('calcW 월말 u == KPI 미처리',wme?wme.u:null,a.unr);
    ok('calcW 월말 컷 sun·라벨 정합',!!wme&&(wme.sun?/주$/.test(wme.label):/말$/.test(wme.label)));
    // --- 중대하자 의심 후보 추출(규칙) + _calcImpl ---
    eq('isCrit 누수내용',isCritCandidate(norm({'접수내용':'안방 천장 누수 발생','접수일':'2026-05-01','처리상태':'미처리'})),true);
    eq('isCrit 하자유형 누수',isCritCandidate(norm({'하자유형':'누수','접수일':'2026-05-01','처리상태':'미처리'})),true);
    eq('isCrit 일반 도배',isCritCandidate(norm({'하자유형':'도배','접수내용':'벽지 들뜸','접수일':'2026-05-02','처리상태':'미처리'})),false);
    // 부정·해소 절 필터: "누수 없음/이상無/정상"은 오탐 제거, 진짜 위험은 유지
    eq('isCrit 누수 없음 오탐제거',isCritCandidate(norm({'접수내용':'누수 흔적 없음, 단순 확인 요청','접수일':'2026-05-01','처리상태':'미처리'})),false);
    eq('isCrit 침수 정상 오탐제거',isCritCandidate(norm({'접수내용':'침수 이상 무, 정상 상태','접수일':'2026-05-01','처리상태':'미처리'})),false);
    eq('isCrit 누수 발생 유지',isCritCandidate(norm({'접수내용':'화장실 누수, 아래층 피해 우려','접수일':'2026-05-01','처리상태':'미처리'})),true);
    eq('isCrit 부정어 동반 실위험 유지',isCritCandidate(norm({'접수내용':'전등 이상 없음. 그러나 안방 누수 심각','접수일':'2026-05-01','처리상태':'미처리'})),true);
    // --- html`` 태그드 템플릿: 자동 이스케이프 + rawHTML 통과 ---
    eq('html XSS 이스케이프',html`<div>${'<img src=x onerror=alert(1)>'}</div>`,'<div>&lt;img src=x onerror=alert(1)&gt;</div>');
    eq('html 따옴표 이스케이프',html`<a t="${'a"b'}">x</a>`,'<a t="a&quot;b">x</a>');
    eq('html rawHTML 통과',html`<ul>${rawHTML('<li>x</li>')}</ul>`,'<ul><li>x</li></ul>');
    eq('html 배열 이스케이프',html`${['<a>','<b>']}`,'&lt;a&gt;&lt;b&gt;');
    eq('html null/false 빈문자',html`x${null}${false}y`,'xy');
    const cItems=[
      norm({'접수내용':'거실 바닥 침수, 가구 피해 보상 요구','공종':'방수','접수일':'2026-05-01','처리상태':'미처리','동':'101','호':'1502'}),
      norm({'하자유형':'누수','공종':'방수','접수일':'2026-04-10','처리상태':'미처리','동':'103','호':'808'}),
      norm({'접수내용':'엘리베이터 갇힘 사고','접수일':'2026-05-02','처리상태':'처리','처리확인일':'2026-05-05'}),
      norm({'하자유형':'도배','접수내용':'벽지 들뜸','접수일':'2026-05-03','처리상태':'미처리'})
    ];
    const cA=_calcImpl(cItems,site,'2026-05');
    eq('calc 중대후보 전체',cA.critT,3);
    eq('calc 중대후보 미처리',cA.critUnr,2);
    eq('calc 중대후보 전월미처리',cA.critPrevUnr,1);
  }catch(e){R.push({name:'실행 중 예외: '+((e&&e.message)||e),ok:false,got:String(e&&e.stack||e),exp:'정상 실행'});}
  const pass=R.filter(r=>r.ok).length,fail=R.length-pass;
  try{console.log('%c[셀프테스트] '+pass+'/'+R.length+' 통과'+(fail?(' · 실패 '+fail):''),'font-weight:bold;font-size:13px;color:'+(fail?'#c0392b':'#1a7a3c'));
    console.table(R.map(r=>({테스트:r.name,결과:r.ok?'PASS':'FAIL',got:JSON.stringify(r.got),exp:JSON.stringify(r.exp)})));}catch(_){}
  const rows=R.map(r=>'<div style="display:flex;gap:10px;padding:4px 0;border-bottom:1px solid rgba(255,255,255,.05);font-size:12px;line-height:1.5"><span style="width:48px;flex-shrink:0;font-weight:700;color:'+(r.ok?'#7CFC9A':'#ff8a80')+'">'+(r.ok?'PASS':'FAIL')+'</span><span style="flex:1">'+esc(r.name)+(r.ok?'':(' <span style="color:#ff8a80">→ got '+esc(JSON.stringify(r.got))+' / exp '+esc(JSON.stringify(r.exp))+'</span>'))+'</span></div>').join('');
  const el=document.createElement('div');
  el.style.cssText='position:fixed;inset:0;z-index:100000;overflow:auto;background:radial-gradient(120% 120% at 50% 0%,#1c2b46 0%,#0f1626 60%,#0a0f1a 100%);color:#dfe7f5;font-family:-apple-system,BlinkMacSystemFont,sans-serif;padding:34px 20px';
  el.innerHTML='<div style="max-width:780px;margin:0 auto"><div style="font-size:19px;font-weight:800;letter-spacing:-.01em;margin-bottom:4px">자체 점검 결과 — '+(fail?('<span style="color:#ff8a80">실패 '+fail+'건</span>'):'<span style="color:#7CFC9A">전체 통과</span>')+' <span style="color:#9fb0cc;font-weight:600;font-size:14px">('+pass+'/'+R.length+')</span></div><div style="font-size:12.5px;color:#9fb0cc;margin-bottom:18px">핵심 순수 로직(nd · pM · wk · calc · calcW) 동작 고정 · 실제 함수 호출(사본 불일치 없음) · 일반 부팅에는 영향 없음</div><div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:8px 18px 12px;box-shadow:0 20px 50px rgba(0,0,0,.4)">'+rows+'</div><div style="margin-top:14px;font-size:11.5px;color:#74849e">콘솔(F12)에서 표 형태로도 확인 가능 · 일반 사용은 주소에서 <b style="color:#aebfe0">?selftest=1</b> 제거 후 새로고침</div></div>';
  document.body.appendChild(el);
  try{hideCover();progHide();}catch(_){}
}
window.__runSelfTest=__runSelfTest;
// 전역 UI 바인딩(툴팁·우클릭 메뉴·단축키·피벗 드래그) — 스냅샷·뷰어·편집자 모두 동일하게 필요.
// 과거 부팅 말미에 있어 스냅샷 조기 return 뒤로 밀렸고, 그 결과 스냅샷에서 목록 컬럼 우클릭·
// 사이드바/제목 툴팁·Esc·피벗 드래그가 전부 죽어 있었다. 멱등 가드 후 조기 return 이전에 호출한다.
function bindGlobalUi(){
  if(window._globalUiBound)return;window._globalUiBound=true;
  attachSBTip();attachTitleTip();

  attachKpiTap();

  // 창 크기 변경 시 첫 슬롯 현장명 폰트 재적합

  let _fitT;window.addEventListener('resize',()=>{clearTimeout(_fitT);_fitT=setTimeout(()=>{try{fitSiteName();}catch(e){}},150);});

  document.addEventListener('keydown',e=>{

    if(shEditing())return;

    const mo=document.getElementById('mo');if(mo&&mo.classList.contains('open'))return;

    if(e.metaKey||e.ctrlKey||e.altKey)return;

    if(e.key==='['){e.preventDefault();stepMonth(-1);}

    else if(e.key===']'){e.preventDefault();stepMonth(1);}

    else if(e.key==='?'){e.preventDefault();toggleShortcutHelp();}

  });

  document.addEventListener('contextmenu',e=>{

    if(!window.__REC)return;

    const th=e.target.closest('.rl-table thead th[data-key]');

    if(!th||th.dataset.key==='__no')return;

    e.preventDefault();

    recOpenMenu(th.dataset.key,e.clientX,e.clientY);

  });

  document.addEventListener('mousedown',e=>{if(window.__RECMENU&&!e.target.closest('#rlMenu'))recCloseMenu();});

  document.addEventListener('mousedown',e=>{if(window.__PVMENU&&!e.target.closest('#pvMenu')&&!e.target.closest('[data-act="rec.pivotAdd"]'))recClosePvMenu();});

  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&window.__RECMENU){e.stopImmediatePropagation();e.preventDefault();recCloseMenu();}},true);

  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&window.__PVMENU){e.stopImmediatePropagation();e.preventDefault();recClosePvMenu();}},true);

  document.addEventListener('keydown',e=>{if(e.key!=='Escape')return;const mo=document.getElementById('mo');if(mo&&mo.classList.contains('open'))return;if(typeof insCollapseAll==='function'&&insCollapseAll())e.preventDefault();}); // Esc — 주요 이슈 확장 카드 접기(모달 열림 시 모달 우선)

  // 행 칩 드래그 재정렬 — 네이티브 HTML5 DnD + 라이브 재배치(드래그 중 다른 칩이 실시간으로 비켜남, FLIP 슬라이드)

  let pvDragged=null;

  const pvRowChip=t=>t&&t.closest?t.closest('.pv-chip.pv-drag[data-zone="rows"]'):null;

  document.addEventListener('dragstart',e=>{const c=pvRowChip(e.target);if(!c)return;pvDragged=c;try{e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain','');}catch(_){}setTimeout(()=>{if(pvDragged)pvDragged.classList.add('pv-dragging');},0);});

  document.addEventListener('dragover',e=>{

    if(!pvDragged)return;

    const zone=e.target.closest&&e.target.closest('.pv-zone');

    if(!zone||!zone.contains(pvDragged))return;

    e.preventDefault();try{e.dataTransfer.dropEffect='move';}catch(_){}

    const over=pvRowChip(e.target);if(!over||over===pvDragged)return;

    const r=over.getBoundingClientRect(),after=e.clientX>r.left+r.width/2;

    if(after&&over.nextElementSibling===pvDragged)return;

    if(!after&&over.previousElementSibling===pvDragged)return;

    pvFlip(zone,()=>{after?over.after(pvDragged):over.before(pvDragged);});

  });

  document.addEventListener('drop',e=>{if(!pvDragged)return;e.preventDefault();const d=pvDragged;pvDragged=null;d.classList.remove('pv-dragging');pvCommitOrder();});

  document.addEventListener('dragend',()=>{if(pvDragged){pvDragged.classList.remove('pv-dragging');pvDragged=null;pvCommitOrder();}});

}
document.addEventListener('DOMContentLoaded',async()=>{
  applyChartTheme();
  bindDelegatedEvents(); // 위임 리스너 — 스냅샷·일반 경로 모두 커버 (조기 return 이전, 멱등)
  bindGlobalUi();        // 툴팁·우클릭·단축키·드래그 — 동일 이유로 조기 return 이전(멱등)
  if(/[?&]selftest=1(?:&|$)/.test(location.search)){__runSelfTest();return;} // 셀프테스트 모드 — 일반 부팅 생략
  if(window.__SNAPZ__&&!window.__SNAP__){ // 압축 스냅샷 — lz-string(CDN)으로 해제. 오프라인이면 명시적으로 알림
    try{
      if(typeof LZString==='undefined')throw new Error('lz-string 미로드(CDN 차단/오프라인)');
      window.__SNAP__=JSON.parse(LZString.decompressFromBase64(window.__SNAPZ__));
    }catch(e){console.error('[snap] 압축 해제 실패',e);alert('스냅샷 데이터를 여는 데 실패했습니다.\n네트워크(CDN) 연결 상태에서 다시 열어 주세요.');}
  }
  if(window.__SNAP__){try{
    let P=window.__SNAP__;
    if(P.months&&P.rm&&P.months[P.rm]){window.__SNAPM__=P.months;P=P.months[P.rm];window.__SNAP__=P;} // 여러 달 스냅샷 — 기본 월로 시작
    S.sites=P.sites||[];S.teams=P.teams||[];S.cmt=P.cmt||{};S.ana=P.ana||{};Object.keys(S.def).forEach(_k=>delete S.def[_k]);
    for(const _sid in (P.st||{}))deriveLul(P.st[_sid]); // 장기미처리는 미저장 — 뷰어와 동일하게 여기서 파생
    if(P.rm)S.rm=P.rm;
    anaNormalize(); // 구버전 스냅샷(문자열 ana) 호환
    document.body.classList.add('snap');
    document.body.classList.add('viewer'); // 뷰어 시점 — 실제 뷰어 화면과 동일한 숨김 규칙 공유(업로드 탭·관리 편집 요소 등)
    ensureTeams();
    setRmChip();
    snapInitRmSel(); // 여러 달이 담겼으면 기준월 선택기 표시
    rTeamSel();rNav();
    go('dashboard');
    hideCover();progHide(); // 골격 fetch 방식의 coverGate는 기본 표시 상태 — 명시적으로 걷어야 함(라이브 DOM 박제 시절엔 숨김 상태가 우연히 담겨 있었음)
    return;
  }catch(e){console.error('[snap] boot failed',e);}}
  // 저장소 영속화 요청 — 하자 원본의 유일 보관소인 IndexedDB가 디스크 압박 시 브라우저에 의해
  // 자동 삭제(eviction)되지 않도록 persist를 요청한다. 거부돼도 동작에는 영향 없음(콘솔로만 알림).
  try{if(navigator.storage&&navigator.storage.persist){navigator.storage.persist().then(ok=>{if(!ok)console.warn('[storage] 영속화 미승인 — 저장 공간 부족 시 브라우저가 IndexedDB를 정리할 수 있음. 스냅샷·원본 엑셀 백업 유지 권장');}).catch(()=>{});}}catch(_){}
  // CDN 라이브러리 로드 실패 감지 — 사내망 차단 시 차트·업로드가 조용히 죽는 것을 사용자에게 알림
  {const miss=[];if(typeof Chart==='undefined')miss.push('차트');if(typeof LZString==='undefined')miss.push('데이터 압축');if(miss.length)setTimeout(()=>{try{toast('일부 기능 사용 불가('+miss.join('·')+') · 네트워크/CDN 차단 여부 확인',6000);}catch(_){}}, 500);}
  const ck=localStorage.getItem('ck'),exTk=localStorage.getItem('exTk');
  if(ck)S.ck=ck;
  try{['aiRules','critKw','rulesOvr'].forEach(k=>localStorage.removeItem(k));}catch(_){} // 규칙 편집 기능 폐지 — 레거시 캐시 정리(규칙은 코드 내 RULE_DEF/CRIT_DEF 고정)
  // 제외 키워드: localStorage 값이 있으면 (빈 문자열 포함) 그것을 사용, 없으면 기본값 'dummy' 유지
  if(exTk!==null)S.exTk=exTk;
  const ulex=document.getElementById('ulex');if(ulex)ulex.value=S.exTk;
  // 부팅 순서:
  // (1) IndexedDB에서 메타(팀·현장·처리계획·분석)·def 로드 (로컬 캐시 — 로그인 후 즉시 표시)
  // (2) 팀 모델 보정(없으면 기본 팀 생성, 현장에 teamId 부여)
  // (3) Microsoft(@hdec.co.kr) 로그인 게이트 → 인증 후 Firebase 동기화
  // 어느 단계가 실패해도 멈추지 않고 게이트/대시보드까지 도달하도록 전체를 보호.
  try{await metaLoad();}catch(e){console.error('[boot] metaLoad failed',e);}
  try{await defLoadAll();}catch(e){console.error('[boot] defLoadAll failed',e);}
  ensureTeams();
  try{migratePlansMonthly();}catch(e){console.error('[boot] migratePlansMonthly failed',e);}
  // 사내 Firebase 인증 게이트 (@hdec.co.kr) → 인증 후 편집자=로컬집계, 뷰어=게시 열람·실시간 협업
  try{fb2Boot();}catch(e){console.error('[boot] fb2Boot failed',e);try{showGateForm();fbMsg('초기화 오류 · 페이지를 새로고침하세요');}catch(_){}}
  // 기준월 chip 표시 + 사이드바 초기 렌더 (게이트 뒤에서 미리 그려둠)
  setRmChip();
  rTeamSel();rNav();rSMgr();
  if(!parseHashNav())go('dashboard'); // 해시 딥링크 우선 (#site/{sid} 등) — 없거나 무효면 대시보드
  // 부팅 중 어느 단계에서 로딩창이 켜졌든, 완료 시 반드시 닫음
  progHide();
});
