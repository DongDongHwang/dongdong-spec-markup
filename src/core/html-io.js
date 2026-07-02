// 저장 왕복 — 주석 JSON 을 원본 목업 HTML 에 무손상 append / 재개봉 시 추출·제거 (순수 문자열 로직).
//   불변식 = extract(embed(pure, ann)) === { pure, ann } (왕복 항등) / embed(embed(x)) 는 dd 블록 1세트 유지(멱등).
//   원본은 파싱·재직렬화하지 않는다 — 마지막 </body> 앞 문자열 append 만. 원본 무변형이 최우선.
//   M2 에서는 annotations JSON 블록만 심는다. 뷰어 런타임(style·script 인라인)은 M5 에서 같은 마커 안에 추가.
// UMD — node(require)와 브라우저(window.DDHtmlIO) 양쪽.

(function (root, factory) {
	'use strict';
	if (typeof module !== 'undefined' && module.exports) module.exports = factory();
	else root.DDHtmlIO = factory();
})(typeof self !== 'undefined' ? self : this, function () {
	'use strict';

	const BEGIN = '<!-- dd-spec-viewer:begin -->';
	const END = '<!-- dd-spec-viewer:end -->';
	const JSON_ID = 'dd-annotations';

	// JSON 직렬화 — 본문 리치텍스트에 '</script>' 가 들어와도 스크립트 블록이 안 깨지게 '<' 를 유니코드 이스케이프.
	function serializeSet(set) {
		return JSON.stringify(set).replace(/</g, '\\u003c');
	}

	// dd 블록 조립 — 마커로 감싼 형제 노드들. 원본과 항상 개행으로 분리.
	//   runtime({css,js}) 주면 브라우저 자기완결 뷰어(style+script)까지 같은 마커 안에 인라인.
	//   런타임 JS 안의 '</script>' 리터럴은 태그 조기 종료를 막기 위해 '<\/script>' 로 이스케이프.
	function buildBlock(set, runtime) {
		let s = BEGIN + '\n'
			+ '<script type="application/json" id="' + JSON_ID + '">' + serializeSet(set) + '</script>\n';
		if (runtime && runtime.css) s += '<style id="dd-runtime-style">' + String(runtime.css).replace(/<\/(style)>/gi, '<\\/$1>') + '</style>\n';
		if (runtime && runtime.js) s += '<script id="dd-runtime">' + String(runtime.js).replace(/<\/(script)>/gi, '<\\/$1>') + '</script>\n';
		return s + END;
	}

	// 주석 세트를 원본 HTML 에 심는다 — 기존 dd 블록이 있으면 제거 후 새로 1세트(멱등).
	//   삽입 지점 = 마지막 </body> 앞(대소문자 무관). 없으면 문서 끝에 append.
	//   runtime 선택 인자 = 브라우저 자기완결 뷰어(M5b). 없으면 JSON 블록만(M5a 동작·기존 테스트 호환).
	function embed(html, set, runtime) {
		const pure = strip(html);
		const block = buildBlock(set, runtime);
		const m = pure.match(/<\/body\s*>(?![\s\S]*<\/body\s*>)/i); // 마지막 </body>
		if (!m) return pure + (pure.endsWith('\n') ? '' : '\n') + block + '\n'; // 개행 중복 방지(멱등 유지)
		const at = m.index;
		return pure.slice(0, at) + block + '\n' + pure.slice(at);
	}

	// dd 블록 제거 — 순수 목업 반환. 블록 앞뒤에 embed 가 넣은 개행 1개까지만 함께 걷어 원문을 보존한다.
	function strip(html) {
		let out = String(html);
		let from;
		while ((from = out.indexOf(BEGIN)) !== -1) {
			const to = out.indexOf(END, from);
			if (to === -1) break; // 짝 없는 마커는 건드리지 않는다(원본 보존 우선)
			let head = from;
			let tail = to + END.length;
			if (out[tail] === '\n') tail++;
			out = out.slice(0, head) + out.slice(tail);
		}
		return out;
	}

	// 재개봉 — raw 에서 { pure, set } 추출. dd 블록 없으면 set = null.
	//   JSON 파싱 실패 시에도 pure 는 돌려준다(주석만 소실, 목업은 산다).
	function extract(raw) {
		const html = String(raw);
		const pure = strip(html);
		const re = new RegExp('<script type="application/json" id="' + JSON_ID + '">([\\s\\S]*?)</script>');
		const m = html.match(re);
		if (!m) return { pure, set: null };
		let set = null;
		try { set = JSON.parse(m[1]); } catch (_) { set = null; }
		return { pure, set };
	}

	return { BEGIN, END, JSON_ID, serializeSet, embed, strip, extract };
});
