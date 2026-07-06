// ===================================================================
// H서비스센터 하자처리 대시보드 — RTDB 보안 규칙 단위테스트
//
// 준비(1회):
//   npm i -D @firebase/rules-unit-testing firebase-tools
//   firebase.json 에 등록:
//     { "database": { "rules": "database.rules.json" },
//       "emulators": { "database": { "port": 9000 } } }
//
// 실행:
//   npx firebase emulators:exec --only database --project report-c29a1 \
//     "node --test tests/database.rules.test.mjs"
//
// 규칙 수정 시 이 테스트가 회귀를 잡는다. 케이스 추가는 아래 패턴을 복제.
// ===================================================================
import { test, before, after, beforeEach } from 'node:test';
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from '@firebase/rules-unit-testing';

let env;

// 테스트 계정 3종 — 클라이언트는 이메일을 소문자 정규화해 기록하므로 토큰도 소문자.
const EDITOR  = { uid: 'u_editor',  email: 'editor@hdec.co.kr',  email_verified: true };
const VIEWER  = { uid: 'u_viewer',  email: 'viewer@hdec.co.kr',  email_verified: true };
const BLOCKED = { uid: 'u_blocked', email: 'blocked@hdec.co.kr', email_verified: true };
const OUTSIDE = { uid: 'u_out',     email: 'mallory@gmail.com',  email_verified: true };
const UNVERIF = { uid: 'u_unv',     email: 'newbie@hdec.co.kr',  email_verified: false };

const db  = (t) => env.authenticatedContext(t.uid, { email: t.email, email_verified: t.email_verified }).database();
const anon = () => env.unauthenticatedContext().database();

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'report-c29a1',
    database: { rules: readFileSync('database.rules.json', 'utf8') },
  });
});
after(async () => { await env.cleanup(); });

// 매 테스트 전 시드: 규칙 우회 컨텍스트로 role 3종 + 게시 1건 심기
beforeEach(async () => {
  await env.clearDatabase();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const root = ctx.database().ref();
    await root.update({
      'users/u_editor':  { email: EDITOR.email,  role: 'editor'  },
      'users/u_viewer':  { email: VIEWER.email,  role: 'viewer'  },
      'users/u_blocked': { email: BLOCKED.email, role: 'blocked' },
      'report/2026-05/_meta': { publishedAt: 1, publishedBy: EDITOR.email, rm: '2026-05' },
    });
  });
});

// ── report ──────────────────────────────────────────────────────────
test('01 비로그인: report 읽기 거부', async () => {
  await assertFails(anon().ref('report/2026-05').once('value'));
});
test('02 viewer: report 읽기 허용 (limitToLast 쿼리 포함)', async () => {
  await assertSucceeds(db(VIEWER).ref('report').orderByKey().limitToLast(1).once('value'));
});
test('03 viewer: report 쓰기 거부', async () => {
  await assertFails(db(VIEWER).ref('report/2026-06/_meta').set({ publishedAt: 2, publishedBy: VIEWER.email, rm: '2026-06' }));
});
test('04 editor: report 쓰기 허용 (rm 형식 YYYY-MM)', async () => {
  await assertSucceeds(db(EDITOR).ref('report/2026-06/_meta').set({ publishedAt: 2, publishedBy: EDITOR.email, rm: '2026-06' }));
});
test('05 editor: report 잘못된 기준월 키 형식 거부', async () => {
  await assertFails(db(EDITOR).ref('report/hack-path/_meta').set({ publishedAt: 2 }));
});
test('06 사외 도메인(gmail): report 읽기 거부', async () => {
  await assertFails(db(OUTSIDE).ref('report/2026-05').once('value'));
});
test('07 미인증 이메일(@hdec): report 읽기 거부', async () => {
  await assertFails(db(UNVERIF).ref('report/2026-05').once('value'));
});

// ── users: 자기등록·자기승격·이메일 위조 ──────────────────────────────
test('08 자기등록: role=viewer + 본인 email 허용', async () => {
  const me = { uid: 'u_new', email: 'new@hdec.co.kr', email_verified: true };
  await assertSucceeds(db(me).ref('users/u_new').set({ email: me.email, role: 'viewer', createdAt: 1, lastSeen: 1 }));
});
test('09 자기등록: role=editor 거부 (자기승격 차단)', async () => {
  const me = { uid: 'u_new2', email: 'new2@hdec.co.kr', email_verified: true };
  await assertFails(db(me).ref('users/u_new2').set({ email: me.email, role: 'editor' }));
});
test('10 자기등록: 타인 email 기재 거부 (P5 신규 검증)', async () => {
  const me = { uid: 'u_new3', email: 'new3@hdec.co.kr', email_verified: true };
  await assertFails(db(me).ref('users/u_new3').set({ email: 'someoneelse@hdec.co.kr', role: 'viewer' }));
});
test('11 기존 viewer: 자기 role을 editor로 변경 거부', async () => {
  await assertFails(db(VIEWER).ref('users/u_viewer').set({ email: VIEWER.email, role: 'editor' }));
});
test('12 blocked: 자기 role을 viewer로 되돌리는 자가해제 거부', async () => {
  await assertFails(db(BLOCKED).ref('users/u_blocked').set({ email: BLOCKED.email, role: 'viewer' }));
});
test('13 본인 lastSeen 갱신 허용 (role·email 불변 부분쓰기)', async () => {
  await assertSucceeds(db(VIEWER).ref('users/u_viewer/lastSeen').set(12345));
});
test('14 editor: 타인 role 변경(viewer→blocked) 허용', async () => {
  await assertSucceeds(db(EDITOR).ref('users/u_viewer').set({ email: VIEWER.email, role: 'blocked' }));
});
test('15 타인 레코드 읽기: viewer가 타인 조회 거부 / editor는 허용', async () => {
  await assertFails(db(VIEWER).ref('users/u_editor').once('value'));
  await assertSucceeds(db(EDITOR).ref('users/u_viewer').once('value'));
});

// ── reportIndex (게시월 인덱스) ─────────────────────────────────────
test('07a reportIndex: viewer 읽기 허용 / 쓰기 거부', async () => {
  await assertSucceeds(db(VIEWER).ref('reportIndex').once('value'));
  await assertFails(db(VIEWER).ref('reportIndex/2026-06').set(Date.now()));
});
test('07b reportIndex: editor 쓰기 허용, 잘못된 월 키·비숫자 값 거부', async () => {
  await assertSucceeds(db(EDITOR).ref('reportIndex/2026-06').set(Date.now()));
  await assertFails(db(EDITOR).ref('reportIndex/hack').set(Date.now()));
  await assertFails(db(EDITOR).ref('reportIndex/2026-07').set('문자열'));
});

// ── plans / analysis ────────────────────────────────────────────────
test('16 viewer: plans 허용 필드 리프 쓰기 허용 (≤5000자)', async () => {
  await assertSucceeds(db(VIEWER).ref('plans/s1/processingPlan/2026-05%40타일').set('재방문 일정 협의'));
});
test('17 viewer: plans 허용 외 필드 쓰기 거부', async () => {
  await assertFails(db(VIEWER).ref('plans/s1/evilField/k').set('x'));
});
test('18 plans 5000자 초과 거부 / 20000자 초과 analysis 거부', async () => {
  await assertFails(db(VIEWER).ref('plans/s1/processingPlan/k').set('가'.repeat(5001)));
  await assertFails(db(VIEWER).ref('analysis/s1/2026-05').set('가'.repeat(20001)));
});
test('19 blocked: plans 읽기·쓰기 전면 거부', async () => {
  await assertFails(db(BLOCKED).ref('plans').once('value'));
  await assertFails(db(BLOCKED).ref('plans/s1/processingPlan/k').set('x'));
});
test('20 viewer: analysis 월 노드 쓰기 허용 (기준월 아카이브, 협업 last-write-wins)', async () => {
  await assertSucceeds(db(VIEWER).ref('analysis/s1/2026-05').set('<p>분석의견</p>'));
});
test('20a analysis: 잘못된 기준월 키 형식 거부', async () => {
  await assertFails(db(VIEWER).ref('analysis/s1/hack-key').set('<p>x</p>'));
});
test('20b analysis: 구버전 형태(현장 노드 직접 문자열) 쓰기 거부', async () => {
  await assertFails(db(VIEWER).ref('analysis/s1').set('<p>레거시 형태</p>'));
});

// ── siteConfig ──────────────────────────────────────────────────────
test('21 siteConfig: viewer 쓰기 거부 / editor 허용, 스키마 봉인($other) 거부', async () => {
  await assertFails(db(VIEWER).ref('siteConfig/s1').set({ hasCommercial: true, showVacant: true, updatedAt: 1 }));
  await assertSucceeds(db(EDITOR).ref('siteConfig/s1').set({ hasCommercial: true, showVacant: true, updatedAt: 1 }));
  await assertFails(db(EDITOR).ref('siteConfig/s1').set({ hasCommercial: true, showVacant: true, updatedAt: 1, extra: 'x' }));
});
