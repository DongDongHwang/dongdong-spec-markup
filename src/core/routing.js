// 볼트 라우팅 규칙 엔진 — CmdMD Vault.swift 의 RoutingCondition/RoutingRule 충실 이식.
// 문서를 태그·frontmatter·파일명·기기·내용 조건으로 평가해 대상 폴더로 자동 분류한다.
// 원본의 미묘한 동작을 그대로 보존한다.
//   - 일반 비교는 양쪽 소문자화, regex 는 원문 대상 + case-insensitive 플래그
//   - filenamePrefix/Suffix 는 matchType 을 무시하고 value 로 대소문자 구분 비교 (원본 동일)

'use strict';

const ConditionType = Object.freeze({
	tag: 'Tag',
	frontmatterKey: 'Frontmatter Key',
	filenamePrefix: 'Filename Prefix',
	filenameSuffix: 'Filename Suffix',
	sourceDevice: 'Source Device',
	content: 'Content',
});

const MatchType = Object.freeze({
	equals: 'Equals',
	contains: 'Contains',
	startsWith: 'Starts With',
	endsWith: 'Ends With',
	regex: 'Regex',
});

// 경로 문자열에서 파일명만 (윈도우/유닉스 구분자 모두 처리)
function basename(p) {
	const parts = String(p).split(/[\\/]/);
	return parts[parts.length - 1] || '';
}

// 확장자 제거
function stripExt(name) {
	const i = name.lastIndexOf('.');
	return i > 0 ? name.slice(0, i) : name;
}

// Swift split(separator: ":", maxSplits: 1, omittingEmptySubsequences: true) 흉내.
// 콜론 한 번만 쪼개고, 빈 조각은 버린다. key:value 형태가 아니면 빈 배열에 가깝게 동작.
function splitFirstColon(value) {
	const i = value.indexOf(':');
	if (i === -1) return [value].filter((s) => s.length > 0);
	const left = value.slice(0, i);
	const right = value.slice(i + 1);
	return [left, right].filter((s) => s.length > 0);
}

// 원본 matchValue — expected 가 주어지면 그것을, 아니면 condition.value 를 비교 기준으로.
function matchValue(target, matchType, value, expected) {
	const compareValue = expected !== undefined && expected !== null ? expected : value;
	const t = String(target).toLowerCase();
	const c = String(compareValue).toLowerCase();
	switch (matchType) {
		case MatchType.equals:
			return t === c;
		case MatchType.contains:
			return t.includes(c);
		case MatchType.startsWith:
			return t.startsWith(c);
		case MatchType.endsWith:
			return t.endsWith(c);
		case MatchType.regex:
			try {
				// 원본은 NSRegularExpression(caseInsensitive) 를 원문 target 에 적용
				return new RegExp(String(compareValue), 'i').test(String(target));
			} catch (e) {
				return false;
			}
		default:
			return false;
	}
}

// custom frontmatter 값에서 표시 문자열을 얻는다.
// FrontmatterValue 인스턴스(displayString getter)와 평문 문자열 둘 다 허용.
function displayStringOf(cv) {
	if (cv && typeof cv.displayString === 'string') return cv.displayString;
	if (Array.isArray(cv)) return cv.join(', ');
	return String(cv);
}

// document 형태:
//   { title, content, fileURL(경로 문자열|null), sourceDevice,
//     frontmatter: { tags: [], custom: { key: FrontmatterValue|string } } | null }
function conditionMatches(condition, document) {
	const { type, matchType, value } = condition;
	switch (type) {
		case ConditionType.tag: {
			const tags = (document.frontmatter && document.frontmatter.tags) || [];
			return tags.some((tag) => matchValue(tag, matchType, value));
		}
		case ConditionType.frontmatterKey: {
			const parts = splitFirstColon(value);
			if (parts.length !== 2) return false;
			const key = parts[0];
			const expected = parts[1];
			const custom = document.frontmatter && document.frontmatter.custom;
			if (custom && Object.prototype.hasOwnProperty.call(custom, key)) {
				return matchValue(displayStringOf(custom[key]), matchType, value, expected);
			}
			return false;
		}
		case ConditionType.filenamePrefix: {
			// 원본은 matchType 무시 + 대소문자 구분 hasPrefix(value)
			const target = document.fileURL ? basename(document.fileURL) : document.title || '';
			return target.startsWith(value);
		}
		case ConditionType.filenameSuffix: {
			const name = document.fileURL
				? stripExt(basename(document.fileURL))
				: document.title || '';
			return name.endsWith(value);
		}
		case ConditionType.sourceDevice:
			return matchValue(document.sourceDevice || '', matchType, value);
		case ConditionType.content:
			return matchValue(document.content || '', matchType, value);
		default:
			return false;
	}
}

// 규칙은 활성 상태이고 모든 조건이 AND 로 맞아야 매칭으로 본다.
function ruleMatches(rule, document) {
	if (!rule.isEnabled) return false;
	if (!rule.conditions || rule.conditions.length === 0) return false;
	return rule.conditions.every((c) => conditionMatches(c, document));
}

// 매칭되는 규칙 중 priority 가 가장 높은 것을 고른다 (동률이면 먼저 정의된 것).
// AppState.resolveSendFolder 와의 정확한 동률 처리는 추후 대조 필요.
function resolveRule(rules, document) {
	let best = null;
	for (const rule of rules) {
		if (!ruleMatches(rule, document)) continue;
		if (best === null || rule.priority > best.priority) best = rule;
	}
	return best;
}

module.exports = {
	ConditionType,
	MatchType,
	matchValue,
	conditionMatches,
	ruleMatches,
	resolveRule,
};
