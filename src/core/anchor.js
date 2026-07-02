// 앵커↔좌표 변환 — 순수 기하 함수(DOM 무관). 렉트는 { left, top, width, height } 평면 객체.
//   원칙 = 저장은 비율/논리키, 렌더는 실시간 재계산. overlay.js 가 매 layout 마다 호출한다.
//   element 모드: 요소 렉트 기준 상대(offsetPct·rectPct) / coord 모드: 기준 컨테이너 렉트 기준 비율.
// UMD — node 테스트(require)와 브라우저(window.DDAnchor) 양쪽.

(function (root, factory) {
	'use strict';
	if (typeof module !== 'undefined' && module.exports) module.exports = factory();
	else root.DDAnchor = factory();
})(typeof self !== 'undefined' ? self : this, function () {
	'use strict';

	function clamp01(n) { return Math.max(0, Math.min(1, n)); }

	// 핀 절대점 — 요소 렉트 + 요소 내 상대 오프셋(offsetPct 기본 = 상단 중앙 {0.5, 0}).
	function pinPointFromElement(rect, offsetPct) {
		const dx = offsetPct && typeof offsetPct.dx === 'number' ? offsetPct.dx : 0.5;
		const dy = offsetPct && typeof offsetPct.dy === 'number' ? offsetPct.dy : 0;
		return { left: rect.left + dx * rect.width, top: rect.top + dy * rect.height };
	}

	// 박스 절대 렉트 — rectPct 없으면 요소 전체, 있으면 요소 기준 상대 렉트.
	function boxRectFromElement(rect, rectPct) {
		if (!rectPct) return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
		return {
			left: rect.left + rectPct.x * rect.width,
			top: rect.top + rectPct.y * rect.height,
			width: rectPct.w * rect.width,
			height: rectPct.h * rect.height,
		};
	}

	// coord 모드 절대 렉트 — 기준 컨테이너 렉트 × 비율. 핀은 w/h 없이 점만 쓴다.
	function rectFromCoord(coord, basisRect) {
		return {
			left: basisRect.left + coord.x * basisRect.width,
			top: basisRect.top + coord.y * basisRect.height,
			width: (coord.w || 0) * basisRect.width,
			height: (coord.h || 0) * basisRect.height,
		};
	}

	// 역변환 — 절대점 → 기준 컨테이너 비율 (M3 찍기에서 사용. 0 나눗셈 가드).
	function coordFromPoint(point, basisRect) {
		return {
			x: basisRect.width > 0 ? (point.left - basisRect.left) / basisRect.width : 0,
			y: basisRect.height > 0 ? (point.top - basisRect.top) / basisRect.height : 0,
		};
	}

	// 역변환 — 절대점 → 요소 내 상대 오프셋 (element 핀 찍기용. 요소 밖은 0~1 로 클램프).
	function offsetPctFromPoint(point, rect) {
		return {
			dx: rect.width > 0 ? clamp01((point.left - rect.left) / rect.width) : 0.5,
			dy: rect.height > 0 ? clamp01((point.top - rect.top) / rect.height) : 0,
		};
	}

	// 역변환 — 절대 렉트 → 기준 컨테이너 비율 렉트 (coord 박스 찍기용).
	function coordFromRect(absRect, basisRect) {
		const p = coordFromPoint(absRect, basisRect);
		return {
			x: p.x, y: p.y,
			w: basisRect.width > 0 ? absRect.width / basisRect.width : 0,
			h: basisRect.height > 0 ? absRect.height / basisRect.height : 0,
		};
	}

	return { clamp01, pinPointFromElement, boxRectFromElement, rectFromCoord, coordFromPoint, offsetPctFromPoint, coordFromRect };
});
