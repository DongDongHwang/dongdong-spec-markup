// 저장 HTML 에 인라인되는 자기완결 뷰어 런타임의 "소스 문자열" 공급 모듈.
//   dd 없이 브라우저로 저장본을 열었을 때 #dd-annotations(JSON)를 읽어 핀·박스를 읽기전용으로 그린다.
//   외부 의존 0 — 앵커 math·레이아웃·리사이즈 추종을 전부 함수 안에 인라인한다(dd 앱의 anchor.js/overlay.js
//   read-only 판박이). ddRuntimeMain 을 실제 함수로 두고 toString() 으로 직렬화 → node --check 로 문법 검증됨.
//   dd 앱이 저장본을 다시 열 때는 html-io.strip 이 이 블록을 걷어내므로(iframe 엔 순수 목업만) 충돌 없음.
// UMD — node(테스트·embed)와 브라우저(window.DDRuntimeSrc) 양쪽.

(function (root, factory) {
	'use strict';
	if (typeof module !== 'undefined' && module.exports) module.exports = factory();
	else root.DDRuntimeSrc = factory();
})(typeof self !== 'undefined' ? self : this, function () {
	'use strict';

	// 저장본 오버레이 CSS — dd 앱 overlay.js OVERLAY_CSS 의 읽기전용 부분(편집 커서·러버밴드 제외).
	const RUNTIME_CSS = `
#dd-overlay-root { position: absolute; left: 0; top: 0; width: 0; height: 0; overflow: visible; z-index: 99990; pointer-events: none; }
#dd-overlay-root .dd-pin {
	position: absolute; transform: translate(-50%, -50%);
	min-width: 22px; height: 22px; padding: 0 5px; box-sizing: border-box;
	display: flex; align-items: center; justify-content: center;
	background: #7460D9; color: #fff; border: 2px solid #fff; border-radius: 999px;
	font: 700 11px/1 Pretendard, -apple-system, sans-serif;
	box-shadow: 0 1px 4px rgba(0,0,0,.35); pointer-events: auto; cursor: pointer; user-select: none;
}
#dd-overlay-root .dd-box { position: absolute; border: 2px dashed #7460D9; border-radius: 4px; background: rgba(116,96,217,.06); pointer-events: none; }
#dd-overlay-root .dd-box .dd-box-label {
	position: absolute; left: -2px; top: -22px; min-width: 20px; height: 18px; padding: 0 5px; box-sizing: border-box;
	display: inline-flex; align-items: center; justify-content: center;
	background: #7460D9; color: #fff; border-radius: 4px 4px 4px 0;
	font: 700 10px/1 Pretendard, -apple-system, sans-serif; pointer-events: auto; user-select: none;
}
#dd-overlay-root .dd-pin.dd-active, #dd-overlay-root .dd-box.dd-active { outline: 3px solid rgba(116,96,217,.5); outline-offset: 2px; }
#dd-panel {
	position: fixed; right: 14px; top: 14px; bottom: 14px; width: 300px; z-index: 99992;
	display: flex; flex-direction: column; background: #fff; color: #1f2328;
	border: 1px solid #e5e7eb; border-radius: 10px; box-shadow: 0 6px 24px rgba(0,0,0,.18);
	font: 13px/1.5 -apple-system, "Segoe UI", "Malgun Gothic", sans-serif; overflow: hidden;
}
#dd-panel .dd-p-head { padding: 10px 12px; border-bottom: 1px solid #e5e7eb; font-weight: 700; display: flex; align-items: center; justify-content: space-between; }
#dd-panel .dd-p-head b { color: #7460D9; }
#dd-panel .dd-p-toggle { border: 1px solid #e5e7eb; background: #fff; border-radius: 5px; font-size: 11px; padding: 2px 7px; cursor: pointer; color: #6b7280; }
#dd-panel .dd-p-list { list-style: none; margin: 0; padding: 6px; overflow-y: auto; flex: 1 1 auto; }
#dd-panel .dd-p-row { display: flex; gap: 8px; padding: 7px 8px; border-radius: 6px; cursor: pointer; align-items: flex-start; }
#dd-panel .dd-p-row:hover { background: rgba(116,96,217,.08); }
#dd-panel .dd-p-row.dd-active { background: rgba(116,96,217,.14); }
#dd-panel .dd-p-num { flex: 0 0 auto; min-width: 22px; height: 20px; padding: 0 6px; box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; background: #7460D9; color: #fff; font-weight: 700; font-size: 11px; border-radius: 999px; }
#dd-panel .dd-p-body { flex: 1 1 auto; min-width: 0; }
#dd-panel .dd-p-body ul { margin: 2px 0; padding-left: 16px; }
#dd-panel.dd-collapsed { width: auto; bottom: auto; }
#dd-panel.dd-collapsed .dd-p-list { display: none; }
@media print { #dd-panel { position: static; width: auto; box-shadow: none; border: none; } #dd-overlay-root .dd-pin { box-shadow: none; } }
`;

	// 저장본 안에서 실행될 본체 — 외부 스코프 참조 없음(toString 직렬화 안전). document 만 의존.
	function ddRuntimeMain() {
		'use strict';
		var doc = document, win = window;
		var dataEl = doc.getElementById('dd-annotations');
		if (!dataEl) return;
		var set;
		try { set = JSON.parse(dataEl.textContent); } catch (e) { return; }
		if (!set || !set.annotations || !set.annotations.length) return;
		var anns = set.annotations;

		// ---- 앵커 math (anchor.js 인라인) ----
		function pinPoint(rect, off) {
			var dx = off && typeof off.dx === 'number' ? off.dx : 0.5;
			var dy = off && typeof off.dy === 'number' ? off.dy : 0;
			return { left: rect.left + dx * rect.width, top: rect.top + dy * rect.height };
		}
		function boxRect(rect, rp) {
			if (!rp) return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
			return { left: rect.left + rp.x * rect.width, top: rect.top + rp.y * rect.height, width: rp.w * rect.width, height: rp.h * rect.height };
		}
		function coordRect(c, b) {
			return { left: b.left + c.x * b.width, top: b.top + c.y * b.height, width: (c.w || 0) * b.width, height: (c.h || 0) * b.height };
		}
		function esc(id) {
			return (win.CSS && win.CSS.escape) ? win.CSS.escape(id) : String(id).replace(/["\\]/g, '\\$&');
		}
		function queryEl(id) { return doc.querySelector('[data-element-id="' + esc(id) + '"]'); }
		function basisEl(basis) {
			if (basis === 'frame') return doc.querySelector('.mobile-frame') || doc.querySelector('.web-frame') || doc.querySelector('.frame-stage') || doc.body;
			return doc.body;
		}
		function renderable(el) {
			if (!el) return false;
			if (el.offsetParent === null && el.getClientRects().length === 0) return false;
			var r = el.getBoundingClientRect();
			return r.width > 0 || r.height > 0;
		}
		function curScreen() {
			try { return (typeof APP_DATA !== 'undefined' && APP_DATA) ? (APP_DATA.currentScreen || null) : null; } catch (e) { return null; }
		}

		// ---- 오버레이 DOM ----
		var root = doc.getElementById('dd-overlay-root');
		if (root) root.parentNode.removeChild(root);
		root = doc.createElement('div');
		root.id = 'dd-overlay-root';
		doc.body.appendChild(root);
		var nodes = {};
		var selected = null;

		function slotHtml(a) {
			if (a.body && a.body.html) return a.body.html;
			if (a.body && a.body.plain) return '<p>' + a.body.plain.replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }) + '</p>';
			return '<p style="color:#9aa0a6">(설명 없음)</p>';
		}

		for (var i = 0; i < anns.length; i++) {
			(function (a) {
				var el;
				if (a.type === 'box') {
					el = doc.createElement('div'); el.className = 'dd-box';
					var lb = doc.createElement('span'); lb.className = 'dd-box-label'; lb.textContent = a.label; el.appendChild(lb);
				} else {
					el = doc.createElement('div'); el.className = 'dd-pin'; el.textContent = a.label;
				}
				el.setAttribute('data-dd-id', a.id);
				if (a.style && a.style.color) { if (a.type === 'box') el.style.borderColor = a.style.color; else el.style.background = a.style.color; }
				el.style.display = 'none';
				el.addEventListener('click', function (e) { e.stopPropagation(); selectAnn(a.id); });
				root.appendChild(el);
				nodes[a.id] = el;
			})(anns[i]);
		}

		// ---- 우측 패널 (읽기전용 목록 + 설명) ----
		var panel = doc.createElement('div');
		panel.id = 'dd-panel';
		var head = doc.createElement('div'); head.className = 'dd-p-head';
		head.innerHTML = '<span>주석 <b>' + anns.length + '</b></span>';
		var toggle = doc.createElement('button'); toggle.className = 'dd-p-toggle'; toggle.textContent = '접기';
		toggle.addEventListener('click', function () {
			var c = panel.classList.toggle('dd-collapsed'); toggle.textContent = c ? '펼치기' : '접기';
		});
		head.appendChild(toggle);
		var list = doc.createElement('ul'); list.className = 'dd-p-list';
		panel.appendChild(head); panel.appendChild(list);
		doc.body.appendChild(panel);
		var rows = {};
		function sortedAnns() { return anns.slice().sort(function (a, b) { return (a.seq || 0) - (b.seq || 0); }); }
		var sa = sortedAnns();
		for (var j = 0; j < sa.length; j++) {
			(function (a) {
				var li = doc.createElement('li'); li.className = 'dd-p-row'; li.setAttribute('data-dd-id', a.id);
				li.innerHTML = '<span class="dd-p-num">' + a.label + '</span><div class="dd-p-body">' + slotHtml(a) + '</div>';
				li.addEventListener('click', function () { selectAnn(a.id); });
				list.appendChild(li); rows[a.id] = li;
			})(sa[j]);
		}
		function selectAnn(id) {
			selected = id;
			for (var k in nodes) if (nodes.hasOwnProperty(k)) nodes[k].classList.toggle('dd-active', k === id);
			for (var m in rows) if (rows.hasOwnProperty(m)) rows[m].classList.toggle('dd-active', m === id);
			if (rows[id]) rows[id].scrollIntoView({ block: 'nearest' });
		}

		// ---- 레이아웃(요소/좌표 실시간 재계산) ----
		function layout() {
			if (!doc.body || !doc.getElementById('dd-overlay-root')) return;
			var rootRect = root.getBoundingClientRect();
			var screen = curScreen();
			for (var i = 0; i < anns.length; i++) {
				var a = anns[i], node = nodes[a.id];
				if (!node) continue;
				var abs = null;
				if (a.anchor && a.anchor.screenId && screen && a.anchor.screenId !== screen) {
					abs = null;
				} else if (a.anchor && a.anchor.mode === 'element') {
					var target = queryEl(a.anchor.elementId);
					if (renderable(target)) {
						var r = target.getBoundingClientRect();
						var rect = { left: r.left, top: r.top, width: r.width, height: r.height };
						abs = a.type === 'box' ? boxRect(rect, a.anchor.rectPct) : pinPoint(rect, a.anchor.offsetPct);
					}
				} else if (a.coord) {
					var base = basisEl(a.coord.basis);
					if (renderable(base) || base === doc.body) {
						var br = base.getBoundingClientRect();
						abs = coordRect(a.coord, { left: br.left, top: br.top, width: br.width, height: br.height });
					}
				}
				if (!abs) { node.style.display = 'none'; continue; }
				node.style.display = '';
				node.style.left = (abs.left - rootRect.left) + 'px';
				node.style.top = (abs.top - rootRect.top) + 'px';
				if (a.type === 'box') { node.style.width = Math.max(0, abs.width) + 'px'; node.style.height = Math.max(0, abs.height) + 'px'; }
			}
		}
		var pending = false;
		function schedule() { if (pending) return; pending = true; win.requestAnimationFrame(function () { pending = false; layout(); }); }
		win.addEventListener('resize', schedule);
		doc.addEventListener('scroll', schedule, true);
		try {
			var mo = new win.MutationObserver(function (muts) { for (var i = 0; i < muts.length; i++) if (!root.contains(muts[i].target)) { schedule(); return; } });
			mo.observe(doc.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
		} catch (e) {}
		try {
			if (typeof win.ResizeObserver === 'function') { var ro = new win.ResizeObserver(schedule); ro.observe(doc.documentElement); if (doc.body) ro.observe(doc.body); }
		} catch (e) {}
		layout();
	}

	// DOM 준비 시 실행하는 부트스트랩까지 포함해 직렬화.
	function ddRuntimeBoot() {
		if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', RUN);
		else RUN();
		function RUN() { try { MAIN(); } catch (e) { /* 저장본 뷰어 실패는 목업 자체를 막지 않는다 */ } }
	}

	// RUNTIME_JS = 부트 + 본체를 한 IIFE 로. MAIN 자리에 ddRuntimeMain 소스를 주입.
	var RUNTIME_JS = '(function(){\n'
		+ 'var MAIN = ' + ddRuntimeMain.toString() + ';\n'
		+ '(' + ddRuntimeBoot.toString() + ')();\n'
		+ '})();';

	return { RUNTIME_CSS: RUNTIME_CSS, RUNTIME_JS: RUNTIME_JS };
});
