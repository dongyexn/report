// 계층 방향 검사 — 아래 계층이 위 계층 함수를 직접 부르면 실패시킨다.
//   허용 방향: core → (없음) / data → core / view → core, data / boot → 전부
//   아래에서 위로 알려야 할 일은 core의 fireHook/onHook 으로 처리한다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORDER = ['app/app-core.js', 'app/app-data.js', 'app/app-view.js', 'app/app-boot.js'];

const src = {}, defs = {};
for (const f of ORDER) {
  src[f] = fs.readFileSync(path.join(ROOT, f), 'utf8');
  defs[f] = new Set([...src[f].matchAll(/^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)].map(m => m[1]));
}
const rank = Object.fromEntries(ORDER.map((f, i) => [f, i]));

const violations = [];
for (const f of ORDER) {
  for (const g of ORDER) {
    if (rank[g] <= rank[f]) continue;          // 같거나 아래 계층은 허용
    for (const name of defs[g]) {
      const re = new RegExp(`(?<![\\w$.])${name.replace(/\$/g, '\\$')}\\s*\\(`, 'g');
      const hits = [...src[f].matchAll(re)];
      if (hits.length) {
        const line = src[f].slice(0, hits[0].index).split(/\r\n|\n/).length;
        violations.push(`${f}:${line} → ${name}()  (정의: ${g}, ${hits.length}회)`);
      }
    }
  }
}

// 훅 등록은 boot 한 곳에서만
const stray = ORDER.filter(f => f !== 'app/app-boot.js' &&
  /(?<!function )onHook\s*\(/.test(src[f].replace(/function onHook[^\n]*/g, '')));

// 훅 이름 짝 검사 — fireHook('오타')는 조용히 아무 일도 안 하므로 이름이 어긋나면 즉시 실패시킨다.
const all = ORDER.map(f => src[f]).join('\n');
const fired = new Set([...all.matchAll(/fireHook\(\s*'([^']+)'/g)].map(m => m[1]));
const handled = new Set([...all.matchAll(/onHook\(\s*'([^']+)'/g)].map(m => m[1]));
const noHandler = [...fired].filter(n => !handled.has(n));
const neverFired = [...handled].filter(n => !fired.has(n));

if (violations.length || stray.length || noHandler.length || neverFired.length) {
  console.error('계층 방향 위반:');
  violations.slice(0, 30).forEach(v => console.error('  ' + v));
  stray.forEach(f => console.error(`  ${f}: onHook 등록은 app-boot.js 에서만 해야 합니다`));
  noHandler.forEach(n => console.error(`  fireHook('${n}') — 받는 onHook 이 없습니다(오타이거나 등록 누락)`));
  neverFired.forEach(n => console.error(`  onHook('${n}') — 아무도 부르지 않습니다(불필요하거나 호출부 오타)`));
  process.exit(1);
}
console.log(`계층 방향 OK — 역방향 호출 0 · 훅 ${fired.size}종 모두 짝 맞음`);
