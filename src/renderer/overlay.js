// 오버레이 — 목업 iframe "문서 내부"에 #dd-overlay-root 를 주입해 핀·박스를 렌더한다 (M2 읽기전용).
//   같은 좌표계·스크롤·resize 이벤트 안에 살므로 좌표 이중화가 없다. sandbox 미사용 전제(same-origin).
//   원칙 = 저장은 비율/논리키(annotation), 렌더는 실시간 재계산 — element 모드는 매 layout 마다
//   요소 rect 를 다시 읽어 리사이즈·화면전환·조건분기 재배치에도 따라간다. 해석 불가(다른 화면·display:none)
//   주석은 숨은 트레이에 보존했다가 요소가 돌아오면 복귀한다.
// 의존 — window.DDAnchor (core/anchor.js, index.html 에서 먼저 로드).

'use strict';

const DDOverlay = (() => {
	const ROOT_ID = 'dd-overlay-root';
	const STYLE_ID = 'dd-overlay-style';

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
.dd-tray {
	position: fixed; right: 10px; bottom: 10px; z-index: 99991;
	max-width: 240px; padding: 6px 10px; background: rgba(26,29,35,.88); color: #cbd5e1;
	border-radius: 8px; font: 500 11px/1.5 Pretendard, -apple-system, sans-serif; pointer-events: none;
}
.dd-tray b { color: #fff; }
`;

	// element 모드 대상 조회 — CSS.escape 폴백 포함(구형 환경 방어).
	function queryElement(doc, elementId) {
		const esc = (doc.defaultView && doc.defaultView.CSS && doc.defaultView.CSS.escape)
			? doc.defaultView.CSS.escape(elementId)
			: String(elementId).replace(/["\\]/g, '\\$&');
		return doc.querySelector(`[data-element-id="${esc}"]`);
	}

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

	// spec-html 목업이면 현재 화면 ID (자유형이면 null) — screenId 불일치 주석은 렌더 스킵.
	function currentScreenOf(win) {
		try { return (win.APP_DATA && win.APP_DATA.currentScreen) || null; } catch (_) { return null; }
	}

	function attach(frame, set) {
		const doc = frame.contentDocument;
		const win = frame.contentWindow;
		if (!doc || !doc.body || !win) return null;
		const annotations = (set && Array.isArray(set.annotations)) ? set.annotations : [];

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
		doc.body.appendChild(root);
		const tray = doc.createElement('div');
		tray.className = 'dd-tray';
		tray.style.display = 'none';
		root.appendChild(tray);

		// 주석별 DOM 노드 — 1회 생성 후 layout 마다 위치만 갱신 (id 키)
		const nodes = new Map();
		for (const a of annotations) {
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
			if (a.style && a.style.color) {
				if (a.type === 'box') el.style.borderColor = a.style.color;
				else el.style.background = a.style.color;
			}
			const plain = a.body && a.body.plain;
			if (plain) el.title = plain; // M2 읽기전용 — 네이티브 툴팁으로 설명 확인
			el.style.display = 'none';
			root.appendChild(el);
			nodes.set(a.id, el);
		}

		let lastStats = { visible: 0, hidden: 0 };

		// 재정렬 본체 — 요소/기준 rect 를 매번 다시 읽고 root 기준 상대 px 로 배치.
		//   rootRect 와의 차로 계산하므로 body 마진·문서 스크롤 상태와 무관하게 정확하다.
		function layout() {
			if (!doc.body || !doc.getElementById(ROOT_ID)) return;
			const rootRect = root.getBoundingClientRect();
			const screen = currentScreenOf(win);
			const hiddenLabels = [];
			let visible = 0;
			for (const a of annotations) {
				const node = nodes.get(a.id);
				if (!node) continue;
				let abs = null; // { left, top, width?, height? } — viewport 좌표
				if (a.anchor && a.anchor.mode === 'element') {
					if (a.anchor.screenId && screen && a.anchor.screenId !== screen) {
						abs = null; // 다른 화면 소속 — 렌더 스킵
					} else {
						const target = queryElement(doc, a.anchor.elementId);
						if (isRenderable(target)) {
							const r = target.getBoundingClientRect();
							const rect = { left: r.left, top: r.top, width: r.width, height: r.height };
							abs = a.type === 'box'
								? DDAnchor.boxRectFromElement(rect, a.anchor.rectPct)
								: DDAnchor.pinPointFromElement(rect, a.anchor.offsetPct);
						}
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

		// 재정렬 트리거 — resize / 내부 스크롤(캡처) / DOM 변이(goScreen 재렌더·조건분기 class/style)
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

		layout();
		console.log(`[dd-overlay] attach — 주석 ${annotations.length}건 (표시 ${lastStats.visible} / 숨김 ${lastStats.hidden})`);

		return {
			relayout: layout,
			stats: () => lastStats,
			detach() {
				try {
					mo.disconnect();
					if (ro) ro.disconnect();
					win.removeEventListener('resize', onResize);
					doc.removeEventListener('scroll', onScroll, true);
					root.remove();
					const st = doc.getElementById(STYLE_ID);
					if (st) st.remove();
				} catch (_) { /* 문서가 이미 교체된 경우 — 무시 */ }
			},
		};
	}

	return { attach };
})();
