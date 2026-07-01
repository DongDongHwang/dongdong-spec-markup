// 렌더러 — CmdMD MarkdownRenderer 의 변환 순서를 이식한 마크다운 -> HTML 파이프라인.
//   1) 코드/수식 마스킹 (private-use 토큰으로 치환해 정규식 변환이 코드를 안 건드리게)
//   2) Obsidian 확장 정규식 변환 (위키링크 / 임베드 / ==하이라이트== / #태그 / 콜아웃)
//   3) markdown-it 파싱
//   4) 마스킹 복원 (코드는 highlight.js, 수식은 KaTeX auto-render 가 처리)
//   5) Mermaid / KaTeX 실행
// 전체 파리티(콜아웃 접기·태스크 토글·임베드 해석)는 다음 마일스톤. 지금은 코어 렌더 증명.

'use strict';

const OPEN = '';
const CLOSE = '';

const md = window.markdownit({ html: true, linkify: true, typographer: false, breaks: false });

function htmlEscape(s) {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
}

// 코드/수식을 토큰으로 마스킹. 복원에 필요한 정보를 store 에 적재.
function maskCodeAndMath(text) {
	const store = [];
	const tok = (kind, payload) => {
		const i = store.length;
		store.push({ kind, payload });
		return `${OPEN}${i}${CLOSE}`;
	};

	let out = text;
	// 1. 펜스 코드 ```lang\n...\n```
	out = out.replace(/```([^\n`]*)\n([\s\S]*?)```/g, (_m, lang, code) =>
		tok('fenced', { lang: (lang || '').trim(), code })
	);
	// 2. 블록 수식 $$...$$
	out = out.replace(/\$\$([\s\S]+?)\$\$/g, (_m, math) => tok('mathBlock', { math }));
	// 3. 인라인 코드 `code`
	out = out.replace(/`([^`\n]+)`/g, (_m, code) => tok('inlineCode', { code }));
	// 4. 인라인 수식 $...$ (공백으로 시작/끝나지 않을 때만 — 통화 표기 오인 방지)
	out = out.replace(/\$(?!\s)([^$\n]+?)(?<!\s)\$/g, (_m, math) => tok('mathInline', { math }));

	return { text: out, store };
}

// Obsidian 확장 변환 (마스킹된 텍스트 위에서)
function applyObsidianTransforms(text) {
	let out = text;
	// 임베드 ![[target]] (위키링크보다 먼저)
	out = out.replace(/!\[\[([^\]]+)\]\]/g, (_m, target) => {
		const t = htmlEscape(target.trim());
		return `<span class="embed" data-embed="${t}">![[${t}]]</span>`;
	});
	// 위키링크 [[target|alias]] / [[target]]
	out = out.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, target, alias) => {
		const t = htmlEscape(target.trim());
		const label = htmlEscape((alias || target).trim());
		return `<a href="#" class="wikilink" data-note="${t}">${label}</a>`;
	});
	// ==하이라이트==
	out = out.replace(/==([^=\n]+)==/g, (_m, t) => `<mark>${t}</mark>`);
	// #태그 (줄머리/공백 뒤, 한글·영문·숫자·_·/·- 허용)
	out = out.replace(/(^|\s)#([A-Za-z0-9_가-힣/\-]+)/g, (_m, pre, tag) =>
		`${pre}<span class="tag">#${tag}</span>`
	);
	return out;
}

// markdown-it 결과 HTML 안의 토큰을 실제 마크업으로 복원
function restore(html, store) {
	let out = html;
	for (let i = 0; i < store.length; i++) {
		const { kind, payload } = store[i];
		const token = `${OPEN}${i}${CLOSE}`;
		const wrapped = `<p>${token}</p>`; // 블록 토큰이 <p> 로 감싸진 경우
		let replacement;
		switch (kind) {
			case 'fenced':
				if (payload.lang === 'mermaid') {
					replacement = `<pre class="mermaid">${htmlEscape(payload.code)}</pre>`;
				} else {
					const cls = payload.lang ? ` class="language-${htmlEscape(payload.lang)}"` : '';
					replacement = `<pre><code${cls}>${htmlEscape(payload.code)}</code></pre>`;
				}
				out = out.split(wrapped).join(replacement).split(token).join(replacement);
				break;
			case 'mathBlock':
				// KaTeX auto-render 가 처리하도록 원래 구분자 복원
				replacement = `<p>$$${payload.math}$$</p>`;
				out = out.split(wrapped).join(replacement).split(token).join(`$$${payload.math}$$`);
				break;
			case 'inlineCode':
				replacement = `<code>${htmlEscape(payload.code)}</code>`;
				out = out.split(token).join(replacement);
				break;
			case 'mathInline':
				out = out.split(token).join(`$${payload.math}$`);
				break;
			default:
				out = out.split(token).join('');
		}
	}
	return out;
}

function renderMarkdown(body) {
	const masked = maskCodeAndMath(body);
	const transformed = applyObsidianTransforms(masked.text);
	const parsed = md.render(transformed);
	return restore(parsed, masked.store);
}

function runEnhancers(root) {
	// 코드 하이라이트
	if (window.hljs) {
		root.querySelectorAll('pre code').forEach((el) => {
			try { window.hljs.highlightElement(el); } catch (e) {}
		});
	}
	// Mermaid
	if (window.mermaid && root.querySelector('pre.mermaid')) {
		try {
			window.mermaid.initialize({ startOnLoad: false });
			window.mermaid.run({ nodes: root.querySelectorAll('pre.mermaid') });
		} catch (e) {}
	}
	// KaTeX
	if (window.renderMathInElement) {
		try {
			window.renderMathInElement(root, {
				delimiters: [
					{ left: '$$', right: '$$', display: true },
					{ left: '$', right: '$', display: false },
					{ left: '\\[', right: '\\]', display: true },
					{ left: '\\(', right: '\\)', display: false },
				],
				throwOnError: false,
			});
		} catch (e) {}
	}
}

// ---- Obsidian 확장 후처리 (markdown-it 파싱 후 DOM 조작) --------------------

function calloutDefaultTitle(type) {
	return type.charAt(0).toUpperCase() + type.slice(1);
}

// blockquote 첫 줄이 [!type] 이면 콜아웃 구조로 변환. +/- 로 접기 상태 결정.
function enhanceCallouts(root) {
	root.querySelectorAll('blockquote').forEach((bq) => {
		const firstP = bq.querySelector(':scope > p');
		if (!firstP) return;
		const html = firstP.innerHTML;
		const nlIdx = html.indexOf('\n');
		const firstLineHtml = nlIdx >= 0 ? html.slice(0, nlIdx) : html;
		const restHtml = nlIdx >= 0 ? html.slice(nlIdx + 1) : '';
		const probe = document.createElement('div');
		probe.innerHTML = firstLineHtml;
		const m = probe.textContent.match(/^\s*\[!([A-Za-z\-]+)\]([+-]?)\s*(.*)$/);
		if (!m) return;
		const type = m[1].toLowerCase();
		const fold = m[2]; // '' | '+' | '-'
		const titleText = m[3].trim();

		const callout = document.createElement('div');
		callout.className = 'callout';
		callout.dataset.callout = type;
		if (fold) callout.classList.add('is-foldable');
		if (fold === '-') callout.classList.add('is-collapsed');

		const titleEl = document.createElement('div');
		titleEl.className = 'callout-title';
		const inner = document.createElement('span');
		inner.className = 'callout-title-inner';
		inner.textContent = titleText || calloutDefaultTitle(type);
		titleEl.appendChild(inner);
		if (fold) {
			const foldEl = document.createElement('span');
			foldEl.className = 'callout-fold';
			titleEl.appendChild(foldEl);
		}

		const contentEl = document.createElement('div');
		contentEl.className = 'callout-content';
		firstP.innerHTML = restHtml;
		if (!restHtml.trim()) firstP.remove();
		while (bq.firstChild) contentEl.appendChild(bq.firstChild);

		callout.appendChild(titleEl);
		callout.appendChild(contentEl);
		bq.replaceWith(callout);
	});
}

// el 의 첫 번째 자식이 텍스트 노드면 반환 (태스크 마커 [ ]/[x] 탐지용)
function firstTextNode(el) {
	for (const n of el.childNodes) {
		if (n.nodeType === 3) return n;
		if (n.nodeType === 1) return null; // 첫 자식이 엘리먼트면 태스크 마커 아님
	}
	return null;
}

// 리스트 항목 [ ]/[x] 를 체크박스로 변환 (이번 스코프 = 렌더 + 시각 토글, 파일 미저장)
function enhanceTasks(root) {
	root.querySelectorAll('li').forEach((li) => {
		const p = li.querySelector(':scope > p');
		const host = p || li;
		const node = firstTextNode(host);
		if (!node) return;
		const m = node.nodeValue.match(/^\s*\[([ xX])\]\s+/);
		if (!m) return;
		const checked = m[1].toLowerCase() === 'x';
		node.nodeValue = node.nodeValue.slice(m[0].length);
		const cb = document.createElement('input');
		cb.type = 'checkbox';
		cb.className = 'task-checkbox';
		cb.checked = checked;
		host.insertBefore(cb, host.firstChild);
		li.classList.add('task-item');
		if (checked) li.classList.add('is-done');
	});
}

// 넓은 표가 본문 폭을 넘어 오른쪽 컬럼이 잘리는 것을 막는다 — 가로 스크롤 래퍼로 감싼다.
function enhanceTables(root) {
	root.querySelectorAll('table').forEach((tb) => {
		const parent = tb.parentElement;
		if (parent && parent.classList.contains('table-scroll')) return; // 이미 감쌈
		const wrap = document.createElement('div');
		wrap.className = 'table-scroll';
		tb.replaceWith(wrap);
		wrap.appendChild(tb);
	});
}

const EMBED_IMG_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'];

// ![[target]] 해석 — 이미지면 메인에 resolve 요청해 인라인 표시, 노트면 열기 링크로.
async function enhanceEmbeds(root, docPath) {
	const spans = root.querySelectorAll('span.embed[data-embed]');
	for (const span of spans) {
		const target = span.dataset.embed;
		const ext = (target.split('.').pop() || '').toLowerCase();
		const isImg = EMBED_IMG_EXT.includes(ext);
		if (isImg && window.cmdmd && window.cmdmd.resolveEmbed) {
			let dataUrl = null;
			try {
				dataUrl = await window.cmdmd.resolveEmbed(target, docPath);
			} catch (e) {
				dataUrl = null;
			}
			if (dataUrl) {
				const img = document.createElement('img');
				img.src = dataUrl;
				img.alt = target;
				img.className = 'embed-img';
				span.replaceWith(img);
			} else {
				span.classList.add('embed-missing');
				span.textContent = `🖼 ${target} (찾지 못함)`;
			}
		} else {
			// 노트 임베드 → 열기 링크 (재귀 렌더는 다음 차수)
			const a = document.createElement('a');
			a.href = '#';
			a.className = 'wikilink embed-note';
			a.dataset.note = target;
			a.textContent = target;
			span.replaceWith(a);
		}
	}
}

// 표준 마크다운 이미지 ![alt](경로) 해석 — 로컬 경로는 메인에 resolve 요청해 인라인 표시.
// (원격 http/https·data URL 은 그대로 두고, ![[임베드]] 로 이미 처리된 img 는 건너뛴다.)
async function enhanceImages(root, docPath) {
	const imgs = root.querySelectorAll('img');
	for (const img of imgs) {
		const src = img.getAttribute('src') || '';
		if (!src || /^(https?:|data:)/i.test(src)) continue;
		if (img.classList.contains('embed-img')) continue; // 위키 임베드로 이미 변환됨
		let name = src;
		try { name = decodeURIComponent(src); } catch (e) { name = src; }
		let dataUrl = null;
		if (window.cmdmd && window.cmdmd.resolveEmbed) {
			try { dataUrl = await window.cmdmd.resolveEmbed(name, docPath); } catch (e) { dataUrl = null; }
		}
		if (dataUrl) {
			img.src = dataUrl;
			img.classList.add('embed-img');
		} else {
			const span = document.createElement('span');
			span.className = 'embed-missing';
			span.textContent = `🖼 ${src} (찾지 못함)`;
			img.replaceWith(span);
		}
	}
}

// ---- 편집 그룹 + 탭 모델 (VS Code 식) --------------------------------------
// v1.0 의 "문서 1개 전역 상태" 를 Tab(문서 뷰) 단위로 내린다. Group(열)은 탭들을 담는다.
// 5a 는 그룹 1·탭 1 로만 동작(v1.0 패리티). 탭 추가·분할 버튼은 5b.
const docpath = document.getElementById('docpath');
const editBtn = document.getElementById('edit-btn');
const saveBtn = document.getElementById('save-btn');
const cancelBtn = document.getElementById('cancel-btn');
const splitBtn = document.getElementById('split-btn');
const newWinBtn = document.getElementById('newwin-btn');
const panes = document.getElementById('panes');

// 문서 없을 때 첫 탭에 표시하는 웰컴 (과거 index.html 의 .empty 를 JS 로 이관).
// 볼트 감지 안내는 사이드바 #vault-section 으로 이관 — 여기선 기본 열기 안내만.
const WELCOME_HTML =
	'<div class="empty">' +
	'<h2>Dong Dong Spec Viewer for Windows</h2>' +
	'<p><kbd>Ctrl</kbd>+<kbd>O</kbd> 로 파일을, <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>O</kbd> 로 폴더를 열면 바로 렌더 프리뷰가 표시됩니다.</p>' +
	'<p class="muted">Obsidian 볼트를 쓰신다면 왼쪽 <b>내 Obsidian 볼트</b> 목록에서 바로 열 수 있어요.</p>' +
	'</div>';

const MAX_GROUPS = 5; // 분할 최대 열 수 (동동이 지시: 3→5)
let groupSeq = 0;
let tabSeq = 0;
const groups = []; // Group[] (1~5)
let activeGroupId = null;
let dragTab = null; // 드래그 중인 탭 { tab, group } (탭 드래그 이동)

function activeGroup() { return groups.find((g) => g.id === activeGroupId) || groups[0] || null; }
function activeTabOf(g) { return g ? g.tabs.find((t) => t.id === g.activeTabId) || null : null; }
function activeTab() { return activeTabOf(activeGroup()); }
function groupOf(tab) { return groups.find((g) => g.id === tab.groupId) || null; }
function currentPath() { const t = activeTab(); return t ? t.docPath : ''; }

// 그룹(열) 생성 — .tabstrip(탭 칩, 5b) + .group-body(활성 탭의 content/editor)
function createGroup() {
	const id = 'g' + (++groupSeq);
	const el = document.createElement('div');
	el.className = 'group';
	el.dataset.group = id;
	const tabstripEl = document.createElement('div');
	tabstripEl.className = 'tabstrip';
	const bodyEl = document.createElement('div');
	bodyEl.className = 'group-body';
	el.append(tabstripEl, bodyEl);
	const group = { id, el, tabstripEl, bodyEl, tabs: [], activeTabId: null, flex: 1 };
	groups.push(group);
	panes.appendChild(el);
	el.addEventListener('mousedown', () => setActiveGroup(id)); // 클릭 시 활성 그룹 전환
	// 탭 드래그 이동 — 이 열의 탭바가 드롭 타깃(분할 상태엔 1-탭 열도 탭바가 보여 열 전체가 드롭존)
	tabstripEl.addEventListener('dragover', (e) => {
		if (!dragTab) return;
		e.preventDefault();
		e.dataTransfer.dropEffect = 'move';
		tabstripEl.classList.add('drag-over');
	});
	tabstripEl.addEventListener('dragleave', () => tabstripEl.classList.remove('drag-over'));
	tabstripEl.addEventListener('drop', (e) => { tabstripEl.classList.remove('drag-over'); onTabDrop(e, group); });
	// 탭 많을 때 세로 휠 → 가로 스크롤 (넘칠 때만)
	tabstripEl.addEventListener('wheel', (e) => {
		if (e.deltaY !== 0 && tabstripEl.scrollWidth > tabstripEl.clientWidth) {
			tabstripEl.scrollLeft += e.deltaY;
			e.preventDefault();
		}
	});
	updatePanesMulti(); // 그룹 2개+ 이면 활성 그룹 강조 켜기 + 분할 버튼 상한 반영
	return group;
}

// 탭(문서 뷰) 생성 — 탭마다 자기 content/editor DOM 을 소유(렌더 1회·독립 스크롤).
function createTab(group) {
	const id = 't' + (++tabSeq);
	const contentEl = document.createElement('main');
	contentEl.className = 'markdown-body content';
	const editorEl = document.createElement('textarea');
	editorEl.className = 'editor hidden';
	editorEl.spellcheck = false;
	editorEl.setAttribute('wrap', 'soft');
	const tab = {
		id, groupId: group.id, docPath: '', raw: '', exists: true,
		contentEl, editorEl, scrollTop: 0,
		navHistory: [], navIndex: -1, dirty: false, editMode: false,
	};
	group.bodyEl.append(contentEl, editorEl);
	attachContentHandlers(tab);
	editorEl.addEventListener('input', () => {
		if (!tab.dirty) { tab.dirty = true; renderTabstrip(groupOf(tab)); } // 첫 변경 시 탭에 • 표시
	});
	contentEl.addEventListener('scroll', () => { if (!tab.editMode) tab.scrollTop = contentEl.scrollTop; });
	group.tabs.push(tab);
	return tab;
}

// 콜아웃 접기 + 태스크 시각 토글 + 링크 이동 (탭 content 별 1회 위임 바인딩)
function attachContentHandlers(tab) {
	tab.contentEl.addEventListener('click', async (e) => {
		const link = e.target.closest('a');
		if (link) {
			const note = link.dataset.note;
			const href = link.getAttribute('href') || '';
			if (note) {
				e.preventDefault();
				const target = await window.cmdmd.resolveNote(note, tab.docPath);
				if (target) {
					if (confirmLeaveEdit()) openInActiveGroup(target);
				} else {
					link.classList.add('wikilink-missing');
					link.title = '노트를 찾지 못했습니다';
				}
				return;
			}
			if (/^(https?:|mailto:)/i.test(href)) { e.preventDefault(); window.cmdmd.openExternal(href); return; }
			if (href.startsWith('#') || href === '') { e.preventDefault(); return; } // 같은 문서 앵커/빈 링크
		}
		const title = e.target.closest('.callout.is-foldable > .callout-title');
		if (title) { title.parentElement.classList.toggle('is-collapsed'); return; }
		const cb = e.target.closest('.task-checkbox');
		if (cb) { const li = cb.closest('.task-item'); if (li) li.classList.toggle('is-done', cb.checked); }
	});
}

// 활성 그룹 전환 (5b 에서 시각 강조·topbar 반영)
function setActiveGroup(id) {
	if (!groups.some((g) => g.id === id)) return;
	activeGroupId = id;
	for (const g of groups) g.el.classList.toggle('is-active', g.id === id);
	syncTopbar();
}

// 그룹 내 활성 탭 표시 — 활성 탭만 content(또는 편집 중이면 editor) 노출, 나머지 숨김.
function showTab(group, tabId) {
	group.activeTabId = tabId;
	for (const t of group.tabs) {
		const on = t.id === tabId;
		t.contentEl.classList.toggle('hidden', !on || t.editMode);
		t.editorEl.classList.toggle('hidden', !on || !t.editMode);
	}
	const t = group.tabs.find((x) => x.id === tabId);
	if (t && !t.editMode) t.contentEl.scrollTop = t.scrollTop; // 탭별 스크롤 복원
	renderTabstrip(group);
	if (group.id === activeGroupId) syncTopbar();
}

// 탭 제목 — 파일명(확장자 제거), 빈 문서는 '새 문서'.
function tabTitle(t) {
	if (!t.docPath) return '새 문서';
	const base = t.docPath.split(/[\\/]/).pop() || t.docPath;
	return base.replace(MD_NAME_RE, '');
}

// 탭 칩 렌더. 탭 1개면 탭바를 비워 둔다(.tabstrip:empty 로 접힘 → 단일 문서는 v1.0 처럼 간결).
function renderTabstrip(group) {
	group.tabstripEl.innerHTML = '';
	if (groups.length <= 1 && group.tabs.length <= 1) return; // 비분할 단일 문서만 탭바 숨김(분할 상태엔 1-탭 열도 칩+× 노출 → × 로 분할 해제)
	for (const t of group.tabs) {
		const chip = document.createElement('div');
		chip.className = 'tab' + (t.id === group.activeTabId ? ' is-active' : '') + (t.dirty ? ' is-dirty' : '');
		chip.title = t.docPath || '(빈 문서)';
		const label = document.createElement('span');
		label.className = 'tab-label';
		label.textContent = tabTitle(t);
		const close = document.createElement('span');
		close.className = 'tab-close';
		close.textContent = '×';
		close.title = '닫기';
		chip.append(label, close);
		chip.draggable = true; // 탭 드래그 이동
		chip.addEventListener('dragstart', (e) => {
			dragTab = { tab: t, group };
			e.dataTransfer.effectAllowed = 'move';
			try { e.dataTransfer.setData('text/plain', t.id); } catch (_) {}
			chip.classList.add('dragging');
		});
		chip.addEventListener('dragend', () => { dragTab = null; chip.classList.remove('dragging'); });
		chip.addEventListener('mousedown', (e) => {
			if (e.button === 1) { e.preventDefault(); closeTab(group, t); } // 가운데 버튼으로 닫기
		});
		chip.addEventListener('click', (e) => {
			if (e.target === close) { closeTab(group, t); return; }
			setActiveGroup(group.id);
			if (t.id === group.activeTabId) return;
			if (!confirmLeaveEdit()) return; // 이동 전 활성 탭 미저장 보호
			showTab(group, t.id);
		});
		group.tabstripEl.appendChild(chip);
	}
}

// 탭별 방문 기록 적재 (렌더러가 소유 — 탭마다 독립 뒤로/앞으로). 같은 파일이면 무시, forward 가지 잘라냄.
function pushTabHistory(tab, filePath) {
	if (tab.navIndex >= 0 && samePath(tab.navHistory[tab.navIndex], filePath)) return;
	tab.navHistory = tab.navHistory.slice(0, tab.navIndex + 1);
	tab.navHistory.push(filePath);
	tab.navIndex = tab.navHistory.length - 1;
}

// 문서를 탭에 로드 — 메인에 read-doc 요청(request/response) 후 렌더. history:false 는 뒤로/앞으로·저장 후 재읽기.
async function loadDocIntoTab(tab, filePath, opts) {
	opts = opts || {};
	const doc = await window.cmdmd.readDoc(filePath);
	if (!doc || doc.exists === false) {
		window.alert(`열기 실패\n${filePath}\n${(doc && doc.error) || '파일을 찾을 수 없습니다.'}`);
		return;
	}
	tab.editMode = false; // 새 문서·재읽기는 항상 읽기 모드
	tab.dirty = false;
	tab.docPath = doc.filePath || filePath;
	tab.raw = doc.raw || ''; // 편집 시작점 — frontmatter 포함 원본 전체
	tab.exists = true;
	if (opts.history !== false) pushTabHistory(tab, tab.docPath);
	tab.contentEl.innerHTML = renderMarkdown(doc.body || '');
	tab.scrollTop = 0;
	enhanceCallouts(tab.contentEl);
	enhanceTasks(tab.contentEl);
	enhanceTables(tab.contentEl);
	runEnhancers(tab.contentEl);
	showTab(groupOf(tab), tab.id); // 읽기 모드 표시
	tab.contentEl.scrollTop = 0; // 새 문서는 항상 맨 위
	syncTopbar();
	highlightActive(tab.docPath);
	await enhanceEmbeds(tab.contentEl, tab.docPath); // ![[임베드]] (위키 임베드 img 우선 변환)
	await enhanceImages(tab.contentEl, tab.docPath); // ![alt](경로) 표준 이미지
}

// 그룹에 문서 열기 — 이미 열려 있으면 그 탭 활성화, 활성 탭이 빈(웰컴)이면 재사용, 아니면 새 탭.
function openInGroup(group, filePath) {
	if (!group) group = activeGroup();
	if (!group) return;
	const existing = group.tabs.find((t) => t.docPath && samePath(t.docPath, filePath));
	if (existing) {
		setActiveGroup(group.id);
		showTab(group, existing.id);
		window.cmdmd.touchRecent(filePath); // 이미 열린 문서 재방문도 최근 목록 최상단으로(read-doc 미경유 보완)
		return;
	}
	let tab = activeTabOf(group);
	if (!tab || tab.docPath) tab = createTab(group); // 빈 웰컴 탭은 재사용, 아니면 새 탭
	setActiveGroup(group.id);
	showTab(group, tab.id);
	loadDocIntoTab(tab, filePath, { history: true });
}
function openInActiveGroup(filePath) { openInGroup(activeGroup(), filePath); }

// ---- 분할(그룹 추가) / 탭·그룹 닫기 -----------------------------------------
// 활성 문서를 새 열(그룹)에 복제 — VS Code 식 "옆에 나란히". 최대 MAX_GROUPS 열.
function splitActive() {
	if (groups.length >= MAX_GROUPS) return;
	const src = activeTab();
	if (!src || !src.docPath) return; // 열린 문서가 있어야 분할 의미
	const g = createGroup();
	const tab = createTab(g);
	setActiveGroup(g.id);
	showTab(g, tab.id);
	loadDocIntoTab(tab, src.docPath, { history: true }); // 같은 문서를 새 열에
}

// 그룹 강조 on/off(그룹 2개+) + 분할 버튼 상한 반영 (그룹 수 바뀔 때마다)
function updatePanesMulti() {
	panes.classList.toggle('multi', groups.length > 1);
	for (const g of groups) renderTabstrip(g); // 단일↔분할 전환 시 1-탭 탭바 표시/숨김 갱신
	layoutPanes(); // 열 사이 거터 재구성 + flex-grow(폭 비율) 반영
	syncTopbar();
}

// 열 사이 드래그 거터 배치 + 각 열 flex-grow 반영. 그룹 수 바뀔 때마다 재구성.
function layoutPanes() {
	panes.querySelectorAll('.gutter').forEach((el) => el.remove());
	groups.forEach((g, i) => {
		g.el.style.flexGrow = g.flex != null ? g.flex : 1;
		if (i < groups.length - 1) {
			const next = groups[i + 1];
			const gut = document.createElement('div');
			gut.className = 'gutter';
			gut.addEventListener('mousedown', (e) => startGutterDrag(e, g, next));
			g.el.after(gut); // DOM 순서 = groups[] 순서 (항상 append/splice 로 일치)
		}
	});
}

// 거터 드래그 — 인접 두 열의 flex-grow 비율을 마우스 이동량만큼 재분배(최소 150px). 비율 기반이라 창 크기 변화에도 유지.
function startGutterDrag(e, a, b) {
	e.preventDefault();
	const aw = a.el.getBoundingClientRect().width;
	const bw = b.el.getBoundingClientRect().width;
	const startX = e.clientX;
	const combinedPx = aw + bw;
	const combinedFlex = (a.flex || 1) + (b.flex || 1);
	const MIN = 150; // 열 최소 폭 px
	document.body.classList.add('col-resizing');
	function onMove(ev) {
		let aPx = aw + (ev.clientX - startX);
		aPx = Math.max(MIN, Math.min(combinedPx - MIN, aPx));
		a.flex = combinedFlex * (aPx / combinedPx);
		b.flex = combinedFlex - a.flex;
		a.el.style.flexGrow = a.flex;
		b.el.style.flexGrow = b.flex;
	}
	function onUp() {
		document.removeEventListener('mousemove', onMove);
		document.removeEventListener('mouseup', onUp);
		document.body.classList.remove('col-resizing');
	}
	document.addEventListener('mousemove', onMove);
	document.addEventListener('mouseup', onUp);
}

// 그룹 제거 — 활성 그룹이었으면 인접 그룹을 활성화.
function removeGroup(group) {
	const gi = groups.indexOf(group);
	if (gi < 0) return;
	group.el.remove();
	groups.splice(gi, 1);
	if (activeGroupId === group.id) {
		const ng = groups[Math.min(gi, groups.length - 1)];
		if (ng) setActiveGroup(ng.id);
	}
	updatePanesMulti();
}

// 탭 닫기 — 편집 중 미저장이면 확인. 그룹의 마지막 탭이면 그룹 제거(그룹 2개+), 전체 마지막이면 웰컴.
function closeTab(group, tab) {
	if (tab.editMode && tab.dirty && !window.cmdmd.confirmDiscard()) return;
	const idx = group.tabs.indexOf(tab);
	if (idx < 0) return;
	tab.contentEl.remove();
	tab.editorEl.remove();
	group.tabs.splice(idx, 1);
	if (group.tabs.length === 0) {
		if (groups.length > 1) { removeGroup(group); return; }
		const t = createTab(group); // 마지막 그룹의 마지막 탭 → 웰컴 탭 하나 남긴다
		t.contentEl.innerHTML = WELCOME_HTML;
		setActiveGroup(group.id);
		showTab(group, t.id);
		return;
	}
	if (group.activeTabId === tab.id) {
		const next = group.tabs[Math.min(idx, group.tabs.length - 1)];
		showTab(group, next.id); // 활성 탭을 닫았으면 인접 탭 활성화
	} else {
		renderTabstrip(group);
	}
	syncTopbar();
}

// ---- 탭 드래그 이동 (같은 열 재정렬 + 다른 열로 이동) --------------------------
// 드롭 X 좌표 기준 삽입 인덱스 — 각 칩 중점보다 왼쪽이면 그 앞, 아니면 맨 끝.
function tabDropIndex(tabstripEl, clientX) {
	const chips = [...tabstripEl.querySelectorAll('.tab')];
	for (let i = 0; i < chips.length; i++) {
		const r = chips[i].getBoundingClientRect();
		if (clientX < r.left + r.width / 2) return i;
	}
	return chips.length;
}
function onTabDrop(e, toGroup) {
	if (!dragTab) return;
	e.preventDefault();
	const from = dragTab;
	dragTab = null;
	moveTab(from.tab, from.group, toGroup, tabDropIndex(toGroup.tabstripEl, e.clientX));
}
// 탭을 fromGroup → toGroup 의 toIndex 위치로 이동. 같은 그룹이면 재정렬, 다르면 content/editor DOM 재부모 + 출발 그룹 정리.
function moveTab(tab, fromGroup, toGroup, toIndex) {
	const fromIdx = fromGroup.tabs.indexOf(tab);
	if (fromIdx < 0) return;
	if (fromGroup === toGroup) { // 같은 열 안 재정렬
		fromGroup.tabs.splice(fromIdx, 1);
		let ins = fromIdx < toIndex ? toIndex - 1 : toIndex; // 제거로 밀린 인덱스 보정
		ins = Math.max(0, Math.min(ins, fromGroup.tabs.length));
		fromGroup.tabs.splice(ins, 0, tab);
		showTab(fromGroup, tab.id);
		return;
	}
	// 다른 열로 이동
	fromGroup.tabs.splice(fromIdx, 1);
	tab.groupId = toGroup.id;
	toGroup.bodyEl.append(tab.contentEl, tab.editorEl); // content/editor DOM 을 목적지 열로 재부모
	const ins = Math.max(0, Math.min(toIndex, toGroup.tabs.length));
	toGroup.tabs.splice(ins, 0, tab);
	setActiveGroup(toGroup.id);
	showTab(toGroup, tab.id);
	if (fromGroup.tabs.length === 0) {
		removeGroup(fromGroup); // 다른 열이 있다는 건 분할 상태(그룹 2개+) → 안전
	} else if (fromGroup.activeTabId === tab.id) {
		const next = fromGroup.tabs[Math.min(fromIdx, fromGroup.tabs.length - 1)];
		showTab(fromGroup, next.id); // 활성 탭을 옮겼으면 인접 탭 활성화
	} else {
		renderTabstrip(fromGroup); // 옮긴 칩만 제거 반영
	}
	syncTopbar();
}

// topbar(경로·편집 버튼)를 활성 탭 상태로 동기화
function syncTopbar() {
	const tab = activeTab();
	docpath.textContent = tab ? tab.docPath : '';
	const hasDoc = !!(tab && tab.docPath);
	if (splitBtn) splitBtn.disabled = !hasDoc || groups.length >= MAX_GROUPS;
	if (tab && tab.editMode) {
		editBtn.classList.add('hidden');
		saveBtn.classList.remove('hidden');
		cancelBtn.classList.remove('hidden');
	} else {
		editBtn.classList.remove('hidden');
		editBtn.disabled = !hasDoc;
		saveBtn.classList.add('hidden');
		cancelBtn.classList.add('hidden');
	}
}

// ---- 읽기 ↔ 편집 토글 (raw 전체를 그대로 편집·저장 = 무손실) -----------------
// 편집 위젯은 순수 textarea — 의존성 0·오프라인 자동. `## 기호` 가 보이는 상태로 고치고
// [저장]하면 메인이 디스크에 쓴 뒤 렌더러가 재읽기해 읽기 모드로 돌아온다. (전부 활성 탭 기준)
function enterEditMode() {
	const tab = activeTab();
	if (!tab || !tab.docPath) return; // 열린 문서 없으면 편집 불가
	tab.editorEl.value = tab.raw;
	tab.dirty = false;
	tab.editMode = true;
	tab.contentEl.classList.add('hidden');
	tab.editorEl.classList.remove('hidden');
	syncTopbar();
	tab.editorEl.focus();
	tab.editorEl.setSelectionRange(0, 0); // 캐럿을 맨 앞에 노출 — '클릭하면 수정됨'을 즉시 인지
}

function exitEditMode(tab) {
	tab = tab || activeTab();
	if (!tab) return;
	tab.editMode = false;
	tab.dirty = false;
	tab.editorEl.classList.add('hidden');
	tab.contentEl.classList.remove('hidden');
	const g = groupOf(tab);
	if (g) renderTabstrip(g); // dirty • 표시 해제
	syncTopbar();
}

async function saveDoc() {
	const tab = activeTab();
	if (!tab || !tab.editMode || !tab.docPath) return;
	const res = await window.cmdmd.saveFile(tab.docPath, tab.editorEl.value);
	if (res && res.ok) {
		tab.dirty = false;
		await loadDocIntoTab(tab, tab.docPath, { history: false }); // 디스크 재읽기 → 읽기 모드 복귀(round-trip 자가 검증)
	} else {
		window.alert(`저장 실패\n${(res && res.error) || '알 수 없는 오류'}`);
	}
}

// 편집 중 이탈(취소·다른 파일 열기) 전 미저장 변경 확인. 진행 가능하면 true. (활성 탭 기준)
function confirmLeaveEdit() {
	const tab = activeTab();
	if (tab && tab.editMode && tab.dirty) {
		return window.cmdmd.confirmDiscard(); // 네이티브 모달 (예=버림 / 아니요=계속 편집)
	}
	return true;
}

editBtn.addEventListener('click', enterEditMode);
saveBtn.addEventListener('click', saveDoc);
cancelBtn.addEventListener('click', () => {
	if (confirmLeaveEdit()) exitEditMode();
});
if (splitBtn) splitBtn.addEventListener('click', splitActive);

// 브라우저식 뒤로/앞으로 — 활성 탭의 방문 기록. 편집 중이면 미저장 변경 확인 후 이동.
function goBack() {
	const tab = activeTab();
	if (!tab || tab.navIndex <= 0) return;
	if (!confirmLeaveEdit()) return;
	tab.navIndex--;
	loadDocIntoTab(tab, tab.navHistory[tab.navIndex], { history: false });
}
function goForward() {
	const tab = activeTab();
	if (!tab || tab.navIndex >= tab.navHistory.length - 1) return;
	if (!confirmLeaveEdit()) return;
	tab.navIndex++;
	loadDocIntoTab(tab, tab.navHistory[tab.navIndex], { history: false });
}
// 뒤로/앞으로 = 단축키(Alt+←/→) + 마우스 뒤로/앞으로 버튼으로만 조작 (상단 ◀▶ 버튼 제거됨)
// 마우스 뒤로(X1=button 3)/앞으로(X2=button 4) 버튼
window.addEventListener('mouseup', (e) => {
	if (e.button === 3) { e.preventDefault(); goBack(); }
	else if (e.button === 4) { e.preventDefault(); goForward(); }
});

// 단축키 — Ctrl+E 편집/읽기 토글, Ctrl+S 저장, Esc 취소, Alt+←/→ 이동 (활성 탭 기준)
document.addEventListener('keydown', (e) => {
	const ctrl = e.ctrlKey || e.metaKey;
	const tab = activeTab();
	if (ctrl && (e.key === 'e' || e.key === 'E')) {
		e.preventDefault();
		if (tab && tab.editMode) {
			if (confirmLeaveEdit()) exitEditMode();
		} else {
			enterEditMode();
		}
	} else if (ctrl && (e.key === 's' || e.key === 'S')) {
		e.preventDefault();
		saveDoc();
	} else if (ctrl && e.key === '\\') {
		e.preventDefault();
		splitActive();
	} else if (e.key === 'Escape' && tab && tab.editMode) {
		e.preventDefault();
		if (confirmLeaveEdit()) exitEditMode();
	} else if (e.altKey && e.key === 'ArrowLeft') {
		e.preventDefault();
		goBack();
	} else if (e.altKey && e.key === 'ArrowRight') {
		e.preventDefault();
		goForward();
	}
});

// ---- 폴더 트리 (사이드바) --------------------------------------------------
const fileTree = document.getElementById('filetree');
const sbRoot = document.getElementById('sb-root');
const openFolderBtn = document.getElementById('open-folder-btn');
const vaultSection = document.getElementById('vault-section');
const vaultList = document.getElementById('vault-list');
const recentSection = document.getElementById('recent-section');
const recentList = document.getElementById('recent-list');
const recentClearBtn = document.getElementById('recent-clear-btn');
const MD_NAME_RE = /\.(md|markdown|mdown)$/i;

// 새 창 요청 — 현재 사이드바 폴더(sbRoot.title=root)를 물려주며 메인에 새 창 생성을 맡긴다.
// filePath 지정 시 새 창이 그 파일을 열고, null 이면 폴더만 물려받은 빈 창을 연다.
function requestNewWindow(filePath) {
	const folder = sbRoot && sbRoot.title ? sbRoot.title : null;
	window.cmdmd.openNewWindow({ filePath: filePath || null, folder });
}
// 트리·최근 행의 "새 창으로 열기" 제스처 — Ctrl/⌘+클릭 또는 미들클릭(auxclick button 1).
function isNewWindowGesture(e) {
	return !!(e && (e.ctrlKey || e.metaKey));
}
window.cmdmd.onMenuNewWindow(() => requestNewWindow(null)); // 메뉴/Ctrl+N
if (newWinBtn) newWinBtn.addEventListener('click', () => requestNewWindow(null)); // 상단 버튼

// 경로 동일성 비교 — 트리(path.join)와 최근(path.resolve)의 구분자·대소문자 차이를 흡수.
function samePath(a, b) {
	if (!a || !b) return false;
	return a.replace(/\//g, '\\').toLowerCase() === b.replace(/\//g, '\\').toLowerCase();
}

// 트리 노드 배열 -> 중첩 <ul>. 폴더는 접기 토글, 파일은 클릭 시 열기.
function makeTree(nodes) {
	const ul = document.createElement('ul');
	ul.className = 'tree';
	for (const node of nodes) {
		const li = document.createElement('li');
		const row = document.createElement('div');
		row.className = 'tree-row';
		row.dataset.path = node.path;
		const tw = document.createElement('span');
		tw.className = 'tw';
		const ti = document.createElement('span');
		ti.className = 'ti';
		const tn = document.createElement('span');
		tn.className = 'tn';
		if (node.type === 'dir') {
			li.className = 'tree-dir is-collapsed';
			ti.textContent = '📂';
			tn.textContent = node.name;
			row.append(tw, ti, tn);
			li.appendChild(row);
			li.appendChild(makeTree(node.children || []));
			row.addEventListener('click', () => li.classList.toggle('is-collapsed'));
		} else {
			li.className = 'tree-file';
			ti.textContent = '📄';
			tn.textContent = node.name.replace(MD_NAME_RE, '');
			row.title = 'Ctrl+클릭 / 가운데 클릭 = 새 창으로 열기';
			row.append(tw, ti, tn);
			li.appendChild(row);
			row.addEventListener('click', (e) => {
				if (isNewWindowGesture(e)) { requestNewWindow(node.path); return; } // Ctrl+클릭 = 새 창
				if (!confirmLeaveEdit()) return; // 편집 중 미저장 변경 보호
				openInActiveGroup(node.path);
			});
			row.addEventListener('auxclick', (e) => {
				if (e.button === 1) { e.preventDefault(); requestNewWindow(node.path); } // 미들클릭 = 새 창
			});
		}
		ul.appendChild(li);
	}
	return ul;
}

function loadTree(payload) {
	if (!payload) return;
	sbRoot.textContent = payload.name || '';
	sbRoot.title = payload.root || '';
	fileTree.innerHTML = '';
	if (!payload.tree || payload.tree.length === 0) {
		fileTree.innerHTML = '<div class="tree-empty">이 폴더에 .md 파일이 없습니다.</div>';
		return;
	}
	fileTree.appendChild(makeTree(payload.tree));
	if (payload.truncated) {
		const note = document.createElement('div');
		note.className = 'tree-empty';
		note.textContent = '⚠ 항목이 많아 일부만 표시됩니다.';
		fileTree.appendChild(note);
	}
}

// 현재 열린 문서를 트리·최근 목록에서 강조 (경로에 백슬래시가 있어 순회 비교로 매칭).
function highlightActive(p) {
	fileTree.querySelectorAll('.tree-file > .tree-row').forEach((el) => {
		el.classList.toggle('is-active', samePath(el.dataset.path, p));
	});
	if (recentList) recentList.querySelectorAll('.recent-row').forEach((el) => {
		el.classList.toggle('is-active', samePath(el.dataset.path, p));
	});
}

// ---- 최근 연 파일 (사이드바) -----------------------------------------------
// 메인이 recent-files 채널로 push 한 [{ path, name }] 을 렌더. 비면 섹션을 접는다.
function renderRecent(items) {
	recentList.innerHTML = '';
	if (!items || items.length === 0) {
		recentSection.classList.add('hidden');
		return;
	}
	recentSection.classList.remove('hidden');
	for (const it of items) {
		const li = document.createElement('li');
		li.className = 'recent-item';
		const row = document.createElement('div');
		row.className = 'tree-row recent-row';
		row.dataset.path = it.path;
		const ti = document.createElement('span');
		ti.className = 'ti';
		ti.textContent = '📄';
		const tn = document.createElement('span');
		tn.className = 'tn';
		tn.textContent = it.name.replace(MD_NAME_RE, '');
		const rm = document.createElement('span');
		rm.className = 'recent-remove';
		rm.textContent = '×';
		rm.title = '목록에서 제거';
		rm.addEventListener('click', (e) => { e.stopPropagation(); window.cmdmd.removeRecent(it.path); }); // 행 열기와 분리
		row.title = it.path + '\nCtrl+클릭 / 가운데 클릭 = 새 창으로 열기';
		row.append(ti, tn, rm);
		li.appendChild(row);
		row.addEventListener('click', (e) => {
			if (isNewWindowGesture(e)) { requestNewWindow(it.path); return; } // Ctrl+클릭 = 새 창
			if (!confirmLeaveEdit()) return; // 편집 중 미저장 변경 보호
			openInActiveGroup(it.path);
		});
		row.addEventListener('auxclick', (e) => {
			if (e.button === 1) { e.preventDefault(); requestNewWindow(it.path); } // 미들클릭 = 새 창
		});
		recentList.appendChild(li);
	}
	highlightActive(currentPath());
}
window.cmdmd.onRecent((items) => renderRecent(items));
if (recentClearBtn) recentClearBtn.addEventListener('click', () => window.cmdmd.clearRecent()); // 전체 초기화(메인이 빈 목록 재전송 → 섹션 접힘)

openFolderBtn.addEventListener('click', async () => {
	const payload = await window.cmdmd.openFolder();
	loadTree(payload);
});

window.cmdmd.onFolderTree((payload) => loadTree(payload));

// ---- 드래그앤드롭 (파일 → 열기 / 폴더 → 트리) ------------------------------
// Electron 33 은 File.path 제거 → preload 의 pathForFile(webUtils) 로 실제 경로를 얻는다.
// dragover/drop 을 preventDefault 해 기본 file:// navigate(창 깨짐)를 막는다.
const dropOverlay = document.getElementById('drop-overlay');
let dragDepth = 0; // dragenter/leave 가 자식 요소마다 튀는 것을 상쇄
function showDropOverlay(on) {
	if (dropOverlay) dropOverlay.classList.toggle('hidden', !on);
}
window.addEventListener('dragenter', (e) => { if (dragTab) return; e.preventDefault(); dragDepth++; showDropOverlay(true); });
window.addEventListener('dragover', (e) => {
	if (dragTab) { e.preventDefault(); return; } // 탭 내부 드래그 중 — 파일 드롭 오버레이 비활성(탭바가 처리)
	e.preventDefault();
	if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
});
window.addEventListener('dragleave', (e) => {
	if (dragTab) return;
	e.preventDefault();
	dragDepth = Math.max(0, dragDepth - 1);
	if (dragDepth === 0) showDropOverlay(false);
});
window.addEventListener('drop', async (e) => {
	if (dragTab) { e.preventDefault(); return; } // 탭 이동 드롭은 탭바 drop 핸들러가 처리
	e.preventDefault();
	dragDepth = 0;
	showDropOverlay(false);
	const files = e.dataTransfer && e.dataTransfer.files;
	if (!files || files.length === 0) return;
	if (files.length > 1) console.log(`드롭 ${files.length}개 중 첫 항목만 엽니다 (v1.1 정책).`);
	let p = '';
	try { p = window.cmdmd.pathForFile(files[0]); } catch (_) { p = ''; }
	if (!p) return;
	const res = await window.cmdmd.classifyDropped(p);
	if (!res) return;
	if (res.kind === 'md') {
		const groupEl = e.target && e.target.closest ? e.target.closest('.group') : null;
		const target = (groupEl && groups.find((x) => x.id === groupEl.dataset.group)) || activeGroup();
		if (target) setActiveGroup(target.id);
		if (!confirmLeaveEdit()) return; // 편집 중 미저장 변경 보호(드롭한 그룹 기준)
		openInGroup(target, res.path);
	}
	// dir / dir-blocked / other / missing 은 메인이 처리(폴더 트리 push)하거나 무시
});

window.cmdmd.onVaults((vaults) => showVaults(vaults));

// 감지된 Obsidian 볼트를 사이드바 목록으로. 경로는 우리가 아는 게 아니라 각 PC 의 Obsidian 이
// obsidian.json 에 스스로 기록해둔 것(메인 vault-detect 가 읽어 전달). Obsidian 미사용 PC 는 0개 → 섹션 숨김.
// 클릭 = 그 볼트 폴더를 트리로 열기, Ctrl/⌘·가운데 클릭 = 새 창으로 (트리·최근과 동일 제스처).
function showVaults(vaults) {
	if (!vaultSection || !vaultList) return;
	vaultList.innerHTML = '';
	if (!vaults || vaults.length === 0) {
		vaultSection.classList.add('hidden'); // 안 쓰는 사람에겐 흔적 없음
		return;
	}
	vaultSection.classList.remove('hidden');
	for (const v of vaults) {
		if (!v || !v.path) continue;
		const li = document.createElement('li');
		li.className = 'recent-item';
		const row = document.createElement('div');
		row.className = 'tree-row recent-row';
		row.dataset.path = v.path;
		row.title = v.path + '\nCtrl+클릭 / 가운데 클릭 = 새 창으로 열기';
		const ti = document.createElement('span');
		ti.className = 'ti';
		ti.textContent = '📚';
		const tn = document.createElement('span');
		tn.className = 'tn';
		tn.textContent = v.name || v.path;
		row.append(ti, tn);
		li.appendChild(row);
		row.addEventListener('click', (e) => {
			if (isNewWindowGesture(e)) { window.cmdmd.openNewWindow({ filePath: null, folder: v.path }); return; }
			openVaultFolder(v.path);
		});
		row.addEventListener('auxclick', (e) => {
			if (e.button === 1) { e.preventDefault(); window.cmdmd.openNewWindow({ filePath: null, folder: v.path }); }
		});
		vaultList.appendChild(li);
	}
}

// 볼트 경로를 다이얼로그 없이 트리로 연다 (실패 시 조용히 무시).
async function openVaultFolder(vaultPath) {
	const payload = await window.cmdmd.openFolderPath(vaultPath);
	if (payload) loadTree(payload);
}

// ---- 초기 그룹·탭 + 웰컴 화면 ----------------------------------------------
const firstGroup = createGroup();
const firstTab = createTab(firstGroup);
firstTab.contentEl.innerHTML = WELCOME_HTML;
showTab(firstGroup, firstTab.id);
setActiveGroup(firstGroup.id);

// 메인의 open-path 신호(argv·연결 프로그램·메뉴 열기·두 번째 인스턴스) → 활성 그룹에 로드
window.cmdmd.onOpenPath((filePath) => {
	if (!filePath) return;
	if (!confirmLeaveEdit()) return;
	openInActiveGroup(filePath);
});

// 준비 신호 -> 볼트 목록 수신
window.cmdmd.ready().then((res) => {
	if (res && res.vaults) showVaults(res.vaults);
});
