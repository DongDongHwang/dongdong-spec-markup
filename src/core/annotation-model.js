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

	const DD_VERSION = 6;               // v6 — 화면 플로우맵(flowMap: 화면 노드 + goScreen 간선). v5=커넥터·v4=docMeta. v1~v5 는 migrate 로 승격.
	const TOOL_NAME = 'dd-spec-viewer';
	const TYPES = ['pin', 'box', 'text', 'arrow']; // text·arrow = 번호 없는 캔버스 요소(시퀀스·계층 제외). arrow = 두 끝점(anchor+anchor2)
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
			flowMap: null,   // 화면 플로우맵(노드+간선). null=미생성/없음(generic·화면개념 없음). 문서 뷰 앞 페이지에 렌더.
			annotations: [],
		};
	}

	// ---- 화면 플로우맵 (v6) — 문서 뷰 앞 페이지의 화면 흐름도. 자동 초안 + 사람 확정 편집(복사-편집 모델). ----
	//   nodes = 화면명 박스(canvas 0~1 비율 좌상단 x,y). edges = goScreen 간선(from/to = 노드 id, label = 조건).
	//   좌표는 화면과 무관한 독립 캔버스 비율(반응형·줌 견딤). 목업 재생성에도 flowMap 은 세트에 보존(불변).
	function genFlowId(prefix, rng) {
		const rand = rng || Math.random;
		let s = '';
		while (s.length < 6) s += Math.floor(rand() * 36).toString(36);
		return (prefix || 'fn') + '_' + s.slice(0, 6);
	}

	// 플로우 노드 1건 — screenId 로 화면과 연결(라벨은 화면명 스냅샷). x,y = 캔버스 비율 좌상단.
	function createFlowNode(props, rng) {
		const p = props || {};
		return {
			id: p.id || genFlowId('fn', rng),
			screenId: p.screenId != null ? String(p.screenId) : null, // 대응 화면(있으면). null=자유 노드
			label: p.label != null ? String(p.label) : '',
			x: typeof p.x === 'number' ? p.x : 0,
			y: typeof p.y === 'number' ? p.y : 0,
		};
	}
	// 플로우 간선 1건 — from/to = 노드 id. label = 조건("로그인 시" 등). origin: draft(초안 파싱) | manual(직접).
	function createFlowEdge(props, rng) {
		const p = props || {};
		return {
			id: p.id || genFlowId('fe', rng),
			from: p.from != null ? String(p.from) : null,
			to: p.to != null ? String(p.to) : null,
			label: p.label != null ? String(p.label) : '',
			origin: p.origin === 'manual' ? 'manual' : 'draft',
		};
	}

	// 화면 목록 → 노드 그리드 자동 배치(초안). screens = [{id,name}]. cols 열로 균등 배치(캔버스 0~1 비율).
	//   자동 초안일 뿐 — 이후 사람이 드래그로 확정(복사-편집). 빈 목록이면 빈 배열.
	function layoutFlowNodes(screens, opts) {
		const list = Array.isArray(screens) ? screens.filter((s) => s && s.id) : [];
		if (!list.length) return [];
		const o = opts || {};
		const cols = o.cols && o.cols > 0 ? o.cols : Math.min(3, list.length); // 기본 최대 3열
		const rows = Math.ceil(list.length / cols);
		// 셀 중앙에 배치되도록 여백(마진) 준 균등 그리드. 노드 좌상단 기준이라 셀폭의 일부를 뺀 위치.
		const marginX = 0.06, marginY = 0.06;
		const cellW = (1 - marginX * 2) / cols;
		const cellH = rows > 0 ? (1 - marginY * 2) / rows : 0;
		return list.map((s, i) => {
			const col = i % cols, row = Math.floor(i / cols);
			return createFlowNode({
				screenId: s.id,
				label: s.name || s.id,
				x: +(marginX + col * cellW + cellW * 0.12).toFixed(4),
				y: +(marginY + row * cellH + cellH * 0.15).toFixed(4),
			}, o.rng);
		});
	}

	// 초안 플로우맵 조립 — 화면 목록으로 노드 그리드 + (파싱된) 간선. edges 는 호출자(DOM 파서)가 넘긴 [{from:screenId,to:screenId,label}].
	//   edges 의 screenId 쌍을 노드 id 로 매핑(양끝 다 노드가 있을 때만 채택). 파싱 못 하면 노드만(사람이 간선 그림).
	function buildFlowDraft(screens, screenEdges, opts) {
		const nodes = layoutFlowNodes(screens, opts);
		const byScreen = {};
		for (const n of nodes) if (n.screenId) byScreen[n.screenId] = n.id;
		const edges = [];
		const seen = {};
		if (Array.isArray(screenEdges)) {
			for (const e of screenEdges) {
				if (!e || e.from == null || e.to == null) continue;
				const f = byScreen[String(e.from)], t = byScreen[String(e.to)];
				if (!f || !t || f === t) continue; // 양끝 노드 있고 자기연결 아님
				const key = f + '>' + t + '|' + (e.label || '');
				if (seen[key]) continue; // 같은 from>to+라벨 중복 제거
				seen[key] = 1;
				edges.push(createFlowEdge({ from: f, to: t, label: e.label != null ? String(e.label) : '', origin: 'draft' }, opts && opts.rng));
			}
		}
		return { nodes, edges };
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
		const type = TYPES.includes(p.type) ? p.type : 'pin';
		const noNum = type === 'text' || type === 'arrow'; // 번호 없음(label 기본 ''·autoNumber false)
		return {
			id: p.id || genId(rng),
			type,
			seq: typeof p.seq === 'number' ? p.seq : 1,
			label: p.label != null ? String(p.label) : (noNum ? '' : '1'),
			autoNumber: noNum ? false : (p.autoNumber !== false),
			parentId: p.parentId != null ? String(p.parentId) : null, // 1단계 계층 — 부모 핀 id(자식이면). null=최상위
			anchor: p.anchor || null,   // { mode:'element', elementId, screenId?, offsetPct?, rectPct? }
			coord: p.coord || null,     // { basis:'frame'|'body', x, y, w?, h? }  (mode='coord' 전용)
			anchor2: p.anchor2 || null, // 화살표 끝점 앵커(arrow 전용) — start=anchor, end=anchor2
			coord2: p.coord2 || null,   // 화살표 끝점 coord(arrow + end 가 coord 모드)
			// 커넥터(Phase 4, arrow 전용) — 끝점이 다른 주석(핀·박스·텍스트)에 스냅되면 그 id.
			//   from=시작점, to=끝점. null=자유 끝점(anchor/coord 가 위치 소유). 연결되면 렌더는 대상 노드를 따라간다.
			//   anchor/coord 는 연결 중에도 폴백으로 유지 — 대상 삭제 시 마지막 자유 위치로 자가 복귀.
			connect: (type === 'arrow' && p.connect) ? { from: p.connect.from || null, to: p.connect.to || null } : null,
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
		if (!('flowMap' in set)) set.flowMap = null; // v5 이하 저장본엔 flowMap 키 없음 → null 로 채움(옵셔널)
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
		if (a.type === 'arrow') { // 끝점(anchor2) — 시작점과 같은 포인트 앵커(element|coord)
			const m2 = a.anchor2 && a.anchor2.mode;
			if (!ANCHOR_MODES.includes(m2)) errs.push(`${at}.anchor2.mode: ${ANCHOR_MODES.join('|')} 필수(arrow 끝점)`);
			else if (m2 === 'element') { if (typeof a.anchor2.elementId !== 'string' || !a.anchor2.elementId) errs.push(`${at}.anchor2.elementId: element 끝점 필수`); }
			else { const c2 = a.coord2; if (!c2 || !isPosRatio(c2.x) || !isPosRatio(c2.y)) errs.push(`${at}.coord2: coord 끝점 x/y 비율 필수`); }
			if (a.connect != null) { // 커넥터 — 있을 때만 형태 검증(옵셔널). from/to = 주석 id 문자열|null.
				if (typeof a.connect !== 'object') errs.push(`${at}.connect: 객체|null 이어야 함`);
				else {
					if (a.connect.from != null && typeof a.connect.from !== 'string') errs.push(`${at}.connect.from: 문자열|null`);
					if (a.connect.to != null && typeof a.connect.to !== 'string') errs.push(`${at}.connect.to: 문자열|null`);
				}
			}
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

	// 플로우맵 검증 — 오류 문자열 배열(비면 통과). null 은 통과(옵셔널). 간선 from/to 는 실재 노드 id 여야.
	function validateFlowMap(fm) {
		if (fm == null) return [];
		if (typeof fm !== 'object') return ['flowMap: 객체|null 이어야 함'];
		const errs = [];
		if (!Array.isArray(fm.nodes)) errs.push('flowMap.nodes: 배열 필수');
		if (!Array.isArray(fm.edges)) errs.push('flowMap.edges: 배열 필수');
		const ids = new Set();
		if (Array.isArray(fm.nodes)) {
			fm.nodes.forEach((n, i) => {
				if (!n || typeof n !== 'object') { errs.push(`flowMap.nodes[${i}]: 객체가 아님`); return; }
				if (typeof n.id !== 'string' || !n.id) errs.push(`flowMap.nodes[${i}].id: 필수 문자열`);
				else { if (ids.has(n.id)) errs.push(`flowMap.nodes[${i}].id: 중복 (${n.id})`); ids.add(n.id); }
				if (typeof n.x !== 'number' || typeof n.y !== 'number') errs.push(`flowMap.nodes[${i}]: x/y 숫자 필수`);
			});
		}
		if (Array.isArray(fm.edges)) {
			fm.edges.forEach((e, i) => {
				if (!e || typeof e !== 'object') { errs.push(`flowMap.edges[${i}]: 객체가 아님`); return; }
				if (typeof e.id !== 'string' || !e.id) errs.push(`flowMap.edges[${i}].id: 필수 문자열`);
				if (!e.from || !ids.has(e.from)) errs.push(`flowMap.edges[${i}].from: 실재 노드 id 여야 함`);
				if (!e.to || !ids.has(e.to)) errs.push(`flowMap.edges[${i}].to: 실재 노드 id 여야 함`);
			});
		}
		return errs;
	}

	// 세트 전체 검증 — { ok, errors }.
	function validateSet(set) {
		const errs = [];
		if (!set || typeof set !== 'object') return { ok: false, errors: ['세트가 객체가 아님'] };
		if (!(set.ddVersion >= 1 && set.ddVersion <= DD_VERSION)) errs.push(`ddVersion: 1~${DD_VERSION} 이어야 함 (현재 ${set.ddVersion})`); // v1 저장본 수용 → migrate 로 승격
		if (set.docMeta != null && typeof set.docMeta !== 'object') errs.push('docMeta: 객체|null 이어야 함'); // 정책부 스냅샷(옵셔널)
		errs.push(...validateFlowMap(set.flowMap)); // 플로우맵(옵셔널)
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

	return { DD_VERSION, TOOL_NAME, TYPES, ANCHOR_MODES, MARK_KINDS, PHASE_PALETTE, GROUP_PALETTE, genId, createSet, createAnnotation, normalizeDocMeta, validateAnnotation, validateSet, annotStatus, annotBadge, phaseColor, statusColor, groupColorForKey, migrate, genFlowId, createFlowNode, createFlowEdge, layoutFlowNodes, buildFlowDraft, validateFlowMap };
});
