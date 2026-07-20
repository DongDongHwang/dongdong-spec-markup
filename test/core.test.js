// 코어 로직 동작 테스트 — 외부 프레임워크 없이 node 내장 assert 로 돌린다.  실행:  node test/core.test.js
// 대상 = src/core/{annotation-model,anchor,html-io}.js (M2 신설. html-io 는 M5 조기 착수분).
//   - annotation-model : 스키마 생성·검증·id 생성
//   - anchor           : element/coord 절대↔비율 변환 (왕복 대칭 포함)
//   - html-io          : embed/extract 왕복 항등 + 멱등 + </script> 이스케이프

'use strict';

const assert = require('assert');
const DDModel = require('../src/core/annotation-model.js');
const DDAnchor = require('../src/core/anchor.js');
const DDHtmlIO = require('../src/core/html-io.js');
const DDNumbering = require('../src/core/numbering.js');
const DDRuntimeSrc = require('../src/renderer/runtime/dd-runtime-src.js');

let passed = 0;
let failed = 0;
function test(name, fn) {
	try {
		fn();
		passed++;
		console.log(`  ok   ${name}`);
	} catch (e) {
		failed++;
		console.log(`  FAIL ${name}\n       ${e.message}`);
	}
}

// ---- annotation-model ------------------------------------------------------

test('model: genId 형식 + rng 주입 재현성', () => {
	assert.match(DDModel.genId(), /^an_[0-9a-z]{6}$/);
	const fixed = () => 0.5;
	assert.strictEqual(DDModel.genId(fixed), DDModel.genId(fixed)); // 같은 rng → 같은 id
});

test('model: createSet 기본값 + source.kind 방어', () => {
	const s = DDModel.createSet('spec-html');
	assert.strictEqual(s.ddVersion, DDModel.DD_VERSION); // v6 — 플로우맵 도입
	assert.strictEqual(s.source.kind, 'spec-html');
	assert.strictEqual(s.docMeta, null); // 정책부 미추출 상태 — 저장 시 목업에서 채움
	assert.strictEqual(s.flowMap, null); // 플로우맵 미생성 상태
	assert.deepStrictEqual(s.annotations, []);
	assert.strictEqual(DDModel.createSet('이상한값').source.kind, 'generic');
});

test('model: normalizeDocMeta — 정책부 스냅샷 정규화 + 빈 입력 null', () => {
	assert.strictEqual(DDModel.normalizeDocMeta(null), null);
	assert.strictEqual(DDModel.normalizeDocMeta({}), null); // 내용 없으면 null → 정책부 섹션 생략
	const m = DDModel.normalizeDocMeta({
		title: '회원가입 분기', version: 'v1.0',
		history: [{ no: 1, date: '2026-07-02', ver: 'v1.0', content: '최초', author: '동동이', extra: '버림' }],
		overview: { 기능정의: '의도 분리', 추진배경: '자동분기 제거', 작업범위: '로그인 분리' },
		flows: [{ id: 'LGN-001', name: '계정 선택' }],
	});
	assert.strictEqual(m.title, '회원가입 분기');
	assert.strictEqual(m.history.length, 1);
	assert.strictEqual(m.history[0].author, '동동이');
	assert.strictEqual(m.history[0].extra, undefined); // 스키마 밖 키는 버림
	assert.strictEqual(m.overview.기능정의, '의도 분리');
	assert.strictEqual(m.flows[0].id, 'LGN-001');
});

test('model: 정상 세트 검증 통과 (element 핀 + coord 박스)', () => {
	const s = DDModel.createSet('spec-html');
	s.annotations.push(DDModel.createAnnotation({
		id: 'an_aaa111', seq: 1, label: '1',
		anchor: { mode: 'element', elementId: 'LGN-LOG-001-BD-BTN-001', screenId: 'LGN-LOG-001', offsetPct: { dx: 0.5, dy: 0 } },
	}));
	s.annotations.push(DDModel.createAnnotation({
		id: 'an_bbb222', type: 'box', seq: 2, label: '2',
		anchor: { mode: 'coord' },
		coord: { basis: 'frame', x: 0.1, y: 0.2, w: 0.5, h: 0.1 },
	}));
	const v = DDModel.validateSet(s);
	assert.strictEqual(v.ok, true, v.errors.join(' / '));
});

test('model: 오류 검출 — elementId 누락·coord 박스 w/h 누락·id 중복', () => {
	const s = DDModel.createSet('generic');
	s.annotations.push(DDModel.createAnnotation({ id: 'an_dup111', anchor: { mode: 'element' } })); // elementId 없음
	s.annotations.push(DDModel.createAnnotation({ id: 'an_dup111', type: 'box', anchor: { mode: 'coord' }, coord: { basis: 'body', x: 0.1, y: 0.1 } })); // w/h 없음 + id 중복
	const v = DDModel.validateSet(s);
	assert.strictEqual(v.ok, false);
	assert.ok(v.errors.some((e) => e.includes('elementId')));
	assert.ok(v.errors.some((e) => e.includes('w/h')));
	assert.ok(v.errors.some((e) => e.includes('중복')));
});

test('model: origin/edited + annotStatus (diff)', () => {
	const m = DDModel.createAnnotation({ anchor: { mode: 'coord' }, coord: { basis: 'body', x: 0.1, y: 0.1 } });
	assert.strictEqual(m.origin, 'manual');
	assert.strictEqual(m.edited, false);
	assert.strictEqual(DDModel.annotStatus(m), 'new'); // manual(직접) = 신규
	const d = DDModel.createAnnotation({ origin: 'draft', anchor: { mode: 'coord' }, coord: { basis: 'body', x: 0.1, y: 0.1 } });
	assert.strictEqual(DDModel.annotStatus(d), 'unchanged'); // 초안 미편집 = 기존
	d.edited = true;
	assert.strictEqual(DDModel.annotStatus(d), 'modified'); // 초안 편집 = 수정
	assert.strictEqual(DDModel.annotStatus({}), 'new'); // origin 없는 옛 저장본 = 신규(하위호환)
});

test('model: mark 가 origin 을 덮어쓴다 (사용자 지정 SSOT)', () => {
	// draft(자동=기존)라도 사용자가 신규로 지정하면 신규
	const d = DDModel.createAnnotation({ origin: 'draft', mark: { kind: '신규', phase: 2 }, anchor: { mode: 'coord' }, coord: { basis: 'body', x: 0.1, y: 0.1 } });
	assert.strictEqual(DDModel.annotStatus(d), 'new');
	// manual(자동=신규)이라도 사용자가 기존으로 지정하면 기존
	const m = DDModel.createAnnotation({ mark: { kind: '기존' }, anchor: { mode: 'coord' }, coord: { basis: 'body', x: 0.1, y: 0.1 } });
	assert.strictEqual(DDModel.annotStatus(m), 'unchanged');
});

test('model: annotBadge — 신규 1차/2차 라벨 + 툴팁(날짜·사유)', () => {
	const b1 = DDModel.annotBadge(DDModel.createAnnotation({ mark: { kind: '신규', phase: 1 }, anchor: { mode: 'coord' }, coord: { basis: 'body', x: 0.1, y: 0.1 } }));
	assert.strictEqual(b1.label, '신규');
	const b2 = DDModel.annotBadge(DDModel.createAnnotation({ mark: { kind: '신규', phase: 2, addedAt: '2026-07-02', reason: '중간보상 추가' }, anchor: { mode: 'coord' }, coord: { basis: 'body', x: 0.1, y: 0.1 } }));
	assert.strictEqual(b2.label, '신규·2차');
	assert.strictEqual(b2.status, 'new');
	assert.strictEqual(b2.tooltip, '2026-07-02 · 중간보상 추가');
	const b3 = DDModel.annotBadge(DDModel.createAnnotation({ mark: { kind: '기존' }, anchor: { mode: 'coord' }, coord: { basis: 'body', x: 0.1, y: 0.1 } }));
	assert.strictEqual(b3.label, '기존');
});

test('model: mark 형태 검증 — 잘못된 kind/phase 적발, 미지정(null) 통과', () => {
	const good = DDModel.createSet('generic');
	good.annotations.push(DDModel.createAnnotation({ id: 'an_ok0001', mark: null, anchor: { mode: 'coord' }, coord: { basis: 'body', x: 0.1, y: 0.1 } }));
	assert.strictEqual(DDModel.validateSet(good).ok, true);
	const bad = DDModel.createSet('generic');
	bad.annotations.push(DDModel.createAnnotation({ id: 'an_bad001', mark: { kind: '엉뚱', phase: 9 }, anchor: { mode: 'coord' }, coord: { basis: 'body', x: 0.1, y: 0.1 } }));
	const v = DDModel.validateSet(bad);
	assert.strictEqual(v.ok, false);
	assert.ok(v.errors.some((e) => e.includes('mark.kind')));
	assert.ok(v.errors.some((e) => e.includes('mark.phase')));
});

test('model: migrate v1~v4 → 최신 (옛 저장본 무손실 승격 + docMeta 채움)', () => {
	const V = DDModel.DD_VERSION; // v5 — 커넥터(connect) 도입
	const v1 = { ddVersion: 1, tool: 'dd-spec-viewer', savedAt: '', source: { kind: 'generic' }, annotations: [] };
	const out1 = DDModel.migrate(v1);
	assert.strictEqual(out1.ddVersion, V);
	assert.strictEqual(out1.docMeta, null); // docMeta 없던 옛 세트 → null 로 채움
	assert.strictEqual(DDModel.validateSet(out1).ok, true); // 승격 후 최신 스키마 통과
	const v2 = { ddVersion: 2, tool: 'dd-spec-viewer', savedAt: '', source: { kind: 'generic' }, annotations: [] };
	assert.strictEqual(DDModel.migrate(v2).ddVersion, V);
	const v3 = { ddVersion: 3, tool: 'dd-spec-viewer', savedAt: '', source: { kind: 'generic' }, annotations: [] };
	assert.strictEqual(DDModel.migrate(v3).ddVersion, V);
});

test('model: migrate — generic screenId 오저장 복구(#셀렉터 → screenSel)', () => {
	const bad = { ddVersion: 4, tool: 'dd-spec-viewer', savedAt: '', source: { kind: 'generic' }, annotations: [
		{ id: 'a1', type: 'pin', seq: 1, label: '1', anchor: { mode: 'coord', screenId: '#screen-0' }, coord: { basis: 'body', x: 0.5, y: 0.5 } },
		{ id: 'a2', type: 'pin', seq: 2, label: '2', anchor: { mode: 'element', elementId: 'x', screenId: 'S1' } }, // spec-html 정상 screenId — 유지
	] };
	const out = DDModel.migrate(bad);
	assert.strictEqual(out.annotations[0].anchor.screenId, undefined); // # 셀렉터는 screenId 에서 제거
	assert.strictEqual(out.annotations[0].anchor.screenSel, '#screen-0'); // screenSel 로 이동
	assert.strictEqual(out.annotations[1].anchor.screenId, 'S1'); // 정상 screenId 는 그대로
});

// ---- anchor ----------------------------------------------------------------

const RECT = { left: 100, top: 200, width: 300, height: 60 }; // 요소/기준 렉트 예시

test('anchor: pinPointFromElement — 기본 오프셋(상단 중앙)과 명시 오프셋', () => {
	assert.deepStrictEqual(DDAnchor.pinPointFromElement(RECT, null), { left: 250, top: 200 });
	assert.deepStrictEqual(DDAnchor.pinPointFromElement(RECT, { dx: 0, dy: 1 }), { left: 100, top: 260 });
});

test('anchor: boxRectFromElement — rectPct 없으면 요소 전체', () => {
	assert.deepStrictEqual(DDAnchor.boxRectFromElement(RECT, null), { left: 100, top: 200, width: 300, height: 60 });
	assert.deepStrictEqual(DDAnchor.boxRectFromElement(RECT, { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }), { left: 250, top: 230, width: 150, height: 30 });
});

test('anchor: rectFromCoord ↔ coordFromRect 왕복 대칭', () => {
	const coord = { basis: 'frame', x: 0.25, y: 0.5, w: 0.4, h: 0.2 };
	const abs = DDAnchor.rectFromCoord(coord, RECT);
	const back = DDAnchor.coordFromRect(abs, RECT);
	assert.ok(Math.abs(back.x - coord.x) < 1e-9 && Math.abs(back.y - coord.y) < 1e-9);
	assert.ok(Math.abs(back.w - coord.w) < 1e-9 && Math.abs(back.h - coord.h) < 1e-9);
});

test('anchor: coordFromPoint — 0 나눗셈 가드', () => {
	const zero = { left: 0, top: 0, width: 0, height: 0 };
	assert.deepStrictEqual(DDAnchor.coordFromPoint({ left: 50, top: 50 }, zero), { x: 0, y: 0 });
});

test('anchor: offsetPctFromPoint — 요소 밖 클램프', () => {
	const o = DDAnchor.offsetPctFromPoint({ left: 9999, top: -9999 }, RECT);
	assert.strictEqual(o.dx, 1);
	assert.strictEqual(o.dy, 0);
});

// ---- html-io ---------------------------------------------------------------

const PURE = '<!DOCTYPE html>\n<html><head><title>목업</title></head>\n<body>\n<div class="mobile-frame">UI</div>\n<script>const APP_DATA={};</script>\n</body>\n</html>\n';

function sampleSet() {
	const s = DDModel.createSet('spec-html');
	s.annotations.push(DDModel.createAnnotation({
		id: 'an_test01', seq: 1, label: '1-1',
		anchor: { mode: 'element', elementId: 'X-Y-001', offsetPct: { dx: 0.5, dy: 0 } },
		body: { format: 'html', html: '<p>설명 with </scr' + 'ipt> 함정</p>', plain: '설명' },
	}));
	return s;
}

test('html-io: 왕복 항등 — extract(embed(pure, set)) === { pure, set }', () => {
	const set = sampleSet();
	const embedded = DDHtmlIO.embed(PURE, set);
	const out = DDHtmlIO.extract(embedded);
	assert.strictEqual(out.pure, PURE); // 원본 한 글자도 안 바뀜
	assert.deepStrictEqual(out.set, set);
});

test('html-io: 멱등 — embed(embed(x)) 에 dd 블록 1세트만', () => {
	const set = sampleSet();
	const once = DDHtmlIO.embed(PURE, set);
	const twice = DDHtmlIO.embed(once, set);
	assert.strictEqual(twice, once);
	assert.strictEqual(twice.split(DDHtmlIO.BEGIN).length - 1, 1);
});

test('html-io: 본문 </script> 이스케이프 — 블록이 조기 종료되지 않는다', () => {
	const embedded = DDHtmlIO.embed(PURE, sampleSet());
	const m = embedded.match(/<script type="application\/json" id="dd-annotations">([\s\S]*?)<\/script>/);
	assert.ok(m, 'dd-annotations 블록 존재');
	assert.ok(!m[1].includes('</'), 'JSON 안에 리터럴 </ 없음(\\u003c 이스케이프)');
	assert.ok(DDHtmlIO.extract(embedded).set.annotations[0].body.html.includes('</scr' + 'ipt>'));
});

test('html-io: </body> 없는 문서 — 끝에 append + 왕복 유지', () => {
	const noBody = '<div>fragment</div>';
	const embedded = DDHtmlIO.embed(noBody, sampleSet());
	const out = DDHtmlIO.extract(embedded);
	assert.strictEqual(out.pure, noBody + '\n'); // 삽입 위한 개행 1개만 추가(멱등 유지)
	assert.strictEqual(DDHtmlIO.embed(embedded, sampleSet()), embedded);
});

test('html-io: dd 블록 없는 일반 목업 — set=null, pure 그대로', () => {
	const out = DDHtmlIO.extract(PURE);
	assert.strictEqual(out.pure, PURE);
	assert.strictEqual(out.set, null);
});

test('html-io: 런타임 인라인(M5b) — 왕복·멱등·원본 무손상 유지', () => {
	const rt = { css: '.dd-x{color:red}', js: 'console.log("dd runtime");' };
	const set = sampleSet();
	const embedded = DDHtmlIO.embed(PURE, set, rt);
	assert.ok(embedded.includes('dd-runtime-style'), '런타임 style 블록 포함');
	assert.ok(embedded.includes('id="dd-runtime"'), '런타임 script 블록 포함');
	const out = DDHtmlIO.extract(embedded);
	assert.strictEqual(out.pure, PURE); // 런타임 심어도 원본 무손상(strip 이 전부 걷어냄)
	assert.deepStrictEqual(out.set, set); // JSON 만 파싱 복원
	assert.strictEqual(DDHtmlIO.embed(embedded, set, rt), embedded); // 멱등
});

test('html-io: 런타임 JS 의 </script> 리터럴 이스케이프 — 태그 조기종료 방지', () => {
	const rt = { css: 'x{}', js: 'var s="</scr'+'ipt>";' };
	const embedded = DDHtmlIO.embed(PURE, sampleSet(), rt);
	// dd-runtime 스크립트 블록 안에 리터럴 </script> 가 없어야(이스케이프됨) 태그가 안 깨진다
	const m = embedded.match(/<script id="dd-runtime">([\s\S]*?)<\/script>/);
	assert.ok(m, 'dd-runtime 블록이 온전히 닫힘');
	assert.ok(!m[1].includes('</scr' + 'ipt>'), '내부 리터럴 이스케이프됨');
	assert.strictEqual(DDHtmlIO.extract(embedded).pure, PURE); // 무손상 유지
});

test('html-io: 마킹(mark) 왕복 보존 — 신규·차수·날짜·사유 무손실', () => {
	const s = DDModel.createSet('spec-html');
	s.annotations.push(DDModel.createAnnotation({
		id: 'an_mk0001', seq: 1, label: '1',
		anchor: { mode: 'element', elementId: 'X-Y-001' },
		mark: { kind: '신규', phase: 2, addedAt: '2026-07-02', reason: '중간보상 추가' },
	}));
	const out = DDHtmlIO.extract(DDHtmlIO.embed(PURE, s));
	assert.deepStrictEqual(out.set.annotations[0].mark, s.annotations[0].mark);
	assert.strictEqual(DDModel.annotBadge(out.set.annotations[0]).label, '신규·2차');
});

test('runtime: 직렬화 문자열에 마킹·차수 렌더 로직 포함(회귀 가드)', () => {
	const src = DDRuntimeSrc.RUNTIME_JS;
	assert.ok(src.includes('a.mark'), 'annStatus 가 mark 를 본다');
	assert.ok(src.includes('dd-phase-badge'), '차수 배지 노드 생성');
	assert.ok(DDRuntimeSrc.RUNTIME_CSS.includes('dd-phase-badge'), '차수 배지 CSS 포함(색은 인라인 소유)');
});

test('runtime: 팔레트가 core SSOT 와 일치(드리프트 가드)', () => {
	// annotation-model 이 색 SSOT. dd-runtime 은 저장본 자기완결(외부 require 0) 때문에 팔레트를 판박이 복제한다.
	// 어느 한쪽만 바뀌면 저장본 색이 앱과 달라지므로, SSOT 배열 리터럴이 직렬화 문자열에 그대로 있는지 잠근다.
	const src = DDRuntimeSrc.RUNTIME_JS;
	const lit = (arr) => "['" + arr.join("', '") + "']";
	assert.ok(src.includes(lit(DDModel.PHASE_PALETTE)), 'RUNTIME_JS PHASE_PAL 이 core PHASE_PALETTE 와 일치');
	assert.ok(src.includes(lit(DDModel.GROUP_PALETTE)), 'RUNTIME_JS GROUP_PAL 이 core GROUP_PALETTE 와 일치');
	assert.strictEqual(DDModel.statusColor({ origin: 'draft', edited: true }), '#E08600', 'modified 색 대문자 통일');
});

// ---- numbering -------------------------------------------------------------

function numSet(n) {
	const s = DDModel.createSet('generic');
	for (let i = 1; i <= n; i++) {
		DDNumbering.add(s, DDModel.createAnnotation({ id: 'an_num00' + i, anchor: { mode: 'coord' }, coord: { basis: 'body', x: 0.1, y: 0.1 } }));
	}
	return s;
}
const labels = (s) => s.annotations.map((a) => a.label);

test('numbering: 추가 시 자동 다음번호 (1, 2, 3)', () => {
	assert.deepStrictEqual(labels(numSet(3)), ['1', '2', '3']);
});

test('numbering: 삭제 시 뒤 당김 (기본) — 2 삭제 → 1, 2', () => {
	const s = numSet(3);
	DDNumbering.remove(s, 'an_num002');
	assert.deepStrictEqual(labels(s), ['1', '2']);
	assert.deepStrictEqual(s.annotations.map((a) => a.seq), [1, 2]);
});

test('numbering: 삭제 pullBack=false — 라벨 동결(구멍 유지), seq 는 압축', () => {
	const s = numSet(3);
	DDNumbering.remove(s, 'an_num002', { pullBack: false });
	assert.deepStrictEqual(labels(s), ['1', '3']);
	assert.deepStrictEqual(s.annotations.map((a) => a.seq), [1, 2]);
	assert.ok(s.annotations.every((a) => a.autoNumber === false)); // 동결 = 수동 고정
});

test('numbering: moveTo 중간 삽입 밀기 — 3번을 1자리로 → 3이 1, 나머지 밀림', () => {
	const s = numSet(3);
	DDNumbering.moveTo(s, 'an_num003', 1);
	assert.deepStrictEqual(s.annotations.map((a) => a.id), ['an_num003', 'an_num001', 'an_num002']);
	assert.deepStrictEqual(labels(s), ['1', '2', '3']); // 자동 재번호
});

test('numbering: setLabel 수동 고정 (계층 1-1) — 재번호에 안 흔들림', () => {
	const s = numSet(3);
	DDNumbering.setLabel(s, 'an_num002', '1-1');
	DDNumbering.remove(s, 'an_num001'); // 재번호 유발
	assert.deepStrictEqual(labels(s), ['1-1', '2']); // 수동 라벨 보존, 자동만 당김
});

test('numbering: setAuto 복귀 — seq 위치 기준 재번호', () => {
	const s = numSet(3);
	DDNumbering.setLabel(s, 'an_num002', 'A');
	DDNumbering.setAuto(s, 'an_num002');
	assert.deepStrictEqual(labels(s), ['1', '2', '3']);
});

test('numbering: 복제(clone + add) — 새 id·다음 seq·mark 승계', () => {
	const s = numSet(2);
	const src = s.annotations[0];
	src.mark = { kind: '신규', phase: 2, addedAt: '2026-07-02', reason: '원본' };
	const clone = DDModel.createAnnotation(Object.assign({}, JSON.parse(JSON.stringify(src)), { id: DDModel.genId() }));
	DDNumbering.add(s, clone);
	assert.strictEqual(s.annotations.length, 3);
	assert.strictEqual(clone.seq, 3);            // 맨 뒤 다음 번호
	assert.notStrictEqual(clone.id, src.id);      // 새 id
	assert.deepStrictEqual(clone.mark, src.mark); // 마킹 승계
	assert.strictEqual(DDModel.validateSet(s).ok, true); // id 중복 없음
});

test('numbering: setParent 계층 — 자식은 부모라벨-A/B, 가족 인접', () => {
	const s = numSet(3); // 1, 2, 3
	DDNumbering.setParent(s, 'an_num003', 'an_num001'); // 3 → 1 의 자식
	assert.deepStrictEqual(labels(s), ['1', '1-A', '2']); // 자식이 부모 뒤로, 나머지 재번호
	const secondTop = s.annotations.find((a) => a.label === '2');
	DDNumbering.setParent(s, secondTop.id, 'an_num001'); // 2번째 최상위도 1 의 자식
	assert.deepStrictEqual(labels(s), ['1', '1-A', '1-B']);
});

test('numbering: 부모 삭제 시 자식 최상위 승격(고아)', () => {
	const s = numSet(2);
	DDNumbering.setParent(s, 'an_num002', 'an_num001'); // 1, 1-A
	assert.deepStrictEqual(labels(s), ['1', '1-A']);
	DDNumbering.remove(s, 'an_num001', { pullBack: true }); // 부모 삭제 → 자식은 고아
	assert.deepStrictEqual(labels(s), ['1']);
});

test('numbering: 2단계 계층 금지 — 자식의 자식 불가', () => {
	const s = numSet(3);
	DDNumbering.setParent(s, 'an_num002', 'an_num001'); // 2 → 1-A
	DDNumbering.setParent(s, 'an_num003', 'an_num002'); // 자식(002)의 자식 시도 → 거부
	assert.strictEqual(s.annotations.find((a) => a.id === 'an_num003').parentId, null);
});

test('model/numbering: 텍스트 타입 — 번호 없음·시퀀스 제외(핀 번호 연속 유지)', () => {
	const s = DDModel.createSet('generic');
	// 기본값 — text 는 autoNumber false·label '' 자동
	const t0 = DDModel.createAnnotation({ type: 'text', anchor: { mode: 'coord' }, coord: { basis: 'body', x: 0.2, y: 0.2 }, body: { format: 'html', html: '<p>메모</p>', plain: '메모' } });
	assert.strictEqual(t0.type, 'text');
	assert.strictEqual(t0.autoNumber, false);
	assert.strictEqual(t0.label, '');
	// 핀 - 텍스트 - 핀 순으로 추가해도 핀 번호는 1,2 연속(텍스트가 번호를 소비하지 않음)
	DDNumbering.add(s, DDModel.createAnnotation({ id: 'an_pin001', anchor: { mode: 'coord' }, coord: { basis: 'body', x: 0.1, y: 0.1 } }));
	DDNumbering.add(s, DDModel.createAnnotation({ id: 'an_txt001', type: 'text', anchor: { mode: 'coord' }, coord: { basis: 'body', x: 0.3, y: 0.3 }, body: { format: 'html', html: '', plain: '노트' } }));
	DDNumbering.add(s, DDModel.createAnnotation({ id: 'an_pin002', anchor: { mode: 'coord' }, coord: { basis: 'body', x: 0.5, y: 0.5 } }));
	assert.strictEqual(s.annotations.find((a) => a.id === 'an_pin001').label, '1');
	assert.strictEqual(s.annotations.find((a) => a.id === 'an_pin002').label, '2'); // 텍스트 건너뛰고 연속
	assert.strictEqual(s.annotations.find((a) => a.id === 'an_txt001').label, '');   // 텍스트는 무번호 유지
	// 검증 통과(text + coord)
	assert.strictEqual(DDModel.validateSet(s).ok, true);
});

test('model/numbering: 화살표 타입 — 두 끝점·번호 없음·검증', () => {
	const s = DDModel.createSet('generic');
	const ar = DDModel.createAnnotation({
		type: 'arrow',
		anchor: { mode: 'coord' }, coord: { basis: 'body', x: 0.2, y: 0.2 },
		anchor2: { mode: 'coord' }, coord2: { basis: 'body', x: 0.6, y: 0.5 },
	});
	assert.strictEqual(ar.type, 'arrow');
	assert.strictEqual(ar.autoNumber, false);
	assert.strictEqual(ar.label, '');
	assert.ok(ar.anchor2 && ar.coord2, '끝점 앵커/좌표 보존');
	DDNumbering.add(s, DDModel.createAnnotation({ id: 'an_pin001', anchor: { mode: 'coord' }, coord: { basis: 'body', x: 0.1, y: 0.1 } }));
	DDNumbering.add(s, ar);
	DDNumbering.add(s, DDModel.createAnnotation({ id: 'an_pin002', anchor: { mode: 'coord' }, coord: { basis: 'body', x: 0.5, y: 0.5 } }));
	assert.strictEqual(s.annotations.find((a) => a.id === 'an_pin002').label, '2'); // 화살표가 번호 소비 안 함
	assert.strictEqual(DDModel.validateSet(s).ok, true);
	// 끝점 누락 arrow 는 검증 실패
	const bad = DDModel.createSet('generic');
	bad.annotations.push(DDModel.createAnnotation({ type: 'arrow', anchor: { mode: 'coord' }, coord: { basis: 'body', x: 0.1, y: 0.1 } }));
	assert.strictEqual(DDModel.validateSet(bad).ok, false);
});

test('model: 커넥터(Phase 4) — connect 스키마·검증·arrow 전용', () => {
	const s = DDModel.createSet('generic');
	DDNumbering.add(s, DDModel.createAnnotation({ id: 'an_pinA0', anchor: { mode: 'coord' }, coord: { basis: 'body', x: 0.1, y: 0.1 } }));
	DDNumbering.add(s, DDModel.createAnnotation({ id: 'an_pinB0', anchor: { mode: 'coord' }, coord: { basis: 'body', x: 0.7, y: 0.7 } }));
	// 양끝 연결 화살표 — connect 저장·검증 통과. anchor/coord 폴백도 함께 유지.
	const ar = DDModel.createAnnotation({
		type: 'arrow',
		anchor: { mode: 'coord' }, coord: { basis: 'body', x: 0.1, y: 0.1 },
		anchor2: { mode: 'coord' }, coord2: { basis: 'body', x: 0.7, y: 0.7 },
		connect: { from: 'an_pinA0', to: 'an_pinB0' },
	});
	assert.deepStrictEqual(ar.connect, { from: 'an_pinA0', to: 'an_pinB0' });
	DDNumbering.add(s, ar);
	assert.strictEqual(DDModel.validateSet(s).ok, true);
	// 한쪽만 연결(from 만) — to 는 null 정규화
	const half = DDModel.createAnnotation({
		type: 'arrow',
		anchor: { mode: 'coord' }, coord: { basis: 'body', x: 0.2, y: 0.2 },
		anchor2: { mode: 'coord' }, coord2: { basis: 'body', x: 0.5, y: 0.5 },
		connect: { from: 'an_pinA0' },
	});
	assert.strictEqual(half.connect.to, null);
	// connect 는 arrow 전용 — pin 에 넘겨도 무시(null)
	const pin = DDModel.createAnnotation({ anchor: { mode: 'coord' }, coord: { basis: 'body', x: 0.3, y: 0.3 }, connect: { from: 'an_pinA0' } });
	assert.strictEqual(pin.connect, null);
	// 형태 위반 — from 이 문자열|null 아님 → 검증 실패
	const bad = DDModel.createSet('generic');
	const badAr = DDModel.createAnnotation({
		type: 'arrow',
		anchor: { mode: 'coord' }, coord: { basis: 'body', x: 0.1, y: 0.1 },
		anchor2: { mode: 'coord' }, coord2: { basis: 'body', x: 0.5, y: 0.5 },
	});
	badAr.connect = { from: 123, to: null };
	bad.annotations.push(badAr);
	assert.strictEqual(DDModel.validateSet(bad).ok, false);
	// migrate — connect 없는 옛 저장본(v4)도 그대로 통과 + 버전 승격
	const old = DDModel.createSet('generic');
	old.ddVersion = 4;
	const oldAr = DDModel.createAnnotation({
		type: 'arrow',
		anchor: { mode: 'coord' }, coord: { basis: 'body', x: 0.1, y: 0.1 },
		anchor2: { mode: 'coord' }, coord2: { basis: 'body', x: 0.5, y: 0.5 },
	});
	delete oldAr.connect; // 옛 스키마엔 키 자체가 없음
	old.annotations.push(oldAr);
	const mig = DDModel.migrate(old);
	assert.strictEqual(mig.ddVersion, DDModel.DD_VERSION);
	assert.strictEqual(DDModel.validateSet(mig).ok, true);
});

test('model: 플로우맵(v6) — 노드 그리드 배치·간선 매핑·검증·migrate', () => {
	const screens = [{ id: 'S1', name: '홈' }, { id: 'S2', name: '로그인' }, { id: 'S3', name: '완료' }, { id: 'S4', name: '오류' }];
	// 노드 자동 배치 — 화면 수만큼, 좌표 0~1, screenId·label 스냅샷
	const nodes = DDModel.layoutFlowNodes(screens, { cols: 2 });
	assert.strictEqual(nodes.length, 4);
	assert.ok(nodes.every((n) => n.x >= 0 && n.x <= 1 && n.y >= 0 && n.y <= 1), '좌표 0~1');
	assert.strictEqual(nodes[0].screenId, 'S1');
	assert.strictEqual(nodes[0].label, '홈');
	// 2열 배치 — 0,1 같은 행(y 동일) / 2,3 다음 행(y 더 큼)
	assert.strictEqual(nodes[0].y, nodes[1].y);
	assert.ok(nodes[2].y > nodes[0].y);
	assert.strictEqual(nodes[0].x, nodes[2].x); // 같은 열
	// 빈 목록 → 빈 배열
	assert.deepStrictEqual(DDModel.layoutFlowNodes([]), []);
	// 초안 조립 — 화면 간선(screenId 쌍)을 노드 id 간선으로 매핑. 양끝 노드 없거나 자기연결·중복은 버림.
	const draft = DDModel.buildFlowDraft(screens, [
		{ from: 'S1', to: 'S2', label: '로그인 시작' },
		{ from: 'S2', to: 'S3', label: '성공' },
		{ from: 'S2', to: 'S4', label: '실패' },
		{ from: 'S1', to: 'S1' },                  // 자기연결 — 버림
		{ from: 'S1', to: 'S9' },                  // S9 노드 없음 — 버림
		{ from: 'S1', to: 'S2', label: '로그인 시작' }, // 중복 — 버림
	], { cols: 2 });
	assert.strictEqual(draft.nodes.length, 4);
	assert.strictEqual(draft.edges.length, 3, '유효 간선 3개만');
	assert.ok(draft.edges.every((e) => draft.nodes.some((n) => n.id === e.from) && draft.nodes.some((n) => n.id === e.to)), '간선 양끝 = 실재 노드 id');
	assert.strictEqual(draft.edges[0].origin, 'draft');
	// 세트에 flowMap 실어 검증 통과
	const s = DDModel.createSet('spec-html');
	s.flowMap = draft;
	assert.strictEqual(DDModel.validateSet(s).ok, true);
	// 간선 from 이 실재 노드 아님 → 검증 실패
	const bad = DDModel.createSet('spec-html');
	bad.flowMap = { nodes: [DDModel.createFlowNode({ screenId: 'S1', x: 0.1, y: 0.1 })], edges: [DDModel.createFlowEdge({ from: 'fn_ghost', to: 'fn_ghost2' })] };
	assert.strictEqual(DDModel.validateSet(bad).ok, false);
	// flowMap=null 은 통과(옵셔널)
	assert.strictEqual(DDModel.validateFlowMap(null).length, 0);
	// migrate v5(flowMap 키 없음) → v6, flowMap=null 로 채움
	const v5 = { ddVersion: 5, tool: 'dd-spec-viewer', savedAt: '', source: { kind: 'generic' }, docMeta: null, annotations: [] };
	const mig = DDModel.migrate(v5);
	assert.strictEqual(mig.ddVersion, DDModel.DD_VERSION);
	assert.strictEqual(mig.flowMap, null);
	assert.strictEqual(DDModel.validateSet(mig).ok, true);
});

test('anchor: edgeClipPoint — 테두리 교점·pad·내부 상대점', () => {
	const rect = { left: 100, top: 100, width: 40, height: 20 }; // 중심 (120, 110)
	// 오른쪽 수평 — 우변(x=140)과 교차
	const r = DDAnchor.edgeClipPoint(rect, { left: 200, top: 110 }, 0);
	assert.strictEqual(Math.round(r.left), 140);
	assert.strictEqual(Math.round(r.top), 110);
	// 위쪽 수직 — 상변(y=100)과 교차
	const u = DDAnchor.edgeClipPoint(rect, { left: 120, top: 10 }, 0);
	assert.strictEqual(Math.round(u.left), 120);
	assert.strictEqual(Math.round(u.top), 100);
	// pad — 교점에서 상대점 방향으로 pad px 더 나감
	const p = DDAnchor.edgeClipPoint(rect, { left: 200, top: 110 }, 6);
	assert.strictEqual(Math.round(p.left), 146);
	// 상대점이 렉트 내부 — 그대로 반환(역전 방지)
	const inn = DDAnchor.edgeClipPoint(rect, { left: 125, top: 112 }, 4);
	assert.strictEqual(inn.left, 125);
	assert.strictEqual(inn.top, 112);
	// 중심과 동일 — 중심 반환(0 나눗셈 가드)
	const same = DDAnchor.edgeClipPoint(rect, { left: 120, top: 110 }, 4);
	assert.strictEqual(same.left, 120);
	assert.strictEqual(same.top, 110);
});

test('model: 색 SSOT — 차수별 다름·그룹색·상태색', () => {
	assert.notStrictEqual(DDModel.phaseColor(1), DDModel.phaseColor(2));
	assert.notStrictEqual(DDModel.phaseColor(2), DDModel.phaseColor(3)); // 2·3차 이제 서로 다름
	assert.strictEqual(DDModel.groupColorForKey(null), null);            // 그룹 없으면 색 없음
	assert.strictEqual(typeof DDModel.groupColorForKey('an_x'), 'string');
	assert.strictEqual(DDModel.statusColor({ mark: { kind: '신규', phase: 2 } }), DDModel.phaseColor(2)); // 신규=차수색
	assert.strictEqual(DDModel.statusColor({ mark: { kind: '기존' } }), '#6B7280'); // 기존=회색
});

test('model: arrowColor — 무마킹 보라·style.color 유지·신규 차수색·기존 현행색', () => {
	// 마킹 없음 → 현행 보라(회귀 방지 — 기존 저장본 화살표가 초록으로 안 튐)
	assert.strictEqual(DDModel.arrowColor({}), '#7460D9');
	assert.strictEqual(DDModel.arrowColor({ style: {} }), '#7460D9');
	// style.color 지정 시 그 색 유지
	assert.strictEqual(DDModel.arrowColor({ style: { color: '#123456' } }), '#123456');
	// 신규 = 차수색(phaseColor 와 일치) — 1차·2차
	assert.strictEqual(DDModel.arrowColor({ mark: { kind: '신규', phase: 1 } }), DDModel.phaseColor(1));
	assert.strictEqual(DDModel.arrowColor({ mark: { kind: '신규', phase: 2 } }), DDModel.phaseColor(2));
	assert.strictEqual(DDModel.arrowColor({ mark: { kind: '신규' } }), DDModel.phaseColor(1)); // phase 없으면 1차
	// 기존 마킹 = style.color(없으면 보라) 유지 — 신규만 상태색 따라감
	assert.strictEqual(DDModel.arrowColor({ mark: { kind: '기존' }, style: { color: '#7460D9' } }), '#7460D9');
	assert.strictEqual(DDModel.arrowColor({ mark: { kind: '기존' }, style: { color: '#abcdef' } }), '#abcdef');
});

test('anchor: squareFromDrag — 4사분면·지배축(정원 잠금)', () => {
	// 우하(Q4) dx 지배 — side=|dx|
	assert.deepStrictEqual(DDAnchor.squareFromDrag(0, 0, 100, 40), { left: 0, top: 0, width: 100, height: 100 });
	// 우하 dy 지배 — side=|dy|
	assert.deepStrictEqual(DDAnchor.squareFromDrag(0, 0, 30, 80), { left: 0, top: 0, width: 80, height: 80 });
	// 좌상(Q2) — 시작점 기준 좌상 방향으로 정사각형
	assert.deepStrictEqual(DDAnchor.squareFromDrag(100, 100, 40, 30), { left: 30, top: 30, width: 70, height: 70 });
	// 우상(Q1)
	assert.deepStrictEqual(DDAnchor.squareFromDrag(0, 100, 50, 20), { left: 0, top: 20, width: 80, height: 80 });
	// 좌하(Q3)
	assert.deepStrictEqual(DDAnchor.squareFromDrag(100, 0, 20, 50), { left: 20, top: 0, width: 80, height: 80 });
});

test('anchor: resizeRectLocked — 코너·변·최소가드·aspect 유지', () => {
	const sq = { left: 0, top: 0, width: 100, height: 100 }; // aspect 1(정원)
	// se 코너 — NW 고정, dx 지배로 폭·높이 동반 확대
	assert.deepStrictEqual(DDAnchor.resizeRectLocked(sq, 'se', 40, 20), { left: 0, top: 0, width: 140, height: 140 });
	// nw 코너 — SE 고정, 좌상단이 위·왼쪽으로 이동(확대)
	assert.deepStrictEqual(DDAnchor.resizeRectLocked(sq, 'nw', -40, -30), { left: -40, top: -40, width: 140, height: 140 });
	// e 변 — 폭 변경 + 세로 비율 추종, 세로 중심 유지(center=50)
	const e = DDAnchor.resizeRectLocked(sq, 'e', 50, 0);
	assert.strictEqual(e.width, 150);
	assert.strictEqual(e.height, 150);
	assert.strictEqual(e.top + e.height / 2, 50); // 직교축 중심 유지
	assert.strictEqual(e.left, 0);
	// 최소 가드(12px) — 과한 축소도 양축 12 이상
	const min = DDAnchor.resizeRectLocked(sq, 'se', -200, -100);
	assert.strictEqual(min.width, 12);
	assert.strictEqual(min.height, 12);
	// aspect 2:1 유지 — se 코너 dx 지배
	const rect = { left: 0, top: 0, width: 200, height: 100 }; // aspect 2
	const r = DDAnchor.resizeRectLocked(rect, 'se', 100, 10);
	assert.strictEqual(r.width / r.height, 2);
	assert.strictEqual(r.width, 300);
	assert.strictEqual(r.height, 150);
	// aspect 명시 opts 우선
	const a = DDAnchor.resizeRectLocked(sq, 'se', 60, 0, { aspect: 2 });
	assert.strictEqual(a.width / a.height, 2);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
