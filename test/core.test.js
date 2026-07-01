// 코어 로직 동작 테스트 — 외부 프레임워크 없이 node 내장 assert 로 돌린다.  실행:  node test/core.test.js
// M1(iframe 뷰어)에는 아직 순수 로직 모듈이 없다(렌더는 Electron/iframe DOM). 순수 코어 테스트는
// M3~M5 에서 신설되는 src/core/{annotation-model,html-io,anchor}.js 를 대상으로 채워진다.
//   - html-io  : embed/extract 왕복 항등(extract(embed(pure,ann))==={pure,ann}) + 멱등(embed(embed(x))===embed(x))
//   - anchor   : element↔coord 비율 변환
//   - annotation-model : 스키마 검증·id 생성
// 아래 test() 하네스를 그대로 재사용한다.

'use strict';

const assert = require('assert');

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

// M1 스모크 — 하네스 자체가 동작하는지 (신규 core 모듈이 붙기 전 골격 유지용).
test('test harness sanity', () => {
	assert.strictEqual(1 + 1, 2);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
