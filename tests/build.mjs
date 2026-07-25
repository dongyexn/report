// 빌드 식별자 검사 — 배포되는 파일이 바뀌었는데 BUILD 값을 안 올렸으면 실패시킨다.
//   화면에 뜬 것이 어느 배포본인지 못 알아보면 "캐시된 옛 버전인가, 진짜 버그인가"를 가릴 수 없다.
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const core = fs.readFileSync(path.join(ROOT, 'app/app-core.js'), 'utf8');

const m = core.match(/const BUILD='([^']+)'/);
if (!m) { console.error('app-core.js 에 BUILD 상수가 없습니다'); process.exit(1); }
const build = m[1];
if (!/^\d{4}-\d{2}-\d{2}\.\d+$/.test(build)) {
  console.error(`BUILD 형식이 올바르지 않습니다: "${build}" (예: 2026-07-25.1)`);
  process.exit(1);
}

// git 이력이 있으면 '배포 파일이 바뀌었는데 BUILD는 그대로'인 경우를 잡는다
const WATCH = ['index.html', 'app/', 'vendor/'];
let changed = [], prevBuild = null;
try {
  const diff = execSync('git diff --name-only HEAD~1 HEAD', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] })
    .toString().trim().split('\n').filter(Boolean);
  changed = diff.filter(f => WATCH.some(w => f === w || f.startsWith(w)));
  const prev = execSync('git show HEAD~1:app/app-core.js', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
  const pm = prev.match(/const BUILD='([^']+)'/);
  prevBuild = pm ? pm[1] : null;
} catch (_) {
  console.log(`BUILD ${build} · 이전 커밋과 비교할 수 없어 형식만 확인했습니다`);
  process.exit(0);
}

if (changed.length && prevBuild === build) {
  console.error(`배포 파일이 바뀌었는데 BUILD 가 그대로입니다 (${build})`);
  changed.slice(0, 8).forEach(f => console.error('  변경: ' + f));
  console.error('  → app/app-core.js 의 BUILD 값을 올리세요');
  process.exit(1);
}
console.log(`BUILD ${build} OK${prevBuild ? ` (이전 ${prevBuild})` : ''} · 변경 파일 ${changed.length}개`);
