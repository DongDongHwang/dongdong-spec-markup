// 윈도우 설치본 빌드 스크립트 — electron-builder 가 패키징 중 electron.exe(약 180MB) rename
// 단계에서 실패하면서 그 이후 복사됐어야 할 필수 런타임 파일(icudtl.dat·resources.pak·
// v8_context_snapshot.bin·d3dcompiler_47.dll 등)까지 누락시키는 환경 이슈를 자동 우회한다.
// 그 파일들이 빠지면 exe 가 STATUS_BREAKPOINT(0x80000003)로 즉시 죽어 "클릭 무반응"이 된다.
// 절차. (1) --dir 패키징 시도 (2) 완전한 dev dist 에서 누락 런타임 파일 전부 보강(electron.exe
// 는 앱 exe 로) (3) rcedit 로 버전 리소스 스탬핑 (4) --prepackaged 로 NSIS 설치본 생성.
// 정석 해결은 관리자 PowerShell 에서 `Add-MpPreference -ExclusionPath 'C:\DEV\cmdmd-win'` 후 그냥 electron-builder.
//
// ※ rcedit 스탬핑(3)의 이유 — electron.exe 를 '바이트 복사'만 하면 PE 버전 리소스가 Electron 원본
//   (FileDescription="Electron")으로 남아 Windows "연결 프로그램"·작업관리자·파일 속성이 electron 으로
//   표시된다. 정상 패키징이 하던 rcedit 스탬핑을 여기서 직접 수행해 앱 이름으로 덮어쓴다.

'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const rcedit = require('rcedit');
const pkg = require('../package.json');

const root = path.resolve(__dirname, '..');
const unpacked = path.join(root, 'dist', 'win-unpacked');
const exeName = 'Dong Dong Spec Viewer.exe'; // build.productName 과 일치해야 함
const targetExe = path.join(unpacked, exeName);
const strayExe = path.join(unpacked, 'electron.exe');
const distDir = path.join(root, 'node_modules', 'electron', 'dist');
// "1.1.0" -> "1.1.0.0" (PE 버전은 4-part). package.json 에서 읽어 버전업에도 자동 반영.
const ver4 = pkg.version.split('.').concat(['0', '0', '0']).slice(0, 4).join('.');

function tryRun(cmd) {
	console.log('> ' + cmd);
	try {
		execSync(cmd, { cwd: root, stdio: 'inherit' });
		return true;
	} catch (e) {
		console.log('  (계속) 위 단계가 0 이 아닌 코드로 종료됨 — 우회 보정 진행');
		return false;
	}
}

async function main() {
	// 1) win-unpacked 패키징 시도 (electron.exe rename 단계에서 실패할 수 있음)
	tryRun('npx electron-builder --dir');

	// 2) 런타임 파일 보강 — 완전한 dev dist 에서 win-unpacked 에 빠진 파일을 모두 채운다.
	//    electron.exe 는 앱 exe 로. (누락 시 STATUS_BREAKPOINT 로 즉사하던 근본 원인)
	if (!fs.existsSync(distDir)) {
		console.error('electron 런타임(node_modules/electron/dist)을 찾지 못함. 먼저 `npm install`.');
		process.exit(1);
	}
	if (!fs.existsSync(unpacked)) fs.mkdirSync(unpacked, { recursive: true });
	let filled = 0;
	for (const name of fs.readdirSync(distDir)) {
		if (name === 'electron.exe') {
			if (!fs.existsSync(targetExe)) {
				fs.copyFileSync(path.join(distDir, name), targetExe);
				filled++;
			}
			continue;
		}
		const dest = path.join(unpacked, name);
		if (!fs.existsSync(dest)) {
			fs.cpSync(path.join(distDir, name), dest, { recursive: true });
			filled++;
		}
	}
	if (fs.existsSync(strayExe)) fs.rmSync(strayExe, { force: true }); // 앱 exe 로 대체됨
	console.log('보정. 누락 런타임 파일 ' + filled + '개 보강 (electron.exe -> ' + exeName + ')');
	if (!fs.existsSync(targetExe)) {
		console.error(exeName + ' 생성 실패.');
		process.exit(1);
	}

	// 3) 버전 리소스 스탬핑 — "electron" 표시를 앱 이름으로 덮어쓴다. targetExe 존재 시 항상 수행
	//    (기존 exe 재사용 시에도 리소스가 stale 하지 않도록). idempotent.
	try {
		await rcedit(targetExe, {
			'version-string': {
				FileDescription: 'Dong Dong Spec Viewer',
				ProductName: 'Dong Dong Spec Viewer',
				CompanyName: 'CMDSPACE',
				LegalCopyright: '(c) CMDSPACE',
				OriginalFilename: exeName,
				InternalName: 'Dong Dong Spec Viewer',
			},
			'file-version': ver4,
			'product-version': ver4,
		});
		console.log('버전 스탬핑. FileDescription/ProductName = Dong Dong Spec Viewer (v' + ver4 + ')');
	} catch (e) {
		console.error('rcedit 버전 스탬핑 실패: ' + e.message);
		process.exit(1);
	}

	// 4) 이미 만들어진 디렉터리로 NSIS 설치본 생성
	const ok = tryRun('npx electron-builder --prepackaged "' + unpacked + '" --win nsis');
	if (!ok) {
		console.error('NSIS 설치본 생성 실패.');
		process.exit(1);
	}

	console.log('\n완료. dist/ 의 *.exe 설치본을 확인하세요.');
}

main();
