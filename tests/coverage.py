# -*- coding: utf-8 -*-
"""검증이 코드의 얼마를 건드리는지 측정한다.
   Chrome의 Profiler.takePreciseCoverage 로 실행된 바이트/함수를 모으고,
   한 번도 실행되지 않은 함수를 이름으로 뽑아 준다(테스트 공백 목록)."""
import threading, http.server, functools, io, re, json, sys
from playwright.sync_api import sync_playwright

ROOT = '/home/claude/work'
PORT = 9401
srv = http.server.ThreadingHTTPServer(('127.0.0.1', PORT),
      functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT))
threading.Thread(target=srv.serve_forever, daemon=True).start()
SEED = open(ROOT + '/qa_full.py', encoding='utf-8').read().split('SEED = r"""')[1].split('"""')[0]

# 파괴적 액션은 제외 — 커버리지 때문에 데이터를 지울 수는 없다
SKIP = re.compile(r'(del|rm\b|remove|clear|logout|signout|reset|publish|게시|drop)', re.I)

def merge(cov, url, ranges):
    cov.setdefault(url, [])
    cov[url] += ranges

def covered_bytes(ranges, size):
    hit = bytearray(size)
    for s, e, c in ranges:
        if c > 0:
            for i in range(max(0, s), min(size, e)):
                hit[i] = 1
    return sum(hit)

with sync_playwright() as pw:
    br = pw.chromium.launch(executable_path='/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell')
    ctx = br.new_context(viewport={'width': 1440, 'height': 950})
    pg = ctx.new_page()
    cdp = ctx.new_cdp_session(pg)
    cdp.send('Profiler.enable')
    cdp.send('Profiler.startPreciseCoverage', {'callCount': True, 'detailed': True})

    pg.goto(f'http://127.0.0.1:{PORT}/index.html', wait_until='load'); pg.wait_for_timeout(1400)
    pg.evaluate('hideCover()')
    pg.evaluate(f'({SEED})()'); pg.wait_for_timeout(500)

    # ── 시나리오 ──
    pg.evaluate("go('dashboard')"); pg.wait_for_timeout(1800)
    pg.evaluate("if(rDash._flush)rDash._flush()"); pg.wait_for_timeout(400)

    # 모든 현장 · 모든 탭
    sids = pg.evaluate("S.sites.map(s=>s.id)")
    for sid in sids[:3]:
        pg.evaluate(f"go('site',{json.dumps(sid)})"); pg.wait_for_timeout(700)
        for tab in ['overview', 'trade', 'vacant', 'store', 'detail']:
            pg.evaluate(f"try{{setTab({json.dumps(tab)})}}catch(e){{}}"); pg.wait_for_timeout(320)
    pg.evaluate("go('manage')"); pg.wait_for_timeout(600)
    pg.evaluate("go('settings')"); pg.wait_for_timeout(600)
    pg.evaluate("go('dashboard')"); pg.wait_for_timeout(1200)

    # 목록 창 · 정렬 · 필터 · 피벗
    pg.evaluate("openRecList('__team','ul',null,false)"); pg.wait_for_timeout(900)
    pg.evaluate("""(()=>{const R=window.__REC;if(!R)return;
      try{recToggleSort('delayDays')}catch(_){}
      try{R.filterRow=true;recRenderModalBody()}catch(_){}
      try{R.pivotOn=true;recRenderModalBody()}catch(_){}})()""")
    pg.wait_for_timeout(900)
    pg.evaluate("closeMo()"); pg.wait_for_timeout(400)
    pg.evaluate("openRecList('__team','lul',null,false)"); pg.wait_for_timeout(800)
    pg.evaluate("closeMo()"); pg.wait_for_timeout(300)

    # 찾기 패널
    pg.evaluate("nlqOpen(true)"); pg.wait_for_timeout(300)
    for q in ['타일', '누수 60일 넘은 거', '두정 공가세대', '101동', '없는말']:
        pg.fill('#nqQ', q); pg.wait_for_timeout(320)
    pg.evaluate("(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.dataset.act==='nlq.list');b&&b.click();})()")
    pg.wait_for_timeout(800); pg.evaluate("closeMo()"); pg.wait_for_timeout(300)

    # 테마 · 인쇄
    pg.evaluate("applyTheme(true)"); pg.wait_for_timeout(1200)
    pg.evaluate("printThemeSwap(true)"); pg.wait_for_timeout(300)
    pg.evaluate("printThemeSwap(false)"); pg.wait_for_timeout(300)
    pg.evaluate("applyTheme(false)"); pg.wait_for_timeout(900)
    pg.evaluate("window.print=()=>{};doPrint()"); pg.wait_for_timeout(1200)

    # 사용 안내 · 단축키 · 계정
    pg.evaluate("openReadme()"); pg.wait_for_timeout(1500); pg.evaluate("closeMo()"); pg.wait_for_timeout(300)
    pg.evaluate("toggleShortcutHelp()"); pg.wait_for_timeout(400); pg.evaluate("closeMo()"); pg.wait_for_timeout(300)

    # 클릭 전수(파괴적 제외)
    acts = pg.evaluate("[...document.querySelectorAll('[data-act]')].map(e=>e.dataset.act)")
    for a in sorted(set(acts)):
        if SKIP.search(a): continue
        pg.evaluate(f"""(()=>{{const e=document.querySelector('[data-act={json.dumps(a)}]');
          if(e&&e.offsetParent!==null)try{{e.click()}}catch(_){{}}}})()""")
        pg.wait_for_timeout(90)
    pg.evaluate("closeMo();nlqOpen(false)"); pg.wait_for_timeout(400)

    # 스냅샷 생성(무거운 경로)
    pg.evaluate("FB2.ready=false;window.__SNAP__=null;try{exportSnapshot()}catch(e){};void 0;")
    pg.wait_for_timeout(1200)
    pg.evaluate("(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.dataset.act==='snapPick.ok');b&&b.click();})()")
    pg.wait_for_timeout(2500)

    res = cdp.send('Profiler.takePreciseCoverage')
    cdp.send('Profiler.stopPreciseCoverage')

    # ── 집계 ──
    files = {}
    for s in res['result']:
        url = s.get('url', '')
        if '/app/app-' not in url: continue
        name = url.split('/')[-1]
        src = io.open(ROOT + '/app/' + name, encoding='utf-8', newline='').read()
        size = len(src.encode('utf-8'))
        f = files.setdefault(name, {'size': size, 'ranges': [], 'fn': {}, 'src': src})
        for fn in s['functions']:
            rs = fn['ranges']
            f['ranges'] += [(r['startOffset'], r['endOffset'], r['count']) for r in rs]
            nm = fn['functionName'] or '(익명)'
            top = rs[0]
            f['fn'][(nm, top['startOffset'])] = max(f['fn'].get((nm, top['startOffset']), 0), top['count'])

    print('\n══ 커버리지 ══')
    tb = tc = 0
    for name in sorted(files):
        f = files[name]
        cb = covered_bytes(f['ranges'], f['size'])
        tb += f['size']; tc += cb
        named = {k: v for k, v in f['fn'].items() if k[0] != '(익명)'}
        run = sum(1 for v in named.values() if v > 0)
        print(f'  {name:16s} 바이트 {cb*100/f["size"]:5.1f}%  함수 {run}/{len(named)} ({run*100/max(1,len(named)):.0f}%)')
    print(f'  {"합계":16s} 바이트 {tc*100/tb:5.1f}%')

    print('\n══ 한 번도 실행되지 않은 함수 ══')
    for name in sorted(files):
        f = files[name]
        dead = sorted(k[0] for k, v in f['fn'].items() if v == 0 and k[0] != '(익명)')
        if dead:
            print(f'  [{name}] {len(dead)}개')
            for i in range(0, len(dead), 6):
                print('     ' + ', '.join(dead[i:i+6]))
    br.close()
srv.shutdown()
