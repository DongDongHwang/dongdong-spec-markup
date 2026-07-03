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

	const DD_VERSION = 4;               // v4 — 문서 메타(docMeta: 표지·History·개요·플로우) 도입. v1~v3 은 migrate 로 승격.
	const TOOL_NAME = 'dd-spec-viewer';
	const TYPES = ['pin', 'box'];
	const ANCHOR_MODES = ['element', 'coord'];
	const SOURCE_KINDS = ['spec-html', 'generic'];
	const MARK_KINDS = ['신규', '기존'];  // 사용자가 핀마다 직접 지정. 신규는 차수(phase)로 2·3차 확장.

	// ---- 색 SSOT — 오버레이·저장본 런타임·목록이 공유. "색은 계속 달라야 한다"(동동이) → 차수·그룹 모두 팔레트 순환. ----
	// 차수색 — 신규 1·2·3차…가 서로 다른 색(과거엔 2·3차가 같은 황색이었음). 4차 이상도 팔레트 순환으로 계속 다름.
	const PHASE_PALETTE = ['#18a558', '#D97706', '#0891B2', '#7C3AED', '#DB2777', '#CA8A04', '#0D9488', '#DC2626'];
	const MODIFIED_COLOR = '#E08600';   // 수정(draft 편집)
	const UNCHANGED_COLOR = '#6B7280';  // 기존(회색)
	// 그룹색 — 1-A·1-B 연관 묶음마다 다른 색(부모 id 해시). 렌더러가 "그룹의 일원"인 핀에만 적용.
	const GROUP_PALETTE = ['#7C3AED', '#EA580C', '#0891B2', '#DB2777', '#65A30D', '#2563EB', '#C026D3', '#0D9488'];

	function phaseColor(phase) {
		const p = (typeof phase === 'number' && phase >= 1) ? Math.floor(phase) : 1;
		return PHASE_PALETTE[(p - 1) % PHASE_PALETTE.length];
	}
	// 상태색 — new 는 차수색, modified 주황, unchanged(기존) 회색. 핀 배경·배지·날짜/사유 텍스트가 이 색을 쓴다.
	function statusColor(a) {
		const st = annotStatus(a);
		if (st === 'modified') return MODIFIED_COLOR;
		if (st === 'unchanged') return UNCHANGED_COLOR;
		return phaseColor(a && a.mark && a.mark.phase ? a.mark.phase : 1);
	}
	// 그룹색 — key(부모 id) 해시로 팔레트 인덱스. key 없으면 null(그룹 테두리 없음).
	function groupColorForKey(key) {
		if (!key) return null;
		let h = 0;
		for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
		return GROUP_PALETTE[h % GROUP_PALETTE.length];
	}

	// 주석 id — 'an_' + base36 6자. rng 주입 가능(테스트 재현성).
	function genId(rng) {
		const rand = rng || Math.random;
		let s = '';
		while (s.length < 6) s += Math.floor(rand() * 36).toString(36);
		return 'an_' + s.slice(0, 6);
	}

	// 빈 주석 세트 — source.kind 는 목업 판별 결과('spec-html' | 'generic').
	//   docMeta = 정책부(표지·History·개요·플로우) 스냅샷. null=미추출/없음(generic). 저장 시 목업에서 뽑아 채운다.
	function createSet(sourceKind) {
		return {
			ddVersion: DD_VERSION,
			tool: TOOL_NAME,
			savedAt: '',
			source: { kind: SOURCE_KINDS.includes(sourceKind) ? sourceKind : 'generic' },
			docMeta: null,
			annotations: [],
		};
	}

	// 문서 메타 정규화 — 목업에서 뽑은 raw(OVERVIEW·HISTORY)를 안전한 스키마로 다듬는다(순수 로직·DOM 무관).
	//   내용이 하나도 없으면 null 반환 → 정책부 섹션 생략(generic·OVERVIEW 없는 목업). 있으면 저장본에 캐싱.
	function normalizeDocMeta(raw) {
		if (!raw || typeof raw !== 'object') return null;
		const str = (v) => (v == null ? '' : String(v));
		const ov = raw.overview && typeof raw.overview === 'object' ? raw.overview : {};
		const meta = {
			title: str(raw.title),
			version: str(raw.version),
			history: Array.isArray(raw.history) ? raw.history.map((h) => ({
				no: str(h && h.no), date: str(h && h.date), ver: str(h && h.ver),
				content: str(h && h.content), author: str(h && h.author),
			})) : [],
			overview: { 기능정의: str(ov.기능정의), 추진배경: str(ov.추진배경), 작업범위: str(ov.작업범위) },
			flows: Array.isArray(raw.flows) ? raw.flows.map((f) => ({ id: str(f && f.id), name: str(f && f.name) })) : [],
		};
		const hasOv = meta.overview.기능정의 || meta.overview.추진배경 || meta.overview.작업범위;
		const empty = !meta.title && !meta.version && !meta.history.length && !hasOv && !meta.flows.length;
		return empty ? null : meta;
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
			parentId: p.parentId != null ? String(p.parentId) : null, // 1단계 계층 — 부모 핀 id(자식이면). null=최상위
			anchor: p.anchor || null,   // { mode:'element', elementId, screenId?, offsetPct?, rectPct? }
			coord: p.coord || null,     // { basis:'frame'|'body', x, y, w?, h? }  (mode='coord' 전용)
			style: p.style || { variant: 'solid', color: '#7460D9' },
			body: p.body || { format: 'html', html: '', plain: '' },
			slots: p.slots || null,
			origin: p.origin === 'draft' ? 'draft' : 'manual', // M6 diff — draft(초안 주입) | manual(직접 생성=신규)
			edited: !!p.edited,                                 // draft 를 사람이 손대면 true → '수정'
			mark: p.mark || null,   // 사용자 지정 마킹. null=미지정→origin 자동 폴백.
			                        // { kind:'신규'|'기존', phase:1|2|3|null, addedAt:'YYYY-MM-DD'|null, reason:string }
		};
	}

	// diff 상태 — 사용자 mark 가 있으면 그게 SSOT(신규→new / 기존→unchanged).
	//   mark 미지정이면 origin 자동 폴백 — manual=신규 / draft 편집됨=수정 / draft 그대로=기존.
	//   origin 없는 옛 저장본은 manual 취급(신규) — 하위호환(과거엔 diff 개념 없음).
	function annotStatus(a) {
		if (a && a.mark && a.mark.kind) return a.mark.kind === '신규' ? 'new' : 'unchanged';
		if (!a || a.origin !== 'draft') return 'new';
		return a.edited ? 'modified' : 'unchanged';
	}

	// 배지 표시용 — { status, label, tooltip }. 신규 2·3차는 차수 병기, 툴팁은 날짜·사유.
	function annotBadge(a) {
		const status = annotStatus(a);
		const mark = a && a.mark;
		let label;
		if (status === 'new') {
			const phase = mark && mark.phase ? mark.phase : 1;
			label = phase >= 2 ? `신규·${phase}차` : '신규';
		} else if (status === 'modified') {
			label = '수정';
		} else {
			label = '기존';
		}
		const parts = [];
		if (mark && mark.addedAt) parts.push(mark.addedAt);
		if (mark && mark.reason) parts.push(mark.reason);
		return { status, label, tooltip: parts.join(' · ') };
	}

	// 저장본 로드 시 스키마 승격 — v1(마킹 없음)·v2(계층 없음)·v3(docMeta 없음) → v4. 데이터 손실 없음.
	//   parentId·docMeta 키가 없는 옛 세트는 렌더가 옵셔널로 읽어 그대로 동작 — 버전 올리고 docMeta 는 null 로 채운다.
	function migrate(set) {
		if (!set || typeof set !== 'object') return set;
		if (typeof set.ddVersion === 'number' && set.ddVersion < DD_VERSION) set.ddVersion = DD_VERSION;
		if (!('docMeta' in set)) set.docMeta = null;
		// generic 오저장 복구 — screenId 에 CSS 셀렉터(#·. 시작)가 든 건 옛 tagScreen 버그(generic 화면을 screenId 로 저장).
		//   화면 넘김 게이팅이 깨지므로 screenSel 로 이동. spec-html screenId(S1·LGN-001 등)는 영향 없음.
		if (Array.isArray(set.annotations)) {
			for (const a of set.annotations) {
				const an = a && a.anchor;
				if (an && typeof an.screenId === 'string' && /^[#.]/.test(an.screenId)) {
					if (!an.screenSel) an.screenSel = an.screenId;
					delete an.screenId;
				}
			}
		}
		return set;
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
		if (a.parentId != null && typeof a.parentId !== 'string') errs.push(`${at}.parentId: 문자열|null 이어야 함`);
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
		if (a.mark != null) { // 있을 때만 형태 검증(미지정 null 은 통과)
			if (typeof a.mark !== 'object') errs.push(`${at}.mark: 객체여야 함`);
			else {
				if (a.mark.kind != null && !MARK_KINDS.includes(a.mark.kind)) errs.push(`${at}.mark.kind: ${MARK_KINDS.join('|')} 중 하나`);
				if (a.mark.phase != null && ![1, 2, 3].includes(a.mark.phase)) errs.push(`${at}.mark.phase: 1|2|3`);
				if (a.mark.addedAt != null && typeof a.mark.addedAt !== 'string') errs.push(`${at}.mark.addedAt: 문자열`);
				if (a.mark.reason != null && typeof a.mark.reason !== 'string') errs.push(`${at}.mark.reason: 문자열`);
			}
		}
		return errs;
	}

	// 세트 전체 검증 — { ok, errors }.
	function validateSet(set) {
		const errs = [];
		if (!set || typeof set !== 'object') return { ok: false, errors: ['세트가 객체가 아님'] };
		if (!(set.ddVersion >= 1 && set.ddVersion <= DD_VERSION)) errs.push(`ddVersion: 1~${DD_VERSION} 이어야 함 (현재 ${set.ddVersion})`); // v1 저장본 수용 → migrate 로 승격
		if (set.docMeta != null && typeof set.docMeta !== 'object') errs.push('docMeta: 객체|null 이어야 함'); // 정책부 스냅샷(옵셔널)
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

	return { DD_VERSION, TOOL_NAME, TYPES, ANCHOR_MODES, MARK_KINDS, PHASE_PALETTE, GROUP_PALETTE, genId, createSet, createAnnotation, normalizeDocMeta, validateAnnotation, validateSet, annotStatus, annotBadge, phaseColor, statusColor, groupColorForKey, migrate };
});
