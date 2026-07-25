// CI 검증 — 브라우저에서 실제로 앱을 띄워 셀프테스트·클릭 전수·스냅샷 왕복을 확인한다.
//   실행: node tests/ci.mjs   (Playwright chromium 필요)
//   실패 시 비정상 종료 코드로 끝나 GitHub Actions가 배포 전에 잡아낸다.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json',
               '.png':'image/png', '.woff2':'font/woff2', '.md':'text/markdown', '.svg':'image/svg+xml' };

const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, r));
const BASE = `http://127.0.0.1:${server.address().port}`;

const fails = [];
const step = (name, ok, detail='') => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) fails.push(name);
};

// 테스트용 시드 — 실제 데이터 없이 4개 현장 1,040행을 만들어 화면을 채운다
const SEED = `() => {
  const names=[['가온','1권역'],['나루','1권역'],['다온','2권역'],['라온','인수 전 현장']];
  S.teams=[{id:'t1',name:'검증팀',regions:['1권역','2권역','인수 전 현장'],regionOrder:['1권역','2권역','인수 전 현장']}];
  S.sites=names.map((n,i)=>({id:'s'+i,name:'현장 '+n[0],region:n[1],teamId:'t1',units:500+i*100,buildings:6,completionDate:'2025-01'}));
  const trades=['타일','도배','창호','가구','조명','마루','전기','설비'];
  const def={};
  S.sites.forEach((st,si)=>{const rows=[];
    for(let i=0;i<260;i++){const mo=(i%6)+1,day=(i%27)+1,done=i%3!==0;
      rows.push({receiptDate:\`2026-0\${mo}-\${String(day).padStart(2,'0')}\`,status:done?'처리완료':'미처리',
        completionDate:done?\`2026-0\${Math.min(6,mo+1)}-\${String(day).padStart(2,'0')}\`:'',
        trade:trades[i%trades.length],receiptContent:'검증용 접수 '+i,defectType:i%7===0?'누수':'기타',
        building:String(101+(i%8)),unit:String(100+(i%40)*10+1),saleStatus:i%9===0?'미분양':'입주완료',
        unitType:'세대',moveIn:i%9===0?'N':'Y',space:'거실',complaint:'',repairParty:i%5===0?'당사':'협력사',
        contractor:'A',repairContractor:'B',delayDays:i%90,defectClass:'',criticalType:'',receiptNo:String(si*1000+i)});}
    def[st.id]=rows;});
  S.def=def; S.rm='2026-06'; ensureTeams(); rTeamSel(); rNav(); go('dashboard');
  return Object.values(def).reduce((a,r)=>a+r.length,0);
}`;

// 화면별로 보이는 버튼을 액션 종류마다 한 번씩 눌러 예외를 수집(파괴적 동작 제외)
const SWEEP = `async (skip) => {
  const vis=el=>{const s=getComputedStyle(el);if(s.display==='none'||s.visibility==='hidden')return false;
                 const r=el.getBoundingClientRect();return r.width>1&&r.height>1;};
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const seen=new Set(); let n=0;
  window.__ERR__=window.__ERR__||[];
  for(const el of [...document.querySelectorAll('[data-act]')]){
    const a=el.dataset.act||'';
    if(skip.some(s=>a.toLowerCase().includes(s)))continue;
    if(['INPUT','SELECT','TEXTAREA'].includes(el.tagName))continue;
    if(!vis(el)||seen.has(a))continue;
    seen.add(a); n++;
    try{ el.click(); }catch(e){ window.__ERR__.push('click:'+a+' → '+e.message); }
    await sleep(120);
    const mo=document.getElementById('mo');
    if(mo&&mo.classList.contains('open')){ try{closeMo();}catch(_){} await sleep(60); }
    document.querySelectorAll('.ctxmenu,#rlMenu,#pvMenu').forEach(x=>x.remove());
  }
  return n;
}`;
const SKIP = ['del','remove','delete','signout','publish','print','snapshot','reset','wipe','upload.file','acct.changePw'];

// 로컬에서 다른 브라우저 빌드를 쓸 때만 PW_CHROMIUM으로 경로를 지정한다(CI는 설치본 사용)
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const ctx = await browser.newContext({ viewport:{width:1500,height:950}, acceptDownloads:true });
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(String(e).slice(0,200)));

// ── 1) 자체 점검(셀프테스트) ──
console.log('\n[1] 셀프테스트');
await page.goto(`${BASE}/index.html?selftest=1`, { waitUntil:'load' });
await page.waitForTimeout(2500);
const self = await page.evaluate(() => {
  const el=[...document.querySelectorAll('div')].map(d=>d.textContent||'').find(t=>t.includes('자체 점검 결과'));
  const m=el&&el.match(/(\d+)\s*\/\s*(\d+)/);
  return m ? { pass:+m[1], total:+m[2] } : null;
});
step('셀프테스트 통과', !!self && self.pass === self.total, self ? `${self.pass}/${self.total}` : '결과 미검출');

// ── 2) 화면별 클릭 전수 ──
console.log('\n[2] 클릭 전수');
await page.goto(`${BASE}/index.html`, { waitUntil:'load' });
await page.waitForTimeout(1200);
await page.evaluate("window.__ERR__=[];hideCover();");
const rows = await page.evaluate(`(${SEED})()`);
await page.waitForTimeout(1200);
step('시드 데이터', rows > 1000, `${rows}행`);

const states = [
  ['대시보드', "go('dashboard')", 1400],
  ['현장', "go('site','s0');setTab('overview');", 1100],
  ['장기미처리', "go('site','s0');setTab('trade');", 900],
  ['현장관리', "go('manage')", 800],
  ['설정', "go('settings')", 800],
  ['목록모달', "go('site','s0');openRecList('s0','ul','','');", 900],
];
let clicks = 0;
for (const [label, js, wait] of states) {
  await page.evaluate(js); await page.waitForTimeout(wait);
  clicks += await page.evaluate(`(${SWEEP})(${JSON.stringify(SKIP)})`);
  await page.evaluate("try{closeMo();}catch(_){}"); await page.waitForTimeout(150);
}
const clickErrs = await page.evaluate(() => window.__ERR__ || []);
step('클릭 중 예외 없음', clickErrs.length === 0, `${clicks}종 클릭${clickErrs.length ? ' · ' + clickErrs.slice(0,3).join(' | ') : ''}`);

// ── 3) 집계 불변식 ──
console.log('\n[3] 집계 불변식');
await page.evaluate("go('dashboard')"); await page.waitForTimeout(800);
const bad = await page.evaluate(() => {
  const out=[]; const chk=(c,m)=>{ if(!c) out.push(m); };
  for(const st of S.sites){
    const k=calc(S.def[st.id]||[], st, S.rm), nm=st.name;
    chk(k.res+k.unr===k.tR, `${nm}: 완료+미처리≠전체접수`);
    chk(k.ul.length===k.unr, `${nm}: 미처리목록≠미처리`);
    chk(k.lul.length===k.lt, `${nm}: 장기목록≠장기미처리`);
    chk(k.dd[0]+k.dd[1]+k.dd[2]===k.unr, `${nm}: 지연구간합≠미처리`);
    chk(k.dd[1]+k.dd[2]===k.lt, `${nm}: 30일+합≠장기미처리`);
  }
  chk(dashSites().every(s=>s.region!=='인수 전 현장'), '대시보드 집계에 인수 전 현장 포함');
  return out;
});
step('불변식 위반 없음', bad.length === 0, bad.slice(0,3).join(' | '));

// ── 4) 스냅샷 생성 → 오프라인 열람 ──
console.log('\n[4] 스냅샷 왕복');
await page.evaluate("FB2.ready=false;window.__SNAP__=null;exportSnapshot();void 0;"); // 반환 Promise를 기다리지 않도록(모달 대기)
await page.waitForTimeout(900);
const dl = page.waitForEvent('download', { timeout:90000 });
await page.evaluate(" const b=[...document.querySelectorAll('button')].find(x=>x.dataset.act==='snapPick.ok'); if(b)b.click(); ");
const file = path.join(os.tmpdir(), 'ci-snapshot.html');
await (await dl).saveAs(file);
step('스냅샷 생성', fs.existsSync(file), `${(fs.statSync(file).size/1048576).toFixed(2)}MB`);

const offCtx = await browser.newContext({ viewport:{width:1400,height:900} });
await offCtx.route('**', r => r.request().url().startsWith('file://') ? r.continue() : r.abort()); // 완전 오프라인
const off = await offCtx.newPage();
const offErr = [];
off.on('pageerror', e => offErr.push(String(e).slice(0,200)));
off.on('console', m => { if (/Content Security Policy/.test(m.text())) offErr.push('CSP ' + m.text().slice(0,120)); });
await off.goto('file://' + file, { waitUntil:'load' });
await off.waitForTimeout(2500);
const snap = await off.evaluate(() => ({
  app: typeof calc === 'function', data: !!window.__SNAP__,
  chart: typeof Chart, lz: typeof LZString,
  kpi: document.querySelectorAll('#dkpi .kc').length,
  charts: Object.keys(S.charts||{}).length,
  cover: getComputedStyle(document.getElementById('coverGate')).display,
}));
step('오프라인 스냅샷 실행', snap.app && snap.data && snap.kpi > 0 && snap.cover === 'none',
     `KPI ${snap.kpi} · 차트 ${snap.charts} · Chart=${snap.chart} · LZ=${snap.lz}`);
step('오프라인 스냅샷 오류 없음', offErr.filter(e => !/Pretendard/.test(e)).length === 0, offErr.slice(0,2).join(' | '));

await browser.close();
server.close();

const realPageErrors = pageErrors.filter(e => !/Pretendard|favicon|net::ERR/.test(e));
step('페이지 예외 없음', realPageErrors.length === 0, realPageErrors.slice(0,2).join(' | '));

console.log(`\n${fails.length ? '실패 ' + fails.length + '건: ' + fails.join(', ') : '전체 통과'}`);
process.exit(fails.length ? 1 : 0);
