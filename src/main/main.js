// Electron 메인 프로세스 — 창 생성 + 파일/폴더 열기. 파일 로드 시 frontmatter 를 분리해
// 렌더러로 본문만 보낸다. (CmdMD 의 review-first = 열면 바로 렌더 프리뷰)

'use strict';

const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const fm = require('../core/frontmatter');
const vault = require('../core/vault-detect');

// 다중 창 — 전역 단일 win 을 버리고 창별 상태를 webContents.id 로 격리한다.
//   pendingFiles   : 렌더러 준비 전 보류한 "이 창에서 열 파일" (더블클릭/연결 프로그램/새 창으로 열기)
//   pendingFolders : 새 창이 물려받을 폴더 루트 (창을 열 때 사이드바 트리를 같이 넘기기)
//   lastFolderRoots: 각 창이 마지막으로 연 폴더 (위키링크 노트 검색 범위 보강 — 창마다 독립)
// 대상 창은 IPC 는 event.sender, 메뉴는 focusedWindow 로 특정한다.
// 방문 기록(뒤로/앞으로)은 렌더러가 탭별로 소유 — 메인은 무상태 문서 서비스.
const pendingFiles = new Map();
const pendingFolders = new Map();
const lastFolderRoots = new Map();

// 메뉴·두 번째 인스턴스 등 "지금 대상 창"이 필요한 곳 — 포커스 창 우선, 없으면 아무 창.
function focusedOrAnyWindow() {
	return BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0] || null;
}

// 줌 적용 — delta 0 은 초기화(100%), 그 외는 현재 레벨에 가감(±3 클램프). 키 입력·메뉴 공용.
function applyZoom(wc, delta) {
	if (!wc || wc.isDestroyed()) return;
	if (delta === 0) { wc.setZoomLevel(0); return; }
	const next = Math.max(-3, Math.min(3, wc.getZoomLevel() + delta));
	wc.setZoomLevel(next);
}

// ---- 최근 연 파일 (userData 영속) ------------------------------------------
// 방문 기록은 메모리(navHistory)라 종료 시 소실 → 최근 목록은 userData/recent.json 에 남긴다.
// 저장 형식 = 경로 문자열 배열(최신순, 상한 RECENT_MAX). 존재하지 않는 경로는 로드 시 걸러낸다.
const RECENT_MAX = 15;
function recentFilePath() {
	return path.join(app.getPath('userData'), 'recent.json');
}
function loadRecent() {
	try {
		const arr = JSON.parse(fs.readFileSync(recentFilePath(), 'utf8'));
		if (Array.isArray(arr)) return arr.filter((p) => typeof p === 'string' && fs.existsSync(p));
	} catch (_) {}
	return [];
}
function saveRecent(arr) {
	try {
		fs.writeFileSync(recentFilePath(), JSON.stringify(arr), 'utf8');
	} catch (_) {}
}
// 렌더러로 최근 목록 push — { path, name } 배열로 변환(렌더러엔 path 모듈 없음). 열린 모든 창에 전송.
function sendRecent(arr) {
	const list = (arr || loadRecent()).filter((p) => fs.existsSync(p));
	const payload = list.map((p) => ({ path: p, name: path.basename(p) }));
	for (const w of BrowserWindow.getAllWindows()) w.webContents.send('recent-files', payload);
}
// 파일 열림 → 최근 목록 맨 앞으로(중복 제거), 상한 유지, 저장 후 push.
function pushRecent(filePath) {
	const abs = path.resolve(filePath);
	let arr = loadRecent().filter((p) => path.resolve(p).toLowerCase() !== abs.toLowerCase());
	arr.unshift(abs);
	if (arr.length > RECENT_MAX) arr = arr.slice(0, RECENT_MAX);
	saveRecent(arr);
	sendRecent(arr);
}

// 새 창 생성. open = { file, folder } — 렌더러 준비(ready) 시점에 이 창으로 flush 한다.
//   file   : 준비되면 이 경로를 열도록 open-path 신호
//   folder : 준비되면 이 폴더 트리를 folder-tree 로 push (새 창이 부모 창의 폴더를 물려받기)
// 창이 여러 개일 수 있으므로 각 창의 상태는 webContents.id 로 Map 에 격리한다.
function createWindow(open) {
	const w = new BrowserWindow({
		width: 1360,
		height: 860,
		title: 'Dong Dong Spec Viewer for Windows',
		backgroundColor: '#ffffff',
		webPreferences: {
			preload: path.join(__dirname, 'preload.js'),
			contextIsolation: true,
			nodeIntegration: false,
		},
	});
	const id = w.webContents.id;
	if (open && open.file) pendingFiles.set(id, open.file);
	if (open && open.folder) pendingFolders.set(id, open.folder);
	w.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

	// 외부 링크 안전망 — 앱 창이 외부 주소로 navigate 되어 깨지는 것을 막고 기본 브라우저로 넘긴다.
	w.webContents.setWindowOpenHandler(({ url }) => {
		if (/^https?:/i.test(url)) shell.openExternal(url);
		return { action: 'deny' };
	});
	w.webContents.on('will-navigate', (e, url) => {
		if (!url.startsWith('file://')) {
			e.preventDefault();
			if (/^(https?:|mailto:)/i.test(url)) shell.openExternal(url);
		}
	});

	// 줌 단축키 — Ctrl+= / Ctrl++ 확대, Ctrl+- 축소, Ctrl+0 초기화.
	// Shift 유무·키보드 레이아웃과 무관하게 대칭 동작하도록 '='·'+'·'-'·'_'·'0' 을 모두 잡는다.
	// (메뉴 role 의 기본 accelerator 는 registerAccelerator:false 로 꺼서 이중 발동 방지 — 여기서 단일 처리.)
	w.webContents.on('before-input-event', (e, input) => {
		if (input.type !== 'keyDown') return;
		if (!(input.control || input.meta)) return;
		const k = input.key;
		if (k === '=' || k === '+') { applyZoom(w.webContents, 0.5); e.preventDefault(); }
		else if (k === '-' || k === '_') { applyZoom(w.webContents, -0.5); e.preventDefault(); }
		else if (k === '0') { applyZoom(w.webContents, 0); e.preventDefault(); }
	});

	// 창이 닫히면 그 창의 격리 상태를 정리 (id 는 closed 후 접근 불가라 미리 캡처).
	w.on('closed', () => {
		pendingFiles.delete(id);
		pendingFolders.delete(id);
		lastFolderRoots.delete(id);
	});

	buildMenu();
	return w;
}

// frontmatter 의 FrontmatterValue 를 렌더러에 보낼 평문 형태로 직렬화
function serializeFrontmatter(frontmatter) {
	if (!frontmatter) return null;
	const custom = {};
	for (const [k, v] of Object.entries(frontmatter.custom || {})) {
		custom[k] = v && typeof v.displayString === 'string' ? v.displayString : String(v);
	}
	return {
		title: frontmatter.title || null,
		date: frontmatter.date ? String(frontmatter.date) : null,
		tags: frontmatter.tags || [],
		aliases: frontmatter.aliases || [],
		cssclass: frontmatter.cssclass || null,
		custom,
	};
}

// 더블클릭/"연결 프로그램"으로 넘어온 파일 경로를 argv 에서 안전 추출.
//   dev  : electron . "C:\x.md"  -> argv = [electron, '.', 'C:\x.md']
//   배포 : "Dong Dong Spec Viewer.exe" "C:\x.md"   -> argv = [exe, 'C:\x.md']
// argv[0] 은 실행 파일(.md 로 안 끝남)이라 i=1 부터 훑고, 플래그/'.'/존재하지 않는 경로는 건너뛴다.
// (dev/배포 분기 없이 확장자 + 실제 파일 존재로 판정 — 패키지 환경 argv 변형에도 견고)
function fileArgFrom(argv) {
	for (let i = 1; i < argv.length; i++) {
		const a = argv[i];
		if (!a || a.startsWith('-') || a === '.') continue;
		if (/\.(md|markdown|mdown|txt)$/i.test(a)) {
			try {
				if (fs.statSync(a).isFile()) return a;
			} catch (_) {
				return a; // stat 실패해도 확장자 매칭이면 일단 시도 (readDocPayload 가 에러 처리)
			}
		}
	}
	return null;
}

// 문서 서비스 — 파일을 읽어 frontmatter 분리 + 원본 raw 를 request/response 로 돌려준다.
// (방문 기록은 렌더러가 탭별로 소유하므로 메인은 무상태. 열림 시 최근 목록만 갱신.)
function readDocPayload(filePath) {
	let text;
	try {
		text = fs.readFileSync(filePath, 'utf8');
	} catch (e) {
		return { filePath, exists: false, error: e.message };
	}
	pushRecent(filePath);
	const { frontmatter, body } = fm.parse(text);
	return {
		filePath,
		exists: true,
		frontmatter: serializeFrontmatter(frontmatter),
		body,
		raw: text, // 편집 모드용 원본 전체(frontmatter 포함) — parse/serialize 안 거쳐 무손실
	};
}

// 대상 창에 "이 경로를 열어라" 신호 — argv·연결 프로그램·메뉴 열기·두 번째 인스턴스 진입점.
function sendOpenPath(targetWin, filePath) {
	if (targetWin && !targetWin.isDestroyed() && filePath) targetWin.webContents.send('open-path', filePath);
}

async function openMarkdownFile() {
	const target = focusedOrAnyWindow();
	const res = await dialog.showOpenDialog(target || undefined, {
		properties: ['openFile'],
		filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'txt'] }],
	});
	if (res.canceled || !res.filePaths[0]) return;
	sendOpenPath(target, res.filePaths[0]);
}

// ---- 폴더 트리 (사이드바에서 클릭 탐색) -----------------------------------
// 폴더를 골라 그 아래 .md 트리를 만들어 렌더러로 보낸다. .md 가 없는 폴더는 접는다.
const MD_RE = /\.(md|markdown|mdown)$/i;
const TREE_SKIP_DIR = new Set(['.obsidian', '.git', 'node_modules', '.trash']);

// dir 이하를 재귀로 훑어 { type, name, path, children } 노드 배열을 만든다 (budget 으로 폭주 방지).
function buildTree(dir, budget) {
	const out = [];
	let entries;
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch (_) {
		return out;
	}
	const dirs = [];
	const files = [];
	for (const ent of entries) {
		if (budget.n-- <= 0) break;
		if (ent.isDirectory()) {
			if (TREE_SKIP_DIR.has(ent.name.toLowerCase())) continue;
			dirs.push(ent.name);
		} else if (MD_RE.test(ent.name)) {
			files.push(ent.name);
		}
	}
	dirs.sort((a, b) => a.localeCompare(b));
	files.sort((a, b) => a.localeCompare(b));
	for (const name of dirs) {
		const full = path.join(dir, name);
		const children = buildTree(full, budget);
		if (children.length > 0) out.push({ type: 'dir', name, path: full, children });
	}
	for (const name of files) {
		out.push({ type: 'file', name, path: path.join(dir, name) });
	}
	return out;
}

// 폴더 선택 다이얼로그 -> 트리 payload (취소 시 null). 요청 창을 다이얼로그 부모로,
// 그 창의 lastFolderRoot 를 갱신한다 (senderId = 요청 창 webContents.id, 없으면 전역 폴백 없음).
async function pickFolder(parentWin, senderId) {
	const res = await dialog.showOpenDialog(parentWin || undefined, { properties: ['openDirectory'] });
	if (res.canceled || !res.filePaths[0]) return null;
	const root = res.filePaths[0];
	if (senderId != null) lastFolderRoots.set(senderId, root);
	return { root, name: path.basename(root), tree: buildTree(root, { n: 20000 }) };
}

// 메뉴에서 폴더 열기 -> 포커스 창에 트리를 push.
async function openFolderFromMenu() {
	const target = focusedOrAnyWindow();
	if (!target) return;
	const payload = await pickFolder(target, target.webContents.id);
	if (payload && !target.isDestroyed()) target.webContents.send('folder-tree', payload);
}

// 설치된 Obsidian 볼트를 감지해 포커스 창으로 (라우터 UI 의 출발점)
function reportDetectedVaults() {
	const target = focusedOrAnyWindow();
	if (!target) return;
	target.webContents.send('vaults', vault.detectedVaults());
}

function buildMenu() {
	const template = [
		{
			label: '파일',
			submenu: [
				// 새 창은 렌더러에 위임(menu-new-window) — 렌더러가 현재 폴더를 물려주며 open-new-window 를 호출한다.
				{ label: '새 창', accelerator: 'CmdOrCtrl+N', click: () => {
					const t = focusedOrAnyWindow();
					if (t && !t.isDestroyed()) t.webContents.send('menu-new-window');
					else createWindow();
				} },
				{ type: 'separator' },
				{ label: '열기…', accelerator: 'CmdOrCtrl+O', click: openMarkdownFile },
				{ label: '폴더 열기…', accelerator: 'CmdOrCtrl+Shift+O', click: openFolderFromMenu },
				{ label: 'Obsidian 볼트 감지', click: reportDetectedVaults },
				{ type: 'separator' },
				{ role: 'quit', label: '종료' },
			],
		},
		{
			label: '보기',
			submenu: [
				{ role: 'reload', label: '새로고침' },
				{ role: 'toggleDevTools', label: '개발자 도구' },
				{ type: 'separator' },
				// accelerator 는 표시용 — 실제 바인딩은 창의 before-input-event 가 단일 처리(registerAccelerator:false).
				{ label: '확대', accelerator: 'CmdOrCtrl+Plus', registerAccelerator: false, click: (_mi, w) => applyZoom(w && w.webContents, 0.5) },
				{ label: '축소', accelerator: 'CmdOrCtrl+-', registerAccelerator: false, click: (_mi, w) => applyZoom(w && w.webContents, -0.5) },
				{ label: '실제 크기', accelerator: 'CmdOrCtrl+0', registerAccelerator: false, click: (_mi, w) => applyZoom(w && w.webContents, 0) },
			],
		},
	];
	Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// 렌더러가 준비되면 볼트 목록을 한 번 보낸다.
// 더블클릭/연결 프로그램으로 보류된 파일이 있으면 이 시점(렌더러 준비 완료)에 open-path 신호로 연다.
ipcMain.handle('ready', (e) => {
	const vaults = vault.detectedVaults();
	const id = e.sender.id;
	sendRecent(); // 시작 시 최근 목록 1회 전송(모든 창)
	// 이 창이 물려받을 폴더가 있으면 트리를 push (부모 창의 폴더를 새 창이 이어받기).
	const folder = pendingFolders.get(id);
	if (folder) {
		pendingFolders.delete(id);
		try {
			const root = path.resolve(folder);
			if (fs.statSync(root).isDirectory()) {
				lastFolderRoots.set(id, root);
				e.sender.send('folder-tree', { root, name: path.basename(root), tree: buildTree(root, { n: 20000 }) });
			}
		} catch (_) {}
	}
	// 이 창이 열도록 보류된 파일이 있으면 open-path 신호 (더블클릭·연결 프로그램·새 창으로 열기).
	const file = pendingFiles.get(id);
	if (file) {
		pendingFiles.delete(id);
		e.sender.send('open-path', file);
	}
	return { vaults };
});

// 렌더러가 요청한 "새 창" — file/folder 를 물려 창을 만든다 (renderer.requestNewWindow → preload.openNewWindow).
ipcMain.handle('open-new-window', (_e, opts) => {
	const o = opts || {};
	createWindow({ file: o.filePath || null, folder: o.folder || null });
	return { ok: true };
});

// ---- 이미지 임베드 해석 (![[img.png]]) -------------------------------------
// 렌더러는 fs 접근이 없으므로, 이미지 파일을 메인이 찾아 data URL 로 돌려준다.
// 노트 임베드(![[노트]])는 이미지가 아니라서 여기서 null → 렌더러가 링크로 처리.
const IMG_MIME = {
	'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
	'.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.bmp': 'image/bmp',
};

// docPath 가 속한 감지된 볼트 루트를 반환 (가장 깊게 매칭되는 볼트). 없으면 null.
function vaultRootFor(docPath) {
	try {
		if (!docPath) return null;
		const norm = path.resolve(docPath).toLowerCase();
		return vault
			.detectedVaults()
			.filter((v) => v.path && norm.startsWith(path.resolve(v.path).toLowerCase() + path.sep))
			.sort((a, b) => b.path.length - a.path.length)
			.map((v) => v.path)[0] || null;
	} catch (_) {
		return null;
	}
}

// root 이하에서 파일명이 일치하는 이미지를 BFS 로 검색 (.obsidian/.git/node_modules 제외, budget 한도).
function findImageUnder(root, baseName, budget) {
	const target = baseName.toLowerCase();
	const stack = [root];
	while (stack.length && budget.n > 0) {
		const dir = stack.pop();
		let entries;
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		} catch (_) {
			continue;
		}
		for (const ent of entries) {
			if (budget.n-- <= 0) break;
			if (ent.isDirectory()) {
				const n = ent.name.toLowerCase();
				if (n === '.obsidian' || n === '.git' || n === 'node_modules' || n === '.trash') continue;
				stack.push(path.join(dir, ent.name));
			} else if (ent.name.toLowerCase() === target) {
				return path.join(dir, ent.name);
			}
		}
	}
	return null;
}

// 사이드바 "폴더 열기" 버튼 -> 트리 payload 반환 (요청 창을 다이얼로그 부모 + lastFolderRoot 소유자로).
ipcMain.handle('open-folder', (e) => {
	const w = BrowserWindow.fromWebContents(e.sender);
	return pickFolder(w, e.sender.id);
});

// 경로 지정 폴더 열기 -> 트리 payload 반환 (다이얼로그 없이. "내 볼트" 클릭 진입점).
// obsidian.json 에서 읽은 볼트 경로를 그대로 받아 트리를 만든다. 폴더 아니면 null.
ipcMain.handle('open-folder-path', (e, p) => {
	try {
		const root = path.resolve(String(p || ''));
		if (!fs.statSync(root).isDirectory()) return null;
		lastFolderRoots.set(e.sender.id, root);
		return { root, name: path.basename(root), tree: buildTree(root, { n: 20000 }) };
	} catch (_) {
		return null;
	}
});

// 렌더러가 문서 본문을 요청 (트리·최근·위키링크·드롭·open-path 신호의 실제 로드 = 탭이 소유).
ipcMain.handle('read-doc', (_e, p) => {
	if (!p || typeof p !== 'string') return { exists: false, error: '경로 누락' };
	return readDocPayload(p);
});

// 최근 목록 초기화(전체 비우기) / 개별 항목 제거 — 저장 후 열린 모든 창에 재전송.
ipcMain.handle('clear-recent', () => { saveRecent([]); sendRecent([]); return { ok: true }; });
ipcMain.handle('remove-recent', (_e, p) => {
	const abs = path.resolve(String(p || ''));
	const arr = loadRecent().filter((x) => path.resolve(x).toLowerCase() !== abs.toLowerCase());
	saveRecent(arr);
	sendRecent(arr);
	return { ok: true };
});
// 이미 열린 문서 재방문 — 재읽기 없이 최근 목록만 최상단으로 갱신(read-doc 을 안 타는 경로 보완).
ipcMain.handle('touch-recent', (_e, p) => {
	if (p && typeof p === 'string' && fs.existsSync(p)) pushRecent(p);
	return { ok: true };
});

// ---- 드래그앤드롭 분류 (기능 3·4 공유) -------------------------------------
// 드롭 폴더 스캔이 앱을 얼리지 않도록 위험/초대형 경로를 가른다.
//   - 드라이브 루트(C:\) : 무조건 위험
//   - 시스템 폴더(Windows·Program Files) : 자기·하위·상위 모두 위험(거대·민감)
//   - 사용자 홈·Users 루트 : 그 지점만 위험(홈 하위 실제 노트 폴더는 허용)
function isDangerousScanRoot(dir) {
	let resolved;
	try { resolved = path.resolve(dir); } catch (_) { return true; }
	const low = resolved.toLowerCase();
	const root = path.parse(resolved).root.toLowerCase();
	if (low === root) return true; // 드라이브 루트
	const sys = [process.env.SystemRoot, process.env.ProgramFiles, process.env['ProgramFiles(x86)']]
		.filter(Boolean)
		.map((d) => path.resolve(d).toLowerCase());
	for (const b of sys) {
		if (low === b || low.startsWith(b + path.sep) || b.startsWith(low + path.sep)) return true;
	}
	const home = path.resolve(app.getPath('home')).toLowerCase(); // C:\Users\<user>
	const usersRoot = path.dirname(home).toLowerCase(); // C:\Users
	if (low === home || low === usersRoot) return true;
	return false;
}

// 드롭된 경로 판별. 폴더면 트리를 push(위험 경로는 확인 다이얼로그), .md 는 kind 만 반환(렌더러가 로드).
// v1.1 정책 — 첫 항목만 처리, 여러 개 동시 드롭은 렌더러가 안내. buildTree budget 으로 폭주 방지.
ipcMain.handle('classify-dropped', (e, p) => {
	try {
		const target = BrowserWindow.fromWebContents(e.sender); // 드롭 발생 창
		if (!p || typeof p !== 'string') return { kind: 'other' };
		let st;
		try { st = fs.statSync(p); } catch (_) { return { kind: 'missing', path: p }; }
		if (st.isDirectory()) {
			if (isDangerousScanRoot(p)) {
				const ok = dialog.showMessageBoxSync(target || undefined, {
					type: 'warning',
					buttons: ['예', '아니요'],
					defaultId: 1,
					cancelId: 1,
					noLink: true,
					title: '폴더 열기 확인',
					message: '시스템/최상위 폴더입니다.',
					detail: `${p}\n\n항목이 매우 많아 느려질 수 있습니다. 계속 열까요?`,
				});
				if (ok !== 0) return { kind: 'dir-blocked', path: p };
			}
			const root = path.resolve(p);
			lastFolderRoots.set(e.sender.id, root); // 드롭 발생 창의 폴더로 기록
			const budget = { n: 12000 }; // 드롭은 폴더 열기(20000)보다 보수적
			const tree = buildTree(root, budget);
			const truncated = budget.n <= 0;
			if (target && !target.isDestroyed()) target.webContents.send('folder-tree', { root, name: path.basename(root), tree, truncated });
			return { kind: 'dir', truncated };
		}
		if (MD_RE.test(p)) return { kind: 'md', path: p }; // 로드는 렌더러가(편집 중 미저장 보호)
		return { kind: 'other', path: p };
	} catch (e) {
		return { kind: 'error', error: e.message };
	}
});

// 뒤로/앞으로는 렌더러가 탭별 방문 기록으로 처리 — 메인 nav 상태·핸들러 제거됨.

// ---- 파일 저장 (편집 모드) -------------------------------------------------
// 렌더러가 보낸 원본 텍스트를 그대로 디스크에 쓴다 (parse/serialize 미경유 = 무손실).
// 저장 성공 시 디스크에서 다시 읽어 렌더 — 화면이 실제 저장 결과로 갱신돼 round-trip 을 자가 검증한다.
ipcMain.handle('save-file', (_e, payload) => {
	try {
		const filePath = payload && payload.filePath;
		const content = payload && typeof payload.content === 'string' ? payload.content : null;
		if (!filePath || content === null) return { ok: false, error: '경로 또는 내용 누락' };
		fs.writeFileSync(filePath, content, 'utf8');
		pushRecent(filePath);
		return { ok: true }; // 렌더러가 read-doc 로 재읽기 → 읽기 모드 복귀(round-trip 자가 검증)
	} catch (e) {
		return { ok: false, error: e.message };
	}
});

// 편집 중 미저장 변경 버리기 확인 — 네이티브 모달(버튼 텍스트 '예'/'아니요' 커스텀).
// 동기(sendSync)로 렌더러의 confirmLeaveEdit 흐름을 단순하게 유지한다.
// 반환 true='예'(버리고 진행) · false='아니요'(편집 계속).
ipcMain.on('confirm-discard-sync', (e) => {
	const target = BrowserWindow.fromWebContents(e.sender);
	const idx = dialog.showMessageBoxSync(target || undefined, {
		type: 'warning',
		buttons: ['예', '아니요'],
		defaultId: 1, // 기본 포커스 = '아니요' (실수로 Enter 쳐도 편집 유지)
		cancelId: 1, // Esc = '아니요'
		noLink: true,
		title: '편집 취소',
		message: '저장하지 않은 내용이 있습니다.',
		detail: '정말 취소하시겠습니까?',
	});
	e.returnValue = idx === 0; // '예' 선택 시에만 버린다
});

// ---- 위키링크/외부링크 이동 -----------------------------------------------
// root 이하에서 파일명이 일치하는 .md 노트를 BFS 로 검색 (이미지 검색과 같은 제외 규칙).
function findNoteUnder(root, baseName, budget) {
	const target = baseName.toLowerCase();
	const stack = [root];
	while (stack.length && budget.n > 0) {
		const dir = stack.pop();
		let entries;
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		} catch (_) {
			continue;
		}
		for (const ent of entries) {
			if (budget.n-- <= 0) break;
			if (ent.isDirectory()) {
				if (TREE_SKIP_DIR.has(ent.name.toLowerCase())) continue;
				stack.push(path.join(dir, ent.name));
			} else if (ent.name.toLowerCase() === target) {
				return path.join(dir, ent.name);
			}
		}
	}
	return null;
}

// 위키링크 [[노트]] / [[노트#헤딩]] / [[하위/노트]] 를 실제 .md 경로로 해석(로드는 렌더러가).
// lastRoot = 요청 창이 마지막으로 연 폴더 (창별 폴백 검색 범위).
function resolveNotePath(rawTarget, docPath, lastRoot) {
	try {
		const raw = (rawTarget || '').trim();
		if (!raw) return null;
		let target = raw.split('#')[0].split('^')[0].trim().replace(/\\/g, '/');
		if (!target) return null; // 같은 문서 내 헤딩/블록 링크면 무시
		const base = path.basename(target);
		const withExt = /\.(md|markdown|mdown)$/i.test(base) ? base : base + '.md';

		// 1) 문서 폴더 기준 상대경로 직접 시도 (하위 폴더 포함 링크)
		let found = null;
		if (docPath) {
			const rel = path.resolve(path.dirname(docPath), target);
			const relExt = /\.(md|markdown|mdown)$/i.test(rel) ? rel : rel + '.md';
			try {
				if (fs.statSync(relExt).isFile()) found = relExt;
			} catch (_) {}
		}
		// 2) 파일명 BFS — 볼트 루트 → 문서 폴더 → 마지막 연 폴더 순
		if (!found) {
			const roots = [];
			const vr = vaultRootFor(docPath);
			if (vr) roots.push(vr);
			if (docPath) roots.push(path.dirname(docPath));
			if (lastRoot) roots.push(lastRoot);
			for (const r of roots) {
				found = findNoteUnder(r, withExt, { n: 20000 });
				if (found) break;
			}
		}
		return found || null;
	} catch (_) {
		return null;
	}
}
ipcMain.handle('resolve-note', (e, payload) =>
	resolveNotePath(
		(payload && payload.target) || '',
		(payload && payload.docPath) || '',
		lastFolderRoots.get(e.sender.id) || null
	)
);

// 외부 URL 을 시스템 기본 브라우저로 연다.
ipcMain.handle('open-external', (_e, url) => {
	try {
		if (typeof url === 'string' && /^(https?:|mailto:)/i.test(url)) shell.openExternal(url);
	} catch (_) {}
});

ipcMain.handle('resolve-embed', (_e, payload) => {
	try {
		const name = ((payload && payload.name) || '').trim();
		const docPath = (payload && payload.docPath) || '';
		if (!name) return null;
		const ext = path.extname(name).toLowerCase();
		if (!IMG_MIME[ext]) return null; // 이미지 임베드만 해석

		// 1) 절대경로 / 문서 디렉토리 기준 상대경로 우선
		const direct = [];
		if (path.isAbsolute(name)) direct.push(name);
		if (docPath) direct.push(path.resolve(path.dirname(docPath), name));
		let found = direct.find((p) => {
			try {
				return fs.statSync(p).isFile();
			} catch (_) {
				return false;
			}
		});
		// 2) 파일명만이면 볼트 루트(없으면 문서 폴더) 재귀 검색
		if (!found) {
			const root = vaultRootFor(docPath) || (docPath ? path.dirname(docPath) : null);
			if (root) found = findImageUnder(root, path.basename(name), { n: 8000 });
		}
		if (!found) return null;
		const buf = fs.readFileSync(found);
		return `data:${IMG_MIME[ext]};base64,${buf.toString('base64')}`;
	} catch (_) {
		return null;
	}
});

// 시작 단계 에러를 조용히 삼키지 않고 userData 에 로그로 남긴다 (사용자 PC 진단용).
function logStartupError(err) {
	try {
		const logPath = path.join(app.getPath('userData'), 'startup-error.log');
		const stamp = new Date().toISOString();
		fs.appendFileSync(logPath, `[${stamp}] ${err && err.stack ? err.stack : String(err)}\n`);
	} catch (_) {}
}

// 단일 인스턴스 — 앱이 떠 있는데 밖에서 다른 .md 를 더블클릭하면 새 프로세스를 띄우지 않고
// 포커스된(없으면 아무) 기존 창에서 열고 포커스한다. lock 획득 실패(=두 번째 인스턴스)면 곧장 종료.
// (앱 내부 "새 창"과는 별개 — 그건 같은 프로세스에서 BrowserWindow 를 추가로 만든다.)
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
	app.quit();
} else {
	app.on('second-instance', (_e, argv) => {
		const file = fileArgFrom(argv);
		const target = focusedOrAnyWindow();
		if (!target) {
			// 모든 창이 닫혔는데 프로세스만 살아있는 경우 — 새 창을 만들고 보류 파일로 연다.
			createWindow(file ? { file } : null);
			return;
		}
		if (target.isMinimized()) target.restore();
		target.focus();
		if (!file) return;
		// 로딩 중이면 ready() 가 flush, 로드 완료면 즉시 open-path 신호 (소실 방지).
		if (target.webContents.isLoading()) pendingFiles.set(target.webContents.id, file);
		else sendOpenPath(target, file);
	});

	app.whenReady()
		.then(() => {
			try {
				const file = fileArgFrom(process.argv);
				createWindow(file ? { file } : null); // 렌더러 준비(ready) 시 flush
			} catch (err) {
				logStartupError(err);
			}
			app.on('activate', () => {
				if (BrowserWindow.getAllWindows().length === 0) createWindow();
			});
		})
		.catch(logStartupError);

	app.on('window-all-closed', () => {
		if (process.platform !== 'darwin') app.quit();
	});
}
