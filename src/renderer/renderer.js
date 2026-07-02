// 렌더러 — 목업 HTML 을 <iframe srcdoc> 으로 격리 렌더하는 뷰어 셸.
//   원본 HTML 을 한 글자도 안 바꾸고 iframe 에 그대로 주입 → 목업의 <style>·goScreen 등 전역 JS 는
//   iframe 안에 격리되어 앱 셸을 오염시키지 않는다. sandbox 는 쓰지 않는다 —
//   부모와 같은 file 오리진을 유지해 M2 에서 오버레이를 iframe 문서 내부에 주입할 수 있게 한다.
// 주석(핀·박스·설명)은 M2~M5. 지금(M1)은 원본대로 렌더 + 네비 가드까지.

'use strict';

// ---- 편집 그룹 + 탭 모델 (VS Code 식) --------------------------------------
// 문서 뷰 = Tab, 열 = Group. Group 은 탭들을 담고, 활성 탭만 노출한다.
const docpath = document.getElementById('docpath');
const splitBtn = document.getElementById('split-btn');
const newWinBtn = document.getElementById('newwin-btn');
const panes = document.getElementById('panes');

// 문서 없을 때 탭에 표시하는 웰컴.
const WELCOME_HTML =
	'<div class="empty">' +
	'<h2>Dong Dong Spec Viewer for Windows</h2>' +
	'<p><kbd>Ctrl</kbd>+<kbd>O</kbd> 로 화면기획서 HTML 을, <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>O</kbd> 로 폴더를 열면 목업이 그대로 렌더됩니다.</p>' +
	'<p class="muted">Obsidian 볼트를 쓰신다면 왼쪽 <b>내 Obsidian 볼트</b> 목록에서 바로 열 수 있어요.</p>' +
	'</div>';

const MAX_GROUPS = 5; // 분할 최대 열 수
const HTML_NAME_RE = /\.html?$/i;
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

// 그룹(열) 생성 — .tabstrip(탭 칩) + .group-body(활성 탭의 문서 뷰)
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

// 탭(문서 뷰) 생성 — 탭마다 자기 iframe 을 소유(로드 1회·독립 스크롤).
// contentEl 안에 웰컴 호스트 + iframe 을 두고, 문서 유무로 둘 중 하나만 노출한다.
function createTab(group) {
	const id = 't' + (++tabSeq);
	const contentEl = document.createElement('main');
	contentEl.className = 'doc-view content';
	const welcomeEl = document.createElement('div');
	welcomeEl.className = 'welcome-host';
	welcomeEl.innerHTML = WELCOME_HTML;
	const frame = document.createElement('iframe');
	frame.className = 'doc-frame hidden'; // 문서 로드 전엔 숨김(웰컴만 표시)
	// sandbox 미사용 — 부모와 같은 file 오리진 유지(오버레이를 iframe 문서 내부에 주입). 네비 가드·오버레이는 load 에서.
	frame.addEventListener('load', () => { guardIframeNav(frame); attachOverlay(tab); });
	contentEl.append(welcomeEl, frame);
	const tab = {
		id, groupId: group.id, docPath: '', raw: '', pure: '', annotations: null, overlay: null, exists: true,
		contentEl, welcomeEl, frame,
		navHistory: [], navIndex: -1,
	};
	group.bodyEl.appendChild(contentEl);
	group.tabs.push(tab);
	return tab;
}

// iframe 내부 링크 클릭 가드 — http(s)/mailto 는 기본 브라우저로, 그 외 외부 이동은 막아
// iframe 이 빈 페이지로 튀는 것을 방지한다. '#앵커'·목업 내부 JS(goScreen)는 그대로 동작.
function guardIframeNav(frame) {
	let doc;
	try { doc = frame.contentDocument; } catch (_) { return; }
	if (!doc) return;
	doc.addEventListener('click', (e) => {
		const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
		if (!a) return;
		const href = a.getAttribute('href') || '';
		if (href.startsWith('#') || href === '') return; // 같은 문서 앵커/빈 링크
		if (/^(https?:|mailto:)/i.test(href)) {
			e.preventDefault();
			window.ddsv.openExternal(href);
			return;
		}
		e.preventDefault(); // 상대·파일 경로 이동 차단(srcdoc 문서가 빈 페이지로 튀지 않게)
	}, true);
}

// 오버레이 부착 (M2 읽기전용) — 문서 load 마다 이전 컨트롤러를 버리고 새 문서에 다시 심는다.
// 주석 세트가 없는 문서(일반 목업)는 아무것도 안 심는다 — 목업 원형 그대로.
function attachOverlay(tab) {
	if (tab.overlay) { tab.overlay.detach(); tab.overlay = null; }
	const set = tab.annotations;
	if (!set || !Array.isArray(set.annotations) || set.annotations.length === 0) return;
	tab.overlay = DDOverlay.attach(tab.frame, set);
}

// 활성 그룹 전환 (시각 강조·topbar 반영)
function setActiveGroup(id) {
	if (!groups.some((g) => g.id === id)) return;
	activeGroupId = id;
	for (const g of groups) g.el.classList.toggle('is-active', g.id === id);
	syncTopbar();
}

// 그룹 내 활성 탭 표시 — 활성 탭만 content 노출, 나머지 숨김.
function showTab(group, tabId) {
	group.activeTabId = tabId;
	for (const t of group.tabs) {
		t.contentEl.classList.toggle('hidden', t.id !== tabId);
	}
	renderTabstrip(group);
	if (group.id === activeGroupId) syncTopbar();
}

// 문서 유무로 웰컴/iframe 전환.
function renderTabView(tab) {
	const hasDoc = !!tab.docPath;
	tab.frame.classList.toggle('hidden', !hasDoc);
	tab.welcomeEl.classList.toggle('hidden', hasDoc);
}

// 탭 제목 — 파일명(확장자 제거), 빈 문서는 '새 문서'.
function tabTitle(t) {
	if (!t.docPath) return '새 문서';
	const base = t.docPath.split(/[\\/]/).pop() || t.docPath;
	return base.replace(HTML_NAME_RE, '');
}

// 탭 칩 렌더. 탭 1개면 탭바를 비워 둔다(비분할 단일 문서는 간결하게).
function renderTabstrip(group) {
	group.tabstripEl.innerHTML = '';
	if (groups.length <= 1 && group.tabs.length <= 1) return; // 비분할 단일 문서만 탭바 숨김(분할 상태엔 1-탭 열도 칩+× 노출 → × 로 분할 해제)
	for (const t of group.tabs) {
		const chip = document.createElement('div');
		chip.className = 'tab' + (t.id === group.activeTabId ? ' is-active' : '');
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

// 문서를 탭에 로드 — 메인에 read-html 요청 후 iframe srcdoc 으로 렌더. history:false 는 뒤로/앞으로.
async function loadDocIntoTab(tab, filePath, opts) {
	opts = opts || {};
	const doc = await window.ddsv.readHtml(filePath);
	if (!doc || doc.exists === false) {
		window.alert(`열기 실패\n${filePath}\n${(doc && doc.error) || '파일을 찾을 수 없습니다.'}`);
		return;
	}
	tab.docPath = doc.filePath || filePath;
	tab.raw = doc.raw || ''; // 원본 HTML 전체 (무손상)
	const io = window.DDHtmlIO.extract(tab.raw); // 재개봉 — dd 블록 분리(중복 누적 방지). 없으면 set=null
	tab.pure = io.pure;
	tab.annotations = io.set;
	tab.exists = true;
	if (opts.history !== false) pushTabHistory(tab, tab.docPath);
	tab.frame.srcdoc = tab.pure; // iframe 격리 렌더(순수 목업) — load 시 네비 가드+오버레이 재부착
	renderTabView(tab);
	showTab(groupOf(tab), tab.id);
	syncTopbar();
	highlightActive(tab.docPath);
}

// 그룹에 문서 열기 — 이미 열려 있으면 그 탭 활성화, 활성 탭이 빈(웰컴)이면 재사용, 아니면 새 탭.
function openInGroup(group, filePath) {
	if (!group) group = activeGroup();
	if (!group) return;
	const existing = group.tabs.find((t) => t.docPath && samePath(t.docPath, filePath));
	if (existing) {
		setActiveGroup(group.id);
		showTab(group, existing.id);
		window.ddsv.touchRecent(filePath); // 이미 열린 문서 재방문도 최근 목록 최상단으로(read-html 미경유 보완)
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

// 탭 닫기 — 그룹의 마지막 탭이면 그룹 제거(그룹 2개+), 전체 마지막이면 웰컴 탭을 남긴다.
function closeTab(group, tab) {
	const idx = group.tabs.indexOf(tab);
	if (idx < 0) return;
	tab.contentEl.remove();
	group.tabs.splice(idx, 1);
	if (group.tabs.length === 0) {
		if (groups.length > 1) { removeGroup(group); return; }
		const t = createTab(group); // 마지막 그룹의 마지막 탭 → 웰컴 탭 하나 남긴다
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
// 탭을 fromGroup → toGroup 의 toIndex 위치로 이동. 같은 그룹이면 재정렬, 다르면 content DOM 재부모 + 출발 그룹 정리.
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
	toGroup.bodyEl.appendChild(tab.contentEl); // content DOM 을 목적지 열로 재부모
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

// topbar(경로·분할 버튼)를 활성 탭 상태로 동기화
function syncTopbar() {
	const tab = activeTab();
	docpath.textContent = tab ? tab.docPath : '';
	const hasDoc = !!(tab && tab.docPath);
	if (splitBtn) splitBtn.disabled = !hasDoc || groups.length >= MAX_GROUPS;
}

if (splitBtn) splitBtn.addEventListener('click', splitActive);

// 브라우저식 뒤로/앞으로 — 활성 탭의 방문 기록.
function goBack() {
	const tab = activeTab();
	if (!tab || tab.navIndex <= 0) return;
	tab.navIndex--;
	loadDocIntoTab(tab, tab.navHistory[tab.navIndex], { history: false });
}
function goForward() {
	const tab = activeTab();
	if (!tab || tab.navIndex >= tab.navHistory.length - 1) return;
	tab.navIndex++;
	loadDocIntoTab(tab, tab.navHistory[tab.navIndex], { history: false });
}
// 뒤로/앞으로 = 단축키(Alt+←/→) + 마우스 뒤로(X1=button 3)/앞으로(X2=button 4) 버튼
window.addEventListener('mouseup', (e) => {
	if (e.button === 3) { e.preventDefault(); goBack(); }
	else if (e.button === 4) { e.preventDefault(); goForward(); }
});

// 단축키 — Ctrl+\ 분할, Alt+←/→ 이동 (활성 탭 기준). 줌은 메인의 before-input-event 가 처리.
document.addEventListener('keydown', (e) => {
	const ctrl = e.ctrlKey || e.metaKey;
	if (ctrl && e.key === '\\') {
		e.preventDefault();
		splitActive();
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

// 새 창 요청 — 현재 사이드바 폴더(sbRoot.title=root)를 물려주며 메인에 새 창 생성을 맡긴다.
// filePath 지정 시 새 창이 그 파일을 열고, null 이면 폴더만 물려받은 빈 창을 연다.
function requestNewWindow(filePath) {
	const folder = sbRoot && sbRoot.title ? sbRoot.title : null;
	window.ddsv.openNewWindow({ filePath: filePath || null, folder });
}
// 트리·최근 행의 "새 창으로 열기" 제스처 — Ctrl/⌘+클릭 또는 미들클릭(auxclick button 1).
function isNewWindowGesture(e) {
	return !!(e && (e.ctrlKey || e.metaKey));
}
window.ddsv.onMenuNewWindow(() => requestNewWindow(null)); // 메뉴/Ctrl+N
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
			tn.textContent = node.name.replace(HTML_NAME_RE, '');
			row.title = 'Ctrl+클릭 / 가운데 클릭 = 새 창으로 열기';
			row.append(tw, ti, tn);
			li.appendChild(row);
			row.addEventListener('click', (e) => {
				if (isNewWindowGesture(e)) { requestNewWindow(node.path); return; } // Ctrl+클릭 = 새 창
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
		fileTree.innerHTML = '<div class="tree-empty">이 폴더에 .html 파일이 없습니다.</div>';
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
		tn.textContent = it.name.replace(HTML_NAME_RE, '');
		const rm = document.createElement('span');
		rm.className = 'recent-remove';
		rm.textContent = '×';
		rm.title = '목록에서 제거';
		rm.addEventListener('click', (e) => { e.stopPropagation(); window.ddsv.removeRecent(it.path); }); // 행 열기와 분리
		row.title = it.path + '\nCtrl+클릭 / 가운데 클릭 = 새 창으로 열기';
		row.append(ti, tn, rm);
		li.appendChild(row);
		row.addEventListener('click', (e) => {
			if (isNewWindowGesture(e)) { requestNewWindow(it.path); return; } // Ctrl+클릭 = 새 창
			openInActiveGroup(it.path);
		});
		row.addEventListener('auxclick', (e) => {
			if (e.button === 1) { e.preventDefault(); requestNewWindow(it.path); } // 미들클릭 = 새 창
		});
		recentList.appendChild(li);
	}
	highlightActive(currentPath());
}
window.ddsv.onRecent((items) => renderRecent(items));
if (recentClearBtn) recentClearBtn.addEventListener('click', () => window.ddsv.clearRecent()); // 전체 초기화(메인이 빈 목록 재전송 → 섹션 접힘)

openFolderBtn.addEventListener('click', async () => {
	const payload = await window.ddsv.openFolder();
	loadTree(payload);
});

window.ddsv.onFolderTree((payload) => loadTree(payload));

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
	if (files.length > 1) console.log(`드롭 ${files.length}개 중 첫 항목만 엽니다.`);
	let p = '';
	try { p = window.ddsv.pathForFile(files[0]); } catch (_) { p = ''; }
	if (!p) return;
	const res = await window.ddsv.classifyDropped(p);
	if (!res) return;
	if (res.kind === 'html') {
		const groupEl = e.target && e.target.closest ? e.target.closest('.group') : null;
		const target = (groupEl && groups.find((x) => x.id === groupEl.dataset.group)) || activeGroup();
		if (target) setActiveGroup(target.id);
		openInGroup(target, res.path);
	}
	// dir / dir-blocked / other / missing 은 메인이 처리(폴더 트리 push)하거나 무시
});

window.ddsv.onVaults((vaults) => showVaults(vaults));

// 감지된 Obsidian 볼트를 사이드바 목록으로. 경로는 각 PC 의 Obsidian 이 obsidian.json 에
// 스스로 기록해둔 것(메인 vault-detect 가 읽어 전달). Obsidian 미사용 PC 는 0개 → 섹션 숨김.
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
			if (isNewWindowGesture(e)) { window.ddsv.openNewWindow({ filePath: null, folder: v.path }); return; }
			openVaultFolder(v.path);
		});
		row.addEventListener('auxclick', (e) => {
			if (e.button === 1) { e.preventDefault(); window.ddsv.openNewWindow({ filePath: null, folder: v.path }); }
		});
		vaultList.appendChild(li);
	}
}

// 볼트 경로를 다이얼로그 없이 트리로 연다 (실패 시 조용히 무시).
async function openVaultFolder(vaultPath) {
	const payload = await window.ddsv.openFolderPath(vaultPath);
	if (payload) loadTree(payload);
}

// ---- 초기 그룹·탭 + 웰컴 화면 ----------------------------------------------
const firstGroup = createGroup();
const firstTab = createTab(firstGroup);
showTab(firstGroup, firstTab.id);
setActiveGroup(firstGroup.id);

// 메인의 open-path 신호(argv·연결 프로그램·메뉴 열기·두 번째 인스턴스) → 활성 그룹에 로드
window.ddsv.onOpenPath((filePath) => {
	if (!filePath) return;
	openInActiveGroup(filePath);
});

// 준비 신호 -> 볼트 목록 수신
window.ddsv.ready().then((res) => {
	if (res && res.vaults) showVaults(res.vaults);
});
