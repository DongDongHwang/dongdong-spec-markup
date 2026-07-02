// M5.5 문서 뷰 스모크 (Electron 헤드리스).
//   실행:  npx electron test/smoke-doc.js
//   경량 임시 목업 2종(spec-html 유사 2화면 앵커 / generic 좌표)을 만들어
//   문서 뷰 토글·현재 화면 필터·화면 전환 재렌더·편집 UI 숨김을 검사한다.
//   무거운 실목업은 electron 헤드리스에서 hang 위험이 있어(메모리 기록) 스모크는 경량으로.
//   main.js 를 require 해 IPC·창을 정상 부팅시키고(argv 에 spec 목업 주입 → 자동 오픈),
//   그 창의 webContents.executeJavaScript 로 renderer 전역 함수를 태워 DOM 결과를 검사한다.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = path.join(os.tmpdir(), 'dd-smoke-doc');
try { fs.mkdirSync(TMP, { recursive: true }); } catch (_) {}

// spec-html 유사 목업 — APP_DATA 2화면 + data-element-id 앵커. goScreen 은 class 를 바꿔
//   overlay 의 MutationObserver(attributeFilter:['class']) 를 트리거한다(실제 spec-html 은 innerHTML 교체).
const SPEC_HTML = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>
body{margin:0;font-family:sans-serif}.mobile-frame{width:360px;margin:20px auto;border:1px solid #ddd;padding:8px}
.el{padding:16px;margin:8px;border:1px solid #bbb}
</style></head><body>
<div class="mobile-frame screen-S1">
  <div class="el" data-element-id="S1-EL-001">화면1 요소 A</div>
  <div class="el" data-element-id="S1-EL-002">화면1 요소 B</div>
</div>
<script>
const APP_DATA = { currentScreen:"S1", screens:{ S1:{id:"S1",name:"화면 1"}, S2:{id:"S2",name:"화면 2"} } };
function goScreen(id){ if(!APP_DATA.screens[id]) return; APP_DATA.currentScreen=id; document.querySelector(".mobile-frame").className="mobile-frame screen-"+id; }
</script>
</body></html>`;

// generic 목업 — APP_DATA·data-element-id 없음(좌표 모드 전용). 초안 버튼 숨김·화면 필터 off 검증용.
const GENERIC_HTML = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>
body{margin:0;font-family:sans-serif}.card{width:400px;margin:20px auto;border:1px solid #ccc;padding:24px}
</style></head><body>
<div class="card">임의 HTML 목업 — 앵커·APP_DATA 없음</div>
</body></html>`;

const specPath = path.join(TMP, 'spec-like.html');
const genPath = path.join(TMP, 'generic.html');
fs.writeFileSync(specPath, SPEC_HTML, 'utf8');
fs.writeFileSync(genPath, GENERIC_HTML, 'utf8');

// headless 안정화 — 무거운 목업 로드 시 네트워크서비스 크래시·hang 방지(메모리 기록).
const { app, BrowserWindow } = require('electron');
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');

// main.js 의 fileArgFrom(process.argv) 가 spec 목업을 자동으로 열도록 argv 에 주입 후 앱 부팅.
process.argv.push(specPath);
require('../src/main/main.js');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let failed = 0;
function check(name, cond, detail) {
	if (cond) { console.log('  ok   ' + name); }
	else { failed++; console.log('  FAIL ' + name + (detail ? '\n       ' + detail : '')); }
}

// spec-html 시나리오 — 편집 켜고 S1 요소핀 2 + S2 좌표핀 1 주입 → 문서 뷰 → 현재 화면(S1) 필터 확인.
const SPEC_SCENARIO = `(function(){
	window.alert=function(){}; window.confirm=function(){return true;};
	window.toggleEdit();
	var tab=window.activeTab(); var set=tab.annotations;
	window.DDNumbering.add(set, window.DDModel.createAnnotation({type:'pin', anchor:{mode:'element', elementId:'S1-EL-001', screenId:'S1'}, body:{format:'html',html:'<p><b>기능.</b> 요소 A 설명</p>',plain:'요소 A'}}));
	window.DDNumbering.add(set, window.DDModel.createAnnotation({type:'pin', anchor:{mode:'element', elementId:'S1-EL-002', screenId:'S1'}, body:{format:'html',html:'<p>요소 B 설명</p>',plain:'요소 B'}}));
	window.DDNumbering.add(set, window.DDModel.createAnnotation({type:'pin', anchor:{mode:'coord', screenId:'S2'}, coord:{basis:'body',x:0.5,y:0.5}, body:{format:'html',html:'<p>화면2 핀</p>',plain:'화면2'}}));
	if(tab.overlay) tab.overlay.refresh();
	window.toggleDocMode();
	var d=document.querySelector('.annot-panel .ap-detail');
	return {
		total:set.annotations.length,
		docMode:document.getElementById('layout').classList.contains('doc-mode'),
		btnOn:document.getElementById('doc-btn').classList.contains('is-on'),
		rows:document.querySelectorAll('#annot-list .doc-row').length,
		detailHidden:(!d||getComputedStyle(d).display==='none'),
		firstBodyHasHtml:!!document.querySelector('#annot-list .doc-row .doc-body b'),
		curScreen:window.currentScreenId(tab)
	};
})()`;

const SWITCH_SCENARIO = `(function(){ window.activeTab().frame.contentWindow.goScreen('S2'); return true; })()`;
const AFTER_SWITCH = `(function(){ return { rows:document.querySelectorAll('#annot-list .doc-row').length, curScreen:window.currentScreenId(window.activeTab()) }; })()`;

const GENERIC_LOAD = `(async function(){ window.alert=function(){};window.confirm=function(){return true;}; await window.loadDocIntoTab(window.activeTab(), ${JSON.stringify(genPath)}, {history:false}); return true; })()`;
const GENERIC_SCENARIO = `(function(){
	var tab=window.activeTab();
	window.toggleEdit();
	window.DDNumbering.add(tab.annotations, window.DDModel.createAnnotation({type:'pin', anchor:{mode:'coord'}, coord:{basis:'body',x:0.4,y:0.4}, body:{format:'html',html:'<p>generic 설명</p>',plain:'g'}}));
	if(tab.overlay) tab.overlay.refresh();
	window.toggleDocMode();
	var b=document.getElementById('ap-import');
	return {
		src:tab.annotations.source.kind,
		docMode:document.getElementById('layout').classList.contains('doc-mode'),
		rows:document.querySelectorAll('#annot-list .doc-row').length,
		importHidden:(!b||b.classList.contains('hidden')),
		curScreen:window.currentScreenId(tab)
	};
})()`;

app.whenReady().then(async () => {
	await wait(1600); // 창 + index.html + iframe(srcdoc) onload + APP_DATA 준비
	const win = BrowserWindow.getAllWindows()[0];
	if (!win) { console.log('FAIL 창이 없음'); app.exit(1); return; }
	const wc = win.webContents;

	console.log('== spec-html 목업 (2화면 앵커) ==');
	const r1 = await wc.executeJavaScript(SPEC_SCENARIO);
	check('편집→핀 3개 주입', r1.total === 3, 'total=' + r1.total);
	check('문서 뷰 doc-mode 클래스 ON', r1.docMode === true);
	check('문서 뷰 버튼 is-on', r1.btnOn === true);
	check('현재 화면(S1) 소속 핀만 표에 = 2행 (S2 제외)', r1.rows === 2, 'rows=' + r1.rows + ' curScreen=' + r1.curScreen);
	check('편집기(ap-detail) 숨김', r1.detailHidden === true);
	check('설명 body 리치텍스트(html) 렌더', r1.firstBodyHasHtml === true);

	await wc.executeJavaScript(SWITCH_SCENARIO);
	await wait(400); // rAF + MutationObserver(class) → onScreenChange → 우측 표 재렌더
	const r1b = await wc.executeJavaScript(AFTER_SWITCH);
	check('화면 전환(S2) 시 현재 화면 인식', r1b.curScreen === 'S2', 'curScreen=' + r1b.curScreen);
	check('화면 전환 후 표 재렌더 = S2 핀 1행', r1b.rows === 1, 'rows=' + r1b.rows);

	console.log('== generic 목업 (좌표·앵커 없음) ==');
	await wc.executeJavaScript(GENERIC_LOAD);
	await wait(700); // iframe onload
	const r2 = await wc.executeJavaScript(GENERIC_SCENARIO);
	check('generic 판별', r2.src === 'generic', 'src=' + r2.src);
	check('generic 문서 뷰 doc-mode ON', r2.docMode === true);
	check('화면 개념 없음 → 좌표핀 전부 표에 = 1행', r2.rows === 1, 'rows=' + r2.rows);
	check('generic 은 초안 버튼 숨김(불변 원칙)', r2.importHidden === true);
	check('generic curScreen = null', r2.curScreen === null || r2.curScreen === undefined, 'curScreen=' + JSON.stringify(r2.curScreen));

	console.log('\n' + (failed === 0 ? 'ALL PASS' : failed + ' FAILED'));
	app.exit(failed === 0 ? 0 : 1);
}).catch((e) => { console.log('SMOKE ERROR ' + (e && e.stack ? e.stack : e)); app.exit(1); });
