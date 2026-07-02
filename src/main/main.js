// Electron 메인 프로세스 — 창 생성 + 파일/폴더 열기. 파일은 원본 HTML 을 그대로
// 렌더러로 보내고, 렌더러가 <iframe srcdoc> 으로 무손상 렌더한다. (spec-html 목업 전용 뷰어)

'use strict';

const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const vault = require('../core/vault-detect');

// 다중 창 — 전역 단일 win 을 버리고 창별 상태를 webContents.id 로 격리한다.
//   pendingFiles   : 렌더러 준비 전 보류한 "이 창에서 열 파일" (더블클릭/연결 프로그램/새 창으로 열기)
//   pendingFolders : 새 창이 물려받을 폴더 루트 (창을 열 때 사이드바 트리를 같이 넘기기)
//   lastFolderRoots: 각 창이 마지막으로 연 폴더 (창마다 독립)
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

// 더블클릭/"연결 프로그램"으로 넘어온 파일 경로를 argv 에서 안전 추출.
//   dev  : electron . "C:\x.html"  -> argv = [electron, '.', 'C:\x.html']
//   배포 : "Dong Dong Spec Viewer.exe" "C:\x.html"   -> argv = [exe, 'C:\x.html']
// argv[0] 은 실행 파일(.html 로 안 끝남)이라 i=1 부터 훑고, 플래그/'.'/존재하지 않는 경로는 건너뛴다.
// (dev/배포 분기 없이 확장자 + 실제 파일 존재로 판정 — 패키지 환경 argv 변형에도 견고)
function fileArgFrom(argv) {
	for (let i = 1; i < argv.length; i++) {
		const a = argv[i];
		if (!a || a.startsWith('-') || a === '.') continue;
		if (/\.html?$/i.test(a)) {
			try {
				if (fs.statSync(a).isFile()) return a;
			} catch (_) {
				return a; // stat 실패해도 확장자 매칭이면 일단 시도 (readHtmlPayload 가 에러 처리)
			}
		}
	}
	return null;
}

// 문서 서비스 — 파일을 읽어 원본 HTML 을 request/response 로 그대로 돌려준다.
// (frontmatter 분리·마크다운 변환 없음 — iframe srcdoc 으로 원본 그대로 렌더. 열림 시 최근 목록만 갱신.)
function readHtmlPayload(filePath) {
	let text;
	try {
		text = fs.readFileSync(filePath, 'utf8');
	} catch (e) {
		return { filePath, exists: false, error: e.message };
	}
	pushRecent(filePath);
	return {
		filePath,
		exists: true,
		raw: text, // 원본 HTML 전체 — iframe srcdoc 으로 무손상 렌더 (주석 왕복은 M5)
	};
}

// 대상 창에 "이 경로를 열어라" 신호 — argv·연결 프로그램·메뉴 열기·두 번째 인스턴스 진입점.
function sendOpenPath(targetWin, filePath) {
	if (targetWin && !targetWin.isDestroyed() && filePath) targetWin.webContents.send('open-path', filePath);
}

async function openHtmlFile() {
	const target = focusedOrAnyWindow();
	const res = await dialog.showOpenDialog(target || undefined, {
		properties: ['openFile'],
		filters: [{ name: 'HTML', extensions: ['html', 'htm'] }],
	});
	if (res.canceled || !res.filePaths[0]) return;
	sendOpenPath(target, res.filePaths[0]);
}

// ---- 폴더 트리 (사이드바에서 클릭 탐색) -----------------------------------
// 폴더를 골라 그 아래 .html 트리를 만들어 렌더러로 보낸다. .html 이 없는 폴더는 접는다.
const HTML_RE = /\.html?$/i;
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
		} else if (HTML_RE.test(ent.name)) {
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
// 그 창의 lastFolderRoot 를 갱신한다 (senderId = 요청 창 webContents.id).
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

// 설치된 Obsidian 볼트를 감지해 포커스 창으로 (사이드바 "내 볼트" 목록의 출발점)
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
				{ label: '열기…', accelerator: 'CmdOrCtrl+O', click: openHtmlFile },
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

// 렌더러가 문서 원본을 요청 (트리·최근·드롭·open-path 신호의 실제 로드 = 탭이 소유).
ipcMain.handle('read-html', (_e, p) => {
	if (!p || typeof p !== 'string') return { exists: false, error: '경로 누락' };
	return readHtmlPayload(p);
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
// 이미 열린 문서 재방문 — 재읽기 없이 최근 목록만 최상단으로 갱신(read-html 을 안 타는 경로 보완).
ipcMain.handle('touch-recent', (_e, p) => {
	if (p && typeof p === 'string' && fs.existsSync(p)) pushRecent(p);
	return { ok: true };
});

// ---- 주석 HTML 저장 (M5) — 렌더러가 조립한 자기완결 HTML 을 파일로. 쓰고 다시 읽어 자가검증. ----
// html 문자열은 렌더러(DDHtmlIO.embed)가 이미 만든 최종본 — main 은 바이트를 그대로 쓴다(무손상 책임은 렌더러).
function writeVerified(filePath, html) {
	fs.writeFileSync(filePath, html, 'utf8');
	const back = fs.readFileSync(filePath, 'utf8'); // 마운트 캐시·인코딩 사고 방지 — 재읽기로 확정
	if (back !== html) return { ok: false, filePath, error: '저장 후 재읽기 불일치(디스크 확인 필요)' };
	pushRecent(filePath);
	return { ok: true, filePath };
}

// 현재 경로에 덮어쓰기.
ipcMain.handle('save-annotated-html', (_e, filePath, html) => {
	if (!filePath || typeof filePath !== 'string' || typeof html !== 'string') return { ok: false, error: '인자 누락' };
	try { return writeVerified(filePath, html); } catch (e) { return { ok: false, error: e.message }; }
});

// 다른 이름으로 저장 — 기본 파일명은 원본 옆 `<이름>_annotated.html`. 취소 시 { canceled:true }.
ipcMain.handle('save-annotated-html-as', async (e, srcPath, html) => {
	if (typeof html !== 'string') return { ok: false, error: 'html 누락' };
	const win = BrowserWindow.fromWebContents(e.sender);
	let defaultPath;
	if (srcPath && typeof srcPath === 'string') {
		const dir = path.dirname(srcPath);
		const base = path.basename(srcPath).replace(/(_annotated)?\.html?$/i, '');
		defaultPath = path.join(dir, base + '_annotated.html');
	}
	const res = await dialog.showSaveDialog(win || undefined, {
		title: '주석 HTML 다른 이름으로 저장',
		defaultPath,
		filters: [{ name: 'HTML', extensions: ['html', 'htm'] }],
	});
	if (res.canceled || !res.filePath) return { canceled: true };
	try { return writeVerified(res.filePath, html); } catch (er) { return { ok: false, error: er.message }; }
});

// ---- 드래그앤드롭 분류 -------------------------------------------------------
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

// 드롭된 경로 판별. 폴더면 트리를 push(위험 경로는 확인 다이얼로그), .html 은 kind 만 반환(렌더러가 로드).
// 첫 항목만 처리, 여러 개 동시 드롭은 렌더러가 안내. buildTree budget 으로 폭주 방지.
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
		if (HTML_RE.test(p)) return { kind: 'html', path: p }; // 로드는 렌더러가
		return { kind: 'other', path: p };
	} catch (e) {
		return { kind: 'error', error: e.message };
	}
});

// 외부 URL 을 시스템 기본 브라우저로 연다 (iframe 내부 링크 네비 가드에서 호출).
ipcMain.handle('open-external', (_e, url) => {
	try {
		if (typeof url === 'string' && /^(https?:|mailto:)/i.test(url)) shell.openExternal(url);
	} catch (_) {}
});

// 시작 단계 에러를 조용히 삼키지 않고 userData 에 로그로 남긴다 (사용자 PC 진단용).
function logStartupError(err) {
	try {
		const logPath = path.join(app.getPath('userData'), 'startup-error.log');
		const stamp = new Date().toISOString();
		fs.appendFileSync(logPath, `[${stamp}] ${err && err.stack ? err.stack : String(err)}\n`);
	} catch (_) {}
}

// 단일 인스턴스 — 앱이 떠 있는데 밖에서 다른 .html 을 더블클릭하면 새 프로세스를 띄우지 않고
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
