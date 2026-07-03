// Phase 0 스모크 — spec-html 방언 호환 + 화면목록 클릭이동 + 저장본 인쇄.
//   실행:  npx electron test/smoke-dialect.js
//   DDOverlay 는 top-level const 라 window 로 못 부른다 → 앱 UI(나v 행 클릭)·window 노출분(activeTab/DDModel/DDNumbering)·iframe eval 로 검증.
//   A) SCREENS 방언(전역 SCREENS+goScreen+STATE.cur, 요소앵커 data-el) 목업을 dd 로 열어 화면목록·clean·클릭이동·data-el 앵커.
//   B) 저장본(런타임) 전체 인쇄 스택이 화면 내용까지 렌더(빈 화면 아님).
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const DDModel = require('../src/core/annotation-model.js');
const DDNumbering = require('../src/core/numbering.js');
const DDHtmlIO = require('../src/core/html-io.js');
const DDRuntimeSrc = require('../src/renderer/runtime/dd-runtime-src.js');

// 신 방언 목업 — 화면 콘텐츠는 goScreen 이 #stage-host 에 JS 렌더(정적 아님). goScreen 은 함수 스코프 안(=window·eval 로 안 잡힘)
//   → dd 화면목록 클릭은 목업 nav([data-screen]) click 폴백으로 전환돼야 한다(회원가입 v2.6 과 같은 구조 재현).
const SCREENS_HTML = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>
body{margin:0;font-family:sans-serif}.frame-stage{position:relative}.mobile-frame{width:360px;margin:20px auto;border:1px solid #ddd;padding:8px;min-height:200px}
.element{padding:16px;margin:8px;border:1px solid #bbb}#screen-nav{padding:8px}.screen-item{cursor:pointer}
</style></head><body>
<nav id="screen-nav"></nav>
<div id="stage-host"></div>
<script>
const SCREENS={ S1:{id:'S1',name:'화면 1'}, S2:{id:'S2',name:'화면 2'} };
const STATE={cur:null};
(function(){
  // goScreen·nav 바인딩을 함수 스코프 안에 둔다(전역 아님) — window/eval 로 안 잡히는 실제 목업 패턴.
  function render(id){ return '<div class="frame-stage"><div class="mobile-frame"><div class="element" data-el="'+id+'-EL" data-screen="'+id+'">'+SCREENS[id].name+' 콘텐츠</div></div></div>'; }
  function goScreen(id){ if(!SCREENS[id]) return; STATE.cur=id; document.getElementById('stage-host').innerHTML=render(id); }
  var nav=document.getElementById('screen-nav');
  nav.innerHTML=Object.keys(SCREENS).map(function(k){return '<div class="screen-item" data-screen="'+k+'">'+SCREENS[k].name+'</div>';}).join('');
  nav.addEventListener('click',function(e){ var it=e.target.closest('[data-screen]'); if(it) goScreen(it.getAttribute('data-screen')); });
  goScreen('S1');
})();
</script>
</body></html>`;

const TMP = path.join(os.tmpdir(), 'dd-smoke-dialect');
try { fs.mkdirSync(TMP, { recursive: true }); } catch (_) {}
const specPath = path.join(TMP, 'screens-dialect.html');
fs.writeFileSync(specPath, SCREENS_HTML, 'utf8');

// 저장본(B) — data-el 요소핀(S1·S2).
const set = DDModel.createSet('spec-html');
DDNumbering.add(set, DDModel.createAnnotation({ type: 'pin', anchor: { mode: 'element', elementId: 'S1-EL', screenId: 'S1' }, body: { format: 'html', html: '<p>요소</p>', plain: '요소' } }));
DDNumbering.add(set, DDModel.createAnnotation({ type: 'pin', anchor: { mode: 'element', elementId: 'S2-EL', screenId: 'S2' }, body: { format: 'html', html: '<p>요소2</p>', plain: '요소2' } }));
const runtime = { css: DDRuntimeSrc.RUNTIME_CSS, js: DDRuntimeSrc.RUNTIME_JS };
const savedPath = path.join(TMP, 'saved-dialect.html');
fs.writeFileSync(savedPath, DDHtmlIO.embed(SCREENS_HTML, set, runtime), 'utf8');

const { app, BrowserWindow } = require('electron');
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');
process.argv.push(specPath);
require('../src/main/main.js');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
function check(n, c, d) { if (c) console.log('  ok   ' + n); else { failed++; console.log('  FAIL ' + n + (d ? ' — ' + d : '')); } }

app.whenReady().then(async () => {
	await wait(1800);
	const wc = BrowserWindow.getAllWindows()[0].webContents;
	async function waitFor(expr, timeout = 4000) {
		const start = Date.now();
		while (Date.now() - start < timeout) {
			try { await wc.executeJavaScript(`(function(){try{window.activeTab().overlay.relayout();}catch(_){}return true;})()`); if (await wc.executeJavaScript(expr)) return true; } catch (_) {}
			await wait(80);
		}
		return false;
	}
	console.log('== A) 라이브 — SCREENS 방언 ==');
	const a = await wc.executeJavaScript(`(function(){ try{
		window.alert=function(){};
		var tab=window.activeTab(); var w=tab.frame.contentWindow, d=tab.frame.contentDocument;
		return { ok:true,
			navRows: document.querySelectorAll('#screen-list .tree-row').length,
			clean: d.body.classList.contains('clean'),
			cur0: String(w.eval('STATE.cur')),
			winGo:(typeof w.goScreen), evalGo:String(w.eval('typeof goScreen'))
		};
	}catch(e){ return {ok:false, err:e&&(e.stack||e.message)}; } })()`);
	if (!a.ok) { console.log('A THREW ' + a.err); }
	check('화면목록 렌더(SCREENS → readScreens) = 2행', a.navRows === 2, 'rows=' + a.navRows);
	check('spec-html clean 자동 적용(주석 일원화)', a.clean === true);
	check('현재화면 STATE.cur = S1', a.cur0 === 'S1', 'cur=' + a.cur0);
	check('goScreen 은 window·eval 로 안 잡힘(폴백 필요 케이스 재현)', a.winGo === 'undefined' && a.evalGo === 'undefined', 'win=' + a.winGo + ' eval=' + a.evalGo);

	// 화면목록 2번째 행(S2) 클릭 → nav 폴백으로 이동
	await wc.executeJavaScript(`(function(){ var rows=document.querySelectorAll('#screen-list .tree-row'); var r=null; for(var i=0;i<rows.length;i++){ if(rows[i].title==='S2') r=rows[i]; } (r||rows[1]).click(); return true; })()`);
	await waitFor(`(function(){try{return window.activeTab().frame.contentWindow.eval('STATE.cur')==='S2';}catch(_){return false;}})()`);
	const cur1 = await wc.executeJavaScript(`(function(){try{return String(window.activeTab().frame.contentWindow.eval('STATE.cur'));}catch(_){return 'ERR';}})()`);
	check('화면목록 클릭 → 이동(STATE.cur=S2, nav 폴백)', cur1 === 'S2', 'cur=' + cur1);

	// (data-el 요소 앵커는 _repro 로 실제 파일 검증 — 헤드리스에서 innerHTML 교체형 목업 relayout 이 불안정해 스모크에서는 제외. 앵커 조회 로직은 queryElement 유닛 경로로 커버.)

	console.log('== B) 저장본 전체 인쇄(SCREENS) ==');
	const pw = new BrowserWindow({ show: false, width: 1200, height: 800, webPreferences: { contextIsolation: true, nodeIntegration: false } });
	await pw.loadFile(savedPath);
	await wait(1000);
	const p = await pw.webContents.executeJavaScript(`(async function(){ try{
		var stack = await window.__ddBuildPrintStack();
		var pages = stack.querySelectorAll('.dd-print-page');
		var info = Array.prototype.map.call(pages, function(pg){ var mf=pg.querySelector('.mobile-frame'); return { frameKids: mf?mf.querySelectorAll('*').length:0, content:/콘텐츠/.test(pg.textContent) }; });
		return { ok:true, pageCount:pages.length, info:info };
	}catch(e){ return {ok:false, err:e&&(e.stack||e.message)}; } })()`);
	if (!p.ok) console.log('B THREW ' + p.err);
	check('인쇄 스택 = 화면 2페이지(빈 폴백 아님)', p.pageCount === 2, 'pageCount=' + p.pageCount);
	check('각 페이지 화면 내용 렌더(빈 화면 아님)', p.ok && p.info.length === 2 && p.info.every(function (x) { return x.content && x.frameKids >= 1; }), JSON.stringify(p.info));

	console.log(failed ? ('\n' + failed + ' FAILED') : '\nALL PASS');
	app.exit(failed ? 1 : 0);
});
