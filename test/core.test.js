// 코어 로직 동작 동일성 테스트 — CmdMD(Swift) 동작을 그대로 옮겼는지 검증한다.
// 외부 테스트 프레임워크 없이 node 내장 assert 로 돌린다.  실행:  node test/core.test.js

'use strict';

const assert = require('assert');
const routing = require('../src/core/routing');
const template = require('../src/core/template');
const fm = require('../src/core/frontmatter');

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

const { ConditionType, MatchType, conditionMatches, resolveRule } = routing;

// ---- 라우팅 매처 -------------------------------------------------------------
test('tag contains 는 대소문자 무시', () => {
	const doc = { frontmatter: { tags: ['Daily', 'Work'], custom: {} }, content: '' };
	const cond = { type: ConditionType.tag, matchType: MatchType.contains, value: 'work' };
	assert.strictEqual(conditionMatches(cond, doc), true);
});

test('frontmatterKey equals (key:value 분리 + 비교)', () => {
	const doc = {
		frontmatter: { tags: [], custom: { status: new fm.FrontmatterValue('string', 'done') } },
		content: '',
	};
	const cond = { type: ConditionType.frontmatterKey, matchType: MatchType.equals, value: 'status:done' };
	assert.strictEqual(conditionMatches(cond, doc), true);
});

test('frontmatterKey 콜론 없으면 매칭 실패', () => {
	const doc = { frontmatter: { tags: [], custom: { status: 'done' } }, content: '' };
	const cond = { type: ConditionType.frontmatterKey, matchType: MatchType.equals, value: 'status' };
	assert.strictEqual(conditionMatches(cond, doc), false);
});

test('filenamePrefix 는 대소문자 구분 + matchType 무시', () => {
	const doc = { fileURL: 'C:/v/CS_2026.md', title: '', content: '' };
	assert.strictEqual(
		conditionMatches({ type: ConditionType.filenamePrefix, matchType: MatchType.contains, value: 'CS_' }, doc),
		true
	);
	// 소문자는 매칭 안 됨 (대소문자 구분 증명)
	assert.strictEqual(
		conditionMatches({ type: ConditionType.filenamePrefix, matchType: MatchType.contains, value: 'cs_' }, doc),
		false
	);
});

test('filenameSuffix 는 확장자 제거 후 비교', () => {
	const doc = { fileURL: 'C:/v/회의록-draft.md', title: '', content: '' };
	const cond = { type: ConditionType.filenameSuffix, matchType: MatchType.equals, value: '-draft' };
	assert.strictEqual(conditionMatches(cond, doc), true);
});

test('content regex 는 원문 대상 + case-insensitive', () => {
	const doc = { content: 'Meeting NOTES here', frontmatter: null };
	const cond = { type: ConditionType.content, matchType: MatchType.regex, value: 'meeting\\s+notes' };
	assert.strictEqual(conditionMatches(cond, doc), true);
});

test('잘못된 regex 는 안전하게 false', () => {
	const doc = { content: 'x', frontmatter: null };
	const cond = { type: ConditionType.content, matchType: MatchType.regex, value: '([' };
	assert.strictEqual(conditionMatches(cond, doc), false);
});

test('resolveRule 은 매칭 규칙 중 priority 최고를 고른다', () => {
	const doc = { content: 'urgent bug', frontmatter: { tags: ['bug'], custom: {} } };
	const rules = [
		{ name: 'low', isEnabled: true, priority: 1, targetFolder: 'Inbox', conditions: [
			{ type: ConditionType.content, matchType: MatchType.contains, value: 'bug' }] },
		{ name: 'high', isEnabled: true, priority: 5, targetFolder: 'Bugs', conditions: [
			{ type: ConditionType.tag, matchType: MatchType.equals, value: 'bug' }] },
		{ name: 'disabled', isEnabled: false, priority: 9, targetFolder: 'X', conditions: [
			{ type: ConditionType.content, matchType: MatchType.contains, value: 'urgent' }] },
	];
	const r = resolveRule(rules, doc);
	assert.strictEqual(r.targetFolder, 'Bugs');
});

test('규칙은 모든 조건이 AND 로 맞아야 함', () => {
	const doc = { content: 'urgent bug', frontmatter: { tags: ['bug'], custom: {} } };
	const rule = { isEnabled: true, priority: 1, conditions: [
		{ type: ConditionType.tag, matchType: MatchType.equals, value: 'bug' },
		{ type: ConditionType.content, matchType: MatchType.contains, value: 'missing' }] };
	assert.strictEqual(routing.ruleMatches(rule, doc), false);
});

// ---- 템플릿 토큰 치환 --------------------------------------------------------
test('substitute 가 title/date 토큰을 치환', () => {
	const d = new Date(2026, 5, 29, 9, 5, 7); // 2026-06-29 09:05:07 로컬
	const out = template.substitute('{{date}} {{title}} {{time}}', '회의록', d);
	assert.strictEqual(out, '2026-06-29 회의록 09:05');
});

test('generateFilename 패턴 비면 {{title}} 폴백', () => {
	const d = new Date(2026, 5, 29);
	assert.strictEqual(template.generateFilename({ filenamePattern: '' }, '메모', d), '메모');
	assert.strictEqual(
		template.generateFilename({ filenamePattern: '{{date}}_{{title}}' }, '메모', d),
		'2026-06-29_메모'
	);
});

test('renderContent 는 {{content}} 자리에 본문 삽입', () => {
	const tpl = { content: '# {{title}}\n\n{{content}}\n\n---' };
	const doc = { title: '제목', content: '본문입니다' };
	assert.strictEqual(template.renderContent(tpl, doc), '# 제목\n\n본문입니다\n\n---');
});

test('renderContent 는 {{content}} 없으면 본문을 끝에 붙임', () => {
	const tpl = { content: '머리말' };
	const doc = { title: 'T', content: '본문' };
	assert.strictEqual(template.renderContent(tpl, doc), '머리말\n\n본문');
});

// ---- frontmatter 타입 보존 (데이터 손실 방지) --------------------------------
test('parse 는 bool 을 bool 로 보존 (1/0 으로 안 뭉갬)', () => {
	const { frontmatter } = fm.parse('---\npublished: true\ndraft: false\n---\n본문\n');
	assert.strictEqual(frontmatter.custom.published.kind, 'bool');
	assert.strictEqual(frontmatter.custom.published.value, true);
	assert.strictEqual(frontmatter.custom.draft.displayString, 'false');
});

test('parse 는 int / list 타입 보존', () => {
	const { frontmatter } = fm.parse('---\norder: 3\nstack:\n  - a\n  - b\n---\n');
	assert.strictEqual(frontmatter.custom.order.kind, 'int');
	assert.strictEqual(frontmatter.custom.order.value, 3);
	assert.deepStrictEqual(frontmatter.custom.stack.value, ['a', 'b']);
});

test('parse 는 알려진 키(title/tags)를 분리', () => {
	const { frontmatter, body } = fm.parse('---\ntitle: 제목\ntags:\n  - x\n---\n\n본문\n');
	assert.strictEqual(frontmatter.title, '제목');
	assert.deepStrictEqual(frontmatter.tags, ['x']);
	assert.strictEqual(body.trim(), '본문');
});

test('toYAML 라운드트립 — bool 이 round-trip 후에도 bool', () => {
	const parsed = fm.parse('---\npublished: true\norder: 2\n---\nbody\n');
	const out = fm.toYAML(parsed.frontmatter);
	const reparsed = fm.parse(out + '\nbody\n');
	assert.strictEqual(reparsed.frontmatter.custom.published.kind, 'bool');
	assert.strictEqual(reparsed.frontmatter.custom.order.kind, 'int');
});

test('toYAML 커스텀 키 정렬 (clean diff)', () => {
	const f = { tags: [], aliases: [], custom: {
		zebra: new fm.FrontmatterValue('string', 'z'),
		alpha: new fm.FrontmatterValue('string', 'a'),
	} };
	const out = fm.toYAML(f);
	assert.ok(out.indexOf('alpha') < out.indexOf('zebra'), '커스텀 키가 정렬되어야 함');
});

test('frontmatter 없는 문서는 본문 그대로', () => {
	const { frontmatter, body } = fm.parse('그냥 본문\n둘째 줄\n');
	assert.strictEqual(frontmatter, null);
	assert.strictEqual(body, '그냥 본문\n둘째 줄\n');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
