// 오버레이 — 목업 iframe "문서 내부"에 #dd-overlay-root 를 주입해 핀·박스를 렌더한다 (M2 읽기 + M3 편집).
//   같은 좌표계·스크롤·resize 이벤트 안에 살므로 좌표 이중화가 없다. sandbox 미사용 전제(same-origin).
//   원칙 = 저장은 비율/논리키(annotation), 렌더는 실시간 재계산 — element 모드는 매 layout 마다
//   요소 rect 를 다시 읽어 리사이즈·화면전환·조건분기 재배치에도 따라간다. 해석 불가(다른 화면·display:none)
//   주석은 숨은 트레이에 보존했다가 요소가 돌아오면 복귀한다.
//   M3 편집 모드 — 목업 클릭 = 핀(앵커 mode 자동판정) / 드래그 = 박스 / 핀·박스 드래그 = 이동(재앵커) /
//   클릭 = 선택 / Delete = 삭제 요청. 편집 중엔 목업 자체 인터랙션(goScreen 등)을 캡처 단계에서 차단해
//   "버튼을 찍으려다 화면이 넘어가는" 오동작을 막는다(화면 이동은 읽기 모드에서).
// 의존 — window.DDAnchor·DDModel·DDNumbering (core, index.html 에서 먼저 로드).

'use strict';

const DDOverlay = (() => {
	const ROOT_ID = 'dd-overlay-root';
	const STYLE_ID = 'dd-overlay-style';
	const DRAG_MIN = 5; // px — 이 미만 이동은 클릭으로 본다

	// 오버레이 CSS — 전부 dd- prefix (목업 무오염). M5 저장 런타임에서도 그대로 재사용할 수 있게 한 덩어리로 유지.
	const OVERLAY_CSS = `
#${ROOT_ID} { position: absolute; left: 0; top: 0; width: 0; height: 0; overflow: visible; z-index: 99990; pointer-events: none; }
#${ROOT_ID} .dd-pin {
	position: absolute; transform: translate(-50%, -50%);
	min-width: 22px; height: 22px; padding: 0 5px; box-sizing: border-box;
	display: flex; align-items: center; justify-content: center; white-space: nowrap;
	background: #7460D9; color: #fff; border: 2px solid #fff; border-radius: 999px;
	font: 700 11px/1 Pretendard, -apple-system, sans-serif;
	box-shadow: 0 1px 4px rgba(0,0,0,.35); pointer-events: auto; cursor: default; user-select: none;
}
#${ROOT_ID} .dd-box { position: absolute; border: 2px dashed #7460D9; border-radius: 4px; background: rgba(116,96,217,.06); }
#${ROOT_ID} .dd-box .dd-box-label {
	position: absolute; left: -2px; top: -22px; min-width: 20px; height: 18px; padding: 0 5px; box-sizing: border-box;
	display: inline-flex; align-items: center; justify-content: center;
	background: #7460D9; color: #fff; border-radius: 4px 4px 4px 0;
	font: 700 10px/1 Pretendard, -apple-system, sans-serif; pointer-events: auto; user-select: none;
}
#${ROOT_ID} .dd-selected { outline: 3px solid rgba(116,96,217,.45); outline-offset: 2px; }
#${ROOT_ID} .dd-pin.dd-st-new { background: #18a558; }
#${ROOT_ID} .dd-pin.dd-st-modified { background: #E08600; }
#${ROOT_ID} .dd-box.dd-st-new { border-color: #18a558; }
#${ROOT_ID} .dd-box.dd-st-modified { border-color: #E08600; }
#${ROOT_ID} .dd-box.dd-st-new .dd-box-label { background: #18a558; }
#${ROOT_ID} .dd-box.dd-st-modified .dd-box-label { background: #E08600; }
/* 신규 2·3차 — 볼트 phase.css 황색 언어(#D97706). dd-st-new 뒤에 둬 우선. */
#${ROOT_ID} .dd-pin.dd-ph { background: #D97706; }
#${ROOT_ID} .dd-box.dd-ph { border-color: #D97706; }
#${ROOT_ID} .dd-box.dd-ph .dd-box-label { background: #D97706; }
#${ROOT_ID} .dd-phase-badge {
	position: absolute; top: -8px; right: -8px;
	min-width: 15px; height: 15px; padding: 0 3px; box-sizing: border-box;
	display: flex; align-items: center; justify-content: center;
	background: #D97706; color: #fff; border: 1.5px solid #fff; border-radius: 999px;
	font: 700 8px/1 Pretendard, -apple-system, sans-serif; pointer-events: none;
}
#${ROOT_ID} .dd-date-cap {
	position: absolute; left: 50%; top: calc(100% + 3px); transform: translateX(-50%);
	white-space: nowrap; font: 600 9px/1 Pretendard, -apple-system, sans-serif; pointer-events: none;
	text-shadow: 0 0 3px #fff, 0 0 3px #fff, 0 0 3px #fff;
}
#${ROOT_ID} .dd-rubber { position: absolute; border: 2px dashed #7460D9; background: rgba(116,96,217,.10); pointer-events: none; }
#${ROOT_ID}.dd-editing .dd-pin, #${ROOT_ID}.dd-editing .dd-box, #${ROOT_ID}.dd-editing .dd-box-label { cursor: move; }
#${ROOT_ID}:not(.dd-editing) .dd-pin, #${ROOT_ID}:not(.dd-editing) .dd-box-label { cursor: pointer; } /* 읽기 모드 = 클릭해 설명 보기 */
/* 드래그 중 앵커 예측 — 요소에 붙음(초록·따라감) / 좌표에 고정(회색 점선) */
#${ROOT_ID}.dd-editing .dd-will-element { outline: 3px solid rgba(24,165,88,.75); outline-offset: 3px; }
#${ROOT_ID}.dd-editing .dd-will-coord { outline: 3px dashed rgba(107,114,128,.85); outline-offset: 3px; }
/* 캔버스 텍스트(B 1단계) — 번호 없는 텍스트 박스. 좌상단 앵커(transform none). */
#${ROOT_ID} .dd-text {
	position: absolute; transform: none; max-width: 240px; padding: 4px 8px; box-sizing: border-box;
	background: rgba(255,255,255,.94); color: #1f2328; border: 1px solid #7460D9; border-radius: 6px;
	font: 600 12px/1.45 Pretendard, -apple-system, sans-serif; box-shadow: 0 1px 4px rgba(0,0,0,.2);
	white-space: pre-wrap; word-break: break-word; pointer-events: auto; cursor: default; user-select: none;
}
#${ROOT_ID}.dd-editing .dd-text { cursor: move; }
#${ROOT_ID}:not(.dd-editing) .dd-text { cursor: pointer; }
body:has(#${ROOT_ID}.dd-tool-text) { cursor: text !important; }
#${ROOT_ID}.dd-editing .dd-box { pointer-events: auto; }
body:has(#${ROOT_ID}.dd-editing) { cursor: crosshair !important; }
.dd-tray {
	position: fixed; right: 10px; bottom: 10px; z-index: 99991;
	max-width: 240px; padding: 6px 10px; background: rgba(26,29,35,.88); color: #cbd5e1;
	border-radius: 8px; font: 500 11px/1.5 Pretendard, -apple-system, sans-serif; pointer-events: none;
}
.dd-tray b { color: #fff; }
.dd-tray .dd-tray-chip { pointer-events: auto; cursor: pointer; text-decoration: underline; color: #fff; } /* 트레이 배경은 클릭 통과, 칩만 클릭 가능 */
.dd-tray .dd-tray-chip:hover { color: #a5b4fc; }
/* 문서 뷰 — 목업 자체 우측 화면정보(#description: 요약·화면 전환·사용법)를 숨겨 dd 설명 표와 중복 제거.
   spec-html 전용 id 라 generic 목업엔 무효(무해). area-rail·el-pin·매핑은 body.clean 이 담당. */
body.dd-docview #description { display: none !important; }
/* 목업 자체 좌측 화면목록(#screen-nav)은 dd 좌측 화면 네비가 대체 — clean 일 때 숨김(화면 1급화). */
body.clean #screen-nav { display: none !important; }
`;

	// element 모드 대상 조회 — CSS.escape 폴백 포함(구형 환경 방어).
	//   앵커 속성 다속성 인식(M6) — spec-html 앱은 data-element-id, 어드민(옛 목업)은 data-field 를 쓴다.
	//   저장된 elementId 가 어느 속성 값인지 모르므로 둘 다 시도(앱·어드민 목업 완전한 합).
	function queryElement(doc, elementId) {
		const esc = (doc.defaultView && doc.defaultView.CSS && doc.defaultView.CSS.escape)
			? doc.defaultView.CSS.escape(elementId)
			: String(elementId).replace(/["\\]/g, '\\$&');
		return doc.querySelector(`[data-element-id="${esc}"]`) || doc.querySelector(`[data-field="${esc}"]`);
	}

	// 요소의 앵커 id — data-element-id(앱) 우선, 없으면 data-field(어드민). 둘 다 안정 식별자.
	function elementIdOf(el) {
		return el.getAttribute('data-element-id') || el.getAttribute('data-field');
	}
	const ANCHOR_SEL = '[data-element-id], [data-field]';

	// coord 모드 기준 컨테이너 — 'frame' 은 목업 프레임 우선, 폴백 body (자유형 정적 목업 대응).
	function basisElement(doc, basis) {
		if (basis === 'frame') {
			return doc.querySelector('.mobile-frame') || doc.querySelector('.web-frame')
				|| doc.querySelector('.frame-stage') || doc.body;
		}
		return doc.body;
	}

	// 요소가 지금 화면에 실재하는가 — 화면 전환/조건분기로 빠졌으면 숨김 처리 대상.
	function isRenderable(el) {
		if (!el) return false;
		if (el.offsetParent === null && el.getClientRects().length === 0) return false; // display:none·미부착
		const r = el.getBoundingClientRect();
		return r.width > 0 || r.height > 0;
	}

	// spec-html 목업의 APP_DATA — `const APP_DATA` 는 전역 lexical 바인딩이라 win.APP_DATA 에 안 붙는다
	// → realm 내 간접 eval 로 읽는다(같은 오리진). 객체 참조는 불변이라 attach 시 1회 캐시하면 된다.
	function resolveAppData(win) {
		try {
			if (win.APP_DATA) return win.APP_DATA;
			return win.eval('typeof APP_DATA === "undefined" ? null : APP_DATA') || null;
		} catch (_) { return null; }
	}

	// spec-html 목업 판별 — 셸(renderer)의 세트 kind 결정용.
	function detectSpecHtml(frame) {
		try { return !!resolveAppData(frame.contentWindow); } catch (_) { return false; }
	}

	// APP_DATA 원본 반환 — 셸의 초안 주입(M4)·화면 네비(M6)가 screens/areas/elements/desc 를 읽는다. 없으면 null(generic 목업).
	function readAppData(frame) {
		try { return resolveAppData(frame.contentWindow); } catch (_) { return null; }
	}

	// dd → 목업 제어 — 화면 전환(M6 화면 네비). spec-html goScreen(id) 를 realm 내에서 호출(readAppData 와 같은 오리진).
	function gotoScreen(frame, id) {
		try { frame.contentWindow.eval("typeof goScreen==='function' && goScreen(" + JSON.stringify(String(id)) + ")"); }
		catch (_) { /* 함수 없거나 접근 불가 — 무시 */ }
	}

	function attach(frame, set, opts) {
		opts = opts || {};
		const doc = frame.contentDocument;
		const win = frame.contentWindow;
		if (!doc || !doc.body || !win) return null;
		let editable = !!opts.editable;
		let selectedId = null;
		const mock = resolveAppData(win); // spec-html APP_DATA (자유형이면 null)
		function cssEsc(s) { return (win.CSS && win.CSS.escape) ? win.CSS.escape(s) : String(s).replace(/["\\#.:]/g, '\\$&'); }
		// generic 목업 화면 감지 — APP_DATA 없이도 "display 토글되는 형제 그룹의 보이는 일원"을 현재 화면으로.
		//   id 있는 컨테이너만 채택(견고). 못 찾으면 null → 게이팅 off(전부 렌더, 현행 유지). STORY 식 #screen-N 커버.
		function detectScreenSel(el) {
			let node = el;
			while (node && node !== doc.body && node.parentElement) {
				const parent = node.parentElement;
				const sibs = Array.prototype.filter.call(parent.children, (c) => c.nodeType === 1 && c.tagName === node.tagName);
				if (sibs.length >= 2 && node.id) {
					const anyHidden = sibs.some((c) => c !== node && c.offsetParent === null && c.getClientRects().length === 0);
					if (anyHidden) return '#' + cssEsc(node.id);
				}
				node = parent;
			}
			return null;
		}
		// 찍을 때 화면 소속 기록 — spec-html 은 screenId(APP_DATA), generic 은 screenSel(DOM 컨테이너).
		function tagScreen(anchor, screen, px, py) {
			// spec-html(mock 존재) 만 screen 을 APP_DATA 화면 ID 로 신뢰해 screenId 로 저장.
			//   generic 은 screen 값이 실은 다른 핀의 screenSel 문자열(genScreen 반환)이라 screenId 로 넣으면
			//   화면 넘김 게이팅이 깨진다(screen=null 시 screenId 조건 무력화) → 항상 DOM 컨테이너 재감지해 screenSel 로.
			if (mock && screen) { anchor.screenId = screen; return; }
			const sel = detectScreenSel(doc.elementFromPoint(px, py));
			if (sel) anchor.screenSel = sel;
		}
		// generic 현재 화면 — 주석들의 screenSel 중 지금 보이는 것(문서 뷰 재렌더·onScreenChange 용).
		function genScreen() {
			for (const a of annotations()) {
				const sel = a.anchor && a.anchor.screenSel;
				if (sel) { const e = doc.querySelector(sel); if (isRenderable(e)) return sel; }
			}
			return null;
		}
		// 현재 화면 ID — screenId/screenSel 불일치 주석은 렌더 스킵(숨은 트레이 보존).
		function currentScreen() {
			if (mock) { try { return mock.currentScreen || null; } catch (_) { return null; } }
			return genScreen();
		}

		// 스타일 + 루트 + 트레이 주입 (형제 append — 목업 노드 무변형)
		if (!doc.getElementById(STYLE_ID)) {
			const style = doc.createElement('style');
			style.id = STYLE_ID;
			style.textContent = OVERLAY_CSS;
			doc.head ? doc.head.appendChild(style) : doc.body.appendChild(style);
		}
		let root = doc.getElementById(ROOT_ID);
		if (root) root.remove(); // 같은 문서 재부착 방어
		root = doc.createElement('div');
		root.id = ROOT_ID;
		root.classList.toggle('dd-editing', editable);
		doc.body.appendChild(root);
		const layer = doc.createElement('div'); // 주석 노드 전용 층 — rebuild 시 트레이는 보존
		root.appendChild(layer);
		const tray = doc.createElement('div');
		tray.className = 'dd-tray';
		tray.style.display = 'none';
		root.appendChild(tray);
		// 트레이 칩 클릭 — 숨은 주석의 화면으로 이동(위임). layout 이 innerHTML 을 매번 갈아끼워도 리스너는 유지.
		tray.addEventListener('click', (e) => {
			const chip = e.target && e.target.closest ? e.target.closest('.dd-tray-chip') : null;
			if (chip && chip.dataset.ddId && opts.onTrayNav) opts.onTrayNav(chip.dataset.ddId);
		});

		function annotations() { return Array.isArray(set.annotations) ? set.annotations : []; }

		// 주석별 DOM 노드 — 구조 변경(추가·삭제·재번호) 시 rebuildNodes 로 전체 재생성 (수십 개 규모라 싸다)
		const nodes = new Map();
		// 색 적용(인라인) — 신규=차수색(팔레트 순환), 수정=주황, 기존=현행 색 유지. 그룹(1-A/1-B)은 테두리 ring.
		//   CSS 색 클래스보다 인라인이 우선 → 2·3차가 서로 다른 색으로 표시된다("색은 계속 달라야").
		function applyPinColor(el, a) {
			const st = DDModel.annotStatus(a);
			let fill = null;
			if (st === 'new') fill = DDModel.phaseColor(a.mark && a.mark.phase ? a.mark.phase : 1);
			else if (st === 'modified') fill = '#E08600';
			else if (a.style && a.style.color) fill = a.style.color; // 기존 — 현행 색
			if (fill) {
				if (a.type === 'box') {
					el.style.borderColor = fill;
					const lb = el.querySelector('.dd-box-label');
					if (lb) lb.style.background = fill;
				} else {
					el.style.background = fill;
				}
			}
			const gc = DDNumbering.isGrouped(set, a) ? DDModel.groupColorForKey(DDNumbering.groupKey(a)) : null;
			if (gc && a.type !== 'box') el.style.boxShadow = '0 0 0 2px #fff, 0 0 0 4px ' + gc + ', 0 1px 4px rgba(0,0,0,.35)';
			else if (gc) el.style.outline = '2px solid ' + gc;
		}
		function makeNode(a) {
			let el;
			if (a.type === 'box') {
				el = doc.createElement('div');
				el.className = 'dd-box';
				const lb = doc.createElement('span');
				lb.className = 'dd-box-label';
				lb.textContent = a.label;
				el.appendChild(lb);
			} else if (a.type === 'text') {
				// 캔버스 텍스트(B 1단계) — 번호·배지·색 없이 내용만. 앵커는 포인트(핀과 동일 경로).
				el = doc.createElement('div');
				el.className = 'dd-text';
				el.textContent = (a.body && a.body.plain) || '텍스트';
			} else {
				el = doc.createElement('div');
				el.className = 'dd-pin';
				el.textContent = a.label;
			}
			el.dataset.ddId = a.id;
			const plain = a.body && a.body.plain;
			if (a.type !== 'text') { // 배지·색·차수·날짜는 번호 주석(pin/box)만
				const badge = DDModel.annotBadge(a); // { status, label, tooltip } — 사용자 마킹 우선, 없으면 origin 폴백
				el.classList.add('dd-st-' + badge.status);
				applyPinColor(el, a); // 색 SSOT(인라인) — 신규 차수색·수정 주황·기존 현행·그룹 ring
				const ph = (a.mark && a.mark.kind === '신규' && a.mark.phase >= 2) ? a.mark.phase : 0;
				if (ph) { // 신규 2차 이상 — 차수 배지(색도 차수색)
					el.classList.add('dd-ph');
					const pb = doc.createElement('span');
					pb.className = 'dd-phase-badge';
					pb.textContent = ph + '차';
					pb.style.background = DDModel.phaseColor(ph);
					el.appendChild(pb);
				}
				if (a.type !== 'box' && a.mark && a.mark.addedAt) { // 목업 위 핀엔 날짜만(사유는 우측 목록에)
					const dc = doc.createElement('span');
					dc.className = 'dd-date-cap';
					dc.textContent = a.mark.addedAt;
					dc.style.color = DDModel.statusColor(a);
					el.appendChild(dc);
				}
				const tip = [];
				if (badge.tooltip) tip.push('[' + badge.label + ']  ' + badge.tooltip);
				if (plain) tip.push(plain);
				if (tip.length) el.title = tip.join('\n'); // 읽기 모드 — 네이티브 툴팁(마킹 + 설명)
			}
			el.style.display = 'none';
			layer.appendChild(el);
			nodes.set(a.id, el);
			return el;
		}
		function rebuildNodes() {
			nodes.clear();
			layer.innerHTML = '';
			for (const a of annotations()) makeNode(a);
			applySelection();
		}
		function applySelection() {
			for (const [id, el] of nodes) el.classList.toggle('dd-selected', id === selectedId);
		}
		function select(id) {
			selectedId = id;
			applySelection();
			if (opts.onSelect) opts.onSelect(id);
		}

		let lastStats = { visible: 0, hidden: 0 };
		let lastScreen; // 직전 layout 의 현재 화면 — 바뀌면 onScreenChange 통지(문서 뷰 우측 표 갱신용)
		let dragNodeId = null; // 드래그 중 노드 — layout 이 위치를 되돌리지 않게 스킵

		// 재정렬 본체 — 요소/기준 rect 를 매번 다시 읽고 root 기준 상대 px 로 배치.
		//   rootRect 와의 차로 계산하므로 body 마진·문서 스크롤 상태와 무관하게 정확하다.
		function layout() {
			if (!doc.body || !doc.getElementById(ROOT_ID)) return;
			const rootRect = root.getBoundingClientRect();
			const screen = currentScreen();
			if (screen !== lastScreen) { lastScreen = screen; if (opts.onScreenChange) opts.onScreenChange(screen); }
			const hidden = [];
			let visible = 0;
			for (const a of annotations()) {
				const node = nodes.get(a.id);
				if (!node) continue;
				if (a.id === dragNodeId) { visible++; continue; } // 드래그 중 — 손이 위치 소유
				let abs = null; // { left, top, width?, height? } — viewport 좌표
				let gated = false;
				if (a.anchor && a.anchor.screenId && screen && a.anchor.screenId !== screen) gated = true; // spec-html 다른 화면
				else if (a.anchor && a.anchor.screenSel && !isRenderable(doc.querySelector(a.anchor.screenSel))) gated = true; // generic — 소속 화면 컨테이너가 지금 안 보임
				if (gated) {
					abs = null; // 다른 화면 소속(element·coord·generic 공통) — 렌더 스킵
				} else if (a.anchor && a.anchor.mode === 'element') {
					const target = queryElement(doc, a.anchor.elementId);
					if (isRenderable(target)) {
						const r = target.getBoundingClientRect();
						const rect = { left: r.left, top: r.top, width: r.width, height: r.height };
						abs = a.type === 'box'
							? DDAnchor.boxRectFromElement(rect, a.anchor.rectPct)
							: DDAnchor.pinPointFromElement(rect, a.anchor.offsetPct);
					}
				} else if (a.coord) {
					const basis = basisElement(doc, a.coord.basis);
					if (isRenderable(basis) || basis === doc.body) {
						const r = basis.getBoundingClientRect();
						abs = DDAnchor.rectFromCoord(a.coord, { left: r.left, top: r.top, width: r.width, height: r.height });
					}
				}
				if (!abs) {
					node.style.display = 'none';
					hidden.push({ id: a.id, label: a.label });
					continue;
				}
				node.style.display = '';
				node.style.left = (abs.left - rootRect.left) + 'px';
				node.style.top = (abs.top - rootRect.top) + 'px';
				if (a.type === 'box') {
					node.style.width = Math.max(0, abs.width) + 'px';
					node.style.height = Math.max(0, abs.height) + 'px';
				}
				visible++;
			}
			// 숨은 주석 트레이 — 화면 전환·조건분기로 빠진 핀을 보존 중임을 알린다(돌아오면 자동 복귀)
			if (hidden.length) {
				tray.style.display = '';
				const chips = hidden.map((h) => `<span class="dd-tray-chip" data-dd-id="${h.id}" title="클릭 — 이 주석의 화면으로 이동">${h.label}</span>`).join(', ');
				tray.innerHTML = `<b>숨김 ${hidden.length}</b> · 다른 화면/상태: ${chips}`;
			} else {
				tray.style.display = 'none';
			}
			lastStats = { visible, hidden: hidden.length };
		}

		// rAF 디바운스 — 이벤트 폭주(스크롤·연쇄 변이)를 프레임당 1회로 합친다.
		let pending = false;
		function schedule() {
			if (pending) return;
			pending = true;
			win.requestAnimationFrame(() => { pending = false; layout(); });
		}

		// ---- M3 편집 — 찍기·이동·박스·선택·삭제 ------------------------------------

		// 클릭 지점의 목업 요소 — 스택을 위→아래로 훑어 첫 [data-element-id] 매치를 찾는다.
		//   spec-html 은 목업 위에 nav-legend 같은 오버레이(data-element-id 없음)를 덮으므로,
		//   "첫 비오버레이 요소가 data-element-id 가 아니면 포기"하면 그 아래 진짜 요소를 놓친다.
		//   → 스택 전체를 훑어 실제 앵커 대상이 나올 때까지 계속 본다(못 찾으면 coord 모드).
		function elementUnderPoint(x, y) {
			const stack = doc.elementsFromPoint ? doc.elementsFromPoint(x, y) : [doc.elementFromPoint(x, y)];
			for (const el of stack) {
				if (!el || root.contains(el)) continue;
				const hit = el.closest ? el.closest(ANCHOR_SEL) : null; // data-element-id(앱) 또는 data-field(어드민)
				if (hit) return hit; // 실제 매치에서만 종료 — 오버레이·비앵커 래퍼는 건너뛴다
			}
			return null;
		}

		// coord 기준 선택 — 폰 프레임이 있으면 항상 frame 비율(밖의 여백 핀도 프레임에 매여 함께 이동).
		//   프레임은 고정폭·가운데 정렬이라 창을 키우면 통째로 재정렬되는데, frame 기준이면 프레임 안이든
		//   여백이든 모두 프레임을 따라가 상대 위치가 유지된다(비율이 0~1 밖으로 나갈 수 있어 검증 완화).
		//   body 기준은 창 폭에 비례해 프레임과 어긋나므로 프레임 없는 자유형 목업에서만 쓴다.
		function coordBasisFor() {
			const frameEl = basisElement(doc, 'frame');
			const r = frameEl.getBoundingClientRect();
			return {
				basis: frameEl === doc.body ? 'body' : 'frame',
				rect: { left: r.left, top: r.top, width: r.width, height: r.height },
			};
		}

		// 핀 앵커 자동판정 — 요소 위면 element(따라감), 빈 곳이면 coord(프레임/바디 비율 고정).
		function pinAnchorAt(x, y) {
			const screen = currentScreen();
			const el = elementUnderPoint(x, y);
			if (el) {
				const r = el.getBoundingClientRect();
				const anchor = {
					mode: 'element',
					elementId: elementIdOf(el),
					offsetPct: DDAnchor.offsetPctFromPoint({ left: x, top: y }, { left: r.left, top: r.top, width: r.width, height: r.height }),
				};
				tagScreen(anchor, screen, x, y);
				return { anchor, coord: null };
			}
			const b = coordBasisFor();
			const p = DDAnchor.coordFromPoint({ left: x, top: y }, b.rect);
			const anchor = { mode: 'coord' };
			tagScreen(anchor, screen, x, y);
			return { anchor, coord: { basis: b.basis, x: p.x, y: p.y } };
		}

		// 박스 앵커 자동판정 — 렉트가 한 요소 안에 온전히 들어가면 element(rectPct), 아니면 coord.
		function boxAnchorFor(absRect) {
			const screen = currentScreen();
			const cx = absRect.left + absRect.width / 2;
			const cy = absRect.top + absRect.height / 2;
			const el = elementUnderPoint(cx, cy);
			if (el) {
				const r = el.getBoundingClientRect();
				const inside = absRect.left >= r.left - 1 && absRect.top >= r.top - 1
					&& absRect.left + absRect.width <= r.right + 1 && absRect.top + absRect.height <= r.bottom + 1;
				if (inside && r.width > 0 && r.height > 0) {
					const anchor = {
						mode: 'element',
						elementId: elementIdOf(el),
						rectPct: DDAnchor.coordFromRect(absRect, { left: r.left, top: r.top, width: r.width, height: r.height }),
					};
					tagScreen(anchor, screen, cx, cy);
					return { anchor, coord: null };
				}
			}
			const b = coordBasisFor();
			const c = DDAnchor.coordFromRect(absRect, b.rect);
			const anchor = { mode: 'coord' };
			tagScreen(anchor, screen, cx, cy);
			return { anchor, coord: Object.assign({ basis: b.basis }, c) };
		}

		function notifyChange() { if (opts.onChange) opts.onChange(); }

		function createPin(x, y) {
			const hit = pinAnchorAt(x, y);
			const a = DDModel.createAnnotation({ type: 'pin', anchor: hit.anchor, coord: hit.coord });
			DDNumbering.add(set, a);
			rebuildNodes();
			layout();
			select(a.id);
			notifyChange();
		}
		function createBox(absRect) {
			const hit = boxAnchorFor(absRect);
			const a = DDModel.createAnnotation({ type: 'box', anchor: hit.anchor, coord: hit.coord, style: { variant: 'dashed', color: '#7460D9' } });
			DDNumbering.add(set, a);
			rebuildNodes();
			layout();
			select(a.id);
			notifyChange();
		}
		// 텍스트 생성 — 좌상단 포인트 앵커(핀과 같은 자동판정). 번호 없음. 생성 후 선택 → 우측 패널서 내용 입력.
		function createText(x, y) {
			const hit = pinAnchorAt(x, y);
			const a = DDModel.createAnnotation({ type: 'text', anchor: hit.anchor, coord: hit.coord, body: { format: 'html', html: '', plain: '' } });
			DDNumbering.add(set, a);
			rebuildNodes();
			layout();
			select(a.id);
			notifyChange();
		}

		// 이동 확정 — 드롭 지점에서 앵커를 다시 판정한다(요소↔빈 곳 넘나들면 mode 도 전환).
		function reanchor(a, node) {
			const r = node.getBoundingClientRect();
			if (a.type === 'box') {
				const abs = { left: r.left, top: r.top, width: r.width, height: r.height };
				const hit = boxAnchorFor(abs);
				a.anchor = hit.anchor;
				a.coord = hit.coord;
			} else {
				// 핀=중심, 텍스트=좌상단(렌더 기준과 일치)
				const cx = a.type === 'text' ? r.left : r.left + r.width / 2;
				const cy = a.type === 'text' ? r.top : r.top + r.height / 2;
				const hit = pinAnchorAt(cx, cy);
				a.anchor = hit.anchor;
				a.coord = hit.coord;
			}
			layout();
			notifyChange();
		}

		// 선택 주석 deep clone — 복사/복제용(원본 무영향). 없으면 null.
		function getSelectedClone() {
			const a = annotations().find((x) => x.id === selectedId);
			return a ? JSON.parse(JSON.stringify(a)) : null;
		}
		// clone 을 새 id·소폭 오프셋으로 추가(붙여넣기·복제 공용). 겹침 방지로 살짝 밀어 놓는다.
		function addClone(src) {
			if (!src) return null;
			const clone = JSON.parse(JSON.stringify(src));
			clone.id = DDModel.genId();
			if (clone.type !== 'box' && clone.anchor && clone.anchor.mode === 'element') {
				const o = clone.anchor.offsetPct || { dx: 0.5, dy: 0 };
				clone.anchor.offsetPct = { dx: o.dx + 0.06, dy: o.dy + 0.06 };
			} else if (clone.coord) {
				clone.coord = Object.assign({}, clone.coord, { x: clone.coord.x + 0.02, y: clone.coord.y + 0.02 });
			} else if (clone.anchor && clone.anchor.rectPct) {
				const rp = clone.anchor.rectPct;
				clone.anchor.rectPct = Object.assign({}, rp, { x: rp.x + 0.02, y: rp.y + 0.02 });
			}
			DDNumbering.add(set, clone);
			rebuildNodes();
			layout();
			select(clone.id);
			notifyChange();
			return clone.id;
		}
		// 선택 주석 미세 이동(화살표) — 화면 px 델타를 더한 지점에서 앵커 재판정(드래그와 동일 경로).
		function nudgeSelected(dx, dy) {
			const a = annotations().find((x) => x.id === selectedId);
			if (!a) return;
			const node = nodes.get(a.id);
			if (!node || node.style.display === 'none') return;
			const r = node.getBoundingClientRect();
			if (a.type === 'box') {
				const hit = boxAnchorFor({ left: r.left + dx, top: r.top + dy, width: r.width, height: r.height });
				a.anchor = hit.anchor; a.coord = hit.coord;
			} else {
				const px = a.type === 'text' ? r.left + dx : r.left + r.width / 2 + dx; // 텍스트=좌상단 기준
				const py = a.type === 'text' ? r.top + dy : r.top + r.height / 2 + dy;
				const hit = pinAnchorAt(px, py);
				a.anchor = hit.anchor; a.coord = hit.coord;
			}
			layout();
			notifyChange();
		}

		// 제스처 상태기 — mousedown 시작, DRAG_MIN 넘으면 드래그(이동/러버밴드), 미만이면 클릭(선택/핀 생성).
		//   tool = 'annot'(기본: 클릭=핀·드래그=박스) | 'text'(클릭=텍스트, 드래그 없음).
		let gesture = null;
		let tool = 'annot';
		function onMouseDown(e) {
			if (!editable || e.button !== 0) return;
			e.preventDefault();
			e.stopPropagation(); // 편집 중엔 목업 인터랙션 차단 — 화면 이동은 읽기 모드에서
			const ddEl = e.target && e.target.closest ? e.target.closest('.dd-pin, .dd-box, .dd-text') : null;
			if (ddEl && ddEl.dataset.ddId) {
				const a = annotations().find((x) => x.id === ddEl.dataset.ddId);
				if (!a) return;
				select(a.id);
				const nr = ddEl.getBoundingClientRect();
				gesture = {
					kind: 'move', a, node: ddEl, sx: e.clientX, sy: e.clientY, moved: false,
					// 노드 좌상단(viewport) — 이동량을 root 상대 px 로 되적용하기 위한 기준
					nx: nr.left, ny: nr.top,
				};
				dragNodeId = a.id;
			} else {
				gesture = { kind: 'create', sx: e.clientX, sy: e.clientY, moved: false, rubber: null };
			}
		}
		function onMouseMove(e) {
			if (!editable || !gesture) return;
			const dx = e.clientX - gesture.sx;
			const dy = e.clientY - gesture.sy;
			if (!gesture.moved && Math.abs(dx) < DRAG_MIN && Math.abs(dy) < DRAG_MIN) return;
			gesture.moved = true;
			const rootRect = root.getBoundingClientRect();
			if (gesture.kind === 'move') {
				const isPin = gesture.node.classList.contains('dd-pin');
				// 핀은 translate(-50%,-50%) 라 중심 기준, 박스는 좌상단 기준으로 되적용
				const left = gesture.nx + dx - rootRect.left + (isPin ? gesture.node.offsetWidth / 2 : 0);
				const top = gesture.ny + dy - rootRect.top + (isPin ? gesture.node.offsetHeight / 2 : 0);
				gesture.node.style.left = left + 'px';
				gesture.node.style.top = top + 'px';
				// 앵커 예측 힌트 — 지금 놓으면 요소에 붙는지(초록·따라감) 좌표에 고정되는지(회색·고정) 실시간 표시.
				const willEl = elementUnderPoint(e.clientX, e.clientY);
				gesture.node.classList.toggle('dd-will-element', !!willEl);
				gesture.node.classList.toggle('dd-will-coord', !willEl);
			} else {
				if (tool === 'text') return; // 텍스트 도구는 드래그(러버밴드) 없음 — 클릭 지점에 생성
				if (!gesture.rubber) {
					gesture.rubber = doc.createElement('div');
					gesture.rubber.className = 'dd-rubber';
					root.appendChild(gesture.rubber);
				}
				const left = Math.min(gesture.sx, e.clientX);
				const top = Math.min(gesture.sy, e.clientY);
				gesture.rubber.style.left = (left - rootRect.left) + 'px';
				gesture.rubber.style.top = (top - rootRect.top) + 'px';
				gesture.rubber.style.width = Math.abs(dx) + 'px';
				gesture.rubber.style.height = Math.abs(dy) + 'px';
			}
		}
		function onMouseUp(e) {
			if (!editable || !gesture) return;
			const g = gesture;
			gesture = null;
			dragNodeId = null;
			if (g.kind === 'move') {
				g.node.classList.remove('dd-will-element', 'dd-will-coord'); // 드래그 힌트 해제
				if (g.moved) reanchor(g.a, g.node);
				return; // 미이동 = 선택만(이미 mousedown 에서 처리)
			}
			if (g.rubber) g.rubber.remove();
			if (tool === 'text') { createText(g.sx, g.sy); return; } // 텍스트 도구 — 클릭 지점(드래그 무시)에 생성
			if (g.moved) {
				const left = Math.min(g.sx, e.clientX);
				const top = Math.min(g.sy, e.clientY);
				const w = Math.abs(e.clientX - g.sx);
				const h = Math.abs(e.clientY - g.sy);
				if (w >= DRAG_MIN && h >= DRAG_MIN) createBox({ left, top, width: w, height: h });
			} else {
				createPin(g.sx, g.sy);
			}
		}
		function onClickCapture(e) {
			if (!editable) return;
			e.preventDefault();
			e.stopPropagation(); // mousedown 차단과 짝 — 목업 click 핸들러(goScreen 등)까지 확실히 봉인
		}
		// 읽기 모드 핀 클릭 = 선택(하이라이트)만. editable 게이트는 안 건드린다.
		//   핀·박스 라벨을 맞췄을 때만 봉인 — 그 외 클릭은 목업 goScreen 등으로 통과(화면 넘김 보존).
		function onReadSelect(e) {
			if (editable) return; // 편집 모드는 gesture 계열이 담당
			const ddEl = e.target && e.target.closest ? e.target.closest('.dd-pin, .dd-box, .dd-text') : null;
			if (!ddEl || !ddEl.dataset.ddId) return; // 핀 아닌 클릭 = 목업 통과
			e.stopPropagation();
			const a = annotations().find((x) => x.id === ddEl.dataset.ddId);
			if (a) select(a.id); // applySelection + onSelect(id) → 문서 뷰 행 하이라이트
		}
		function onKeyDown(e) {
			if (!editable) return;
			if (e.key === 'Escape') { select(null); return; }
			if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
				e.preventDefault();
				if (opts.onDeleteRequest) opts.onDeleteRequest(selectedId);
				return;
			}
			const ctrl = e.ctrlKey || e.metaKey;
			if (ctrl && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); if (e.shiftKey) { if (opts.onRedo) opts.onRedo(); } else if (opts.onUndo) opts.onUndo(); return; } // 되돌리기/다시
			if (ctrl && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); if (opts.onRedo) opts.onRedo(); return; }
			if (ctrl && (e.key === 'd' || e.key === 'D')) { e.preventDefault(); if (opts.onDuplicate) opts.onDuplicate(); return; } // 복제
			if (ctrl && (e.key === 'c' || e.key === 'C') && selectedId) { e.preventDefault(); if (opts.onCopy) opts.onCopy(); return; } // 복사
			if (ctrl && (e.key === 'v' || e.key === 'V')) { e.preventDefault(); if (opts.onPaste) opts.onPaste(); return; } // 붙여넣기
			if (selectedId && (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
				e.preventDefault();
				const step = e.shiftKey ? 10 : 1; // 미세 이동(Figma식) — Shift 는 큰 폭
				const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
				const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
				nudgeSelected(dx, dy);
			}
		}
		doc.addEventListener('mousedown', onMouseDown, true);
		doc.addEventListener('mousemove', onMouseMove, true);
		doc.addEventListener('mouseup', onMouseUp, true);
		doc.addEventListener('click', onClickCapture, true);
		doc.addEventListener('click', onReadSelect, true);
		doc.addEventListener('keydown', onKeyDown, true);

		// ---- 재정렬 트리거 — resize / 내부 스크롤(캡처) / DOM 변이(goScreen 재렌더·조건분기 class/style)
		const onResize = () => schedule();
		const onScroll = () => schedule();
		win.addEventListener('resize', onResize);
		doc.addEventListener('scroll', onScroll, true);
		const mo = new win.MutationObserver((muts) => {
			// 오버레이 자신의 변이는 무시 — 무한 재정렬 루프 방지
			if (muts.every((m) => root.contains(m.target))) return;
			schedule();
		});
		mo.observe(doc.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
		// ResizeObserver 보강 — 스크롤바 등장 같은 "이벤트·변이 없는 reflow"(문서 폭 변화 → 중앙정렬
		// 프레임 이동)는 위 트리거들이 전부 놓친다. html/body 크기 변화로 잡는다.
		let ro = null;
		if (typeof win.ResizeObserver === 'function') {
			ro = new win.ResizeObserver(() => schedule());
			ro.observe(doc.documentElement);
			if (doc.body) ro.observe(doc.body);
		}

		rebuildNodes();
		layout();
		console.log(`[dd-overlay] attach — 주석 ${annotations().length}건 (표시 ${lastStats.visible} / 숨김 ${lastStats.hidden})${editable ? ' · 편집 모드' : ''}`);

		return {
			relayout: layout,
			stats: () => lastStats,
			currentScreen,      // spec-html screenId 또는 generic screenSel(문서 뷰·편집 필터용)
			select,
			getSelected: () => selectedId,
			getSelectedClone,   // 복사용 deep clone
			addClone,           // 붙여넣기·복제 — 새 id·오프셋 추가
			nudgeSelected,      // 화살표 미세 이동
			setTool(name) { tool = name === 'text' ? 'text' : 'annot'; root.classList.toggle('dd-tool-text', tool === 'text'); }, // 도구 전환(주석/텍스트)
			getTool: () => tool,
			// 패널(셸) 쪽 구조 변경(삭제·재번호·라벨) 후 호출 — 노드 전체 재생성 + 재배치
			refresh() {
				if (selectedId && !annotations().some((a) => a.id === selectedId)) selectedId = null;
				rebuildNodes();
				layout();
			},
			setEditable(on) {
				editable = !!on;
				root.classList.toggle('dd-editing', editable);
				if (!editable) { gesture = null; dragNodeId = null; select(null); tool = 'annot'; root.classList.remove('dd-tool-text'); } // 편집 끄면 도구 기본 복귀
			},
			detach() {
				try {
					mo.disconnect();
					if (ro) ro.disconnect();
					win.removeEventListener('resize', onResize);
					doc.removeEventListener('scroll', onScroll, true);
					doc.removeEventListener('mousedown', onMouseDown, true);
					doc.removeEventListener('mousemove', onMouseMove, true);
					doc.removeEventListener('mouseup', onMouseUp, true);
					doc.removeEventListener('click', onClickCapture, true);
					doc.removeEventListener('click', onReadSelect, true);
					doc.removeEventListener('keydown', onKeyDown, true);
					root.remove();
					const st = doc.getElementById(STYLE_ID);
					if (st) st.remove();
				} catch (_) { /* 문서가 이미 교체된 경우 — 무시 */ }
			},
		};
	}

	// ---- M5.6 문서 뷰 — 전 화면 클론 스택 인프라 (attach 클로저 밖 — frame 단위 순수 접근) ----------

	// 화면 목록 — 신버전 APP_DATA.screens 가 SSOT(id·name·순서). 없으면 빈 배열 → 문서 뷰는 현재 화면 1장 폴백(M5.5).
	//   구버전(.screen-view)·generic 자동 순회는 목업별 전환함수·컨테이너가 제각각이라 v1 범위 밖(폴백으로 안전).
	function listScreens(frame) {
		try {
			const app = resolveAppData(frame.contentWindow);
			if (app && app.screens && typeof app.screens === 'object') {
				return Object.keys(app.screens).map((k) => {
					const s = app.screens[k] || {};
					return { id: s.id || k, name: s.name || s.id || k, type: s.type || 'page' };
				}).filter((s) => s.id);
			}
		} catch (_) { /* 접근 불가 — 폴백 */ }
		return [];
	}

	// 전역 lexical(const/var) 읽기 — `const OVERVIEW`·`var HISTORY` 는 win 에 안 붙어 realm 내 간접 eval 로 읽는다(resolveAppData 패턴).
	function resolveGlobal(win, name) {
		try { return win.eval('typeof ' + name + ' === "undefined" ? null : ' + name) || null; }
		catch (_) { return null; }
	}

	// 표지 데이터 — 신버전 APP_DATA.project{name,version} 우선, 없으면 전역 OVERVIEW{name | 기능정의.기능명}. generic 은 빈값.
	//   버전은 신버전 project.version 만 신뢰(구버전 OVERVIEW 엔 정형 version 없음 — History 최신 ver 로 보강은 호출측 몫).
	function readCover(frame) {
		try {
			const win = frame.contentWindow;
			const app = resolveAppData(win);
			const ov = resolveGlobal(win, 'OVERVIEW');
			let title = '', version = '';
			if (app && app.project) { title = app.project.name || ''; version = app.project.version || ''; }
			if (!title && ov) title = ov.name || (ov.기능정의 && ov.기능정의.기능명) || '';
			return { title: title, version: version };
		} catch (_) { return { title: '', version: '' }; }
	}

	// 버전 이력 — 신버전 APP_DATA.history(키 version·screen) 우선, 없으면 전역 HISTORY(키 ver·note). 키 차이 정규화(ver=version||ver).
	//   generic·이력 없는 목업은 빈 배열 → 표지/History 섹션 생략(불변 원칙).
	function readHistory(frame) {
		try {
			const win = frame.contentWindow;
			const app = resolveAppData(win);
			let raw = (app && Array.isArray(app.history)) ? app.history : null;
			if (!raw) raw = resolveGlobal(win, 'HISTORY');
			if (!Array.isArray(raw)) return [];
			return raw.map((h) => ({
				no: h && h.no != null ? String(h.no) : '',
				date: (h && h.date) || '',
				ver: (h && (h.ver || h.version)) || '',
				content: (h && h.content) || '',
				author: (h && h.author) || '',
			}));
		} catch (_) { return []; }
	}

	// 한 화면으로 전환 후 그 순간의 스테이지 DOM 클론 — 신버전은 innerHTML 재작성이 rAF 뒤 끝나므로 두 틱 대기.
	//   반환 = { id, clone } (clone = detached 노드. 목업 스타일은 iframe 내부 <style> 이 살아있어 iframe 안에 append 할 때만 적용).
	//   실패 시 null. Promise — 순회 호출자는 순차 await.
	function snapshotScreen(frame, id) {
		return new Promise((resolve) => {
			const doc = frame.contentDocument, win = frame.contentWindow;
			if (!doc || !win) return resolve(null);
			gotoScreen(frame, id);
			win.requestAnimationFrame(() => win.requestAnimationFrame(() => {
				try {
					const stage = doc.querySelector('#wireframe') || doc.querySelector('.frame-stage')
						|| doc.querySelector('.mobile-frame') || doc.querySelector('.web-frame') || doc.body;
					resolve({ id: id, clone: stage ? stage.cloneNode(true) : null });
				} catch (_) { resolve(null); }
			}));
		});
	}

	return { attach, detectSpecHtml, readAppData, gotoScreen, listScreens, snapshotScreen, readCover, readHistory };
})();
