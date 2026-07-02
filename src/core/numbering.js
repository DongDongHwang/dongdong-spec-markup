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

	// 불변식 복구 — seq 1..n 연속(기존 seq 순서 보존) + autoNumber 라벨 = String(seq).
	function normalize(set) {
		const sorted = sortedBySeq(set);
		sorted.forEach((a, i) => {
			a.seq = i + 1;
			if (a.autoNumber) a.label = String(a.seq);
		});
		set.annotations = sorted;
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

	return { sortedBySeq, normalize, add, remove, moveTo, setLabel, setAuto };
});
