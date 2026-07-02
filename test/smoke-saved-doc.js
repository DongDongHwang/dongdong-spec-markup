// M5.5 저장본 문서 뷰 스모크 (Electron 헤드리스, dd 앱 셸 없이).
//   실행:  npx electron test/smoke-saved-doc.js
//   DDHtmlIO.embed 로 만든 "저장본"(런타임 인라인)을 순수 BrowserWindow 로 열어
//   dd 없이도 우측 패널·핀이 렌더되고, 문서 뷰 토글(현재 화면 필터)·화면 전환 재렌더가 되는지 검사.

'use strict';

const { app, BrowserWindow } = require('electron');
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');

const fs = require('fs');
const os = require('os');
const path = require('path');

const DDModel = require('../src/core/annotation-model.js');
const DDNumbering = require('../src/core/numbering.js');
const DDHtmlIO = require('../src/core/html-io.js');
const DDRuntimeSrc = require('../src/renderer/runtime/dd-runtime-src.js');

// 순수 목업(pure) — spec-html 유사 2화면. goScreen 은 class 변경으로 MutationObserver 를 트리거.
const PURE = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>
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

// 주석 세트 — S1 요소핀 2 + S2 좌표핀 1.
const set = DDModel.createSet('spec-html');
DDNumbering.add(set, DDModel.createAnnotation({ type: 'pin', anchor: { mode: 'element', elementId: 'S1-EL-001', screenId: 'S1' }, body: { format: 'html', html: '<p><b>기능.</b> 요소 A</p>', plain: '요소 A' } }));
DDNumbering.add(set, DDModel.createAnnotation({ type: 'pin', anchor: { mode: 'element', elementId: 'S1-EL-002', screenId: 'S1' }, body: { format: 'html', html: '<p>요소 B</p>', plain: '요소 B' } }));
DDNumbering.add(set, DDModel.createAnnotation({ type: 'pin', anchor: { mode: 'coord', screenId: 'S2' }, coord: { basis: 'body', x: 0.5, y: 0.5 }, body: { format: 'html', html: '<p>화면2 핀</p>', plain: '화면2' } }));

const runtime = { css: DDRuntimeSrc.RUNTIME_CSS, js: DDRuntimeSrc.RUNTIME_JS };
const saved = DDHtmlIO.embed(PURE, set, runtime);
const TMP = path.join(os.tmpdir(), 'dd-smoke-saved');
try { fs.mkdirSync(TMP, { recursive: true }); } catch (_) {}
const savedPath = path.join(TMP, 'saved.html');
fs.writeFileSync(savedPath, saved, 'utf8');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
function check(name, cond, detail) {
	if (cond) { console.log('  ok   ' + name); }
	else { failed++; console.log('  FAIL ' + name + (detail ? '\n       ' + detail : '')); }
}

app.whenReady().then(async () => {
	const win = new BrowserWindow({ show: false, width: 1200, height: 800, webPreferences: { contextIsolation: true, nodeIntegration: false } });
	await win.loadFile(savedPath);
	await wait(700); // DOMContentLoaded → 런타임 부트 → 첫 layout
	const wc = win.webContents;

	console.log('== 저장본 (dd 없이 브라우저 렌더) ==');
	const r = await wc.executeJavaScript(`(function(){
		var panel=document.getElementById('dd-panel');
		var btns=document.querySelectorAll('#dd-panel .dd-p-btns .dd-p-toggle');
		var docBtn=btns[0];
		var rowsAll=document.querySelectorAll('#dd-panel .dd-p-row').length;
		docBtn.click(); // 문서 뷰 ON
		return {
			hasPanel:!!panel, pinsDom:document.querySelectorAll('#dd-overlay-root .dd-pin').length,
			rowsAll:rowsAll, rowsDoc:document.querySelectorAll('#dd-panel .dd-p-row').length,
			docModeClass:document.body.classList.contains('dd-doc-mode'), btnText:docBtn.textContent,
			bodyHtml:!!document.querySelector('#dd-panel .dd-p-row .dd-p-body b'),
			cleanApplied:document.body.classList.contains('clean'),
			docviewApplied:document.body.classList.contains('dd-docview'),
			newBadges:document.querySelectorAll('#dd-panel .dd-p-badge.dd-b-new').length
		};
	})()`);
	check('저장본 우측 패널 자체 렌더(dd 없이)', r.hasPanel === true);
	check('핀 3개 DOM 생성', r.pinsDom === 3, 'pins=' + r.pinsDom);
	check('인터랙티브 = 전체 3행', r.rowsAll === 3, 'rowsAll=' + r.rowsAll);
	check('문서 뷰 ON → body.dd-doc-mode', r.docModeClass === true);
	check('문서 뷰 = 현재 화면(S1) 2행', r.rowsDoc === 2, 'rowsDoc=' + r.rowsDoc);
	check('버튼 텍스트 전환(전체 보기)', r.btnText === '전체 보기');
	check('설명 리치텍스트(html) 렌더', r.bodyHtml === true);
	check('diff — 신규 배지(S1 2개, 직접 생성 manual)', r.newBadges === 2, 'newBadges=' + r.newBadges);
	check('저장본 clean 자동 적용(dd 없이도 목업 자체 주석 끔)', r.cleanApplied === true);
	check('문서 뷰 → body.dd-docview(#description 숨김)', r.docviewApplied === true);

	await wc.executeJavaScript(`(function(){ window.goScreen('S2'); return true; })()`);
	await wait(450); // class 변경 → MutationObserver → layout → 문서 뷰 재렌더
	const r2 = await wc.executeJavaScript(`(function(){ return { rows:document.querySelectorAll('#dd-panel .dd-p-row').length }; })()`);
	check('화면 전환(S2) 후 문서 뷰 목록 = 1행', r2.rows === 1, 'rows=' + r2.rows);

	// 전체 보기 복귀 — 다시 3행
	const r3 = await wc.executeJavaScript(`(function(){ document.querySelectorAll('#dd-panel .dd-p-btns .dd-p-toggle')[0].click(); return { rows:document.querySelectorAll('#dd-panel .dd-p-row').length }; })()`);
	check('전체 보기 복귀 → 3행', r3.rows === 3, 'rows=' + r3.rows);

	console.log('\n' + (failed === 0 ? 'ALL PASS' : failed + ' FAILED'));
	app.exit(failed === 0 ? 0 : 1);
}).catch((e) => { console.log('SMOKE ERROR ' + (e && e.stack ? e.stack : e)); app.exit(1); });
