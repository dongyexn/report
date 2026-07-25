// ─────────────────────────────────────────────────────────────────────────────
// app-data.js — 저장소(IndexedDB)·Firebase 동기화/게시/뷰어·목록/피벗 모달·엑셀 내보내기·사용 안내 뷰어.
//   빌드 없이 여러 <script>로 나눠 로드한다(순서 고정: core → data → view → boot).
//   함수 선언은 전역에 올라가므로 파일 간 호출은 자유롭지만, **최상위 실행문은 순서에 의존**한다.
//   index.html의 로드 순서와 스냅샷 인라인 순서(exportSnapshot의 APP_PARTS)를 함께 유지할 것.
// ─────────────────────────────────────────────────────────────────────────────
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
  if(typeof LZString==='undefined'){
    // 압축 저장분을 압축 해제 없이 JSON.parse 하면 정체불명 오류가 난다 → 원인을 명확히 남기고 중단
    if(row.enc==='b64'||row.enc==='utf16'||row.compressed){
      if(!defDecode._warned){defDecode._warned=true;console.error('[store] 압축 해제 라이브러리(LZString) 미로드 — 로컬 데이터를 읽을 수 없습니다. vendor/lz-string.min.js 배포를 확인하세요.');}
      return null;
    }
    return row.data;
  }
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
    const rows=list.map(m=>`<label class="share-row" style="cursor:pointer"><span class="share-info"><b>${esc(m)}</b>${m===defRm?'<span style="margin-left:8px;font-size:11px;color:var(--bt1)">현재</span>':''}</span><input type="checkbox" class="snap-mo" value="${esc(m)}"${m===defRm?' checked':''} style="width:17px;height:17px;accent-color:var(--bt1)"></label>`).join('<div class="share-sep"></div>');
    const moBlock=list.length>1
      ? '<div class="opt-sec">포함할 기준월</div><p class="opt-note">두 달 이상 담으면 파일 안에서 기준월을 바꿔가며 볼 수 있습니다(월당 수백 KB~수 MB).</p>'+rows+'<div class="opt-div"></div>'
      : '';
    document.getElementById('mbody').innerHTML='<div class="md-scroll" style="max-height:56vh">'+moBlock+
      '<div class="opt-sec">글꼴</div>'+
      '<label class="share-row" style="cursor:pointer"><span class="share-info"><b>글꼴 포함</b><span>어느 PC에서 열어도 화면과 같은 글꼴로 보입니다 · 약 1.5MB 증가</span></span>'+
      '<input type="checkbox" id="snapFontChk"'+(fontOn?' checked':'')+' style="width:18px;height:18px;accent-color:var(--bt1)"></label></div>';
    document.getElementById('mf').innerHTML=(list.length>1?'<button class="btn bo bsm" data-act="snapPick.all">전체 선택</button>':'')+'<div style="flex:1"></div><button class="btn bg2 bsm" data-act="snapPick.cancel">취소</button><button class="btn bp bsm" data-act="snapPick.ok">내보내기</button>';
    const mb=document.getElementById('mb');if(mb){mb.classList.remove('wide');mb.classList.add('narrow');} // 항목이 적어 좁은 폭
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
    if(curTxt!=null&&S.view==='site'&&S.sid===sid&&!shEditing()){const el=document.getElementById('ait-'+sid);if(el)el.innerHTML=themeHTML(safeHTML(curTxt));}
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
    s.src='./vendor/marked.min.js'; // 자체 호스팅 — 사내망 CDN 차단 대비
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
    const mb=document.getElementById('mb');if(mb){mb.classList.add('wide');mb.classList.add('has-x');} // 자체 닫기 버튼이 없어 헤더 X 노출
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
  _xlsxPromise=tryLoad('./vendor/xlsx.full.min.js')
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
