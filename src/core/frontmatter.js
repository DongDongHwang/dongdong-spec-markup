// Frontmatter 파서/직렬화 — CmdMD Document.swift 의 FrontmatterValue/Frontmatter 충실 이식.
// 핵심은 타입 보존. bool 을 int 보다 먼저 판정해 true/false 가 1/0 으로 뭉개지는
// Obsidian 커스텀 키 데이터 손실 버그를 막는다. 알려진 키는 고정 순서, 커스텀 키는 정렬.

'use strict';

const yaml = require('js-yaml');

// YAML 스칼라/시퀀스의 원래 타입을 보존하는 값 객체.
class FrontmatterValue {
	constructor(kind, value) {
		this.kind = kind; // 'string' | 'int' | 'double' | 'bool' | 'list'
		this.value = value;
	}

	// js-yaml.load 결과로부터 생성. bool 을 number 보다 먼저 검사 (원본 동일).
	static fromYaml(value) {
		if (typeof value === 'boolean') return new FrontmatterValue('bool', value);
		if (typeof value === 'number') {
			return Number.isInteger(value)
				? new FrontmatterValue('int', value)
				: new FrontmatterValue('double', value);
		}
		if (Array.isArray(value)) {
			return new FrontmatterValue('list', value.map((v) => String(v)));
		}
		if (typeof value === 'string') return new FrontmatterValue('string', value);
		return new FrontmatterValue('string', String(value));
	}

	// Properties 편집기에서 쓰는 사람이 읽는 형태
	get displayString() {
		switch (this.kind) {
			case 'bool':
				return this.value ? 'true' : 'false';
			case 'list':
				return this.value.join(', ');
			default:
				return String(this.value);
		}
	}

	// js-yaml.dump 에 넘길 네이티브 값 (올바른 YAML 스칼라/시퀀스로 직렬화되도록)
	get yamlValue() {
		return this.value;
	}
}

// 알려진 키 집합 — 나머지는 custom 으로 들어간다.
const KNOWN_KEYS = new Set(['title', 'date', 'tags', 'aliases', 'cssclass']);

// 텍스트에서 frontmatter 블록을 분리하고 본문만 남긴다.
// 선행 BOM, 닫는 '...' 펜스, '---' 뒤 공백을 관대하게 처리 (원본 FileService 동일).
function parse(text) {
	let src = text;
	if (src.charCodeAt(0) === 0xfeff) src = src.slice(1); // BOM 제거

	const fence = /^---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;
	const m = src.match(fence);
	if (!m) {
		return { frontmatter: null, body: src };
	}

	const yamlText = m[1];
	const body = src.slice(m[0].length);

	let raw;
	try {
		raw = yaml.load(yamlText);
	} catch (e) {
		// YAML 깨지면 frontmatter 없는 것으로 간주 (전체 블록 유실 방지)
		return { frontmatter: null, body: src };
	}
	if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
		return { frontmatter: null, body: src };
	}

	const fm = {
		title: undefined,
		date: undefined,
		tags: [],
		aliases: [],
		cssclass: undefined,
		custom: {},
	};

	for (const [key, value] of Object.entries(raw)) {
		switch (key) {
			case 'title':
				fm.title = value === null || value === undefined ? undefined : String(value);
				break;
			case 'date':
				fm.date = value; // 표시/저장 시 그대로 다룸
				break;
			case 'tags':
				fm.tags = toStringArray(value);
				break;
			case 'aliases':
				fm.aliases = toStringArray(value);
				break;
			case 'cssclass':
				fm.cssclass = value === null || value === undefined ? undefined : String(value);
				break;
			default:
				fm.custom[key] = FrontmatterValue.fromYaml(value);
		}
	}

	return { frontmatter: fm, body };
}

function toStringArray(value) {
	if (Array.isArray(value)) return value.map((v) => String(v));
	if (value === null || value === undefined) return [];
	return [String(value)];
}

// frontmatter 객체 -> '---' 구분 YAML 블록. 알려진 키 우선, 커스텀 키 정렬 (clean diff).
// 각 항목을 개별 dump 해서 키 순서를 결정론적으로 통제 (원본 동일 전략).
function toYAML(fm) {
	if (!fm) return '';
	const entries = [];
	if (fm.title) entries.push(['title', fm.title]);
	if (fm.date) entries.push(['date', dateToISODate(fm.date)]);
	if (fm.tags && fm.tags.length) entries.push(['tags', fm.tags]);
	if (fm.aliases && fm.aliases.length) entries.push(['aliases', fm.aliases]);
	if (fm.cssclass) entries.push(['cssclass', fm.cssclass]);

	const customKeys = Object.keys(fm.custom || {}).sort();
	for (const key of customKeys) {
		const v = fm.custom[key];
		entries.push([key, v instanceof FrontmatterValue ? v.yamlValue : v]);
	}

	if (entries.length === 0) return '';

	let body = '';
	for (const [key, value] of entries) {
		body += yaml.dump({ [key]: value }, { lineWidth: -1 });
	}
	const trimmed = body.endsWith('\n') ? body.slice(0, -1) : body;
	return `---\n${trimmed}\n---`;
}

// Date 또는 'YYYY-MM-DD' 문자열 -> 'YYYY-MM-DD'
function dateToISODate(date) {
	if (date instanceof Date) {
		const p = (n) => String(n).padStart(2, '0');
		return `${date.getUTCFullYear()}-${p(date.getUTCMonth() + 1)}-${p(date.getUTCDate())}`;
	}
	return String(date);
}

// 본문(body) + frontmatter 를 합친 디스크 표현. content 가 '---' 로 시작해도
// frontmatter 를 누락시키지 않는다 (원본 fullText 의 의도 보존).
function fullText(fm, body) {
	const ytext = toYAML(fm);
	if (!ytext) return body;
	return `${ytext}\n\n${body}`;
}

module.exports = { FrontmatterValue, parse, toYAML, fullText, KNOWN_KEYS };
