// 주석 데이터 모델 — Annotation 스키마 생성·검증·id 생성 (순수 로직, DOM 무관).
//   문서 1개당 주석 세트 하나. 좌표는 전부 0~1 비율(반응형·줌에 견딤).
//   스키마 정본 = 볼트 ROADMAP §주석 데이터 모델. 렌더러(overlay.js)와 저장(html-io.js)이 공유한다.
// UMD — node 테스트(require)와 브라우저 스크립트 태그(window.DDModel) 양쪽에서 쓴다.

(function (root, factory) {
	'use strict';
	if (typeof module !== 'undefined' && module.exports) module.exports = factory();
	else root.DDModel = factory();
})(typeof self !== 'undefined' ? self : this, function () {
	'use strict';

	const DD_VERSION = 1;
	const TOOL_NAME = 'dd-spec-viewer';
	const TYPES = ['pin', 'box'];
	const ANCHOR_MODES = ['element', 'coord'];
	const SOURCE_KINDS = ['spec-html', 'generic'];

	// 주석 id — 'an_' + base36 6자. rng 주입 가능(테스트 재현성).
	function genId(rng) {
		const rand = rng || Math.random;
		let s = '';
		while (s.length < 6) s += Math.floor(rand() * 36).toString(36);
		return 'an_' + s.slice(0, 6);
	}

	// 빈 주석 세트 — source.kind 는 목업 판별 결과('spec-html' | 'generic').
	function createSet(sourceKind) {
		return {
			ddVersion: DD_VERSION,
			tool: TOOL_NAME,
			savedAt: '',
			source: { kind: SOURCE_KINDS.includes(sourceKind) ? sourceKind : 'generic' },
			annotations: [],
		};
	}

	// 주석 1건 — props 로 부분 지정, 나머지는 기본값. anchor/coord 는 호출자가 채운다.
	function createAnnotation(props, rng) {
		const p = props || {};
		return {
			id: p.id || genId(rng),
			type: TYPES.includes(p.type) ? p.type : 'pin',
			seq: typeof p.seq === 'number' ? p.seq : 1,
			label: p.label != null ? String(p.label) : '1',
			autoNumber: p.autoNumber !== false,
			anchor: p.anchor || null,   // { mode:'element', elementId, screenId?, offsetPct?, rectPct? }
			coord: p.coord || null,     // { basis:'frame'|'body', x, y, w?, h? }  (mode='coord' 전용)
			style: p.style || { variant: 'solid', color: '#7460D9' },
			body: p.body || { format: 'html', html: '', plain: '' },
			slots: p.slots || null,
			origin: p.origin === 'draft' ? 'draft' : 'manual', // M6 diff — draft(초안 주입) | manual(직접 생성=신규)
			edited: !!p.edited,                                 // draft 를 사람이 손대면 true → '수정'
		};
	}

	// diff 상태 — manual(직접 찍음)=신규 / draft 편집됨=수정 / draft 그대로=기존. 목록·핀·저장본 배지에 공용.
	//   origin 없는 옛 저장본은 manual 취급(신규) — 하위호환(과거엔 diff 개념 없음).
	function annotStatus(a) {
		if (!a || a.origin !== 'draft') return 'new';
		return a.edited ? 'modified' : 'unchanged';
	}

	function isRatio(n) { return typeof n === 'number' && isFinite(n) && n >= -0.5 && n <= 1.5; } // 요소 내 비율(경계 살짝 벗어남 허용)
	// coord 위치 비율 — 프레임 여백(밖)에 찍은 핀은 0~1 밖으로 나갈 수 있어 넉넉히 허용(유한값·과도한 이탈만 차단).
	function isPosRatio(n) { return typeof n === 'number' && isFinite(n) && n >= -5 && n <= 5; }

	// 주석 1건 검증 — 오류 문자열 배열 반환(비면 통과).
	function validateAnnotation(a, i) {
		const errs = [];
		const at = `annotations[${i}]`;
		if (!a || typeof a !== 'object') return [`${at}: 객체가 아님`];
		if (typeof a.id !== 'string' || !a.id) errs.push(`${at}.id: 필수 문자열`);
		if (!TYPES.includes(a.type)) errs.push(`${at}.type: ${TYPES.join('|')} 중 하나여야 함`);
		if (typeof a.seq !== 'number') errs.push(`${at}.seq: 숫자 필수`);
		if (typeof a.label !== 'string') errs.push(`${at}.label: 문자열 필수`);
		const mode = a.anchor && a.anchor.mode;
		if (!ANCHOR_MODES.includes(mode)) {
			errs.push(`${at}.anchor.mode: ${ANCHOR_MODES.join('|')} 중 하나여야 함`);
			return errs;
		}
		if (mode === 'element') {
			if (typeof a.anchor.elementId !== 'string' || !a.anchor.elementId) errs.push(`${at}.anchor.elementId: element 모드 필수`);
			if (a.anchor.offsetPct && !(isRatio(a.anchor.offsetPct.dx) && isRatio(a.anchor.offsetPct.dy))) errs.push(`${at}.anchor.offsetPct: dx/dy 비율이어야 함`);
			if (a.anchor.rectPct && !(isRatio(a.anchor.rectPct.x) && isRatio(a.anchor.rectPct.y) && isRatio(a.anchor.rectPct.w) && isRatio(a.anchor.rectPct.h))) errs.push(`${at}.anchor.rectPct: x/y/w/h 비율이어야 함`);
		} else { // coord
			const c = a.coord;
			if (!c || !isPosRatio(c.x) || !isPosRatio(c.y)) errs.push(`${at}.coord: coord 모드는 x/y 비율 필수`);
			else if (a.type === 'box' && !(isRatio(c.w) && isRatio(c.h))) errs.push(`${at}.coord: box 는 w/h 비율 필수`);
		}
		return errs;
	}

	// 세트 전체 검증 — { ok, errors }.
	function validateSet(set) {
		const errs = [];
		if (!set || typeof set !== 'object') return { ok: false, errors: ['세트가 객체가 아님'] };
		if (set.ddVersion !== DD_VERSION) errs.push(`ddVersion: ${DD_VERSION} 이어야 함 (현재 ${set.ddVersion})`);
		if (!Array.isArray(set.annotations)) errs.push('annotations: 배열 필수');
		else {
			const seen = new Set();
			set.annotations.forEach((a, i) => {
				errs.push(...validateAnnotation(a, i));
				if (a && a.id) {
					if (seen.has(a.id)) errs.push(`annotations[${i}].id: 중복 (${a.id})`);
					seen.add(a.id);
				}
			});
		}
		return { ok: errs.length === 0, errors: errs };
	}

	return { DD_VERSION, TOOL_NAME, TYPES, ANCHOR_MODES, genId, createSet, createAnnotation, validateAnnotation, validateSet, annotStatus };
});
