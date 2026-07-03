// 번호 자유관리 — seq(정렬 순서)·label(표시 문자열)·autoNumber(자동/수동) 3필드 순수 로직 (DOM 무관).
//   룰 = 추가 시 자동 다음번호 / 삭제 시 뒤 당김(옵션) / 순서 이동 시 중간 삽입 밀기 /
//   라벨 직접 편집 시 수동 고정(autoNumber=false, 계층 1-1·커스텀 A 자유) / 자동 복귀 시 재번호.
//   normalize 가 불변식을 보장한다 — seq 는 항상 1..n 연속, autoNumber 주석의 label 은 String(seq).
// UMD — node 테스트(require)와 브라우저(window.DDNumbering) 양쪽.

(function (root, factory) {
	'use strict';
	if (typeof module !== 'undefined' && module.exports) module.exports = factory();
	else root.DDNumbering = factory();
})(typeof self !== 'undefined' ? self : this, function () {
	'use strict';

	function sortedBySeq(set) {
		return set.annotations.slice().sort((a, b) => a.seq - b.seq);
	}

	// 자식 순번 → 알파벳(1→A, 2→B … 27→AA). 1-A·1-B 계층 라벨용.
	function letter(n) {
		let s = '';
		while (n > 0) { n--; s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26); }
		return s;
	}

	// 계층 라벨 재계산 — 최상위(부모 없음/고아)는 정수, 자식은 "부모라벨-A/B". 수동 고정(autoNumber=false)은 안 건드림.
	//   계층이 하나도 없으면 전부 최상위라 label = 1,2,3… (기존 동작과 동일 — 하위호환).
	function relabel(set) {
		const byId = {};
		set.annotations.forEach((a) => { byId[a.id] = a; });
		const isTop = (a) => !a.parentId || !byId[a.parentId];
		const sorted = sortedBySeq(set);
		let top = 0;
		sorted.forEach((a) => { if (a.type === 'text') return; if (isTop(a)) { top++; if (a.autoNumber) a.label = String(top); } }); // 텍스트는 번호 시퀀스 제외
		const childCount = {};
		sorted.forEach((a) => {
			if (a.type === 'text') return; // 텍스트는 계층·번호 없음
			if (isTop(a) || !a.autoNumber) return;
			const parent = byId[a.parentId];
			const prefix = parent ? parent.label : '?';
			childCount[a.parentId] = (childCount[a.parentId] || 0) + 1;
			a.label = prefix + '-' + letter(childCount[a.parentId]);
		});
	}

	// 불변식 복구 — seq 1..n 연속(기존 seq 순서 보존) + 계층 라벨 재계산.
	function normalize(set) {
		const sorted = sortedBySeq(set);
		sorted.forEach((a, i) => { a.seq = i + 1; });
		set.annotations = sorted;
		relabel(set);
		return set;
	}

	// 추가 — 맨 뒤 자동 다음번호. ann.seq/label 은 여기서 확정된다.
	function add(set, ann) {
		ann.seq = set.annotations.length + 1;
		if (ann.autoNumber) ann.label = String(ann.seq);
		set.annotations.push(ann);
		return normalize(set);
	}

	// 삭제 — pullBack !== false 면 뒤 번호 당김(기본). false 면 seq 만 압축하고 자동 라벨도 당겨지는 게
	//   normalize 불변식이라, "당김 없이 구멍 유지" 는 라벨을 수동 고정으로 바꿔 보존한다.
	function remove(set, id, opts) {
		const i = set.annotations.findIndex((a) => a.id === id);
		if (i === -1) return set;
		set.annotations.splice(i, 1);
		if (opts && opts.pullBack === false) {
			for (const a of set.annotations) if (a.autoNumber) { a.autoNumber = false; } // 현재 라벨 그대로 동결
		}
		return normalize(set);
	}

	// 순서 이동 — id 를 newSeq 자리(1-based)로. 사이 주석들이 밀리고 자동 라벨은 재번호.
	function moveTo(set, id, newSeq) {
		const sorted = sortedBySeq(set);
		const i = sorted.findIndex((a) => a.id === id);
		if (i === -1) return set;
		const [ann] = sorted.splice(i, 1);
		const at = Math.max(0, Math.min(sorted.length, Math.round(newSeq) - 1));
		sorted.splice(at, 0, ann);
		sorted.forEach((a, idx) => { a.seq = idx + 1; });
		set.annotations = sorted;
		return normalize(set);
	}

	// 라벨 직접 편집 — 수동 고정. 계층(1-1·2-1)·커스텀(A) 자유 문자열.
	function setLabel(set, id, label) {
		const a = set.annotations.find((x) => x.id === id);
		if (!a) return set;
		a.label = String(label);
		a.autoNumber = false;
		return set;
	}

	// 자동 번호 복귀 — seq 위치 기준으로 재번호.
	function setAuto(set, id) {
		const a = set.annotations.find((x) => x.id === id);
		if (!a) return set;
		a.autoNumber = true;
		return normalize(set);
	}

	// 부모 지정 — id 를 parentId 의 자식(1-A…)으로. parentId=null 이면 최상위로 승격.
	//   1단계 계층만 — 이미 자식을 가진 핀은 부모가 될 수 없고(자식의 자식 금지), 자기 자신도 불가.
	//   자식은 부모 및 부모의 기존 자식들 바로 뒤 seq 로 이동(목록에서 가족이 인접).
	function setParent(set, id, parentId) {
		const a = set.annotations.find((x) => x.id === id);
		if (!a || id === parentId) return set;
		if (parentId) {
			const parent = set.annotations.find((x) => x.id === parentId);
			if (!parent) return set;
			if (parent.parentId) return set;                         // 부모가 이미 자식 → 2단계 금지
			if (set.annotations.some((x) => x.parentId === id)) return set; // 내가 이미 부모 → 자식으로 못 감
			a.parentId = parentId;
			a.autoNumber = true;
			const sorted = sortedBySeq(set).filter((x) => x.id !== id);
			let insertAt = sorted.length;
			for (let i = 0; i < sorted.length; i++) {
				const x = sorted[i];
				if (x.id === parentId || x.parentId === parentId) insertAt = i + 1;
			}
			sorted.splice(insertAt, 0, a);
			sorted.forEach((x, i) => { x.seq = i + 1; });
			set.annotations = sorted;
		} else {
			a.parentId = null;
			a.autoNumber = true;
		}
		return normalize(set);
	}

	// 그룹 헬퍼(색용) — 자식이거나 자식을 가진 부모면 "그룹의 일원". 그룹키 = 부모 id(부모·자식 공통).
	function childrenOf(set, id) { return set.annotations.filter((x) => x.parentId === id); }
	function isGrouped(set, a) {
		if (!a) return false;
		if (a.parentId && set.annotations.some((x) => x.id === a.parentId)) return true;
		return set.annotations.some((x) => x.parentId === a.id);
	}
	function groupKey(a) { return a && a.parentId ? a.parentId : (a ? a.id : null); }

	return { sortedBySeq, normalize, add, remove, moveTo, setLabel, setAuto, setParent, childrenOf, isGrouped, groupKey };
});
