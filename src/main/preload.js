// preload — 렌더러에 안전한 IPC 표면만 노출 (contextIsolation 유지)

'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('ddsv', {
	// 문서 원본 요청 -> { filePath, exists, raw } (request/response — 탭이 소유). iframe srcdoc 으로 렌더.
	readHtml: (filePath) => ipcRenderer.invoke('read-html', filePath),
	// 감지된 Obsidian 볼트 목록 수신
	onVaults: (cb) => ipcRenderer.on('vaults', (_e, vaults) => cb(vaults)),
	// 렌더러 준비 신호 -> { vaults }
	ready: () => ipcRenderer.invoke('ready'),
	// 폴더 선택 -> { root, name, tree } | null (사이드바 트리)
	openFolder: () => ipcRenderer.invoke('open-folder'),
	// 경로 지정 폴더 열기 -> { root, name, tree } | null ("내 볼트" 클릭 — 다이얼로그 없이)
	openFolderPath: (p) => ipcRenderer.invoke('open-folder-path', p),
	// 메뉴 "폴더 열기"로 만들어진 트리 수신
	onFolderTree: (cb) => ipcRenderer.on('folder-tree', (_e, payload) => cb(payload)),
	// 최근 연 파일 목록 수신 -> [{ path, name }] (최신순)
	onRecent: (cb) => ipcRenderer.on('recent-files', (_e, payload) => cb(payload)),
	// 최근 목록 전체 초기화 / 개별 항목 제거 -> { ok } (성공 시 메인이 recent-files 재전송)
	clearRecent: () => ipcRenderer.invoke('clear-recent'),
	removeRecent: (p) => ipcRenderer.invoke('remove-recent', p),
	// 이미 열린 문서 재방문 시 최근 목록 갱신 (재읽기 없이)
	touchRecent: (p) => ipcRenderer.invoke('touch-recent', p),
	// 메인의 "이 경로를 열어라" 신호 (argv·연결 프로그램·메뉴·두 번째 인스턴스)
	onOpenPath: (cb) => ipcRenderer.on('open-path', (_e, p) => cb(p)),
	// 새 창 열기 -> { filePath?, folder? } (파일/현재 폴더를 물려 새 창 생성)
	openNewWindow: (opts) => ipcRenderer.invoke('open-new-window', opts),
	// 메뉴 "새 창"(Ctrl+N) 신호 — 렌더러가 현재 폴더를 물려 openNewWindow 호출
	onMenuNewWindow: (cb) => ipcRenderer.on('menu-new-window', () => cb()),
	// 외부 URL 클릭 -> 기본 브라우저 (iframe 내부 링크 네비 가드)
	openExternal: (url) => ipcRenderer.invoke('open-external', url),
	// 드롭된 File 의 실제 경로 (Electron 33 은 File.path 제거 → webUtils 사용)
	pathForFile: (file) => webUtils.getPathForFile(file),
	// 드롭된 경로 판별 -> { kind: 'html'|'dir'|'dir-blocked'|'other'|'missing', path?, truncated? }
	//   (폴더면 메인이 folder-tree 로 트리 push, .html 은 렌더러가 openInGroup 으로 로드)
	classifyDropped: (p) => ipcRenderer.invoke('classify-dropped', p),
	// 주석 HTML 저장 (M5) — 현재 경로 덮어쓰기 / 다른 이름 저장. html 은 DDHtmlIO.embed 결과 최종본.
	saveAnnotated: (filePath, html) => ipcRenderer.invoke('save-annotated-html', filePath, html),
	saveAnnotatedAs: (srcPath, html) => ipcRenderer.invoke('save-annotated-html-as', srcPath, html),
	// 메뉴/단축키 저장 신호 (Ctrl+S / Ctrl+Shift+S)
	onMenuSave: (cb) => ipcRenderer.on('menu-save', (_e, as) => cb(as)),
});
