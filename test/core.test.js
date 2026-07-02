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
	assert.strictEqual(s.ddVersion, 1);
	assert.strictEqual(s.source.kind, 'spec-html');
	assert.deepStrictEqual(s.annotations, []);
	assert.strictEqual(DDModel.createSet('이상한값').source.kind, 'generic');
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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
