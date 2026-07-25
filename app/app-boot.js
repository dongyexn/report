// ─────────────────────────────────────────────────────────────────────────────
// app-boot.js — 조립층: 액션 등록·훅 수신·팀/현장 관리·업로드·설정·인쇄·부팅·스냅샷.
//   로드 순서 고정: core → data → view → boot · 호출 방향도 같은 한 방향(tests/deps.mjs 검사).
//   아래 전부를 부를 수 있는 유일한 층. onHook 등록도 여기서만 한다.
//   index.html의 로드 순서와 스냅샷 인라인 순서(exportSnapshot의 APP_PARTS)를 함께 유지할 것.
// ─────────────────────────────────────────────────────────────────────────────
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
  if(manageLocked()){toast('보기 전용 · 업로드는 관리자만 가능');return;}
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
  try{await loadXLSX();}catch(e){toast('엑셀 모듈 로드 실패 · 네트워크·CDN 차단 확인');return;}
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
  if(!names.length||(names.length===1&&names[0]==='(미지정)')){progHide();toast('현장명 식별 불가 · 엑셀의 "현장" 컬럼 확인');return;}
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
  document.getElementById('mbody').innerHTML=`<p style="font-size:12.5px;color:var(--lbl2);margin-bottom:14px">"<b style="color:var(--bt1)">${esc(name)}</b>" 현장이 등록되어 있지 않습니다. 정보를 입력하세요.</p>
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
  {const b=document.getElementById('buildInfo');
   if(b)b.textContent='버전 '+BUILD+(ERRLOG.length?(' · 기록된 오류 '+ERRLOG.length+'건'):' · 오류 없음');}
  {const d=document.getElementById('darkChk');if(d)d.checked=isDark();} // 다크 모드 토글 상태 복원
  document.getElementById('cfgc').value=S.ck||'';
  try{const fb=document.getElementById('set-fb');if(fb)fb.style.display=fb2IsEditor()?'':'none';if(typeof fb2RefreshMeta==='function'&&FB2.ready)fb2RefreshMeta();}catch(e){}
  try{const su=document.getElementById('set-users');if(su)su.style.display=fb2IsEditor()?'':'none';if(fb2IsEditor()){if(typeof fb2SubUsers==='function')fb2SubUsers();if(typeof fb2RenderUsers==='function')fb2RenderUsers();}}catch(e){}
}
function openSM(sid){const site=sid?S.sites.find(s=>s.id===sid):null;document.getElementById('mt').textContent=site?'현장 수정':'현장 추가';document.getElementById('mbody').innerHTML=`<div class="g2"><div class="ig2"><label class="il" for="mr">권역 *</label><select class="sel" id="mr">${curRegions().map(r=>`<option ${site?.region===r?'selected':''}>${esc(r)}</option>`).join('')}</select></div><div class="ig2"><label class="il" for="mn">현장명 *</label><input class="inp" id="mn" value="${esc(site?.name||'')}"></div><div class="ig2"><label class="il" for="mu">세대수</label><input class="inp" id="mu" type="number" value="${site?.units||''}"></div><div class="ig2"><label class="il" for="mb2">동수</label><input class="inp" id="mb2" type="number" value="${site?.buildings||''}"></div><div class="ig2"><label class="il" for="mcu">상가수</label><input class="inp" id="mcu" type="number" value="${site?.commercialUnits||''}"></div><div class="ig2"><label class="il" for="mc">준공일</label><input class="inp" id="mc" type="date" max="9999-12-31" data-act="util.clampYear" value="${site?.completionDate||''}"></div></div><label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;margin-top:6px"><input type="checkbox" id="mco" ${site?.hasCommercial?'checked':''} aria-label="공가상가 포함 현장"> 공가상가 포함 현장</label><label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;margin-top:8px"><input type="checkbox" id="mcv" ${site?.showVacant!==false?'checked':''} aria-label="공가세대 탭 표시"> 공가세대 탭 표시</label>`;document.getElementById('mf').innerHTML=`<button class="btn bg2 bsm" data-act="modal.close">취소</button><button class="btn bp bsm" data-act="modal.confirmSM" data-sid="${esc(sid||'')}">저장</button>`;openMo();}
function confirmSM(eid){if(manageLocked()){toast('보기 전용 · 변경은 관리자만 가능');return;}const d={name:document.getElementById('mn').value.trim(),region:document.getElementById('mr').value,units:Number(document.getElementById('mu').value)||0,buildings:Number(document.getElementById('mb2').value)||0,commercialUnits:Number(document.getElementById('mcu').value)||0,completionDate:document.getElementById('mc').value,hasCommercial:document.getElementById('mco').checked,showVacant:document.getElementById('mcv')?document.getElementById('mcv').checked:true};if(!d.name){toast('현장명을 입력하세요');return;}if(eid){const old=S.sites.find(s=>s.id===eid);d.id=eid;d.teamId=old?old.teamId:S.teamId;if(old&&old.lastUploadedAt)d.lastUploadedAt=old.lastUploadedAt;const idx=S.sites.findIndex(s=>s.id===eid);if(idx>=0)S.sites[idx]=d;}else{const id='s'+Date.now();d.id=id;d.teamId=S.teamId;S.sites.push(d);}lsSave();fb2SiteConfigWrite(d.id);rNav();if(S.view==='manage')rManage();else rSMgr();closeMo();toast('현장 저장됨');}
function delS(sid){
  if(manageLocked()){toast('보기 전용 · 변경은 관리자만 가능');return;}
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
  if(document.body.classList.contains('snap')){toast('스냅샷은 기준월 고정 문서 · 변경 불가');return;}
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
      printThemeSwap(true); // 인쇄 색으로 먼저 전환(캔버스는 CSS가 안 닿음)
    setTimeout(()=>{window.print();setTimeout(()=>{printThemeSwap(false);_restore();},500);},80);
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
    printThemeSwap(true);
    setTimeout(()=>{window.print();setTimeout(()=>{printThemeSwap(false);_restoreDash();},500);},80);
    return;
  }
  printThemeSwap(true);
  window.print();
  setTimeout(()=>printThemeSwap(false),500);
}

// 테마 갱신 진입점 — 색 토큰(CSS 변수)을 바꾼 뒤 이걸 호출하면 차트까지 새 색으로 다시 그린다.
//   차트는 생성 시 색을 굽기 때문에 인스턴스를 파기하고 현재 화면만 재렌더한다. (다크모드 전환에서 사용)
// 인쇄는 항상 라이트 — 두 가지를 따로 처리한다.
//   ① CSS: @media print의 html.dark 블록이 토큰을 밝은 값으로 덮으므로 **화면의 테마 클래스는 건드리지 않는다**
//      (예전엔 클래스를 벗겼다가 화면까지 라이트로 번쩍이는 문제가 있었음)
//   ② 캔버스: CSS가 닿지 않으므로 차트 색만 인쇄용으로 바꿔 치고 애니메이션 없이 즉시 다시 그린다
//      (파기 후 재생성하면 520ms 애니메이션 때문에 인쇄 캡처 시점에 빈 차트가 찍힌다)
const PRINT_LIGHT={ // 다크 값 → 인쇄용 라이트 값
  '#B4544B':'#DA6A60','#CB6B62':'#C65A50','#C98C86':'#E89C9A','#DCA5A0':'#C76F6D',
  '#6E9BD6':'#B3C7DD','#87ACE0':'#7E9BBC','#8FB5E8':'#3E71D2','#E8BE62':'#F0B144',
  '#E8EEF8':'#1F2B4C','#F2C9C7':'#7A3434','#A9C7EE':'#2C437C','#EFC873':'#A0590A',
  '#212121':'#fff','#ECECEC':'#1C1C1E',
  'rgba(255,255,255,.09)':'rgba(0,0,0,.05)','rgba(236,236,236,.42)':'rgba(60,60,67,.42)'
};
const PRINT_DARK=Object.fromEntries(Object.entries(PRINT_LIGHT).map(([k,v])=>[v,k]));
function _swapColors(o,map,depth){ // 설정 트리를 훑어 매핑된 색 문자열만 교체(키가 색이라 오탐 없음)
  if(!o||depth>6)return;
  if(Array.isArray(o)){for(let i=0;i<o.length;i++){const v=o[i];
    if(typeof v==='string'){if(map[v])o[i]=map[v];}else _swapColors(v,map,depth+1);} return;}
  if(typeof o!=='object')return;
  for(const k of Object.keys(o)){const v=o[k];
    if(typeof v==='string'){if(map[v])o[k]=map[v];}
    else if(v&&typeof v==='object')_swapColors(v,map,depth+1);}
}
let _printSwapped=false;
function printThemeSwap(toLight){
  const dark=document.documentElement.classList.contains('dark');
  if(toLight){ if(!dark||_printSwapped)return; _printSwapped=true; }
  else { if(!_printSwapped)return; _printSwapped=false; }
  const map=toLight?PRINT_LIGHT:PRINT_DARK;
  try{
    Object.values(S.charts||{}).forEach(ch=>{
      if(!ch||ch.$destroyed)return;
      const isDonut=(ch.config&&ch.config.type==='doughnut')||(ch.data.datasets[0]&&ch.data.datasets[0].data&&!ch.options.scales);
      if(isDonut){ // 도넛 팔레트는 테마 무관 고정 — 색을 바꾸면 조각 색이 뒤섞인다. 테두리만 배경색으로.
        ch.data.datasets.forEach(ds=>{ if(typeof ds.borderColor==='string'&&map[ds.borderColor])ds.borderColor=map[ds.borderColor]; });
      }else{
        _swapColors(ch.data.datasets,map,0);
      }
      _swapColors(ch.options.scales,map,0);
      _swapColors(ch.options.plugins,map,0);
      const ct=ch.options.plugins&&ch.options.plugins.centerText;
      if(ct){ct.valueColor=toLight?'#1C1C1E':'#ECECEC';ct.labelColor=toLight?'rgba(60,60,67,.42)':'rgba(236,236,236,.42)';}
      ch.update('none');   // 축·라벨 등 재계산(애니메이션 없음)
      // Chart.js는 막대·점의 색을 '요소'에 캐시해 두기 때문에 데이터셋만 바꾸면 화면이 그대로다.
      //   → 요소 옵션까지 직접 갈아끼운 뒤 즉시 draw. (update 후에 해야 캐시가 되덮지 않는다)
      try{ch.getSortedVisibleDatasetMetas().forEach(m=>(m.data||[]).forEach(el=>{
        if(!el||!el.options)return;
        if(isDonut){ if(map[el.options.borderColor])el.options.borderColor=map[el.options.borderColor]; } // 조각 색은 고정 팔레트라 건드리지 않음
        else _swapColors(el.options,map,4);
      }));}catch(e){logErr('print.요소 색 교체 실패',e);}
      try{ch.draw();}catch(_){} // 다음 프레임을 기다리지 않고 지금 칠한다(Ctrl+P는 대기 시간이 없다)
    });
  }catch(e){logErr('print.차트 색 전환 실패',e);}
}
window.addEventListener('beforeprint',()=>printThemeSwap(true));
window.addEventListener('afterprint',()=>printThemeSwap(false));

function themeRefresh(){
  CSSVAR.clear();
  try{Object.keys(S.charts||{}).forEach(k=>dC(k));}catch(e){logErr('theme.chart reset',e);}
  try{applyChartTheme();}catch(_){}
  try{if(S.view==='site'&&S.sid)rSite(S.sid);else rDash();}catch(e){logErr('theme.rerender',e);}
}
window.themeRefresh=themeRefresh;

// INIT
async function exportSnapshot(){
  try{
    if(typeof LZString==='undefined'){toast('스냅샷 생성 불가 · 압축 라이브러리(lz-string) 미로드');return;}
    // 기준 데이터는 '사내 게시본' — 뷰어가 실제로 보는 것과 같은 파일을 만들기 위함.
    //   로컬 원본(S.def)은 업로드한 PC의 IndexedDB에만 있어, 다른 PC에서 만들면 뷰어와 내용이 어긋난다.
    //   이미 게시본을 보고 있으면(뷰어·게시본 열람) 그대로 쓰고, 편집 모드면 게시본을 '조회만' 해서 쓴다.
    //   (과거엔 뷰어 시점으로 전환했는데, 편집자가 화면을 잃어 새로고침이 필요했다 — 상태는 건드리지 않는다.)
    const _stripLul=Q=>{const st={};for(const sid in (Q.st||{})){const k=Object.assign({},Q.st[sid]);k.lul=null;st[sid]=k;}Q.st=st;return Q;}; // 장기미처리는 열 때 파생
    let pub=null,months=null,defRm=null,list=[];
    if(FB2.ready&&FB2.db){try{list=await fb2ListReportMonths();}catch(e){console.warn('[snap] 게시월 목록 조회 실패',e);}}
    // 담을 것이 하나도 없으면 옵션 창을 띄우기 전에 알린다(빈 창을 보여주지 않기 위해)
    if(!list.length&&!window.__SNAP__&&!Object.keys(S.def||{}).length){
      toast('내보낼 데이터 없음 · 리스트 업로드 또는 사내 게시 필요',7000);return;
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
    if(!P&&!Object.keys(S.def||{}).length){toast('내보낼 데이터 없음 · 리스트 업로드 또는 사내 게시 필요',7000);return;}
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
      toast('게시본 연결 불가 · 이 PC의 로컬 데이터로 생성',6000);
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
    // 스냅샷은 단일 파일이라 외부 참조가 모두 깨진다 → 앱과 필수 라이브러리를 전부 본문에 심는다.
    //   (lz-string은 압축 해제 경로라 없으면 파일 자체가 안 열림 · Chart/DataLabels는 차트 · DOMPurify는 인사이트 살균)
    const VENDOR=['./vendor/lz-string.min.js','./vendor/purify.min.js','./vendor/chart.umd.min.js','./vendor/chartjs-plugin-datalabels.min.js'];
    const APP_PARTS=['./app/app-core.js','./app/app-data.js','./app/app-view.js','./app/app-boot.js']; // index.html의 로드 순서와 반드시 동일
    let docHtml;const vendTxt={},appTxt={};
    try{
      docHtml=await(await fetch('index.html',{cache:'no-cache'})).text();
      for(const f of APP_PARTS)appTxt[f]=await(await fetch(f,{cache:'no-cache'})).text();
      for(const v of VENDOR)vendTxt[v]=await(await fetch(v,{cache:'no-cache'})).text();
    }catch(e){logErr('snap.원본 fetch 실패',e);toast('스냅샷 생성 실패 · 앱·라이브러리 로드 불가');return;}
    // ⚠ CSP 해시는 HTML 파서의 줄바꿈 정규화(CRLF→LF) "이후" 본문을 기준으로 검사된다.
    //   CRLF 그대로 해시하면 브라우저 계산값과 어긋나 인라인 앱이 차단됨(스냅샷 전체 먹통의 근본 원인이었음).
    //   → 해시 대상과 삽입 본문을 모두 LF로 정규화해 일치시킨다.
    //   HTML 파서는 CR·CRLF를 모두 LF로 정규화하므로 /\r\n?/ 로 동일하게 맞춘다(\r\n만 치환하면 \r\r\n·단독 CR이 남아 해시가 어긋남).
    docHtml=docHtml.replace(/\r\n?/g,'\n');
    for(const f of APP_PARTS)appTxt[f]=appTxt[f].replace(/\r\n?/g,'\n').replace(/<\/script/gi,'<\\/script'); // 종료태그 방어(현재 0건 — 안전망)
    for(const v of VENDOR)vendTxt[v]=vendTxt[v].replace(/\r\n?/g,'\n').replace(/<\/script/gi,'<\\/script');
    // 스냅샷은 Firebase를 전혀 쓰지 않음(부팅이 __SNAP__ 분기로 빠짐) — SDK·App Check 태그 제거로 reCAPTCHA 원천 차단
    docHtml=docHtml.replace(/[ \t]*<script[^>]*firebase-(?:app|auth|database|app-check)-compat\.js[^>]*><\/script>\n?/g,'');
    for(const f of APP_PARTS)if(docHtml.indexOf('<script src="'+f+'"></script>')<0){toast('스냅샷 생성 실패 · index.html 구조 불일치('+f+' 태그 없음)');return;}
    // 글꼴 포함(옵션) — 스냅샷은 단일 파일이라 상대경로 woff2를 못 찾고 시스템 글꼴로 폴백된다.
    //   켜져 있으면 base64로 심어 어느 PC에서나 화면과 같은 모양이 되게 한다(파일이 커짐).
    if(_fontOn&&docHtml.indexOf("url('./vendor/PretendardVariable.woff2')")<0){ // 경로가 바뀌었는데 코드가 못 찾는 경우를 드러냄
      console.warn('[snap] @font-face 경로 불일치 — 글꼴 포함 건너뜀');
      toast('글꼴 포함 건너뜀 · index.html 글꼴 경로 불일치',7000);
    }
    if(_fontOn&&docHtml.indexOf("url('./vendor/PretendardVariable.woff2')")>=0){
      try{
        const fb=await(await fetch('./vendor/PretendardVariable.woff2',{cache:'force-cache'})).arrayBuffer();
        let bin='';const u8=new Uint8Array(fb);const CH=0x8000;
        for(let i=0;i<u8.length;i+=CH)bin+=String.fromCharCode.apply(null,u8.subarray(i,i+CH));
        docHtml=docHtml.replace("url('./vendor/PretendardVariable.woff2')",()=>"url('data:font/woff2;base64,"+btoa(bin)+"')");
      }catch(e){console.warn('[snap] 글꼴 포함 실패 — 시스템 글꼴로 표시됩니다',e);
        toast('글꼴 미포함 · vendor/PretendardVariable.woff2 배포 확인 필요',7000);}
    }
    const injectBody='window.__SNAPZ__='+JSON.stringify(packed)+';'; // 한 줄 — 줄바꿈 정규화 무관
    const _h256=async s=>{const d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s));return btoa(String.fromCharCode.apply(null,new Uint8Array(d)));};
    const hInj=await _h256(injectBody);
    docHtml=docHtml.replace('</head>',()=>'<scr'+'ipt>'+injectBody+'</scr'+'ipt>\n</head>'); // 원본 골격 상태에서 먼저 삽입(라이브러리 본문의 </head> 오탐 방지)
    let hashes="'sha256-"+hInj+"' ";
    for(const v of VENDOR){ // 벤더 스크립트 태그 → 인라인 + 해시
      const tag='<script src="'+v+'"></script>';
      if(docHtml.indexOf(tag)<0){console.warn('[snap] 벤더 태그 없음',v);continue;}
      const txt=vendTxt[v];
      hashes+="'sha256-"+(await _h256(txt))+"' ";
      docHtml=docHtml.replace(tag,()=>'<scr'+'ipt>'+txt+'</scr'+'ipt>');
    }
    for(const f of APP_PARTS){ // 앱 조각 → 인라인 + 해시(로드 순서 유지)
      const txt=appTxt[f];
      hashes+="'sha256-"+(await _h256(txt))+"' ";
      docHtml=docHtml.replace('<script src="'+f+'"></script>',()=>'<scr'+'ipt>'+txt+'</scr'+'ipt>'); // 함수 치환 필수 — 본문의 $& 등 replace 특수 패턴 무력화
    }
    docHtml=docHtml.replace("script-src 'self' ","script-src 'self' "+hashes);
    const html=docHtml;
    const blob=new Blob([html],{type:'text/html;charset=utf-8'});
    const _mk=months?Object.keys(months).sort():null;
    const _label=_mk?(_mk.length>1?_mk[0]+'~'+_mk[_mk.length-1]:_mk[0]):(payload.rm||S.rm);
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='하자대시보드_스냅샷_'+_label+'.html';
    document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(a.href),4000);
    toast('스냅샷 저장됨 · '+(P?'게시본':'로컬 데이터')+' 기준 '+_label+(months?(' · '+Object.keys(months).length+'개월'):'')+' · '+(html.length/1048576).toFixed(2)+'MB',6000);
  }catch(e){logErr('snap.export 실패',e);toast('스냅샷 생성 실패');}
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








// ── 팀·현장 관리(유스케이스) ──
//   상태 변경 → 저장 → 재렌더를 엮는 층이라 data·view를 모두 부른다. 그래서 최상위인 boot에 둔다.
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

function addTeam(name){
  if(manageLocked()){toast('보기 전용 · 변경은 관리자만 가능');return null;}
  name=(name||'').trim();if(!name){toast('팀 이름을 입력하세요');return null;}
  if(S.teams.some(t=>t.name===name)){toast('같은 이름의 팀이 있습니다');return null;}
  const t={id:uid('t'),name,regions:[],regionOrder:[]};
  S.teams.push(t);lsSave();return t;
}

function renameTeam(id,name){if(manageLocked())return;name=(name||'').trim();if(!name)return;const t=S.teams.find(x=>x.id===id);if(!t)return;t.name=name;lsSave();rTeamSel();}

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

function addRegion(name){if(manageLocked()){toast('보기 전용 · 변경은 관리자만 가능');return;}const t=curTeam();if(!t)return;name=(name||'').trim();if(!name){toast('권역 이름을 입력하세요');return;}if(name===PERM_REGION){toast('고정 권역입니다');return;}if(t.regions.includes(name)){toast('이미 있는 권역입니다');return;}t.regions.push(name);lsSave();rNav();rSMgr();}

function renameRegion(oldName,name){if(manageLocked())return;const t=curTeam();if(!t)return;name=(name||'').trim();if(!name||oldName===name)return;if(oldName===PERM_REGION||name===PERM_REGION){toast('고정 권역은 변경할 수 없습니다');return;}if(t.regions.includes(name)){toast('이미 있는 권역입니다');return;}const i=t.regions.indexOf(oldName);if(i<0)return;t.regions[i]=name;t.regionOrder=(t.regionOrder||[]).map(r=>r===oldName?name:r);S.sites.forEach(s=>{if(s.teamId===t.id&&s.region===oldName)s.region=name;});lsSave();rNav();rSMgr();if(S.view==='dashboard')rDash();}

function deleteRegion(name){if(manageLocked()){toast('보기 전용 · 변경은 관리자만 가능');return;}const t=curTeam();if(!t)return;if(name===PERM_REGION){toast('고정 권역은 삭제할 수 없습니다');return;}const used=S.sites.filter(s=>s.teamId===t.id&&s.region===name).length;if(used){toast('현장 '+used+'개가 사용 중이라 삭제할 수 없습니다');return;}t.regions=t.regions.filter(r=>r!==name);t.regionOrder=(t.regionOrder||[]).filter(r=>r!==name);lsSave();rNav();rSMgr();}

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
    if(r===PERM_REGION)return `<div class="tm-row tm-locked"><span class="tm-nameinp tm-lockname">${esc(r)}</span><span class="tm-cnt">${used}</span><span class="tm-x tm-lockicon" data-tt="고정 권역 · 수정 불가 · 대시보드 집계 제외" aria-label="고정 권역 · 수정 불가 · 대시보드 집계 제외">${ICON_LOCK}</span></div>`;
    return `<div class="tm-row"><input class="mg-inp tm-nameinp" value="${esc(r)}" data-act="region.rename" data-rgn="${esc(r)}" aria-label="권역 이름"><span class="tm-cnt">${used}</span><button class="tm-x tm-del" data-act="region.del" data-rgn="${esc(r)}" data-tt="삭제" aria-label="삭제">${ICON_TRASH}</button></div>`;
  }).join('');
  el.innerHTML=`<div class="mg-grid"><div><div class="card mb12"><div class="tm-h"><span>팀</span><button class="btn bo bsm tm-add" data-act="team.addTeam">+ 팀 추가</button></div><div class="tm-list">${teamRows}</div></div><div class="card mb12"><div class="tm-h"><span>권역 <span style="color:var(--lbl3);font-weight:500;text-transform:none;letter-spacing:0">· ${esc(t?t.name:'')}</span></span><button class="btn bo bsm tm-add" data-act="team.addRegion">+ 권역 추가</button></div><div class="tm-list">${regRows}</div></div><div class="card tm-upcard"><div class="tm-h" style="margin-bottom:12px"><span>리스트 업로드</span></div><div id="uz" class="uz" data-act="uz"><div class="uzi"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 15V3M7 8l5-5 5 5M2 20h20"></path></svg></div><div class="uzt">Excel 업로드</div><div class="uzh">HCS 전체 하자리스트 드래그 앤 드롭</div></div><input type="file" id="fi" accept=".csv,.xlsx,.xls" style="display:none" data-act="uz.file" aria-label="데이터 파일 선택"><div class="ulex-sep"></div><div><label class="il ulex-lbl" for="ulex">제외 키워드 <span style="font-weight:400;color:var(--lbl3)">· 쉼표로 구분</span></label><input class="inp" id="ulex" style="font-size:12.5px;padding:7px 10px" value="${esc(S.exTk||'')}" placeholder="예: 공가세대점검, 시범세대" data-act="set.exToken"></div></div></div><div><div class="card"><div class="tm-h"><span>현장 <span style="color:var(--lbl3);font-weight:500;text-transform:none;letter-spacing:0">· ${esc(t?t.name:'')}</span></span><button class="btn bo bsm tm-add" data-act="site.addModal">+ 현장 추가</button></div><div id="mgsites"></div></div></div></div>`;
  rSMgr();
}

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

function setDetailYear(y){S.detailYear=y;if(S.sid)rSite(S.sid);}

function setTrendYear(y){S.trendYear=y;const all=dashSites().map(s=>({s,st:calc(S.def[s.id]||[],s,S.rm)}));try{rCharts(all);}catch(e){console.error('rCharts(year)',e);}}

function deleteTeam(id){
  if(manageLocked()){toast('보기 전용 · 변경은 관리자만 가능');return;}
  if(S.teams.length<=1){toast('마지막 팀은 삭제할 수 없습니다');return;}
  const t=S.teams.find(x=>x.id===id);if(!t)return;
  const cnt=S.sites.filter(s=>s.teamId===id).length;
  openConfirm('팀 삭제',`<b>${esc(t.name)}</b> 팀을 삭제합니다.${cnt?` 소속 현장 <b>${cnt}개</b>와 하자 데이터도 함께 삭제됩니다.`:''}`,'삭제',()=>doDeleteTeam(id),true);
}

function tmAddTeam(){const name=uniqName('새 팀',S.teams.map(t=>t.name));const t=addTeam(name);if(t)switchTeam(t.id);rManage();}

function updTeamName(id,val){renameTeam(id,val);rManage();}

function tmDeleteTeam(id){deleteTeam(id);rManage();}

function tmAddRegion(){const t=curTeam();if(!t)return;const name=uniqName('새 권역',t.regions);addRegion(name);rManage();}

function updRegionName(oldR,val){renameRegion(oldR,val);rManage();}

function tmDeleteRegion(r){deleteRegion(r);rManage();}

// FILTER helpers
function setTab(t){S.tab=t;document.querySelectorAll('.tnav-i').forEach(b=>b.classList.toggle('act',b.dataset.tab===t));document.querySelectorAll('.tpane').forEach(p=>p.classList.toggle('act',p.dataset.tab===t));
  // pane이 display:block이 된 직후 동기 측정 → display:none일 때 scrollHeight=0으로 잘못 잡혔던
  // textarea 높이를 페인트 전에 즉시 교정 (첫 진입 시 "작았다 커지는" 깜빡임 방지).
  autoSizeAll(document.querySelector('.tpane.act'));
  setTimeout(()=>{if(S.sid)renderTabCharts(S.sid,S.lastSt);autoSizeAll(document.querySelector('.tpane.act'));},30);} // 차트 렌더로 폭이 바뀐 뒤 같은 프레임에서 재측정 — 높이 점프 방지

function setSiteTrendYear(y){S.siteTrendYear=y;if(S.sid){dC('mo-'+S.sid);buildSiteTrend(S.sid,S.lastSt);}}


// ── 훅 수신처 ── 아래 계층이 알린 사건을 여기서 실제 동작으로 연결한다(등록은 이 한 곳에서만).
onHook('theme.changed',()=>{try{themeRefresh();}catch(e){console.warn('[hook] theme',e);}});
onHook('modal.closed',()=>{if(typeof recCloseMenu==='function')recCloseMenu();if(typeof recClosePvMenu==='function')recClosePvMenu();});
onHook('nav.go',(v,id)=>go(v,id));
onHook('ui.nav',()=>rNav());
onHook('ui.dash',()=>rDash());
onHook('ui.site',(sid)=>rSite(sid));
onHook('ui.rmchip',()=>setRmChip());
onHook('ui.settings',()=>loadSettings());
onHook('cmd.siteModal',(a,b2)=>openSM(a,b2));
onHook('cmd.dashAI',()=>runDashAI());
onHook('cmd.siteAI',(sid)=>runAI(sid));
onHook('cmd.snapshot',()=>exportSnapshot());
onHook('data.teamsChanged',()=>ensureTeams());
onHook('view.manage',()=>rManage());
onHook('view.settings',()=>loadSettings());

// ── 클릭·입력 액션 등록 ──
//   핸들러가 data·view·boot 함수를 모두 부르므로 최상위인 boot에 둔다(위→아래 호출만 남도록).
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
  'theme.toggle':()=>applyTheme(!isDark()),
  'set.copyErr':()=>{const s=errLogText();
    if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(s).then(()=>toast('버전·오류 기록 복사됨'),()=>toast('복사 실패 · 콘솔을 확인하세요'));
    else{console.log(s);toast('복사 미지원 브라우저 · 콘솔에 출력함');}},
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
  'panel.carryPlan':(el)=>{const sid=el.dataset.sid;const n=carryPlansForward(sid);if(n){toast('전월 계획 '+n+'건 복사됨');rSite(sid);}else toast('가져올 전월 계획 없음 · 또는 이미 입력됨');},
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

document.addEventListener('DOMContentLoaded',async()=>{
  console.info('[build]',BUILD);
  document.documentElement.classList.toggle('dark',isDark()); // 렌더 전에 테마 확정 — 밝은 화면이 번쩍이지 않도록
  await ensureVendors(); // vendor/ 로컬 실패 시 CDN 폴백 — 이후 로직이 LZString·Chart 존재를 전제한다
  applyChartTheme();
  bindDelegatedEvents(); // 위임 리스너 — 스냅샷·일반 경로 모두 커버 (조기 return 이전, 멱등)
  bindGlobalUi();        // 툴팁·우클릭·단축키·드래그 — 동일 이유로 조기 return 이전(멱등)
  if(/[?&]selftest=1(?:&|$)/.test(location.search)){__runSelfTest();return;} // 셀프테스트 모드 — 일반 부팅 생략
  if(window.__SNAPZ__&&!window.__SNAP__){ // 압축 스냅샷 — lz-string(CDN)으로 해제. 오프라인이면 명시적으로 알림
    try{
      if(typeof LZString==='undefined')throw new Error('lz-string 미로드(CDN 차단/오프라인)');
      window.__SNAP__=JSON.parse(LZString.decompressFromBase64(window.__SNAPZ__));
    }catch(e){logErr('snap.압축 해제 실패',e);alert('스냅샷 데이터를 여는 데 실패했습니다.\n네트워크(CDN) 연결 상태에서 다시 열어 주세요.');}
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
  }catch(e){logErr('snap.boot failed',e);}}
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
