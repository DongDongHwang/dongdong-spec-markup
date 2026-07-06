// 화면 플로우맵 — 문서 뷰의 독립 캔버스(목업 iframe 아님)에 화면 노드 박스 + goScreen 간선을 렌더/편집한다.
//   안 2(복사-편집 모델) — 초안은 프로그램이 자동 배치(layoutFlowNodes/buildFlowDraft), 확정은 사람이
//   노드 드래그·간선 긋기·조건 라벨로. 결과는 set.flowMap(JSON)에 저장 → 재개봉·재저장 무손상, 목업 재생성 불변.
//   좌표는 캔버스 0~1 비율(반응형·줌 견딤). 간선은 Phase 4 커넥터와 같은 edgeClipPoint 로 노드 가장자리에 붙는다.
//   의존 — window.DDModel·DDAnchor.
'use strict';

const DDFlowMap = (() => {
	const SVGNS = 'http://www.w3.org/2000/svg';
	const ROOT_ID = 'dd-flow-root';
	const DRAG_MIN = 4;

	// 캔버스 CSS — 전부 flow- prefix. dd 앱 셸과 저장본 런타임에서 공유(한 덩어리 유지).
	const FLOW_CSS = `
#${ROOT_ID} { position: absolute; inset: 0; overflow: auto; background: #f6f7f9; }
#${ROOT_ID} .flow-canvas { position: relative; width: 100%; height: 100%; min-height: 420px; }
#${ROOT_ID} .flow-edges { position: absolute; left: 0; top: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; }
#${ROOT_ID} .flow-node {
	position: absolute; box-sizing: border-box; min-width: 96px; max-width: 200px; padding: 10px 14px;
	background: #fff; border: 2px solid #7460D9; border-radius: 10px;
	font: 700 13px/1.35 Pretendard, -apple-system, sans-serif; color: #1f2328;
	box-shadow: 0 2px 8px rgba(0,0,0,.10); user-select: none; cursor: default;
	white-space: pre-wrap; word-break: break-word; text-align: center; z-index: 3;
}
#${ROOT_ID} .flow-node .flow-node-id { display: block; margin-top: 3px; font: 500 10px/1 Pretendard, sans-serif; color: #8a8f98; }
#${ROOT_ID}.flow-editing .flow-node { cursor: move; }
#${ROOT_ID} .flow-node.flow-selected { outline: 3px solid rgba(116,96,217,.4); outline-offset: 2px; }
#${ROOT_ID} .flow-node.flow-connect-hint { outline: 3px solid rgba(116,96,217,.85); outline-offset: 2px; }
/* 연결 포트 — 편집 모드 hover/선택 시 노출. 드래그해 다른 노드로 간선. */
#${ROOT_ID} .flow-port {
	position: absolute; right: -9px; top: 50%; transform: translateY(-50%);
	width: 16px; height: 16px; border-radius: 50%; background: #7460D9; border: 2px solid #fff;
	box-shadow: 0 1px 3px rgba(0,0,0,.3); cursor: crosshair; display: none; z-index: 4;
}
#${ROOT_ID}.flow-editing .flow-node:hover .flow-port,
#${ROOT_ID}.flow-editing .flow-node.flow-selected .flow-port { display: block; }
#${ROOT_ID} .flow-edge-line { stroke: #7460D9; stroke-width: 2.5; fill: none; }
#${ROOT_ID} .flow-edge-hit { stroke: transparent; stroke-width: 16; fill: none; pointer-events: stroke; cursor: pointer; }
#${ROOT_ID} .flow-edge.flow-selected .flow-edge-line { stroke-width: 4; }
#${ROOT_ID} .flow-edge-label {
	position: absolute; transform: translate(-50%, -50%); padding: 2px 7px; box-sizing: border-box;
	background: #fff; border: 1px solid #cbd0d8; border-radius: 999px;
	font: 600 11px/1.3 Pretendard, sans-serif; color: #464f5b; white-space: nowrap; z-index: 3; pointer-events: auto;
}
#${ROOT_ID} .flow-edge-label:empty::before { content: '조건'; color: #b0b6bf; }
#${ROOT_ID}.flow-editing .flow-edge-label { cursor: text; }
#${ROOT_ID} .flow-edge-label.flow-editing-label { outline: 2px solid #7460D9; background: #fff; }
#${ROOT_ID} .flow-arrow-prev { position: absolute; left: 0; top: 0; overflow: visible; pointer-events: none; z-index: 5; }
#${ROOT_ID} .flow-empty { position: absolute; left: 50%; top: 46%; transform: translate(-50%,-50%); text-align: center; color: #8a8f98; font: 500 13px/1.6 Pretendard, sans-serif; }
#${ROOT_ID} .flow-empty b { color: #5b6470; }
#${ROOT_ID} .flow-title { position: sticky; top: 0; left: 0; padding: 10px 16px; font: 700 14px/1 Pretendard, sans-serif; color: #464f5b; background: rgba(246,247,249,.92); z-index: 6; }
`;

	function attach(hostEl, set, opts) {
		opts = opts || {};
		const doc = hostEl.ownerDocument;
		const win = doc.defaultView;
		let editable = !!opts.editable;
		let selectedId = null; // 노드 id 또는 간선 id
		let selectedKind = null; // 'node' | 'edge'
		let gesture = null;
		let editingLabelId = null;

		hostEl.id = ROOT_ID;
		hostEl.innerHTML = '';
		hostEl.classList.toggle('flow-editing', editable);
		const title = doc.createElement('div');
		title.className = 'flow-title';
		title.textContent = '🗺 화면 플로우맵';
		const canvas = doc.createElement('div');
		canvas.className = 'flow-canvas';
		const svg = doc.createElementNS(SVGNS, 'svg');
		svg.setAttribute('class', 'flow-edges');
		canvas.appendChild(svg);
		hostEl.append(title, canvas);

		function fm() { return set.flowMap || { nodes: [], edges: [] }; }
		function nodes() { return fm().nodes || []; }
		function edges() { return fm().edges || []; }
		function nodeById(id) { return nodes().find((n) => n.id === id) || null; }

		const nodeEls = new Map(); // id → div
		const edgeEls = new Map(); // id → { g, hit, vis, label }

		function notifyChange() { if (opts.onChange) opts.onChange(); }

		// ---- 렌더 ----
		function rebuild() {
			nodeEls.clear(); edgeEls.clear();
			// svg 는 유지, 나머지 노드/라벨 제거 후 재생성
			Array.from(canvas.querySelectorAll('.flow-node, .flow-edge-label, .flow-empty')).forEach((el) => el.remove());
			while (svg.firstChild) svg.removeChild(svg.firstChild);
			const ns = nodes();
			if (!ns.length) {
				const empty = doc.createElement('div');
				empty.className = 'flow-empty';
				empty.innerHTML = editable
					? '<b>플로우맵이 비어 있어요.</b><br>초안 불러오기로 화면 노드를 자동 배치하거나<br>화면 목록에서 시작하세요.'
					: '<b>화면 플로우맵이 없어요.</b><br>편집에서 초안을 생성하세요.';
				canvas.appendChild(empty);
			}
			for (const n of ns) makeNode(n);
			for (const e of edges()) makeEdge(e);
			applySelection();
			layout();
		}
		function makeNode(n) {
			const el = doc.createElement('div');
			el.className = 'flow-node';
			el.dataset.flowId = n.id;
			el.textContent = n.label || n.screenId || '(화면)';
			if (n.screenId && n.screenId !== (n.label || '')) {
				const idc = doc.createElement('span');
				idc.className = 'flow-node-id';
				idc.textContent = n.screenId;
				el.appendChild(idc);
			}
			const port = doc.createElement('div');
			port.className = 'flow-port';
			port.dataset.flowPort = '1';
			el.appendChild(port);
			canvas.appendChild(el);
			nodeEls.set(n.id, el);
			return el;
		}
		function makeEdge(e) {
			const g = doc.createElementNS(SVGNS, 'g');
			g.setAttribute('class', 'flow-edge');
			g.dataset.flowId = e.id;
			const mid = 'fah-' + e.id;
			const defs = doc.createElementNS(SVGNS, 'defs');
			const mk = doc.createElementNS(SVGNS, 'marker');
			mk.setAttribute('id', mid); mk.setAttribute('markerWidth', '10'); mk.setAttribute('markerHeight', '8');
			mk.setAttribute('refX', '7'); mk.setAttribute('refY', '3'); mk.setAttribute('orient', 'auto'); mk.setAttribute('markerUnits', 'userSpaceOnUse');
			const hd = doc.createElementNS(SVGNS, 'path'); hd.setAttribute('d', 'M0,0 L8,3 L0,6 Z'); hd.setAttribute('fill', '#7460D9');
			mk.appendChild(hd); defs.appendChild(mk); g.appendChild(defs);
			const hit = doc.createElementNS(SVGNS, 'line'); hit.setAttribute('class', 'flow-edge-hit');
			const vis = doc.createElementNS(SVGNS, 'line'); vis.setAttribute('class', 'flow-edge-line'); vis.setAttribute('marker-end', 'url(#' + mid + ')');
			g.appendChild(hit); g.appendChild(vis);
			svg.appendChild(g);
			const label = doc.createElement('div');
			label.className = 'flow-edge-label';
			label.dataset.flowId = e.id;
			label.textContent = e.label || '';
			canvas.appendChild(label);
			edgeEls.set(e.id, { g, hit, vis, label });
			return g;
		}

		// 노드 렉트(캔버스 로컬 좌표) — 배치·간선 계산용.
		function nodeRectLocal(id) {
			const el = nodeEls.get(id);
			if (!el) return null;
			const cr = canvas.getBoundingClientRect();
			const r = el.getBoundingClientRect();
			return { left: r.left - cr.left, top: r.top - cr.top, width: r.width, height: r.height };
		}

		function layout() {
			const W = canvas.clientWidth || canvas.getBoundingClientRect().width;
			const H = Math.max(canvas.clientHeight, 420);
			// 노드 위치(비율 → px 좌상단)
			for (const n of nodes()) {
				const el = nodeEls.get(n.id);
				if (!el || (gesture && gesture.kind === 'move' && gesture.id === n.id)) continue;
				el.style.left = Math.round(n.x * W) + 'px';
				el.style.top = Math.round(n.y * H) + 'px';
			}
			svg.setAttribute('width', W); svg.setAttribute('height', H);
			// 간선 — 두 노드 중심 사이, 각 끝을 노드 가장자리로 클립(pad).
			for (const e of edges()) {
				const rec = edgeEls.get(e.id);
				if (!rec) continue;
				const ra = nodeRectLocal(e.from), rb = nodeRectLocal(e.to);
				if (!ra || !rb) { rec.g.style.display = 'none'; rec.label.style.display = 'none'; continue; }
				rec.g.style.display = ''; rec.label.style.display = '';
				const ca = { left: ra.left + ra.width / 2, top: ra.top + ra.height / 2 };
				const cb = { left: rb.left + rb.width / 2, top: rb.top + rb.height / 2 };
				const p1 = DDAnchor.edgeClipPoint(ra, cb, 3);
				const p2 = DDAnchor.edgeClipPoint(rb, ca, 4);
				[rec.hit, rec.vis].forEach((l) => { l.setAttribute('x1', p1.left); l.setAttribute('y1', p1.top); l.setAttribute('x2', p2.left); l.setAttribute('y2', p2.top); });
				rec.label.style.left = ((p1.left + p2.left) / 2) + 'px';
				rec.label.style.top = ((p1.top + p2.top) / 2) + 'px';
			}
		}

		function applySelection() {
			for (const [id, el] of nodeEls) el.classList.toggle('flow-selected', selectedKind === 'node' && id === selectedId);
			for (const [id, rec] of edgeEls) rec.g.classList.toggle('flow-selected', selectedKind === 'edge' && id === selectedId);
		}
		function select(kind, id) {
			endLabelEdit();
			selectedKind = id ? kind : null; selectedId = id || null;
			applySelection();
		}

		let connectHintId = null;
		function setConnectHint(id) {
			if (id === connectHintId) return;
			if (connectHintId) { const p = nodeEls.get(connectHintId); if (p) p.classList.remove('flow-connect-hint'); }
			connectHintId = id || null;
			if (connectHintId) { const c = nodeEls.get(connectHintId); if (c) c.classList.add('flow-connect-hint'); }
		}
		// 포인트(캔버스 로컬) 아래의 노드 id — 간선 스냅 대상.
		function nodeAtLocal(lx, ly, excludeId) {
			for (const n of nodes()) {
				if (n.id === excludeId) continue;
				const r = nodeRectLocal(n.id);
				if (r && lx >= r.left && lx <= r.left + r.width && ly >= r.top && ly <= r.top + r.height) return n.id;
			}
			return null;
		}
		function localXY(e) {
			const cr = canvas.getBoundingClientRect();
			return { x: e.clientX - cr.left + canvas.scrollLeft, y: e.clientY - cr.top + canvas.scrollTop };
		}

		// ---- 편집 제스처 ----
		function onMouseDown(e) {
			if (!editable || e.button !== 0) return;
			const labelEl = e.target.closest ? e.target.closest('.flow-edge-label') : null;
			if (labelEl) return; // 라벨 클릭 = 인라인 편집(dblclick 별도) — 여기선 통과
			if (editingLabelId) endLabelEdit();
			const portEl = e.target.closest ? e.target.closest('.flow-port') : null;
			const nodeEl = e.target.closest ? e.target.closest('.flow-node') : null;
			const edgeG = e.target.closest ? e.target.closest('.flow-edge') : null;
			const p = localXY(e);
			if (portEl && nodeEl) { // 포트 드래그 → 간선 그리기
				e.preventDefault();
				select('node', nodeEl.dataset.flowId);
				gesture = { kind: 'edge', from: nodeEl.dataset.flowId, sx: p.x, sy: p.y, moved: false };
				return;
			}
			if (nodeEl) { // 노드 몸통 → 이동
				e.preventDefault();
				const id = nodeEl.dataset.flowId;
				select('node', id);
				const r = nodeRectLocal(id);
				gesture = { kind: 'move', id, offX: p.x - r.left, offY: p.y - r.top, moved: false, node: nodeEl };
				return;
			}
			if (edgeG) { select('edge', edgeG.dataset.flowId); return; }
			select(null, null); // 빈 곳 = 선택 해제
		}
		function onMouseMove(e) {
			if (!editable || !gesture) return;
			const p = localXY(e);
			const dx = p.x - gesture.sx, dy = p.y - gesture.sy;
			if (gesture.kind === 'move') {
				if (!gesture.moved && Math.abs(p.x - (gesture.sx || p.x)) < 0) {} // no-op
				gesture.moved = true;
				gesture.node.style.left = Math.round(p.x - gesture.offX) + 'px';
				gesture.node.style.top = Math.round(p.y - gesture.offY) + 'px';
				layoutEdgesOnly();
				return;
			}
			if (gesture.kind === 'edge') {
				if (!gesture.moved && Math.abs(dx) < DRAG_MIN && Math.abs(dy) < DRAG_MIN) return;
				gesture.moved = true;
				drawEdgePreview(gesture.from, p.x, p.y);
				setConnectHint(nodeAtLocal(p.x, p.y, gesture.from));
			}
		}
		function onMouseUp(e) {
			if (!editable || !gesture) return;
			const g = gesture; gesture = null;
			const p = localXY(e);
			if (g.kind === 'move') {
				if (g.moved) {
					const W = canvas.clientWidth || 1, H = Math.max(canvas.clientHeight, 420);
					const n = nodeById(g.id);
					if (n) {
						n.x = +Math.min(1, Math.max(-0.1, (p.x - g.offX) / W)).toFixed(4);
						n.y = +Math.min(1, Math.max(-0.1, (p.y - g.offY) / H)).toFixed(4);
						layout(); notifyChange();
					}
				}
				return;
			}
			if (g.kind === 'edge') {
				removeEdgePreview(); setConnectHint(null);
				if (g.moved) {
					const target = nodeAtLocal(p.x, p.y, g.from);
					if (target) {
						const dup = edges().some((x) => x.from === g.from && x.to === target);
						if (!dup) {
							const ed = DDModel.createFlowEdge({ from: g.from, to: target, origin: 'manual' });
							fm().edges.push(ed);
							makeEdge(ed); layout(); select('edge', ed.id); notifyChange();
						}
					}
				}
			}
		}
		function layoutEdgesOnly() {
			const cr = canvas.getBoundingClientRect();
			for (const e of edges()) {
				const rec = edgeEls.get(e.id);
				if (!rec) continue;
				const ra = nodeRectLocal(e.from), rb = nodeRectLocal(e.to);
				if (!ra || !rb) continue;
				const ca = { left: ra.left + ra.width / 2, top: ra.top + ra.height / 2 };
				const cb = { left: rb.left + rb.width / 2, top: rb.top + rb.height / 2 };
				const p1 = DDAnchor.edgeClipPoint(ra, cb, 3);
				const p2 = DDAnchor.edgeClipPoint(rb, ca, 4);
				[rec.hit, rec.vis].forEach((l) => { l.setAttribute('x1', p1.left); l.setAttribute('y1', p1.top); l.setAttribute('x2', p2.left); l.setAttribute('y2', p2.top); });
				rec.label.style.left = ((p1.left + p2.left) / 2) + 'px';
				rec.label.style.top = ((p1.top + p2.top) / 2) + 'px';
			}
		}
		let prevSvg = null;
		function drawEdgePreview(fromId, tx, ty) {
			const ra = nodeRectLocal(fromId);
			if (!ra) return;
			const ca = { left: ra.left + ra.width / 2, top: ra.top + ra.height / 2 };
			const p1 = DDAnchor.edgeClipPoint(ra, { left: tx, top: ty }, 3);
			if (!prevSvg) {
				const s = doc.createElementNS(SVGNS, 'svg');
				s.setAttribute('class', 'flow-arrow-prev');
				const ln = doc.createElementNS(SVGNS, 'line'); ln.setAttribute('stroke', '#7460D9'); ln.setAttribute('stroke-width', '2.5'); ln.setAttribute('stroke-dasharray', '5 4');
				s.appendChild(ln); canvas.appendChild(s);
				prevSvg = { s, ln };
			}
			const W = canvas.clientWidth || 1, H = Math.max(canvas.clientHeight, 420);
			prevSvg.s.setAttribute('width', W); prevSvg.s.setAttribute('height', H);
			prevSvg.ln.setAttribute('x1', p1.left); prevSvg.ln.setAttribute('y1', p1.top);
			prevSvg.ln.setAttribute('x2', tx); prevSvg.ln.setAttribute('y2', ty);
		}
		function removeEdgePreview() { if (prevSvg) { prevSvg.s.remove(); prevSvg = null; } }

		// 간선 라벨 인라인 편집(더블클릭).
		function onDblClick(e) {
			if (!editable) return;
			const labelEl = e.target.closest ? e.target.closest('.flow-edge-label') : null;
			if (!labelEl) return;
			beginLabelEdit(labelEl.dataset.flowId);
		}
		function beginLabelEdit(id) {
			const rec = edgeEls.get(id);
			if (!rec) return;
			editingLabelId = id;
			select('edge', id);
			rec.label.contentEditable = 'true';
			rec.label.classList.add('flow-editing-label');
			rec.label.focus();
			try { const rg = doc.createRange(); rg.selectNodeContents(rec.label); const s = win.getSelection(); s.removeAllRanges(); s.addRange(rg); } catch (_) {}
		}
		function endLabelEdit() {
			if (!editingLabelId) return;
			const rec = edgeEls.get(editingLabelId);
			const ed = edges().find((x) => x.id === editingLabelId);
			if (rec && ed) {
				rec.label.contentEditable = 'false';
				rec.label.classList.remove('flow-editing-label');
				const txt = (rec.label.textContent || '').trim();
				if (txt !== ed.label) { ed.label = txt; notifyChange(); }
				rec.label.textContent = ed.label;
			}
			editingLabelId = null;
		}

		function deleteSelected() {
			if (!editable || !selectedId) return false;
			if (selectedKind === 'node') {
				const id = selectedId;
				fm().nodes = nodes().filter((n) => n.id !== id);
				fm().edges = edges().filter((e) => e.from !== id && e.to !== id); // 연결 간선 동반 삭제
			} else if (selectedKind === 'edge') {
				fm().edges = edges().filter((e) => e.id !== selectedId);
			}
			select(null, null);
			rebuild(); notifyChange();
			return true;
		}
		function onKeyDown(e) {
			if (!editable) return;
			if (editingLabelId) { if (e.key === 'Escape' || (e.key === 'Enter' && !e.shiftKey)) { e.preventDefault(); endLabelEdit(); } return; }
			if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) { e.preventDefault(); deleteSelected(); }
		}

		canvas.addEventListener('mousedown', onMouseDown);
		doc.addEventListener('mousemove', onMouseMove);
		doc.addEventListener('mouseup', onMouseUp);
		canvas.addEventListener('dblclick', onDblClick);
		doc.addEventListener('keydown', onKeyDown);
		let ro = null;
		try { if (typeof win.ResizeObserver === 'function') { ro = new win.ResizeObserver(() => layout()); ro.observe(canvas); } } catch (_) {}

		rebuild();

		return {
			rebuild, relayout: layout,
			setEditable(on) { editable = !!on; hostEl.classList.toggle('flow-editing', editable); if (!editable) { endLabelEdit(); select(null, null); } },
			deleteSelected,
			getSelected: () => (selectedId ? { kind: selectedKind, id: selectedId } : null),
			hasFlow: () => nodes().length > 0,
			detach() {
				try { doc.removeEventListener('mousemove', onMouseMove); doc.removeEventListener('mouseup', onMouseUp); doc.removeEventListener('keydown', onKeyDown); if (ro) ro.disconnect(); } catch (_) {}
			},
		};
	}

	return { attach, FLOW_CSS, ROOT_ID };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = DDFlowMap;
