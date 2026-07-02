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
const editBtn = document.getElementById('edit-btn');
const saveBtn = document.getElementById('save-btn');
const panes = document.getElementById('panes');
const annotPanel = document.getElementById('annot-panel');
const annotList = document.getElementById('annot-list');
const apCount = document.getElementById('ap-count');
const apPullback = document.getElementById('ap-pullback');
const apImport = document.getElementById('ap-import');
const apDetail = document.getElementById('ap-detail');
const apdLabel = document.getElementById('apd-label');
const apdName = document.getElementById('apd-name');
const apdEditor = document.getElementById('apd-editor');
const apdSlots = document.getElementById('apd-slots');
const apdSlotsBtn = document.getElementById('apd-slots-btn');
const layoutEl = document.getElementById('layout');
const sidebarToggle = document.getElementById('sidebar-toggle');
const apGutter = document.getElementById('ap-gutter');
const apCollapse = document.getElementById('ap-collapse');
const apReopen = document.getElementById('ap-reopen');
const toastEl = document.getElementById('toast');

// ---- 토스트 (저장 등 결과 피드백) — 조용한 성공이 "안 됨"으로 오해되던 문제 해소 ----
let toastTimer = null;
function showToast(msg, kind) {
	if (!toastEl) return;
	toastEl.textContent = msg;
	toastEl.className = 'toast show' + (kind ? ' ' + kind : '');
	if (toastTimer) clearTimeout(toastTimer);
	toastTimer = setTimeout(() => { toastEl.className = 'toast hidden'; }, 2200);
}

// ---- 레이아웃 접기/리사이즈 (목업이 항상 보이도록) ----
function toggleSidebar() {
	if (!layoutEl) return;
	const off = layoutEl.classList.toggle('sidebar-collapsed');
	if (sidebarToggle) sidebarToggle.classList.toggle('is-off', off);
}
if (sidebarToggle) sidebarToggle.addEventListener('click', toggleSidebar);

function setPanelCollapsed(on) {
	if (!layoutEl) return;
	layoutEl.classList.toggle('panel-collapsed', on);
	// 재열기 버튼은 편집 모드/주석 있을 때 + 접힌 상태에서만
	const t = activeTab();
	const relevant = !!(t && t.docPath && (t.editMode || (t.annotations && t.annotations.annotations.length > 0)));
	if (apReopen) apReopen.classList.toggle('hidden', !(on && relevant));
}
if (apCollapse) apCollapse.addEventListener('click', () => setPanelCollapsed(true));
if (apReopen) apReopen.addEventListener('click', () => setPanelCollapsed(false));

// 주석 패널 폭 드래그 — --ap-width 조절(최소 200 / 최대 창의 60%).
if (apGutter) {
	apGutter.addEventListener('mousedown', (e) => {
		e.preventDefault();
		const startX = e.clientX;
		const startW = annotPanel.getBoundingClientRect().width;
		document.body.classList.add('ap-resizing');
		const onMove = (ev) => {
			let w = startW + (startX - ev.clientX); // 왼쪽 거터라 반대 방향
			w = Math.max(200, Math.min(window.innerWidth * 0.6, w));
			document.documentElement.style.setProperty('--ap-width', w + 'px');
		};
		const onUp = () => {
			document.removeEventListener('mousemove', onMove);
			document.removeEventListener('mouseup', onUp);
			document.body.classList.remove('ap-resizing');
		};
		document.addEventListener('mousemove', onMove);
		document.addEventListener('mouseup', onUp);
	});
}

// 5종 설명 슬롯 — spec-html APP_DATA 의 desc 키(functional/interaction/data/business/technical)와 1:1.
// generic 목업에서도 같은 슬롯을 수동으로 채울 수 있다(주입만 spec-html 전용, 슬롯·편집은 목업 무관).
const SLOT_5DIM = [
	{ key: 'functional', label: '기능' },
	{ key: 'interaction', label: '동작' },
	{ key: 'data', label: '데이터' },
	{ key: 'business', label: '비즈니스' },
	{ key: 'technical', label: '기술' },
];

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
		editMode: false, dirty: false, // M3 — 주석 편집 토글 + 미저장 표시(저장은 M5)
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

// 오버레이 부착 — 문서 load 마다 이전 컨트롤러를 버리고 새 문서에 다시 심는다.
// 주석도 없고 편집 모드도 아닌 문서(일반 목업)는 아무것도 안 심는다 — 목업 원형 그대로.
function attachOverlay(tab) {
	if (tab.overlay) { tab.overlay.detach(); tab.overlay = null; }
	const set = tab.annotations;
	const has = !!(set && Array.isArray(set.annotations) && set.annotations.length > 0);
	if (!has && !tab.editMode) return;
	if (!set) return;
	tab.overlay = DDOverlay.attach(tab.frame, set, {
		editable: tab.editMode,
		onChange: () => { markDirty(tab); renderAnnotPanel(); },
		onSelect: (id) => highlightAnnotRow(id),
		onDeleteRequest: (id) => removeAnnotation(tab, id),
	});
}

// 주석 삭제 — 당김 여부는 패널 체크박스가 결정. 오버레이 Delete 키·패널 × 공용.
function removeAnnotation(tab, id) {
	if (!tab.annotations) return;
	DDNumbering.remove(tab.annotations, id, { pullBack: !apPullback || apPullback.checked });
	if (tab.overlay) tab.overlay.refresh();
	markDirty(tab);
	renderAnnotPanel();
}

// 미저장 표시 — 탭 제목 ● + 저장 버튼 활성화(syncTopbar).
function markDirty(tab) {
	if (tab.dirty) return;
	tab.dirty = true;
	renderTabstrip(groupOf(tab));
	syncTopbar();
}

// ---- 주석 저장 (M5) — 원본 HTML 에 주석 블록을 무손상 심어 자기완결 파일로 -------------------
// asNew=true 면 다른 이름 저장. 저장물 = 주석 있으면 embed, 없으면 순수 원본(dd 블록 미삽입).
async function saveTab(asNew) {
	const tab = activeTab();
	if (!tab || !tab.docPath) return;
	const set = tab.annotations;
	const hasAnn = !!(set && Array.isArray(set.annotations) && set.annotations.length > 0);
	if (set) set.savedAt = new Date().toISOString();
	// tab.raw(원본, dd 블록 포함 가능) 기준으로 embed — embed 가 기존 블록 strip 후 1세트만 남긴다(멱등·무손상).
	//   runtime 인라인(M5b) — 저장본을 dd 없이 브라우저로 열어도 핀·설명이 뜨게 자기완결 뷰어를 심는다.
	const runtime = (window.DDRuntimeSrc && { css: window.DDRuntimeSrc.RUNTIME_CSS, js: window.DDRuntimeSrc.RUNTIME_JS }) || null;
	const html = hasAnn ? window.DDHtmlIO.embed(tab.raw, set, runtime) : window.DDHtmlIO.strip(tab.raw);
	let res;
	if (asNew) res = await window.ddsv.saveAnnotatedAs(tab.docPath, html);
	else res = await window.ddsv.saveAnnotated(tab.docPath, html);
	if (!res || res.canceled) return;
	if (!res.ok) { showToast('저장 실패 — ' + (res.error || '알 수 없는 오류'), 'err'); return; }
	// 저장 성공 — 메모리 상태를 저장본에 맞춘다(재저장 멱등·더티 해제). 경로 갱신(다른 이름 저장).
	tab.docPath = res.filePath || tab.docPath;
	tab.raw = html;
	const io = window.DDHtmlIO.extract(html);
	tab.pure = io.pure;
	tab.dirty = false;
	renderTabstrip(groupOf(tab));
	syncTopbar();
	highlightActive(tab.docPath);
	const name = (tab.docPath.split(/[\\/]/).pop() || tab.docPath);
	showToast('저장됨 ✓  ' + name, 'ok');
}
if (saveBtn) saveBtn.addEventListener('click', (e) => saveTab(!!e.shiftKey));
window.ddsv.onMenuSave((as) => saveTab(!!as));

// 편집 모드 토글 — 주석 세트가 없으면 여기서 처음 만든다(spec-html 판별은 APP_DATA 유무).
function toggleEdit() {
	const tab = activeTab();
	if (!tab || !tab.docPath) return;
	tab.editMode = !tab.editMode;
	if (tab.editMode && !tab.annotations) {
		tab.annotations = DDModel.createSet(DDOverlay.detectSpecHtml(tab.frame) ? 'spec-html' : 'generic');
	}
	if (tab.overlay) tab.overlay.setEditable(tab.editMode);
	else attachOverlay(tab);
	syncTopbar();
}
if (editBtn) editBtn.addEventListener('click', toggleEdit);

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
		label.textContent = (t.dirty ? '● ' : '') + tabTitle(t);
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
	// 미저장 주석 가드 — 재로드는 파일에서 다시 읽으므로 메모리 편집분이 사라진다(저장은 M5)
	if (tab.dirty && !window.confirm('저장하지 않은 주석이 있습니다. 이동하면 사라집니다.\n계속할까요?')) return;
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
	tab.editMode = false; // 새 문서 = 뷰어 모드부터 (편집은 명시 토글)
	tab.dirty = false;
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
	if (tab.dirty && !window.confirm('저장하지 않은 주석이 있습니다. 닫으면 사라집니다.\n닫을까요?')) return;
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

// topbar(경로·편집·분할 버튼) + 주석 패널을 활성 탭 상태로 동기화
function syncTopbar() {
	const tab = activeTab();
	docpath.textContent = tab ? tab.docPath : '';
	const hasDoc = !!(tab && tab.docPath);
	if (splitBtn) splitBtn.disabled = !hasDoc || groups.length >= MAX_GROUPS;
	if (editBtn) {
		editBtn.disabled = !hasDoc;
		editBtn.classList.toggle('is-on', !!(tab && tab.editMode));
	}
	if (saveBtn) {
		// 저장 가능 = 문서 있고 (미저장 변경 또는 주석 보유). 주석 없는 원본만 열린 상태면 저장 의미 없음.
		const hasAnn = !!(tab && tab.annotations && tab.annotations.annotations.length > 0);
		saveBtn.disabled = !(hasDoc && (tab.dirty || hasAnn));
	}
	renderAnnotPanel();
}

if (splitBtn) splitBtn.addEventListener('click', splitActive);

// ---- 주석 패널 (M3 번호 자유관리) --------------------------------------------
// 활성 탭의 주석 세트를 seq 순 리스트로. 행 클릭 = 오버레이 선택 / 더블클릭 = 라벨 편집 /
// 드래그 = 재정렬(중간 삽입 밀기) / 자동 배지 클릭 = 수동↔자동 전환 / × = 삭제(당김 옵션).
let dragAnnotId = null; // 행 드래그 재정렬 중인 주석 id

function annotTypeIcon(a) { return a.type === 'box' ? '▭' : '📍'; }

function renderAnnotPanel() {
	if (!annotPanel) return;
	const tab = activeTab();
	const set = tab && tab.annotations;
	const anns = set && Array.isArray(set.annotations) ? DDNumbering.sortedBySeq(set) : [];
	const show = !!(tab && tab.docPath && (tab.editMode || anns.length > 0));
	annotPanel.classList.toggle('hidden', !show);
	if (apGutter) apGutter.classList.toggle('hidden', !show); // 거터도 패널과 함께
	if (!show) {
		if (apDetail) apDetail.classList.add('hidden');
		if (apReopen) apReopen.classList.add('hidden'); // 패널 숨기면 재열기 버튼도 숨김
		return;
	}
	// 패널이 접혀 있으면 재열기 버튼 노출
	if (apReopen) apReopen.classList.toggle('hidden', !layoutEl.classList.contains('panel-collapsed'));
	// 초안 불러오기 — 편집 모드 + spec-html 목업(APP_DATA)일 때만. generic 목업엔 숨김(불변 원칙).
	if (apImport) {
		const canImport = !!(tab.editMode && DDOverlay.readAppData(tab.frame));
		apImport.classList.toggle('hidden', !canImport);
	}
	apCount.textContent = String(anns.length);
	annotList.innerHTML = '';
	for (const a of anns) {
		const li = document.createElement('li');
		li.className = 'annot-row';
		li.dataset.annotId = a.id;
		li.draggable = true;
		const label = document.createElement('span');
		label.className = 'annot-label' + (a.autoNumber ? '' : ' is-manual');
		label.textContent = a.label;
		label.title = a.autoNumber ? '자동 번호 — 더블클릭으로 직접 수정(수동 고정)' : '수동 번호 — 더블클릭 수정';
		const type = document.createElement('span');
		type.className = 'annot-type';
		type.textContent = annotTypeIcon(a);
		const text = document.createElement('span');
		text.className = 'annot-text';
		text.textContent = (a.body && a.body.plain) || (a.anchor && a.anchor.mode === 'element' ? a.anchor.elementId : '(설명 없음 — M4)');
		const auto = document.createElement('button');
		auto.className = 'annot-auto';
		auto.type = 'button';
		auto.textContent = a.autoNumber ? '자동' : '수동';
		auto.title = a.autoNumber ? '자동 번호(순서 따라 재번호)' : '클릭 = 자동 번호로 복귀';
		const rm = document.createElement('button');
		rm.className = 'annot-remove';
		rm.type = 'button';
		rm.textContent = '×';
		rm.title = '삭제 (Delete)';
		li.append(label, type, text, auto, rm);
		// 선택 동기화 — 행 클릭 → 오버레이 핀 하이라이트
		li.addEventListener('click', (e) => {
			if (e.target === rm || e.target === auto) return;
			if (tab.overlay) tab.overlay.select(a.id);
			highlightAnnotRow(a.id);
		});
		// 라벨 더블클릭 → 인라인 입력 (Enter/blur 확정, Esc 취소) — 수동 고정
		label.addEventListener('dblclick', (e) => {
			e.stopPropagation();
			const input = document.createElement('input');
			input.className = 'annot-label-input';
			input.value = a.label;
			label.replaceWith(input);
			input.focus();
			input.select();
			let done = false;
			const commit = (save) => {
				if (done) return;
				done = true;
				if (save && input.value.trim()) {
					DDNumbering.setLabel(set, a.id, input.value.trim());
					afterAnnotMutate(tab);
				} else {
					renderAnnotPanel();
				}
			};
			input.addEventListener('keydown', (ev) => {
				if (ev.key === 'Enter') commit(true);
				else if (ev.key === 'Escape') commit(false);
			});
			input.addEventListener('blur', () => commit(true));
		});
		auto.addEventListener('click', () => {
			if (a.autoNumber) return; // 이미 자동 — 표시용
			DDNumbering.setAuto(set, a.id);
			afterAnnotMutate(tab);
		});
		rm.addEventListener('click', () => removeAnnotation(tab, a.id));
		// 행 드래그 재정렬 — 드롭 대상 행의 seq 자리로 moveTo(중간 삽입 밀기)
		li.addEventListener('dragstart', (e) => {
			dragAnnotId = a.id;
			e.dataTransfer.effectAllowed = 'move';
			li.classList.add('dragging');
		});
		li.addEventListener('dragend', () => { dragAnnotId = null; li.classList.remove('dragging'); });
		li.addEventListener('dragover', (e) => {
			if (!dragAnnotId || dragAnnotId === a.id) return;
			e.preventDefault();
			e.dataTransfer.dropEffect = 'move';
			li.classList.add('drop-target');
		});
		li.addEventListener('dragleave', () => li.classList.remove('drop-target'));
		li.addEventListener('drop', (e) => {
			li.classList.remove('drop-target');
			if (!dragAnnotId || dragAnnotId === a.id) return;
			e.preventDefault();
			DDNumbering.moveTo(set, dragAnnotId, a.seq);
			dragAnnotId = null;
			afterAnnotMutate(tab);
		});
		annotList.appendChild(li);
	}
	if (tab.overlay) highlightAnnotRow(tab.overlay.getSelected());
	else renderDetail();
}

// 패널 쪽 구조 변경(라벨·재정렬·자동복귀) 공통 후처리 — 오버레이 재생성 + 패널 재렌더 + 더티
function afterAnnotMutate(tab) {
	if (tab.overlay) tab.overlay.refresh();
	markDirty(tab);
	renderAnnotPanel();
}

// 오버레이에서 선택 → 패널 행 하이라이트 + 스크롤 + 설명 편집기 렌더
function highlightAnnotRow(id) {
	if (!annotList) return;
	annotList.querySelectorAll('.annot-row').forEach((el) => {
		const on = !!id && el.dataset.annotId === id;
		el.classList.toggle('is-active', on);
		if (on) el.scrollIntoView({ block: 'nearest' });
	});
	renderDetail();
}

// ---- 설명 편집기 (M4) — 선택된 핀의 자유 리치텍스트 + 5종 슬롯 -----------------
// 자유 리치텍스트가 SSOT(body.html/plain). 슬롯을 채우면 body 에 렌더 스냅샷을 합성한다.
function selectedAnnotation() {
	const tab = activeTab();
	if (!tab || !tab.annotations || !tab.overlay) return { tab: null, ann: null };
	const id = tab.overlay.getSelected();
	const ann = id ? tab.annotations.annotations.find((a) => a.id === id) : null;
	return { tab, ann };
}

// 슬롯 필드 → body.html/plain 합성 스냅샷 (빈 칸은 건너뜀).
function composeSlots(fields) {
	const rows = SLOT_5DIM.filter((s) => (fields[s.key] || '').trim())
		.map((s) => `<li><b>${s.label}.</b> ${escapeHtml(fields[s.key].trim())}</li>`);
	const html = rows.length ? `<ul class="dd-slot-body">${rows.join('')}</ul>` : '';
	const plain = SLOT_5DIM.filter((s) => (fields[s.key] || '').trim())
		.map((s) => `${s.label}. ${fields[s.key].trim()}`).join(' / ');
	return { html, plain };
}
function escapeHtml(s) {
	return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

// 편집기/슬롯을 선택 주석 상태로 렌더. 선택 없으면 detail 숨김.
let apdSlotMode = false; // 슬롯 뷰 on/off (핀마다 slots 유무로 초기화)
function renderDetail() {
	if (!apDetail) return;
	const { ann } = selectedAnnotation();
	if (!ann) { apDetail.classList.add('hidden'); return; }
	apDetail.classList.remove('hidden');
	apdLabel.textContent = ann.label;
	apdName.textContent = ann.type === 'box' ? '범위 설명' : '핀 설명';
	apdSlotMode = !!(ann.slots && ann.slots.fields);
	apdSlotsBtn.classList.toggle('is-on', apdSlotMode);
	apdEditor.classList.toggle('hidden', apdSlotMode);
	apdSlots.classList.toggle('hidden', !apdSlotMode);
	if (apdSlotMode) renderSlots(ann);
	else if (document.activeElement !== apdEditor) apdEditor.innerHTML = (ann.body && ann.body.html) || '';
}

// 5종 슬롯 입력 렌더 — 각 칸 편집 시 body 합성 + 더티.
function renderSlots(ann) {
	const fields = (ann.slots && ann.slots.fields) || {};
	apdSlots.innerHTML = '';
	for (const s of SLOT_5DIM) {
		const wrap = document.createElement('label');
		wrap.className = 'apd-slot';
		const cap = document.createElement('span');
		cap.className = 'apd-slot-cap';
		cap.textContent = s.label;
		const ta = document.createElement('textarea');
		ta.className = 'apd-slot-input';
		ta.rows = 1;
		ta.value = fields[s.key] || '';
		ta.placeholder = '…';
		ta.addEventListener('input', () => {
			autoGrow(ta);
			const { tab, ann: cur } = selectedAnnotation();
			if (!cur) return;
			cur.slots = cur.slots || { template: 'app-5dim', fields: {} };
			cur.slots.fields[s.key] = ta.value;
			const c = composeSlots(cur.slots.fields);
			cur.body = { format: 'html', html: c.html, plain: c.plain };
			markDirty(tab);
			updateRowText(cur);
		});
		wrap.append(cap, ta);
		apdSlots.appendChild(wrap);
		autoGrow(ta);
	}
}
function autoGrow(ta) { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; }

// 리스트 행의 요약 텍스트만 갱신(패널 통째 re-render 없이 — 편집 중 포커스 유지).
function updateRowText(ann) {
	if (!annotList) return;
	const row = annotList.querySelector(`.annot-row[data-annot-id="${ann.id}"] .annot-text`);
	if (row) row.textContent = (ann.body && ann.body.plain) || (ann.anchor && ann.anchor.mode === 'element' ? ann.anchor.elementId : '(설명 없음)');
}

// 자유 편집기 입력 → body 저장(디바운스 없이 즉시, 저장은 M5). 슬롯 모드일 땐 편집기 비활성.
if (apdEditor) {
	apdEditor.addEventListener('input', () => {
		const { tab, ann } = selectedAnnotation();
		if (!ann || apdSlotMode) return;
		ann.body = { format: 'html', html: apdEditor.innerHTML, plain: apdEditor.textContent || '' };
		ann.slots = null; // 자유 텍스트로 쓰면 슬롯 스냅샷 폐기(SSOT=자유 텍스트)
		markDirty(tab);
		updateRowText(ann);
	});
}
// 서식 툴바 — execCommand 최소셋(deprecated 수용, v1).
if (apDetail) {
	apDetail.querySelectorAll('.apd-toolbar button').forEach((btn) => {
		btn.addEventListener('mousedown', (e) => {
			e.preventDefault(); // 편집기 포커스·선택 유지
			apdEditor.focus();
			if (btn.dataset.cmd) document.execCommand(btn.dataset.cmd, false, null);
			else if (btn.dataset.color !== undefined) {
				if (btn.dataset.color) document.execCommand('foreColor', false, btn.dataset.color);
				else document.execCommand('removeFormat', false, null);
			}
			apdEditor.dispatchEvent(new Event('input'));
		});
	});
}
// 슬롯 뷰 토글 — 자유 텍스트 ↔ 5종 슬롯. 슬롯 최초 진입 시 빈 슬롯 세트 생성.
if (apdSlotsBtn) {
	apdSlotsBtn.addEventListener('click', () => {
		const { tab, ann } = selectedAnnotation();
		if (!ann) return;
		if (apdSlotMode) { // 슬롯 → 자유: 슬롯 스냅샷을 자유 텍스트로 승격
			ann.slots = null;
			apdSlotMode = false;
		} else {
			ann.slots = ann.slots || { template: 'app-5dim', fields: {} };
			apdSlotMode = true;
		}
		markDirty(tab);
		renderDetail();
	});
}

// ---- 초안 불러오기 (M4c) — spec-html APP_DATA → 핀 초안 (generic 목업엔 버튼 숨김) -----
function importDrafts() {
	const tab = activeTab();
	if (!tab || !tab.editMode || !tab.annotations) return;
	const app = DDOverlay.readAppData(tab.frame);
	if (!app || !app.screens) { window.alert('이 목업엔 불러올 요소 설명(APP_DATA)이 없습니다.\n임의 HTML 목업은 직접 핀을 찍어 설명하세요.'); return; }
	const screenId = app.currentScreen || Object.keys(app.screens)[0];
	const screen = app.screens[screenId];
	const areas = (screen && screen.areas) || [];
	const els = [];
	for (const area of areas) for (const el of (area.elements || [])) if (!el.noNum) els.push({ el, area });
	if (els.length === 0) { window.alert(`현재 화면(${screenId})에 번호 매길 요소가 없습니다.`); return; }
	const existing = new Set(tab.annotations.annotations
		.filter((a) => a.anchor && a.anchor.mode === 'element')
		.map((a) => a.anchor.screenId + '|' + a.anchor.elementId));
	let added = 0;
	for (const { el } of els) {
		if (existing.has(screenId + '|' + el.id)) continue; // 이미 찍힌 요소는 건너뜀(중복 방지)
		const fields = {};
		if (el.desc) for (const s of SLOT_5DIM) if (el.desc[s.key]) fields[s.key] = el.desc[s.key];
		const c = composeSlots(fields);
		const a = DDModel.createAnnotation({
			type: 'pin',
			anchor: { mode: 'element', elementId: el.id, screenId },
			slots: Object.keys(fields).length ? { template: 'app-5dim', fields } : null,
			body: { format: 'html', html: c.html, plain: c.plain || el.name },
		});
		DDNumbering.add(tab.annotations, a);
		added++;
	}
	if (tab.overlay) tab.overlay.refresh(); else attachOverlay(tab);
	markDirty(tab);
	renderAnnotPanel();
	window.alert(added > 0 ? `초안 ${added}개 불러왔습니다. 위치·문구를 다듬어 확정하세요.` : '새로 추가할 요소가 없습니다(이미 다 찍혀 있음).');
}
if (apImport) apImport.addEventListener('click', importDrafts);

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

// 단축키 — Ctrl+E 주석 편집, Ctrl+\ 분할, Alt+←/→ 이동 (활성 탭 기준). 줌은 메인의 before-input-event 가 처리.
document.addEventListener('keydown', (e) => {
	const ctrl = e.ctrlKey || e.metaKey;
	if (ctrl && (e.key === 'b' || e.key === 'B')) {
		e.preventDefault();
		toggleSidebar();
	} else if (ctrl && (e.key === 's' || e.key === 'S')) {
		e.preventDefault();
		saveTab(e.shiftKey); // Ctrl+Shift+S = 다른 이름으로
	} else if (ctrl && (e.key === 'e' || e.key === 'E')) {
		e.preventDefault();
		toggleEdit();
	} else if (ctrl && e.key === '\\') {
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
