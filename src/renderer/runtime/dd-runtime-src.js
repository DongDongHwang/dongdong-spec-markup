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
	display: flex; align-items: center; justify-content: center; white-space: nowrap;
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
#dd-overlay-root .dd-pin.dd-active, #dd-overlay-root .dd-box.dd-active, #dd-overlay-root .dd-text.dd-active { outline: 3px solid rgba(116,96,217,.5); outline-offset: 2px; }
#dd-overlay-root .dd-text { position: absolute; transform: none; max-width: 240px; padding: 4px 8px; box-sizing: border-box; background: rgba(255,255,255,.94); color: #1f2328; border: 1px solid #7460D9; border-radius: 6px; font: 600 12px/1.45 Pretendard, -apple-system, sans-serif; box-shadow: 0 1px 4px rgba(0,0,0,.2); white-space: pre-wrap; word-break: break-word; pointer-events: auto; cursor: pointer; }
#dd-overlay-root .dd-arrow { position: absolute; }
#dd-overlay-root .dd-arrow.dd-active .dd-arrow-line { stroke-width: 4; }
#dd-overlay-root .dd-box.dd-ellipse { border-radius: 50%; }
#dd-overlay-root .dd-pin.dd-st-new { background: #18a558; }
#dd-overlay-root .dd-pin.dd-st-modified { background: #E08600; }
#dd-overlay-root .dd-box.dd-st-new { border-color: #18a558; }
#dd-overlay-root .dd-box.dd-st-modified { border-color: #E08600; }
#dd-overlay-root .dd-box.dd-st-new .dd-box-label, #dd-overlay-root .dd-box.dd-st-modified .dd-box-label { background: inherit; }
/* 신규 2·3차 색은 인라인(phaseCol)이 항상 소유 — CSS 기본색을 두지 않는다(과거 #D97706 하드코딩이 차수색을 덮던 사문 제거). */
#dd-overlay-root .dd-phase-badge { position: absolute; top: -8px; right: -8px; min-width: 15px; height: 15px; padding: 0 3px; box-sizing: border-box; display: flex; align-items: center; justify-content: center; background: #6B7280; color: #fff; border: 1.5px solid #fff; border-radius: 999px; font: 700 8px/1 Pretendard, -apple-system, sans-serif; pointer-events: none; }
#dd-overlay-root .dd-date-cap { position: absolute; left: 50%; top: calc(100% + 3px); transform: translateX(-50%); white-space: nowrap; font: 600 9px/1 Pretendard, -apple-system, sans-serif; pointer-events: none; text-shadow: 0 0 3px #fff, 0 0 3px #fff, 0 0 3px #fff; }
#dd-panel .dd-p-badge { padding: 1px 6px; border-radius: 4px; font-size: 9.5px; font-weight: 700; margin-right: 4px; align-self: flex-start; }
#dd-panel .dd-p-badge.dd-b-new { background: rgba(24,165,88,.15); color: #18a558; }
#dd-panel .dd-p-badge.dd-b-modified { background: rgba(224,134,0,.2); color: #E08600; }
#dd-panel .dd-p-mark { font-size: 10.5px; font-weight: 600; margin-top: 3px; }
#dd-panel {
	position: fixed; right: 14px; top: 14px; bottom: 14px; width: 300px; z-index: 99992;
	display: flex; flex-direction: column; background: #fff; color: #1f2328;
	border: 1px solid #e5e7eb; border-radius: 10px; box-shadow: 0 6px 24px rgba(0,0,0,.18);
	font: 13px/1.5 -apple-system, "Segoe UI", "Malgun Gothic", sans-serif; overflow: hidden;
}
#dd-panel .dd-p-head { padding: 10px 12px; border-bottom: 1px solid #e5e7eb; font-weight: 700; display: flex; align-items: center; justify-content: space-between; }
#dd-panel .dd-p-head b { color: #7460D9; }
#dd-panel .dd-p-btns { display: inline-flex; gap: 6px; }
#dd-panel .dd-p-toggle { border: 1px solid #e5e7eb; background: #fff; border-radius: 5px; font-size: 11px; padding: 2px 7px; cursor: pointer; color: #6b7280; }
#dd-panel .dd-p-toggle.dd-on { border-color: #7460D9; color: #7460D9; background: rgba(116,96,217,.08); }
#dd-panel .dd-p-list { list-style: none; margin: 0; padding: 6px; overflow-y: auto; flex: 1 1 auto; }
#dd-panel .dd-p-row { display: flex; gap: 8px; padding: 7px 8px; border-radius: 6px; cursor: pointer; align-items: flex-start; }
#dd-panel .dd-p-row:hover { background: rgba(116,96,217,.08); }
#dd-panel .dd-p-row.dd-active { background: rgba(116,96,217,.14); }
#dd-panel .dd-p-num { flex: 0 0 auto; min-width: 22px; height: 20px; padding: 0 6px; box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; background: #7460D9; color: #fff; font-weight: 700; font-size: 11px; border-radius: 999px; }
#dd-panel .dd-p-num.is-text { background: transparent; color: #7460D9; border: 1px solid #7460D9; }
#dd-panel .dd-p-body { flex: 1 1 auto; min-width: 0; }
#dd-panel .dd-p-body ul { margin: 2px 0; padding-left: 16px; }
#dd-panel.dd-collapsed { width: auto; bottom: auto; }
#dd-panel.dd-collapsed .dd-p-list { display: none; }
body.dd-docview #description { display: none !important; }
#dd-panel .dd-p-front { display: block; padding: 10px 4px 12px; border-bottom: 2px solid #7460D9; margin-bottom: 6px; list-style: none; }
#dd-panel .dd-cover-title { font-size: 15px; font-weight: 800; line-height: 1.35; }
#dd-panel .dd-cover-ver { margin-top: 3px; font-size: 11px; font-weight: 700; color: #7460D9; }
#dd-panel .dd-hist-h { font-size: 11px; font-weight: 700; margin: 6px 0 3px; }
#dd-panel .dd-hist-tbl { width: 100%; border-collapse: collapse; font-size: 10px; }
#dd-panel .dd-hist-tbl th, #dd-panel .dd-hist-tbl td { border: 1px solid #e5e7eb; padding: 2px 4px; text-align: left; vertical-align: top; }
#dd-panel .dd-hist-tbl th { background: rgba(116,96,217,.08); font-weight: 700; }
/* 문서 뷰에서 목업 자체 화면 네비 복원 — clean 이 숨긴 걸 되살려 저장본에서 화면 넘김 가능(dd 자체 네비 없이 목업 nav 재활용) */
body.dd-doc-mode.clean #screen-nav, body.dd-doc-mode.clean .wf-nav { display: revert !important; }
@media print { #dd-panel { position: static; width: auto; box-shadow: none; border: none; } #dd-overlay-root .dd-pin { box-shadow: none; } }
/* M5.6c 전 화면 인쇄 — 페이지 스택(평소 숨김, 🖨 전체 인쇄 시만 조립·노출). 저장본이 목업 자체라 iframe 스타일 격리 없음. */
#dd-print-stack { display: none; }
.dd-print-page { padding: 8mm 6mm; box-sizing: border-box; }
.dd-print-hd { font: 700 14px/1.4 Pretendard, -apple-system, "Malgun Gothic", sans-serif; color: #1f2328; border-bottom: 2px solid #7460D9; padding-bottom: 4px; margin: 0 0 8px; }
.dd-print-wrap { display: flex; gap: 12px; align-items: flex-start; }
.dd-print-mock { flex: 0 0 auto; }
.dd-print-stagebox { position: relative; overflow: hidden; background: #fff; }
.dd-print-desc { flex: 1 1 auto; min-width: 0; }
.dd-print-desc table { width: 100%; border-collapse: collapse; font: 11px/1.5 -apple-system, "Malgun Gothic", sans-serif; }
.dd-print-desc th, .dd-print-desc td { border: 1px solid #e5e7eb; padding: 4px 6px; text-align: left; vertical-align: top; }
.dd-print-desc th { background: rgba(116,96,217,.08); font-weight: 700; }
.dd-print-desc .dd-pd-num { width: 34px; text-align: center; font-weight: 700; color: #7460D9; }
.dd-print-cover .dd-cover-title { font-size: 22px; font-weight: 800; line-height: 1.35; }
.dd-print-cover .dd-cover-ver { margin-top: 6px; font-size: 13px; font-weight: 700; color: #7460D9; }
.dd-print-cover .dd-hist-h { font-size: 12px; font-weight: 700; margin: 18px 0 4px; }
.dd-print-cover .dd-hist-tbl { width: 100%; border-collapse: collapse; font-size: 11px; }
.dd-print-cover .dd-hist-tbl th, .dd-print-cover .dd-hist-tbl td { border: 1px solid #e5e7eb; padding: 3px 5px; text-align: left; vertical-align: top; }
.dd-print-cover .dd-hist-tbl th { background: rgba(116,96,217,.08); font-weight: 700; }
/* 인쇄 스택 정적 핀 — #dd-overlay-root 스코프 밖이라 자기완결로 재정의(상태색은 인라인). */
.dd-print-stagebox .dd-sp-pin {
	position: absolute; transform: translate(-50%, -50%);
	min-width: 22px; height: 22px; padding: 0 5px; box-sizing: border-box;
	display: flex; align-items: center; justify-content: center;
	background: #7460D9; color: #fff; border: 2px solid #fff; border-radius: 999px;
	font: 700 11px/1 Pretendard, -apple-system, sans-serif; white-space: nowrap;
}
.dd-print-stagebox .dd-sp-box { position: absolute; border: 2px dashed #7460D9; border-radius: 4px; background: rgba(116,96,217,.06); }
.dd-print-stagebox .dd-sp-box .dd-sp-lb {
	position: absolute; left: -2px; top: -20px; min-width: 20px; height: 18px; padding: 0 5px; box-sizing: border-box;
	display: inline-flex; align-items: center; justify-content: center;
	background: #7460D9; color: #fff; border-radius: 4px 4px 4px 0;
	font: 700 10px/1 Pretendard, -apple-system, sans-serif;
}
@media print {
	body.dd-printing > *:not(#dd-print-stack) { display: none !important; }
	body.dd-printing #dd-print-stack { display: block !important; }
	.dd-print-page { break-after: page; page-break-after: always; }
	.dd-print-page:last-child { break-after: auto; page-break-after: auto; }
}
/* 화면 플로우맵 페이지(읽기전용) — 🗺 플로우맵 토글 시 전면 오버레이. 노드 박스 + goScreen 간선. */
#dd-flow-page { position: fixed; inset: 0; background: #f6f7f9; z-index: 99988; overflow: auto; display: none; }
#dd-flow-page.dd-on { display: block; }
#dd-flow-page .dd-fp-title { position: sticky; top: 0; padding: 10px 16px; font: 700 14px/1 Pretendard, sans-serif; color: #464f5b; background: rgba(246,247,249,.94); }
#dd-flow-page .dd-fp-canvas { position: relative; width: 100%; height: calc(100% - 40px); min-height: 420px; }
#dd-flow-page .dd-fp-edges { position: absolute; left: 0; top: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; }
#dd-flow-page .dd-fp-node {
	position: absolute; box-sizing: border-box; min-width: 96px; max-width: 200px; padding: 10px 14px;
	background: #fff; border: 2px solid #7460D9; border-radius: 10px; text-align: center;
	font: 700 13px/1.35 Pretendard, sans-serif; color: #1f2328; box-shadow: 0 2px 8px rgba(0,0,0,.10);
	white-space: pre-wrap; word-break: break-word; z-index: 3;
}
#dd-flow-page .dd-fp-node .dd-fp-id { display: block; margin-top: 3px; font: 500 10px/1 Pretendard, sans-serif; color: #8a8f98; }
#dd-flow-page .dd-fp-line { stroke: #7460D9; stroke-width: 2.5; fill: none; }
#dd-flow-page .dd-fp-label { position: absolute; transform: translate(-50%,-50%); padding: 2px 7px; background: #fff; border: 1px solid #cbd0d8; border-radius: 999px; font: 600 11px/1.3 Pretendard, sans-serif; color: #464f5b; white-space: nowrap; z-index: 3; }
`;

	// 저장본 안에서 실행될 본체 — 외부 스코프 참조 없음(toString 직렬화 안전). document 만 의존.
	function ddRuntimeMain() {
		'use strict';
		var doc = document, win = window;
		var dataEl = doc.getElementById('dd-annotations');
		if (!dataEl) return;
		var set;
		try { set = JSON.parse(dataEl.textContent); } catch (e) { return; }
		if (!set) return;
		// 주석이 하나도 없어도 flowMap(화면 플로우맵)이 있으면 렌더 진행 — 플로우맵만 있는 저장본도 유효.
		var hasFlow = !!(set.flowMap && Array.isArray(set.flowMap.nodes) && set.flowMap.nodes.length);
		if ((!set.annotations || !set.annotations.length) && !hasFlow) return;
		var anns = Array.isArray(set.annotations) ? set.annotations : (set.annotations = []);
		// spec-html 목업이면 자체 주석(area-rail·el-pin·매핑) 끄기 — dd 핀과 겹침 방지(dd 앱 clean 과 동일). 목업 좌하단 토글로 되돌릴 수 있다.
		try { var __isSpec = (typeof APP_DATA !== 'undefined' && APP_DATA && APP_DATA.screens) || (typeof SCREENS !== 'undefined' && SCREENS); if (__isSpec) doc.body.classList.add('clean'); } catch (e) {} // 두 방언(APP_DATA·SCREENS) 모두 clean
		// diff 상태 — 사용자 mark 우선(신규/기존), 없으면 origin 폴백. dd 앱 annotStatus 판박이.
		function annStatus(a) { if (a && a.mark && a.mark.kind) return a.mark.kind === '신규' ? 'new' : 'unchanged'; if (!a || a.origin !== 'draft') return 'new'; return a.edited ? 'modified' : 'unchanged'; }
		function annPhase(a) { return (a && a.mark && a.mark.kind === '신규' && a.mark.phase >= 2) ? a.mark.phase : 0; }
		function annBadgeLabel(a) { var st = annStatus(a); if (st === 'new') { var ph = annPhase(a); return ph ? '신규·' + ph + '차' : '신규'; } return st === 'modified' ? '수정' : '기존'; }
		function annTip(a) { var p = []; if (a.mark && a.mark.addedAt) p.push(a.mark.addedAt); if (a.mark && a.mark.reason) p.push(a.mark.reason); return p.join(' · '); }
		// 색 SSOT(자기완결 — core annotation-model 판박이). "색은 계속 달라야" → 차수·그룹 팔레트 순환.
		var PHASE_PAL = ['#18a558', '#D97706', '#0891B2', '#7C3AED', '#DB2777', '#CA8A04', '#0D9488', '#DC2626'];
		var GROUP_PAL = ['#7C3AED', '#EA580C', '#0891B2', '#DB2777', '#65A30D', '#2563EB', '#C026D3', '#0D9488'];
		function phaseCol(ph) { var p = (typeof ph === 'number' && ph >= 1) ? Math.floor(ph) : 1; return PHASE_PAL[(p - 1) % PHASE_PAL.length]; }
		function statusCol(a) { var st = annStatus(a); if (st === 'modified') return '#E08600'; if (st === 'unchanged') return '#6B7280'; return phaseCol(a && a.mark && a.mark.phase ? a.mark.phase : 1); }
		function groupCol(key) { if (!key) return null; var h = 0; for (var i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0; return GROUP_PAL[h % GROUP_PAL.length]; }
		function isGrp(a) { if (!a) return false; var i; if (a.parentId) { for (i = 0; i < anns.length; i++) if (anns[i].id === a.parentId) return true; } for (i = 0; i < anns.length; i++) if (anns[i].parentId === a.id) return true; return false; }
		function grpKey(a) { return a && a.parentId ? a.parentId : (a ? a.id : null); }
		function escHtml(s) { return String(s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }

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
		// 포인트 앵커 → 절대 점 {x,y} (화살표 끝점용). 해석 불가면 null.
		function ptOf(anchor, coord) {
			if (anchor && anchor.mode === 'element') {
				var t = queryEl(anchor.elementId);
				if (!renderable(t)) return null;
				var r = t.getBoundingClientRect();
				var p = pinPoint({ left: r.left, top: r.top, width: r.width, height: r.height }, anchor.offsetPct);
				return { x: p.left, y: p.top };
			}
			if (coord) {
				var base = basisEl(coord.basis);
				if (renderable(base) || base === doc.body) {
					var br = base.getBoundingClientRect();
					var p2 = coordRect(coord, { left: br.left, top: br.top, width: br.width, height: br.height });
					return { x: p2.left, y: p2.top };
				}
			}
			return null;
		}
		function esc(id) {
			return (win.CSS && win.CSS.escape) ? win.CSS.escape(id) : String(id).replace(/["\\]/g, '\\$&');
		}
		function queryEl(id) { return doc.querySelector('[data-element-id="' + esc(id) + '"]') || doc.querySelector('[data-field="' + esc(id) + '"]') || doc.querySelector('[data-el="' + esc(id) + '"]'); } // 앱 data-element-id + 어드민 data-field + 신방언 data-el
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
			try { if (typeof APP_DATA !== 'undefined' && APP_DATA) return APP_DATA.currentScreen || null; } catch (e) {}
			try { if (typeof STATE !== 'undefined' && STATE && STATE.cur) return STATE.cur; } catch (e) {} // 신 방언 STATE.cur
			for (var i = 0; i < anns.length; i++) { var s = anns[i].anchor && anns[i].anchor.screenSel; if (s) { var e = doc.querySelector(s); if (renderable(e)) return s; } } // generic 폴백
			return null;
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
		// M5.6 — 표지·History 앞 블록 (docMeta). dd 앱 docFrontHtml 판박이(마크업 동일, 클래스만 dd- prefix).
		function docFrontHtml(dm) {
			var h = '<div class="dd-cover"><div class="dd-cover-title">' + escHtml(dm.title || '(제목 없음)') + '</div>';
			if (dm.version) h += '<div class="dd-cover-ver">' + escHtml(dm.version) + '</div>';
			h += '</div>';
			if (dm.history && dm.history.length) {
				h += '<div class="dd-hist"><div class="dd-hist-h">변경 이력</div><table class="dd-hist-tbl"><thead><tr><th>No</th><th>날짜</th><th>버전</th><th>내용</th><th>작성</th></tr></thead><tbody>';
				for (var i = 0; i < dm.history.length; i++) {
					var r = dm.history[i];
					h += '<tr><td>' + escHtml(r.no) + '</td><td>' + escHtml(r.date) + '</td><td>' + escHtml(r.ver) + '</td><td>' + escHtml(r.content) + '</td><td>' + escHtml(r.author) + '</td></tr>';
				}
				h += '</tbody></table></div>';
			}
			return h;
		}

		for (var i = 0; i < anns.length; i++) {
			(function (a) {
				var el;
					if (a.type === 'text') { // 캔버스 텍스트 — 번호·배지·색 없이 내용만(읽기전용)
						el = doc.createElement('div'); el.className = 'dd-text';
						el.textContent = (a.body && a.body.plain) || '';
						el.setAttribute('data-dd-id', a.id);
						if (a.body && a.body.plain) el.title = a.body.plain;
						el.style.display = 'none';
						el.addEventListener('click', function (e) { e.stopPropagation(); selectAnn(a.id); });
						root.appendChild(el); nodes[a.id] = el;
						return;
					}
					if (a.type === 'arrow') { // 화살표 — root 전체 SVG + 라인/화살촉(읽기전용)
						var SVGNS = 'http://www.w3.org/2000/svg';
						el = doc.createElementNS(SVGNS, 'svg'); el.setAttribute('class', 'dd-arrow');
						el.style.position = 'absolute'; el.style.left = '0'; el.style.top = '0'; el.style.overflow = 'visible'; el.style.pointerEvents = 'none';
						el.setAttribute('data-dd-id', a.id);
						var acol = (a.mark && a.mark.kind === '신규') ? phaseCol(a.mark.phase || 1) : ((a.style && a.style.color) || '#7460D9'), amid = 'ah-' + a.id; // 색 SSOT 판박이 — 신규=차수색, 그 외=style.color(보라). 선+화살촉 동시.
						var adefs = doc.createElementNS(SVGNS, 'defs'), amk = doc.createElementNS(SVGNS, 'marker');
						amk.setAttribute('id', amid); amk.setAttribute('markerWidth', '10'); amk.setAttribute('markerHeight', '8'); amk.setAttribute('refX', '7'); amk.setAttribute('refY', '3'); amk.setAttribute('orient', 'auto'); amk.setAttribute('markerUnits', 'userSpaceOnUse');
						var ahd = doc.createElementNS(SVGNS, 'path'); ahd.setAttribute('d', 'M0,0 L8,3 L0,6 Z'); ahd.setAttribute('fill', acol); amk.appendChild(ahd); adefs.appendChild(amk); el.appendChild(adefs);
						var aln = doc.createElementNS(SVGNS, 'line'); aln.setAttribute('class', 'dd-arrow-line'); aln.setAttribute('stroke', acol); aln.setAttribute('stroke-width', '2.5'); aln.setAttribute('marker-end', 'url(#' + amid + ')'); aln.style.pointerEvents = 'stroke'; aln.style.cursor = 'pointer';
						el.appendChild(aln);
						if (a.mark && a.mark.kind) { var atip = annTip(a); el.title = atip ? '[' + annBadgeLabel(a) + '] ' + atip : '[' + annBadgeLabel(a) + ']'; } // 마킹된 화살표 툴팁(pin 판박이)
						el.style.display = 'none';
						el.addEventListener('click', function (e) { e.stopPropagation(); selectAnn(a.id); });
						root.appendChild(el); nodes[a.id] = el;
						return;
					}
				if (a.type === 'box') {
					el = doc.createElement('div'); el.className = 'dd-box' + (a.style && a.style.shape === 'ellipse' ? ' dd-ellipse' : '');
					var lb = doc.createElement('span'); lb.className = 'dd-box-label'; lb.textContent = a.label; el.appendChild(lb);
				} else {
					el = doc.createElement('div'); el.className = 'dd-pin'; el.textContent = a.label;
				}
				el.setAttribute('data-dd-id', a.id);
				var pst = annStatus(a); el.className += ' dd-st-' + pst;
				// 색 인라인 — 신규 차수색·수정 주황·기존 현행. 그룹(1-A/1-B) ring. dd 앱 applyPinColor 판박이.
				var fill = pst === 'new' ? phaseCol(a.mark && a.mark.phase ? a.mark.phase : 1) : (pst === 'modified' ? '#E08600' : (a.style && a.style.color ? a.style.color : null));
				if (fill) { if (a.type === 'box') { el.style.borderColor = fill; if (lb) lb.style.background = fill; } else el.style.background = fill; }
				var gc = isGrp(a) ? groupCol(grpKey(a)) : null;
				if (gc && a.type !== 'box') el.style.boxShadow = '0 0 0 2px #fff, 0 0 0 4px ' + gc + ', 0 1px 4px rgba(0,0,0,.35)';
				else if (gc) el.style.outline = '2px solid ' + gc;
				var pph = annPhase(a);
				if (pph) { el.className += ' dd-ph'; var pbg = doc.createElement('span'); pbg.className = 'dd-phase-badge'; pbg.textContent = pph + '차'; pbg.style.background = phaseCol(pph); el.appendChild(pbg); }
				if (a.type !== 'box' && a.mark && a.mark.addedAt) { var dc = doc.createElement('span'); dc.className = 'dd-date-cap'; dc.textContent = a.mark.addedAt; dc.style.color = statusCol(a); el.appendChild(dc); }
				var ptip = annTip(a); if (ptip) el.title = '[' + annBadgeLabel(a) + '] ' + ptip;
				el.style.display = 'none';
				el.addEventListener('click', function (e) { e.stopPropagation(); selectAnn(a.id); });
				root.appendChild(el);
				nodes[a.id] = el;
			})(anns[i]);
		}

		// ---- 우측 패널 (읽기전용 목록 + 설명) ----
		//   문서 뷰 토글 — 켜면 현재 화면 소속 핀만 표로(1세대 기획서 Description 표, 인쇄/PDF 대응),
		//   끄면 전체 목록(인터랙티브). 화면 전환 시 layout 이 감지해 문서 뷰 목록을 재렌더한다.
		var panel = doc.createElement('div');
		panel.id = 'dd-panel';
		var head = doc.createElement('div'); head.className = 'dd-p-head';
		var headTitle = doc.createElement('span'); head.appendChild(headTitle);
		var headBtns = doc.createElement('span'); headBtns.className = 'dd-p-btns';
		var docBtn = doc.createElement('button'); docBtn.className = 'dd-p-toggle'; docBtn.textContent = '문서 뷰';
		docBtn.title = '현재 화면 소속 핀만 표로 (인쇄/PDF 대응)';
		var printBtn = doc.createElement('button'); printBtn.className = 'dd-p-toggle'; printBtn.textContent = '🖨 전체 인쇄';
		printBtn.title = '모든 화면을 페이지로 쌓아 인쇄/PDF (1세대 기획서 포맷 — 화면명·목업·설명표)';
		var toggle = doc.createElement('button'); toggle.className = 'dd-p-toggle'; toggle.textContent = '접기';
		headBtns.appendChild(docBtn); headBtns.appendChild(printBtn); headBtns.appendChild(toggle);
		head.appendChild(headBtns);
		printBtn.addEventListener('click', function () { runPrintAll(); });
		toggle.addEventListener('click', function () {
			var c = panel.classList.toggle('dd-collapsed'); toggle.textContent = c ? '펼치기' : '접기';
		});
		var list = doc.createElement('ul'); list.className = 'dd-p-list';
		panel.appendChild(head); panel.appendChild(list);
		doc.body.appendChild(panel);
		var rows = {};
		var docMode = false;
		function sortedAnns() { return anns.slice().sort(function (a, b) { return (a.seq || 0) - (b.seq || 0); }); }
		// 문서 뷰 = 현재 화면 소속 + 화면 무관 좌표핀만. 화면 개념 없으면(generic) 전부. 인터랙티브면 전부.
		function visibleAnns() {
			var sa = sortedAnns();
			if (!docMode) return sa;
			var cur = curScreen();
			if (!cur) return sa;
			return sa.filter(function (a) {
				var sid = a.anchor && a.anchor.screenId;
				if (sid) return sid === cur;
				var ssel = a.anchor && a.anchor.screenSel;
				if (ssel) return renderable(doc.querySelector(ssel)); // generic — 지금 보이는 화면 핀만
				return true; // 화면 무관 좌표핀
			});
		}
		function renderList() {
			list.innerHTML = ''; rows = {};
			var sa = visibleAnns();
			headTitle.innerHTML = (docMode ? '문서 뷰 ' : '주석 ') + '<b>' + sa.length + '</b>';
			// M5.6 — 문서 뷰 최상단 표지·History 1회 (docMeta 있을 때). generic·이력 없으면 생략.
			if (docMode && set.docMeta) {
				var fli = doc.createElement('li'); fli.className = 'dd-p-front';
				fli.innerHTML = docFrontHtml(set.docMeta);
				list.appendChild(fli);
			}
			for (var j = 0; j < sa.length; j++) {
				(function (a) {
					var li = doc.createElement('li'); li.className = 'dd-p-row'; li.setAttribute('data-dd-id', a.id);
					var lst = annStatus(a);
					var isT = a.type === 'text' || a.type === 'arrow'; // 텍스트·화살표 = 번호·배지 없음
					// 색 SSOT 정합 — 신규 배지는 차수색(statusCol)을 핀과 동일하게 인라인(저장본 배경=흰색). 수정은 클래스 유지.
					var lbadge = '';
					if (!isT && lst === 'new') { var bc = statusCol(a); lbadge = '<span class="dd-p-badge dd-b-new" style="color:' + bc + ';background:color-mix(in srgb,' + bc + ' 18%,#fff)">' + annBadgeLabel(a) + '</span>'; }
					else if (!isT && lst === 'modified') { lbadge = '<span class="dd-p-badge dd-b-modified">' + annBadgeLabel(a) + '</span>'; }
					var lgc = isGrp(a) ? groupCol(grpKey(a)) : null; // 그룹색(1-A/1-B)
					var numStyle = lgc ? ' style="background:' + lgc + ';color:#fff"' : '';
					var lcap = (a.mark && (a.mark.addedAt || a.mark.reason)) ? '<div class="dd-p-mark" style="color:' + statusCol(a) + '">' + escHtml(annTip(a)) + '</div>' : ''; // 날짜·사유
					li.innerHTML = '<span class="dd-p-num' + (isT ? ' is-text' : '') + '"' + (isT ? '' : numStyle) + '>' + (a.type === 'text' ? 'T' : a.type === 'arrow' ? '↗' : a.label) + '</span>' + lbadge + '<div class="dd-p-body">' + slotHtml(a) + lcap + '</div>';
					if (lgc) li.style.borderLeft = '3px solid ' + lgc;
					if (a.parentId) li.style.paddingLeft = '18px';
					li.addEventListener('click', function () { selectAnn(a.id); });
					list.appendChild(li); rows[a.id] = li;
				})(sa[j]);
			}
			if (selected && rows[selected]) rows[selected].classList.add('dd-active');
		}
		docBtn.addEventListener('click', function () {
			docMode = !docMode;
			doc.body.classList.toggle('dd-doc-mode', docMode);
			doc.body.classList.toggle('dd-docview', docMode); // 목업 우측 화면정보(#description) 숨김
			docBtn.textContent = docMode ? '전체 보기' : '문서 뷰';
			docBtn.classList.toggle('dd-on', docMode);
			renderList();
		});
		renderList();
		function selectAnn(id) {
			selected = id;
			for (var k in nodes) if (nodes.hasOwnProperty(k)) nodes[k].classList.toggle('dd-active', k === id);
			for (var m in rows) if (rows.hasOwnProperty(m)) rows[m].classList.toggle('dd-active', m === id);
			if (rows[id]) rows[id].scrollIntoView({ block: 'nearest' });
		}

		// ---- 화면 플로우맵 페이지(읽기전용) — set.flowMap 노드/간선이 있을 때만 flow 버튼 노출 ----
		var flowMap = set.flowMap && Array.isArray(set.flowMap.nodes) && set.flowMap.nodes.length ? set.flowMap : null;
		var flowPage = null, flowOn = false;
		if (flowMap) {
			var flowBtn = doc.createElement('button'); flowBtn.className = 'dd-p-toggle'; flowBtn.textContent = '🗺 플로우맵';
			flowBtn.title = '화면 간 흐름도(읽기전용)';
			headBtns.insertBefore(flowBtn, toggle);
			flowBtn.addEventListener('click', function () {
				flowOn = !flowOn;
				if (!flowPage) flowPage = buildFlowPage();
				flowPage.classList.toggle('dd-on', flowOn);
				flowBtn.classList.toggle('dd-on', flowOn);
				if (flowOn) layoutFlowPage();
			});
		}
		function buildFlowPage() {
			var SVGNS2 = 'http://www.w3.org/2000/svg';
			var pg = doc.createElement('div'); pg.id = 'dd-flow-page';
			var ttl = doc.createElement('div'); ttl.className = 'dd-fp-title'; ttl.textContent = '🗺 화면 플로우맵';
			var cv = doc.createElement('div'); cv.className = 'dd-fp-canvas';
			var svg = doc.createElementNS(SVGNS2, 'svg'); svg.setAttribute('class', 'dd-fp-edges');
			cv.appendChild(svg); pg.appendChild(ttl); pg.appendChild(cv); doc.body.appendChild(pg);
			pg._cv = cv; pg._svg = svg; pg._nodeEls = {};
			for (var i = 0; i < flowMap.nodes.length; i++) {
				(function (n) {
					var el = doc.createElement('div'); el.className = 'dd-fp-node'; el.setAttribute('data-fid', n.id);
					el.textContent = n.label || n.screenId || '(화면)';
					if (n.screenId && n.screenId !== (n.label || '')) { var idc = doc.createElement('span'); idc.className = 'dd-fp-id'; idc.textContent = n.screenId; el.appendChild(idc); }
					cv.appendChild(el); pg._nodeEls[n.id] = el;
				})(flowMap.nodes[i]);
			}
			win.addEventListener('resize', function () { if (flowOn) layoutFlowPage(); });
			return pg;
		}
		function layoutFlowPage() {
			if (!flowPage) return;
			var SVGNS2 = 'http://www.w3.org/2000/svg';
			var cv = flowPage._cv, svg = flowPage._svg;
			var W = cv.clientWidth || 1, H = Math.max(cv.clientHeight, 420);
			for (var i = 0; i < flowMap.nodes.length; i++) {
				var n = flowMap.nodes[i], el = flowPage._nodeEls[n.id];
				if (el) { el.style.left = Math.round(n.x * W) + 'px'; el.style.top = Math.round(n.y * H) + 'px'; }
			}
			while (svg.firstChild) svg.removeChild(svg.firstChild);
			Array.prototype.slice.call(flowPage.querySelectorAll('.dd-fp-label')).forEach(function (l) { l.parentNode.removeChild(l); });
			svg.setAttribute('width', W); svg.setAttribute('height', H);
			var defs = doc.createElementNS(SVGNS2, 'defs'), mk = doc.createElementNS(SVGNS2, 'marker');
			mk.setAttribute('id', 'dd-fp-ah'); mk.setAttribute('markerWidth', '10'); mk.setAttribute('markerHeight', '8'); mk.setAttribute('refX', '7'); mk.setAttribute('refY', '3'); mk.setAttribute('orient', 'auto'); mk.setAttribute('markerUnits', 'userSpaceOnUse');
			var hd = doc.createElementNS(SVGNS2, 'path'); hd.setAttribute('d', 'M0,0 L8,3 L0,6 Z'); hd.setAttribute('fill', '#7460D9'); mk.appendChild(hd); defs.appendChild(mk); svg.appendChild(defs);
			function localRect(id) {
				var el = flowPage._nodeEls[id]; if (!el) return null;
				var cr = cv.getBoundingClientRect(), r = el.getBoundingClientRect();
				return { left: r.left - cr.left + cv.scrollLeft, top: r.top - cr.top + cv.scrollTop, width: r.width, height: r.height };
			}
			for (var j = 0; j < flowMap.edges.length; j++) {
				var e = flowMap.edges[j];
				var ra = localRect(e.from), rb = localRect(e.to);
				if (!ra || !rb) continue;
				var ca = { left: ra.left + ra.width / 2, top: ra.top + ra.height / 2 };
				var cb = { left: rb.left + rb.width / 2, top: rb.top + rb.height / 2 };
				var p1 = edgeClip(ra, cb.left, cb.top, 3), p2 = edgeClip(rb, ca.left, ca.top, 4);
				var ln = doc.createElementNS(SVGNS2, 'line');
				ln.setAttribute('class', 'dd-fp-line'); ln.setAttribute('marker-end', 'url(#dd-fp-ah)');
				ln.setAttribute('x1', p1.x); ln.setAttribute('y1', p1.y); ln.setAttribute('x2', p2.x); ln.setAttribute('y2', p2.y);
				svg.appendChild(ln);
				if (e.label) { var lb = doc.createElement('div'); lb.className = 'dd-fp-label'; lb.textContent = e.label; lb.style.left = ((p1.x + p2.x) / 2) + 'px'; lb.style.top = ((p1.y + p2.y) / 2) + 'px'; cv.appendChild(lb); }
			}
		}

		// ---- 레이아웃(요소/좌표 실시간 재계산) ----
		// 커넥터(Phase 4) — 대상 렉트 중심→상대점 방향 테두리 교점(+pad). 상대점이 렉트 안이면 그대로(역전 방지).
		function edgeClip(rect, tox, toy, pad) {
			var cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
			var dx = tox - cx, dy = toy - cy, dist = Math.sqrt(dx * dx + dy * dy);
			if (dist === 0) return { x: cx, y: cy };
			var hw = rect.width / 2, hh = rect.height / 2;
			var tx = dx !== 0 ? hw / Math.abs(dx) : Infinity, ty = dy !== 0 ? hh / Math.abs(dy) : Infinity;
			var t = Math.min(tx, ty);
			if (!isFinite(t) || t >= 1) return { x: tox, y: toy };
			t = Math.min(1, t + (pad || 0) / dist);
			return { x: cx + dx * t, y: cy + dy * t };
		}
		// 커넥터 끝점 해석 — 연결 대상 주석 노드가 보이면 그 렉트(따라감), 대상 숨김이면 hide, 아니면 자유 앵커.
		function arrowEnd(a, key, anchor, coord) {
			var cid = a.connect && a.connect[key];
			if (cid) {
				var found = false;
				for (var k = 0; k < anns.length; k++) if (anns[k].id === cid) { found = true; break; }
				if (found) {
					var n = nodes[cid];
					if (!n || n.style.display === 'none') return { hide: true };
					var r = n.getBoundingClientRect();
					return { rect: { left: r.left, top: r.top, width: r.width, height: r.height } };
				}
				// 대상 없음(비정상 저장본) — 자유 앵커 폴백
			}
			var p = ptOf(anchor, coord);
			return p ? { pt: p } : { hide: true };
		}
		var lastScreen; // 직전 화면 — 바뀌면 문서 뷰 목록을 현재 화면 기준으로 재렌더
		function layout() {
			if (!doc.body || !doc.getElementById('dd-overlay-root')) return;
			var rootRect = root.getBoundingClientRect();
			var screen = curScreen();
			if (screen !== lastScreen) { lastScreen = screen; if (docMode) renderList(); }
			var arrows = []; // 화살표는 2차 패스 — 커넥터가 대상(핀·박스) 이번 프레임 위치를 읽어야 해서 뒤로 미룬다
			for (var i = 0; i < anns.length; i++) {
				var a = anns[i], node = nodes[a.id];
				if (!node) continue;
				var abs = null;
				var gated = false;
				if (a.anchor && a.anchor.screenId && screen && a.anchor.screenId !== screen) gated = true;
				else if (a.anchor && a.anchor.screenSel && !renderable(doc.querySelector(a.anchor.screenSel))) gated = true; // generic 화면 컨테이너 숨김
				if (a.type === 'arrow') { arrows.push({ a: a, node: node, gated: gated }); continue; }
				if (gated) {
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
			// 2차 패스 — 화살표. 커넥터 끝점은 대상 노드 렉트 가장자리에 스냅(대상이 움직이면 따라감).
			for (var j = 0; j < arrows.length; j++) {
				var ar = arrows[j], an = ar.a, nd = ar.node;
				if (ar.gated) { nd.style.display = 'none'; continue; }
				var e1 = arrowEnd(an, 'from', an.anchor, an.coord), e2 = arrowEnd(an, 'to', an.anchor2, an.coord2);
				if (e1.hide || e2.hide) { nd.style.display = 'none'; continue; }
				var c1 = e1.rect ? { x: e1.rect.left + e1.rect.width / 2, y: e1.rect.top + e1.rect.height / 2 } : e1.pt;
				var c2 = e2.rect ? { x: e2.rect.left + e2.rect.width / 2, y: e2.rect.top + e2.rect.height / 2 } : e2.pt;
				var ap1 = e1.rect ? edgeClip(e1.rect, c2.x, c2.y, 4) : e1.pt;
				var ap2 = e2.rect ? edgeClip(e2.rect, c1.x, c1.y, 4) : e2.pt;
				if (!ap1 || !ap2) { nd.style.display = 'none'; continue; }
				nd.style.display = ''; nd.setAttribute('width', rootRect.width); nd.setAttribute('height', rootRect.height);
				nd.style.width = rootRect.width + 'px'; nd.style.height = rootRect.height + 'px';
				var lns = nd.getElementsByTagName('line');
				for (var li = 0; li < lns.length; li++) { lns[li].setAttribute('x1', ap1.x - rootRect.left); lns[li].setAttribute('y1', ap1.y - rootRect.top); lns[li].setAttribute('x2', ap2.x - rootRect.left); lns[li].setAttribute('y2', ap2.y - rootRect.top); }
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

		// ---- M5.6c 전 화면 인쇄 (페이지 스택) — 저장본 우선. 각 화면을 "화면명·목업·설명표" 1페이지로 쌓아 인쇄/PDF ----
		// 화면 목록 = 신버전 APP_DATA.screens(SSOT). 없으면 현재 1장 폴백(generic 전환함수 제각각 → v1 범위 밖, dd 앱 클론 인프라와 동일 방침).
		function listScreensRT() {
			try {
				var src = (typeof APP_DATA !== 'undefined' && APP_DATA && APP_DATA.screens) ? APP_DATA.screens
					: (typeof SCREENS !== 'undefined' && SCREENS) ? SCREENS : null; // 두 방언(APP_DATA·SCREENS)
				if (src) {
					return Object.keys(src).map(function (k) {
						var s = src[k] || {};
						return { id: s.id || k, name: s.name || s.id || k };
					}).filter(function (s) { return s.id; });
				}
			} catch (e) {}
			return [];
		}
		// 화면 전환 = 목업 goScreen(전역 함수) 우선, 없으면 nav 요소 click 폴백. 저장본은 목업 자체 문서라 goScreen 이 살아있다.
		function gotoScreenRT(id) {
			try { if (typeof goScreen === 'function') { goScreen(id); return true; } } catch (e) {}
			var nav = doc.querySelector('[data-screen="' + esc(id) + '"]');
			if (nav) { nav.click(); return true; }
			return false;
		}
		function raf2() { return new Promise(function (r) { win.requestAnimationFrame(function () { win.requestAnimationFrame(r); }); }); }
		function stageOf() {
			return doc.querySelector('#wireframe') || doc.querySelector('.frame-stage')
				|| doc.querySelector('.mobile-frame') || doc.querySelector('.web-frame') || doc.body;
		}
		// 라이브(전환된 화면) 기준 핀 절대좌표 → 스테이지 상대. layout() 의 abs 계산 판박이(root 대신 stageRect 기준).
		function pinAbsRel(a, stageRect) {
			var abs = null;
			if (a.anchor && a.anchor.mode === 'element') {
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
			if (!abs) return null;
			return { left: abs.left - stageRect.left, top: abs.top - stageRect.top, width: abs.width || 0, height: abs.height || 0 };
		}
		// 정적 핀 노드(인쇄용 — 클릭·추종 없음, 시각만). 상태색은 인라인, 모양은 .dd-print-stagebox 스코프 CSS.
		function buildStaticPin(a, rel) {
			var el, lb = null;
			if (a.type === 'box') {
				el = doc.createElement('div'); el.className = 'dd-sp-box';
				lb = doc.createElement('span'); lb.className = 'dd-sp-lb'; lb.textContent = a.label; el.appendChild(lb);
				el.style.width = Math.max(0, rel.width) + 'px'; el.style.height = Math.max(0, rel.height) + 'px';
			} else {
				el = doc.createElement('div'); el.className = 'dd-sp-pin'; el.textContent = a.label;
			}
			el.style.left = rel.left + 'px'; el.style.top = rel.top + 'px';
			var pst = annStatus(a);
			var fill = pst === 'new' ? phaseCol(a.mark && a.mark.phase ? a.mark.phase : 1) : (pst === 'modified' ? '#E08600' : (a.style && a.style.color ? a.style.color : '#7460D9'));
			if (a.type === 'box') { el.style.borderColor = fill; if (lb) lb.style.background = fill; }
			else el.style.background = fill;
			return el;
		}
		// 한 화면의 핀 목록 — screen 지정 시 그 screenId, 폴백(null)이면 지금 보이는 화면 기준(screenId·generic screenSel·무관 좌표핀).
		function pinsFor(screen) {
			var sa = sortedAnns();
			if (screen && screen.id) {
				return sa.filter(function (a) { return a.anchor && a.anchor.screenId === screen.id; });
			}
			var cur = curScreen();
			return sa.filter(function (a) {
				var sid = a.anchor && a.anchor.screenId; if (sid) return cur ? sid === cur : true;
				var ssel = a.anchor && a.anchor.screenSel; if (ssel) return renderable(doc.querySelector(ssel));
				return true;
			});
		}
		// 번호+설명 표(1세대 Description 표). 상태 배지는 인라인색.
		function buildDescTable(pins) {
			var box = doc.createElement('div'); box.className = 'dd-print-desc';
			if (!pins.length) { box.innerHTML = '<div style="color:#9aa0a6;font-size:11px">(이 화면 주석 없음)</div>'; return box; }
			var h = '<table><thead><tr><th class="dd-pd-num">#</th><th>설명</th></tr></thead><tbody>';
			for (var i = 0; i < pins.length; i++) {
				var a = pins[i];
				var badge = (annStatus(a) !== 'unchanged') ? ' <span style="font-size:9px;font-weight:700;color:' + statusCol(a) + '">[' + annBadgeLabel(a) + ']</span>' : '';
				h += '<tr><td class="dd-pd-num">' + escHtml(a.label) + '</td><td>' + slotHtml(a) + badge + '</td></tr>';
			}
			h += '</tbody></table>';
			box.innerHTML = h;
			return box;
		}
		// 라이브(현재 전환된) 화면을 1페이지로 — 스테이지 클론 + 핀 굽기 + 설명표.
		function buildScreenPageLive(screen) {
			var page = doc.createElement('section'); page.className = 'dd-print-page';
			var hd = doc.createElement('div'); hd.className = 'dd-print-hd';
			hd.textContent = screen ? (screen.name || screen.id) : (curScreen() || '화면');
			page.appendChild(hd);
			var wrap = doc.createElement('div'); wrap.className = 'dd-print-wrap';
			var live = stageOf();
			var stageRect = live.getBoundingClientRect();
			var stagebox = doc.createElement('div'); stagebox.className = 'dd-print-stagebox';
			stagebox.style.width = stageRect.width + 'px'; stagebox.style.height = stageRect.height + 'px';
			var clone = live.cloneNode(true);
			var jroot = clone.querySelector ? clone.querySelector('#dd-overlay-root') : null; if (jroot && jroot.parentNode) jroot.parentNode.removeChild(jroot);
			clone.style.position = 'absolute'; clone.style.left = '0'; clone.style.top = '0'; clone.style.margin = '0';
			stagebox.appendChild(clone);
			var pins = pinsFor(screen);
			for (var i = 0; i < pins.length; i++) {
				var rel = pinAbsRel(pins[i], stageRect);
				if (!rel) continue;
				stagebox.appendChild(buildStaticPin(pins[i], rel));
			}
			var mock = doc.createElement('div'); mock.className = 'dd-print-mock'; mock.appendChild(stagebox);
			wrap.appendChild(mock);
			wrap.appendChild(buildDescTable(pins));
			page.appendChild(wrap);
			return page;
		}
		// 전 화면 스택 조립(비동기 — 화면마다 전환 후 rAF 2틱 대기, M5.6a 검증 타이밍). 표지·History 앞 페이지.
		function buildPrintStack() {
			var stack = doc.createElement('div'); stack.id = 'dd-print-stack';
			if (set.docMeta) {
				var cover = doc.createElement('section'); cover.className = 'dd-print-page dd-print-cover';
				cover.innerHTML = docFrontHtml(set.docMeta);
				stack.appendChild(cover);
			}
			var screens = listScreensRT();
			if (screens.length === 0) { stack.appendChild(buildScreenPageLive(null)); return Promise.resolve(stack); }
			var saved = curScreen();
			var i = 0;
			function step() {
				if (i >= screens.length) {
					if (saved) gotoScreenRT(saved);
					return raf2().then(function () { return stack; });
				}
				gotoScreenRT(screens[i].id);
				return raf2().then(function () { stack.appendChild(buildScreenPageLive(screens[i])); i++; return step(); });
			}
			return step();
		}
		var printing = false;
		function runPrintAll() {
			if (printing) return; printing = true;
			buildPrintStack().then(function (stack) {
				doc.body.appendChild(stack);
				doc.body.classList.add('dd-printing');
				function cleanup() {
					try { if (stack.parentNode) stack.parentNode.removeChild(stack); } catch (e) {}
					doc.body.classList.remove('dd-printing');
					win.removeEventListener('afterprint', cleanup);
					printing = false;
					layout();
				}
				win.addEventListener('afterprint', cleanup);
				win.requestAnimationFrame(function () { win.requestAnimationFrame(function () { try { win.print(); } catch (e) { cleanup(); } }); });
			}).catch(function () { printing = false; });
		}
		win.__ddPrintAll = runPrintAll; // 스모크 훅(헤드리스에서 스택 조립만 검증)
		win.__ddBuildPrintStack = buildPrintStack; // 스모크 훅
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
