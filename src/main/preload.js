// preload — 렌더러에 안전한 IPC 표면만 노출 (contextIsolation 유지)

'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('cmdmd', {
	// 문서 본문 요청 -> { filePath, exists, frontmatter, body, raw } (request/response — 탭이 소유)
	readDoc: (filePath) => ipcRenderer.invoke('read-doc', filePath),
	// 감지된 Obsidian 볼트 목록 수신
	onVaults: (cb) => ipcRenderer.on('vaults', (_e, vaults) => cb(vaults)),
	// 렌더러 준비 신호 -> { vaults }
	ready: () => ipcRenderer.invoke('ready'),
	// 이미지 임베드 ![[img.png]] 해석 -> data URL | null (노트 임베드는 null)
	resolveEmbed: (name, docPath) => ipcRenderer.invoke('resolve-embed', { name, docPath }),
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
	// 위키링크 [[노트]] -> 실제 .md 경로 해석 | null (로드는 렌더러가)
	resolveNote: (target, docPath) => ipcRenderer.invoke('resolve-note', { target, docPath }),
	// 외부 URL 클릭 -> 기본 브라우저
	openExternal: (url) => ipcRenderer.invoke('open-external', url),
	// 편집 내용 저장 -> { ok, error? } (성공 시 렌더러가 read-doc 로 재읽기 → 읽기 모드 복귀)
	saveFile: (filePath, content) => ipcRenderer.invoke('save-file', { filePath, content }),
	// 편집 중 미저장 변경 버리기 확인(네이티브 모달) -> true='예'(버림) / false='아니요'(머무름)
	confirmDiscard: () => ipcRenderer.sendSync('confirm-discard-sync'),
	// 드롭된 File 의 실제 경로 (Electron 33 은 File.path 제거 → webUtils 사용)
	pathForFile: (file) => webUtils.getPathForFile(file),
	// 드롭된 경로 판별 -> { kind: 'md'|'dir'|'dir-blocked'|'other'|'missing', path?, truncated? }
	//   (폴더면 메인이 folder-tree 로 트리 push, .md 는 렌더러가 openInActiveGroup 로 로드)
	classifyDropped: (p) => ipcRenderer.invoke('classify-dropped', p),
});
