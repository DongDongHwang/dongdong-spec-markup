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

	// 커넥터 끝점(Phase 4) — 대상 렉트 중심에서 상대점(toward) 방향으로 나가 테두리와 만나는 점(+pad 여백).
	//   화살표가 연결된 핀·박스 "가장자리"에 붙게 한다. 상대점이 렉트 안이면 상대점 그대로(겹침 수용·역전 방지).
	function edgeClipPoint(rect, toward, pad) {
		const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
		const dx = toward.left - cx, dy = toward.top - cy;
		const dist = Math.sqrt(dx * dx + dy * dy);
		if (dist === 0) return { left: cx, top: cy };
		const hw = rect.width / 2, hh = rect.height / 2;
		const tx = dx !== 0 ? hw / Math.abs(dx) : Infinity;
		const ty = dy !== 0 ? hh / Math.abs(dy) : Infinity;
		let t = Math.min(tx, ty);
		if (!isFinite(t) || t >= 1) return { left: toward.left, top: toward.top }; // 상대점이 렉트 내부
		t = Math.min(1, t + (pad || 0) / dist); // 테두리에서 pad px 만큼 더 띄움(화살촉 여백)
		return { left: cx + dx * t, top: cy + dy * t };
	}

	// 드래그 → 정사각형 렉트 — side = max(|dx|,|dy|)(Figma/PPT 관례), 시작점 기준 드래그 방향 부호 유지(4사분면 대응).
	//   원 도구 기본 = 정원. Shift 자유 타원은 호출자가 이 함수를 건너뛴다. dx=0 등 축이 0이면 방향은 양수(우/하)로 폴백.
	function squareFromDrag(sx, sy, cx, cy) {
		const dx = cx - sx, dy = cy - sy;
		const side = Math.max(Math.abs(dx), Math.abs(dy));
		const signX = dx < 0 ? -1 : 1, signY = dy < 0 ? -1 : 1;
		const fx = sx + signX * side, fy = sy + signY * side; // 시작점에서 드래그 방향으로 side 만큼 나간 반대 코너
		return { left: Math.min(sx, fx), top: Math.min(sy, fy), width: side, height: side };
	}

	// 종횡비 잠금 리사이즈 — start={left,top,width,height}, dir='n'|'s'|'e'|'w'|'ne'|'nw'|'se'|'sw'.
	//   opts={min:12, aspect}. aspect 미지정 시 start.width/start.height 에서 계산(정원은 1, 기존 타원은 그 비율 유지).
	//   코너 = 반대 코너 고정 + 지배축(|dx| vs |dy| 큰 쪽)이 종횡비를 끌고 감.
	//   변(n/s/e/w) = 해당 축만 사용자 드래그로 변경 + 직교축은 비율 추종(직교축 중심 유지). 최소 가드는 양축을 비율 유지하며 지킨다.
	function resizeRectLocked(start, dir, dx, dy, opts) {
		const o = opts || {};
		const min = typeof o.min === 'number' ? o.min : 12;
		const aspect = (typeof o.aspect === 'number' && o.aspect > 0)
			? o.aspect
			: (start.height > 0 ? start.width / start.height : 1);
		const hasE = dir.indexOf('e') >= 0, hasW = dir.indexOf('w') >= 0;
		const hasN = dir.indexOf('n') >= 0, hasS = dir.indexOf('s') >= 0;
		const corner = (hasE || hasW) && (hasN || hasS);
		// 각 축 자유 변경량(핸들 방향 부호 반영) — 프레임 자유 리사이즈와 동일 부호 규칙.
		const wDelta = hasE ? dx : (hasW ? -dx : 0);
		const hDelta = hasS ? dy : (hasN ? -dy : 0);
		let width, height;
		if (corner) {
			if (Math.abs(dx) >= Math.abs(dy)) { width = start.width + wDelta; height = width / aspect; }
			else { height = start.height + hDelta; width = height * aspect; }
		} else if (hasE || hasW) {
			width = start.width + wDelta; height = width / aspect;
		} else {
			height = start.height + hDelta; width = height * aspect;
		}
		if (width < min) { width = min; height = width / aspect; }
		if (height < min) { height = min; width = height * aspect; }
		let left, top;
		if (corner) {
			left = hasW ? (start.left + start.width - width) : start.left;
			top = hasN ? (start.top + start.height - height) : start.top;
		} else if (hasE || hasW) {
			left = hasW ? (start.left + start.width - width) : start.left;
			top = (start.top + start.height / 2) - height / 2; // 직교축(세로) 중심 유지
		} else {
			top = hasN ? (start.top + start.height - height) : start.top;
			left = (start.left + start.width / 2) - width / 2; // 직교축(가로) 중심 유지
		}
		return { left, top, width, height };
	}

	return { clamp01, pinPointFromElement, boxRectFromElement, rectFromCoord, coordFromPoint, offsetPctFromPoint, coordFromRect, edgeClipPoint, squareFromDrag, resizeRectLocked };
});
