// 오버레이 — 목업 iframe "문서 내부"에 #dd-overlay-root 를 주입해 핀·박스를 렌더한다 (M2 읽기 + M3 편집).
//   같은 좌표계·스크롤·resize 이벤트 안에 살므로 좌표 이중화가 없다. sandbox 미사용 전제(same-origin).
//   원칙 = 저장은 비율/논리키(annotation), 렌더는 실시간 재계산 — element 모드는 매 layout 마다
//   요소 rect 를 다시 읽어 리사이즈·화면전환·조건분기 재배치에도 따라간다. 해석 불가(다른 화면·display:none)
//   주석은 숨은 트레이에 보존했다가 요소가 돌아오면 복귀한다.
//   M3 편집 모드 — 목업 클릭 = 핀(앵커 mode 자동판정) / 드래그 = 박스 / 핀·박스 드래그 = 이동(재앵커) /
//   클릭 = 선택 / Delete = 삭제 요청. 편집 중엔 목업 자체 인터랙션(goScreen 등)을 캡처 단계에서 차단해
//   "버튼을 찍으려다 화면이 넘어가는" 오동작을 막는다(화면 이동은 뷰어 모드에서).
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
	display: flex; align-items: center; justify-content: center;
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
#${ROOT_ID} .dd-pin.dd-st-modified { background: #e08600; }
#${ROOT_ID} .dd-box.dd-st-new { border-color: #18a558; }
#${ROOT_ID} .dd-box.dd-st-modified { border-color: #e08600; }
#${ROOT_ID} .dd-box.dd-st-new .dd-box-label { background: #18a558; }
#${ROOT_ID} .dd-box.dd-st-modified .dd-box-label { background: #e08600; }
#${ROOT_ID} .dd-rubber { position: absolute; border: 2px dashed #7460D9; background: rgba(116,96,217,.10); pointer-events: none; }
#${ROOT_ID}.dd-editing .dd-pin, #${ROOT_ID}.dd-editing .dd-box, #${ROOT_ID}.dd-editing .dd-box-label { cursor: move; }
#${ROOT_ID}.dd-editing .dd-box { pointer-events: auto; }
body:has(#${ROOT_ID}.dd-editing) { cursor: crosshair !important; }
.dd-tray {
	position: fixed; right: 10px; bottom: 10px; z-index: 99991;
	max-width: 240px; padding: 6px 10px; background: rgba(26,29,35,.88); color: #cbd5e1;
	border-radius: 8px; font: 500 11px/1.5 Pretendard, -apple-system, sans-serif; pointer-events: none;
}
.dd-tray b { color: #fff; }
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
		// 현재 화면 ID — screenId 불일치 주석은 렌더 스킵(숨은 트레이 보존).
		function currentScreen() {
			try { return (mock && mock.currentScreen) || null; } catch (_) { return null; }
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

		function annotations() { return Array.isArray(set.annotations) ? set.annotations : []; }

		// 주석별 DOM 노드 — 구조 변경(추가·삭제·재번호) 시 rebuildNodes 로 전체 재생성 (수십 개 규모라 싸다)
		const nodes = new Map();
		function makeNode(a) {
			let el;
			if (a.type === 'box') {
				el = doc.createElement('div');
				el.className = 'dd-box';
				const lb = doc.createElement('span');
				lb.className = 'dd-box-label';
				lb.textContent = a.label;
				el.appendChild(lb);
			} else {
				el = doc.createElement('div');
				el.className = 'dd-pin';
				el.textContent = a.label;
			}
			el.dataset.ddId = a.id;
			const st = DDModel.annotStatus(a); // diff(M6) — new(초록)/modified(주황)/unchanged(기본 색)
			el.classList.add('dd-st-' + st);
			if (st === 'unchanged' && a.style && a.style.color) {
				if (a.type === 'box') el.style.borderColor = a.style.color;
				else el.style.background = a.style.color;
			}
			const plain = a.body && a.body.plain;
			if (plain) el.title = plain; // 읽기 모드 — 네이티브 툴팁으로 설명 확인
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
			const hiddenLabels = [];
			let visible = 0;
			for (const a of annotations()) {
				const node = nodes.get(a.id);
				if (!node) continue;
				if (a.id === dragNodeId) { visible++; continue; } // 드래그 중 — 손이 위치 소유
				let abs = null; // { left, top, width?, height? } — viewport 좌표
				if (a.anchor && a.anchor.screenId && screen && a.anchor.screenId !== screen) {
					abs = null; // 다른 화면 소속(element·coord 공통) — 렌더 스킵
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
					hiddenLabels.push(a.label);
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
			if (hiddenLabels.length) {
				tray.style.display = '';
				tray.innerHTML = `<b>숨김 ${hiddenLabels.length}</b> · 다른 화면/상태의 주석: ${hiddenLabels.join(', ')}`;
			} else {
				tray.style.display = 'none';
			}
			lastStats = { visible, hidden: hiddenLabels.length };
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
				if (screen) anchor.screenId = screen;
				return { anchor, coord: null };
			}
			const b = coordBasisFor();
			const p = DDAnchor.coordFromPoint({ left: x, top: y }, b.rect);
			const anchor = { mode: 'coord' };
			if (screen) anchor.screenId = screen;
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
					if (screen) anchor.screenId = screen;
					return { anchor, coord: null };
				}
			}
			const b = coordBasisFor();
			const c = DDAnchor.coordFromRect(absRect, b.rect);
			const anchor = { mode: 'coord' };
			if (screen) anchor.screenId = screen;
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

		// 이동 확정 — 드롭 지점에서 앵커를 다시 판정한다(요소↔빈 곳 넘나들면 mode 도 전환).
		function reanchor(a, node) {
			const r = node.getBoundingClientRect();
			if (a.type === 'box') {
				const abs = { left: r.left, top: r.top, width: r.width, height: r.height };
				const hit = boxAnchorFor(abs);
				a.anchor = hit.anchor;
				a.coord = hit.coord;
			} else {
				const cx = r.left + r.width / 2;
				const cy = r.top + r.height / 2;
				const hit = pinAnchorAt(cx, cy);
				a.anchor = hit.anchor;
				a.coord = hit.coord;
			}
			layout();
			notifyChange();
		}

		// 제스처 상태기 — mousedown 시작, DRAG_MIN 넘으면 드래그(이동/러버밴드), 미만이면 클릭(선택/핀 생성).
		let gesture = null;
		function onMouseDown(e) {
			if (!editable || e.button !== 0) return;
			e.preventDefault();
			e.stopPropagation(); // 편집 중엔 목업 인터랙션 차단 — 화면 이동은 뷰어 모드에서
			const ddEl = e.target && e.target.closest ? e.target.closest('.dd-pin, .dd-box') : null;
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
			} else {
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
				if (g.moved) reanchor(g.a, g.node);
				return; // 미이동 = 선택만(이미 mousedown 에서 처리)
			}
			if (g.rubber) g.rubber.remove();
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
		function onKeyDown(e) {
			if (!editable) return;
			if (e.key === 'Escape') { select(null); return; }
			if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
				e.preventDefault();
				if (opts.onDeleteRequest) opts.onDeleteRequest(selectedId);
			}
		}
		doc.addEventListener('mousedown', onMouseDown, true);
		doc.addEventListener('mousemove', onMouseMove, true);
		doc.addEventListener('mouseup', onMouseUp, true);
		doc.addEventListener('click', onClickCapture, true);
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
			select,
			getSelected: () => selectedId,
			// 패널(셸) 쪽 구조 변경(삭제·재번호·라벨) 후 호출 — 노드 전체 재생성 + 재배치
			refresh() {
				if (selectedId && !annotations().some((a) => a.id === selectedId)) selectedId = null;
				rebuildNodes();
				layout();
			},
			setEditable(on) {
				editable = !!on;
				root.classList.toggle('dd-editing', editable);
				if (!editable) { gesture = null; dragNodeId = null; select(null); }
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
					doc.removeEventListener('keydown', onKeyDown, true);
					root.remove();
					const st = doc.getElementById(STYLE_ID);
					if (st) st.remove();
				} catch (_) { /* 문서가 이미 교체된 경우 — 무시 */ }
			},
		};
	}

	return { attach, detectSpecHtml, readAppData, gotoScreen };
})();
