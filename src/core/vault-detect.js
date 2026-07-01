// Obsidian 볼트 자동 감지 — CmdMD VaultService/ObsidianLocator 이식 (윈도우판).
// 맥의 ~/Library/Application Support/obsidian/obsidian.json 대신
// 윈도우의 %APPDATA%\obsidian\obsidian.json 레지스트리를 읽는다.
// macOS 보안 스코프 북마크는 윈도우에 없으므로 평문 경로만 저장한다 (더 단순).

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// obsidian.json 의 표준 위치 (윈도우 기준, 폴백 포함)
function obsidianRegistryPath() {
	const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
	return path.join(appData, 'obsidian', 'obsidian.json');
}

// 설치된 볼트 목록을 최근 열람 순으로 반환. [{ id, path, name, ts, open }]
function detectedVaults(registryPath = obsidianRegistryPath()) {
	let raw;
	try {
		raw = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
	} catch (e) {
		return [];
	}
	const vaults = raw && raw.vaults ? raw.vaults : {};
	const list = Object.entries(vaults).map(([id, v]) => ({
		id,
		path: v.path,
		name: v.path ? path.basename(v.path) : id,
		ts: typeof v.ts === 'number' ? v.ts : 0,
		open: !!v.open,
	}));
	list.sort((a, b) => b.ts - a.ts); // 최근 열람 우선
	return list;
}

// 해당 폴더가 Obsidian 볼트인지 (.obsidian 설정 디렉터리 존재 여부)
function isObsidianVault(dir) {
	try {
		return fs.statSync(path.join(dir, '.obsidian')).isDirectory();
	} catch (e) {
		return false;
	}
}

module.exports = { obsidianRegistryPath, detectedVaults, isObsidianVault };
