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
const APP_DATA = { project:{name:"테스트 기능",version:"v1.0"}, currentScreen:"S1", history:[{no:1,date:"2026-07-03",version:"v1.0",content:"최초 작성",author:"동동이"}], screens:{ S1:{id:"S1",name:"화면 1"}, S2:{id:"S2",name:"화면 2"} } };
function goScreen(id){ if(!APP_DATA.screens[id]) return; APP_DATA.currentScreen=id; document.querySelector(".mobile-frame").className="mobile-frame screen-"+id; }
</script>
</body></html>`;

// generic 목업 — APP_DATA·data-element-id 없음(좌표 모드 전용). 초안 버튼 숨김·화면 필터 off 검증용.
const GENERIC_HTML = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>
body{margin:0;font-family:sans-serif}.card{width:400px;margin:20px auto;border:1px solid #ccc;padding:24px}
</style></head><body>
<div class="card">임의 HTML 목업 — 앵커·APP_DATA 없음</div>
</body></html>`;

// 어드민 유사 목업 — APP_DATA 없음(generic 판정) + data-field 앵커(어드민 규약). WS-F 앵커 다속성 인식 검증.
const ADMIN_HTML = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>
body{margin:0;font-family:sans-serif}.wf-nav{padding:8px;background:#eee}
.field{display:inline-block;padding:16px 24px;margin:8px;border:1px solid #bbb}
</style></head><body>
<nav class="wf-nav"><a data-screen="s1">화면1</a></nav>
<div><span class="field" data-field="apply_at">신청일</span><span class="field" data-field="status">상태</span></div>
<script>const FIELDS={apply_at:{label:"신청일"},status:{label:"상태"}};</script>
</body></html>`;

// 새 어드민 목업 (WS-E2) — APP_DATA.screens + data-element-id + desc 6키 + goScreen.
//   spec-html-admin v4.6 이 발행하는 계약. dd 가 spec-html 급으로 완전 흡수(초안·화면·clean)해야 하고,
//   6종 설명이 admin-6dim 슬롯 초안으로 들어와야 한다.
const ADMIN_NEW_HTML = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>
body{margin:0;font-family:sans-serif}.wf-nav{padding:8px;background:#eee}
.screen{width:600px;margin:20px auto}.screen:not(.active){display:none}
th.field-clickable{padding:12px;border:1px solid #bbb}
</style></head><body>
<nav class="wf-nav"><a data-goscreen="ADM-001">이벤트 목록</a></nav>
<div class="screen active" id="screen-ADM-001" data-screen="ADM-001">
  <table><thead><tr>
    <th class="field-clickable" data-field="call_type" data-element-id="call_type">호출 유형</th>
    <th class="field-clickable" data-field="status" data-element-id="status">상태</th>
  </tr></thead></table>
</div>
<script>
const APP_DATA = { currentScreen:"ADM-001", screens:{ "ADM-001":{ id:"ADM-001", name:"이벤트 목록", type:"admin", areas:[{ elements:[
  { id:"call_type", field:"call_type", number:"1-1", name:"호출 유형", kind:"신규", desc:{ meaning:"운동 데이터 훅/조회 구분", source:"api_call_log.call_type", format:"ENUM", values:"DATA_HOOK / PULL_QUERY", lifecycle:"발생 시 INSERT", note:"" } },
  { id:"status", field:"status", number:"1-2", name:"상태", kind:"변경", desc:{ meaning:"처리 상태", source:"api_call_log.status", format:"ENUM", values:"OK / FAIL", lifecycle:"수신 시", note:"" } }
]}] } } };
function goScreen(id){ if(!APP_DATA.screens[id]) return; APP_DATA.currentScreen=id; document.querySelectorAll('.screen').forEach(function(s){ s.classList.toggle('active', s.getAttribute('data-screen')===id); }); }
</script>
</body></html>`;

// STORY 식 generic 멀티스크린 목업 — APP_DATA·data-element-id 없음. 화면 여러 개가 display 토글로 공존(커스텀 showPage).
//   불변 원칙 핵심 검증 — spec-html 훅 없이도 "페이지마다 다른 주석"(화면별 게이팅)이 되어야 한다.
const STORY_MULTI_HTML = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>
body{margin:0;font-family:sans-serif}.pg{padding:40px}.pg:not(.on){display:none}
.box{padding:20px;border:1px solid #bbb}
</style></head><body>
<div class="pg on" id="pg-0"><div class="box" id="b0">화면0-A</div><div class="box" id="b0b" style="margin-top:40px">화면0-B</div></div>
<div class="pg" id="pg-1"><div class="box" id="b1">화면1 콘텐츠</div></div>
<div class="pg" id="pg-2"><div class="box" id="b2">화면2 콘텐츠</div></div>
<script>function showPage(i){var ps=document.querySelectorAll('.pg');for(var k=0;k<ps.length;k++)ps[k].classList.toggle('on',k===i);}</script>
</body></html>`;

// 플로우맵 목업 — APP_DATA.screens 3개 + data-screen 컨테이너 + onclick goScreen(간선 파싱용).
//   화면 플로우맵 초안(노드=화면, 간선=goScreen)·편집·저장 왕복 검증.
const FLOW_HTML = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>
body{margin:0;font-family:sans-serif}.screen{width:360px;margin:20px auto}.screen:not(.active){display:none}
.btn{display:inline-block;padding:10px 16px;border:1px solid #7460D9;border-radius:8px;margin:8px;cursor:pointer}
</style></head><body>
<div class="screen active" id="screen-F1" data-screen="F1">
  <div class="btn" onclick="goScreen('F2')">로그인하기</div>
</div>
<div class="screen" id="screen-F2" data-screen="F2">
  <div class="btn" onclick="goScreen('F3')">완료</div>
  <div class="btn" onclick="goScreen('F1')">뒤로</div>
</div>
<div class="screen" id="screen-F3" data-screen="F3">완료 화면</div>
<script>
const APP_DATA = { currentScreen:"F1", screens:{ F1:{id:"F1",name:"로그인"}, F2:{id:"F2",name:"약관동의"}, F3:{id:"F3",name:"완료"} } };
function goScreen(id){ if(!APP_DATA.screens[id]) return; APP_DATA.currentScreen=id; document.querySelectorAll('.screen').forEach(function(s){ s.classList.toggle('active', s.getAttribute('data-screen')===id); }); }
</script>
</body></html>`;

// 롱스크롤 목업 — 화면 전환 없이 세로로 긴 단일 페이지. 핀이 스크롤을 따라 콘텐츠에 붙어 이동하는지 검증.
const LONGSCROLL_HTML = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>
body{margin:0;font-family:sans-serif}.sec{padding:40px;border-bottom:1px solid #eee}
</style></head><body>
<div class="sec" id="ls-top" style="height:200px">상단 섹션</div>
<div class="sec" style="height:900px">중간 여백</div>
<div class="sec" id="ls-bot" style="height:200px">하단 섹션</div>
</body></html>`;

const specPath = path.join(TMP, 'spec-like.html');
const storyPath = path.join(TMP, 'story-multi.html');
const longPath = path.join(TMP, 'longscroll.html');
const genPath = path.join(TMP, 'generic.html');
const adminPath = path.join(TMP, 'admin.html');
const adminNewPath = path.join(TMP, 'admin-new.html');
const flowPath = path.join(TMP, 'flow-like.html');
fs.writeFileSync(specPath, SPEC_HTML, 'utf8');
fs.writeFileSync(storyPath, STORY_MULTI_HTML, 'utf8');
fs.writeFileSync(longPath, LONGSCROLL_HTML, 'utf8');
fs.writeFileSync(genPath, GENERIC_HTML, 'utf8');
fs.writeFileSync(adminPath, ADMIN_HTML, 'utf8');
fs.writeFileSync(adminNewPath, ADMIN_NEW_HTML, 'utf8');
fs.writeFileSync(flowPath, FLOW_HTML, 'utf8');

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
		btnReading:(function(){var b=document.getElementById('mode-btn'); return !!b && /읽기/.test(b.textContent) && !b.classList.contains('is-on');})(),
		rows:document.querySelectorAll('#annot-list .doc-row').length,
		detailHidden:(!d||getComputedStyle(d).display==='none'),
		firstBodyHasHtml:!!document.querySelector('#annot-list .doc-row .doc-body b'),
		curScreen:window.currentScreenId(tab),
		cleanApplied:tab.frame.contentDocument.body.classList.contains('clean'),
		docviewApplied:tab.frame.contentDocument.body.classList.contains('dd-docview'),
		newBadges:document.querySelectorAll('#annot-list .st-badge.st-new').length,
		docFront:!!document.querySelector('#annot-list .doc-front'),
		coverTitle:(document.querySelector('.doc-cover-title')||{}).textContent,
		histRows:document.querySelectorAll('.doc-hist-tbl tbody tr').length
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
		curScreen:window.currentScreenId(tab),
		cleanApplied:tab.frame.contentDocument.body.classList.contains('clean'),
		navHidden:document.getElementById('screen-section').classList.contains('hidden'),
		docFront:!!document.querySelector('#annot-list .doc-front')
	};
})()`;

app.whenReady().then(async () => {
	await wait(1600); // 창 + index.html + iframe(srcdoc) onload + APP_DATA 준비
	const win = BrowserWindow.getAllWindows()[0];
	if (!win) { console.log('FAIL 창이 없음'); app.exit(1); return; }
	const wc = win.webContents;
	// 화면 전환 후 재렌더 대기 — 고정 sleep 은 headless 부하에서 들쭉날쭉(플레이키). 조건 충족까지 폴링한다.
	//   expr(truthy)면 즉시 반환. timeout 초과 시 false → 뒤이은 check 가 실제 값으로 FAIL(진짜 실패만 남김).
	async function waitFor(expr, timeout = 4000, interval = 80) {
		const start = Date.now();
		while (Date.now() - start < timeout) {
			try {
				// headless(숨은 창)에선 schedule() 의 requestAnimationFrame 이 throttle/pause 되어 재렌더가 안 돈다.
				// 판정 전 강제 relayout 으로 onScreenChange·게이팅을 동기 실행(롱스크롤 테스트가 쓰는 패턴).
				await wc.executeJavaScript(`(function(){ try{ window.activeTab().overlay.relayout(); }catch(_){} return true; })()`);
				if (await wc.executeJavaScript(expr)) return true;
			} catch (_) { /* 전환 순간 접근불가 — 재시도 */ }
			await wait(interval);
		}
		return false;
	}

	console.log('== spec-html 목업 (2화면 앵커) ==');
	const r1 = await wc.executeJavaScript(SPEC_SCENARIO);
	check('편집→핀 3개 주입', r1.total === 3, 'total=' + r1.total);
	check('문서 뷰 doc-mode 클래스 ON', r1.docMode === true);
	check('모드 버튼 = 읽기 상태(문서 뷰)', r1.btnReading === true);
	check('현재 화면(S1) 소속 핀만 표에 = 2행 (S2 제외)', r1.rows === 2, 'rows=' + r1.rows + ' curScreen=' + r1.curScreen);
	check('편집기(ap-detail) 숨김', r1.detailHidden === true);
	check('설명 body 리치텍스트(html) 렌더', r1.firstBodyHasHtml === true);
	check('spec-html 목업 clean 자동 적용(목업 자체 주석 끔)', r1.cleanApplied === true);
	check('문서 뷰 → iframe body.dd-docview(#description 숨김)', r1.docviewApplied === true);
	check('diff — 직접 찍은 핀 신규 배지(S1 2개)', r1.newBadges === 2, 'newBadges=' + r1.newBadges);
	check('M5.6 표지 블록(doc-front) 렌더', r1.docFront === true);
	check('표지 제목 = APP_DATA.project.name', r1.coverTitle === '테스트 기능', 'title=' + r1.coverTitle);
	check('History 표 1행(APP_DATA.history)', r1.histRows === 1, 'histRows=' + r1.histRows);

	await wc.executeJavaScript(SWITCH_SCENARIO);
	// rAF + MutationObserver(class) → onScreenChange → 우측 표 재렌더. 완료(S2 + 1행)까지 폴링.
	await waitFor(`(function(){ return window.currentScreenId(window.activeTab())==='S2' && document.querySelectorAll('#annot-list .doc-row').length===1; })()`);
	const r1b = await wc.executeJavaScript(AFTER_SWITCH);
	check('화면 전환(S2) 시 현재 화면 인식', r1b.curScreen === 'S2', 'curScreen=' + r1b.curScreen);
	check('화면 전환 후 표 재렌더 = S2 핀 1행', r1b.rows === 1, 'rows=' + r1b.rows);

	console.log('== WS-A 리사이즈 (변수 통일) ==');
	const rz = await wc.executeJavaScript(`(function(){
		document.documentElement.style.setProperty('--ap-width','250px');
		var p=document.querySelector('.annot-panel');
		var docFB=getComputedStyle(p).flexBasis;
		window.toggleEdit();
		var editFB=getComputedStyle(p).flexBasis;
		return { docFB:docFB, editFB:editFB };
	})()`);
	check('편집·문서 뷰 폭 동일(--ap-width 단일 변수)', rz.docFB === rz.editFB && rz.docFB === '250px', 'doc=' + rz.docFB + ' edit=' + rz.editFB);

	console.log('== WS-C 화면 네비·편집 필터 ==');
	// rz 에서 편집 모드로 전환됨. dd 화면 네비 첫 행(S1) 클릭 → gotoScreen 브리지 → 편집 패널이 S1 주석만(이슈 2).
	await wc.executeJavaScript(`(function(){ var rows=document.querySelectorAll('#screen-list .screen-row'); if(rows[0]) rows[0].click(); return true; })()`);
	await waitFor(`(function(){ return window.currentScreenId(window.activeTab())==='S1' && document.querySelectorAll('#annot-list .annot-row').length===2; })()`);
	const nc = await wc.executeJavaScript(`(function(){ return {
		nav: document.querySelectorAll('#screen-list .screen-row').length,
		badge: (document.querySelector('#screen-list .screen-row .screen-count')||{}).textContent,
		editRows: document.querySelectorAll('#annot-list .annot-row').length,
		cur: window.currentScreenId(window.activeTab())
	}; })()`);
	check('dd 화면 네비 = 2화면(S1·S2)', nc.nav === 2, 'nav=' + nc.nav);
	check('화면별 주석 개수 배지(S1=2)', nc.badge === '2', 'badge=' + nc.badge);
	check('편집 모드 S1 화면 필터 = 2행', nc.editRows === 2 && nc.cur === 'S1', 'rows=' + nc.editRows + ' cur=' + nc.cur);
	await wc.executeJavaScript(`(function(){ var rows=document.querySelectorAll('#screen-list .screen-row'); if(rows[1]) rows[1].click(); return true; })()`);
	await waitFor(`(function(){ return window.currentScreenId(window.activeTab())==='S2' && document.querySelectorAll('#annot-list .annot-row').length===1; })()`);
	const nc2 = await wc.executeJavaScript(`(function(){ return { editRows: document.querySelectorAll('#annot-list .annot-row').length, cur: window.currentScreenId(window.activeTab()) }; })()`);
	check('편집 모드 화면 전환(S2) → 필터 1행 (이슈 2 해결)', nc2.editRows === 1 && nc2.cur === 'S2', 'rows=' + nc2.editRows + ' cur=' + nc2.cur);

	console.log('== WS-B 저장 복사 (원본 보존) ==');
	await wc.executeJavaScript(`(async function(){ window.confirm=function(){return true;}; await window.saveTab(false); return true; })()`);
	await wait(400);
	const ddPath = specPath.replace(/\.html$/i, '_dd.html');
	check('순수 목업 첫 저장 → 원본 옆 _dd.html 생성', fs.existsSync(ddPath), ddPath);
	check('원본 목업 무변경', fs.readFileSync(specPath, 'utf8') === SPEC_HTML);

	console.log('== generic 목업 (좌표·앵커 없음) ==');
	await wc.executeJavaScript(GENERIC_LOAD);
	await wait(700); // iframe onload
	const r2 = await wc.executeJavaScript(GENERIC_SCENARIO);
	check('generic 판별', r2.src === 'generic', 'src=' + r2.src);
	check('generic 문서 뷰 doc-mode ON', r2.docMode === true);
	check('화면 개념 없음 → 좌표핀 전부 표에 = 1행', r2.rows === 1, 'rows=' + r2.rows);
	check('generic 은 초안 버튼 숨김(불변 원칙)', r2.importHidden === true);
	check('generic curScreen = null', r2.curScreen === null || r2.curScreen === undefined, 'curScreen=' + JSON.stringify(r2.curScreen));
	check('generic 은 clean 미적용(spec-html 아님)', r2.cleanApplied === false);
	check('generic 은 화면 네비 숨김(화면 개념 없음)', r2.navHidden === true);
	check('generic 은 표지 없음(docMeta null·불변 원칙)', r2.docFront === false);

	console.log('== admin 목업 (data-field 앵커·APP_DATA 없음) ==');
	await wc.executeJavaScript(`(async function(){ window.confirm=function(){return true;}; await window.loadDocIntoTab(window.activeTab(), ${JSON.stringify(adminPath)}, {history:false}); return true; })()`);
	await wait(600);
	const r3 = await wc.executeJavaScript(`(function(){
		var tab=window.activeTab();
		window.toggleEdit();
		var doc=tab.frame.contentDocument, win=tab.frame.contentWindow;
		var el=doc.querySelector('[data-field="apply_at"]');
		var r=el.getBoundingClientRect();
		var cx=Math.round(r.left+r.width/2), cy=Math.round(r.top+r.height/2);
		doc.dispatchEvent(new win.MouseEvent('mousedown',{clientX:cx,clientY:cy,button:0,bubbles:true}));
		doc.dispatchEvent(new win.MouseEvent('mouseup',{clientX:cx,clientY:cy,button:0,bubbles:true}));
		var anns=tab.annotations.annotations, a=anns[anns.length-1];
		return { src:tab.annotations.source.kind, count:anns.length, mode:a&&a.anchor&&a.anchor.mode, elementId:a&&a.anchor&&a.anchor.elementId };
	})()`);
	check('admin generic 판정(APP_DATA 없음)', r3.src === 'generic', 'src=' + r3.src);
	check('admin 핀 생성됨', r3.count >= 1, 'count=' + r3.count);
	check('admin data-field 요소에 element 앵커(WS-F)', r3.mode === 'element', 'mode=' + r3.mode);
	check('admin 앵커 elementId = data-field 값', r3.elementId === 'apply_at', 'elementId=' + r3.elementId);

	console.log('== WS-E2 새 어드민 목업 (APP_DATA + 6dim + data-element-id) ==');
	await wc.executeJavaScript(`(async function(){ window.alert=function(){};window.confirm=function(){return true;}; await window.loadDocIntoTab(window.activeTab(), ${JSON.stringify(adminNewPath)}, {history:false}); return true; })()`);
	await wait(700);
	const r4 = await wc.executeJavaScript(`(function(){
		var tab=window.activeTab();
		window.toggleEdit();
		var btn=document.getElementById('ap-import');
		var importHidden=(!btn||btn.classList.contains('hidden'));
		if(btn) btn.click();  // 초안 불러오기 (importDrafts)
		var anns=tab.annotations.annotations;
		var ws=anns.filter(function(a){return a.slots;});
		var first=ws[0];
		return {
			src:tab.annotations.source.kind,
			count:anns.length,
			importHidden:importHidden,
			template:first&&first.slots.template,
			hasMeaning:!!(first&&first.slots.fields&&first.slots.fields.meaning),
			bodyHasMeaning:!!(first&&first.body&&/의미\./.test(first.body.html||'')),
			clean:tab.frame.contentDocument.body.classList.contains('clean'),
			elId:first&&first.anchor&&first.anchor.elementId
		};
	})()`);
	check('새 어드민 APP_DATA → spec-html 판정', r4.src === 'spec-html', 'src=' + r4.src);
	check('새 어드민 초안 버튼 노출(APP_DATA 있음)', r4.importHidden === false);
	check('초안 흡수 ≥2개', r4.count >= 2, 'count=' + r4.count);
	check('어드민 초안 = admin-6dim 슬롯', r4.template === 'admin-6dim', 'template=' + r4.template);
	check('6종 desc 흡수(meaning)', r4.hasMeaning === true);
	check('body 합성에 6종 라벨(의미.)', r4.bodyHasMeaning === true);
	check('요소 앵커 = data-element-id 값', r4.elId === 'call_type', 'elId=' + r4.elId);
	check('새 어드민 clean 자동 적용', r4.clean === true);

	console.log('== generic 멀티스크린 (STORY 식 display 토글·커스텀 전환) ==');
	await wc.executeJavaScript(`(async function(){ window.alert=function(){};window.confirm=function(){return true;}; await window.loadDocIntoTab(window.activeTab(), ${JSON.stringify(storyPath)}, {history:false}); return true; })()`);
	await wait(700);
	const s1 = await wc.executeJavaScript(`(function(){
		var tab=window.activeTab(); window.toggleEdit();
		var doc=tab.frame.contentDocument, win=tab.frame.contentWindow;
		function click(x,y){ doc.dispatchEvent(new win.MouseEvent('mousedown',{clientX:x,clientY:y,button:0,bubbles:true})); doc.dispatchEvent(new win.MouseEvent('mouseup',{clientX:x,clientY:y,button:0,bubbles:true})); }
		var r=doc.getElementById('b0').getBoundingClientRect();
		var r2=doc.getElementById('b0b').getBoundingClientRect();
		click(Math.round(r.left+r.width/2), Math.round(r.top+r.height/2));  // 화면0 요소 A
		click(Math.round(r2.left+r2.width/2), Math.round(r2.top+r2.height/2)); // 화면0 요소 B — 두 번째가 screenId 로 오저장되던 버그 재현
		var a0=tab.annotations.annotations[0], a1=tab.annotations.annotations[1];
		return { src:tab.annotations.source.kind, total:tab.annotations.annotations.length,
			sel0:a0&&a0.anchor&&a0.anchor.screenSel, sid0:a0&&a0.anchor&&a0.anchor.screenId,
			sel1:a1&&a1.anchor&&a1.anchor.screenSel, sid1:a1&&a1.anchor&&a1.anchor.screenId,
			visible:tab.overlay.stats().visible };
	})()`);
	check('STORY generic 판정', s1.src === 'generic', 'src=' + s1.src);
	check('화면0에 핀 2개 찍힘', s1.total === 2, 'total=' + s1.total);
	check('첫 핀 screenSel=#pg-0 (screenId 없음)', s1.sel0 === '#pg-0' && !s1.sid0, 'sel0=' + s1.sel0 + ' sid0=' + s1.sid0);
	check('둘째 핀도 screenSel=#pg-0 (screenId 오저장 버그 수정)', s1.sel1 === '#pg-0' && !s1.sid1, 'sel1=' + s1.sel1 + ' sid1=' + s1.sid1);
	check('화면0에서 핀 2개 표시', s1.visible === 2, 'visible=' + s1.visible);
	await wc.executeJavaScript(`(function(){ window.activeTab().frame.contentWindow.showPage(1); return true; })()`);
	await waitFor(`(function(){ return window.activeTab().overlay.stats().visible===0; })()`); // 화면0 핀 게이팅 완료까지
	const s2 = await wc.executeJavaScript(`(function(){ return { visible:window.activeTab().overlay.stats().visible }; })()`);
	check('화면1 전환 → 화면0 핀 2개 모두 숨김 = 0 (둘째 핀도 게이팅됨)', s2.visible === 0, 'visible=' + s2.visible);
	await wc.executeJavaScript(`(function(){ window.activeTab().frame.contentWindow.showPage(0); return true; })()`);
	await waitFor(`(function(){ return window.activeTab().overlay.stats().visible===2; })()`); // 화면0 복귀·핀 복원까지
	const s3 = await wc.executeJavaScript(`(function(){ var tab=window.activeTab(); return { visible:tab.overlay.stats().visible, cur:window.currentScreenId(tab) }; })()`);
	check('화면0 복귀 → 핀 2개 복원 = 2', s3.visible === 2, 'visible=' + s3.visible);
	check('generic 현재화면 감지 = #pg-0', s3.cur === '#pg-0', 'cur=' + s3.cur);

	console.log('== 롱스크롤 (긴 페이지 스크롤 추종) ==');
	await wc.executeJavaScript(`(async function(){ window.alert=function(){};window.confirm=function(){return true;}; await window.loadDocIntoTab(window.activeTab(), ${JSON.stringify(longPath)}, {history:false}); return true; })()`);
	await wait(700);
	const ls = await wc.executeJavaScript(`(function(){
		var tab=window.activeTab(); window.toggleEdit();
		var doc=tab.frame.contentDocument, win=tab.frame.contentWindow;
		var el=doc.getElementById('ls-top'); var r=el.getBoundingClientRect();
		var cx=Math.round(r.left+r.width/2), cy=Math.round(r.top+r.height/2);
		doc.dispatchEvent(new win.MouseEvent('mousedown',{clientX:cx,clientY:cy,button:0,bubbles:true}));
		doc.dispatchEvent(new win.MouseEvent('mouseup',{clientX:cx,clientY:cy,button:0,bubbles:true}));
		var a=tab.annotations.annotations[0];
		var node=doc.querySelector('#dd-overlay-root .dd-pin');
		var before=node?node.getBoundingClientRect().top:null;
		win.scrollTo(0,600); tab.overlay.relayout();
		var after=node?node.getBoundingClientRect().top:null;
		return { mode:a&&a.anchor&&a.anchor.mode, delta:(before!=null&&after!=null)?Math.round(before-after):null };
	})()`);
	check('롱스크롤 핀 = coord 앵커(빈 곳)', ls.mode === 'coord', 'mode=' + ls.mode);
	check('스크롤 시 핀이 콘텐츠 따라 이동(≈600px 위로)', ls.delta >= 550 && ls.delta <= 650, 'delta=' + ls.delta);

	console.log('== 화살표 이동 (전체·끝점·미세이동) ==');
	// spec-html 목업 재로딩 — 두 data-element-id 요소 사이에 화살표를 그리고 이동을 검사한다.
	await wc.executeJavaScript(`(async function(){ window.alert=function(){};window.confirm=function(){return true;}; await window.loadDocIntoTab(window.activeTab(), ${JSON.stringify(specPath)}, {history:false}); return true; })()`);
	await wait(700);
	// [생성] 요소 A→B 로 화살표 드래그(도구 arrow). e.target=doc → 좌표 히트테스트로 양끝 요소 앵커.
	const av = await wc.executeJavaScript(`(function(){
		var tab=window.activeTab(); window.toggleEdit();
		var doc=tab.frame.contentDocument, win=tab.frame.contentWindow;
		function ev(t,x,y){ doc.dispatchEvent(new win.MouseEvent(t,{clientX:x,clientY:y,button:0,bubbles:true})); }
		tab.overlay.setTool('arrow');
		var e1=doc.querySelector('[data-element-id="S1-EL-001"]').getBoundingClientRect();
		var e2=doc.querySelector('[data-element-id="S1-EL-002"]').getBoundingClientRect();
		var x1=Math.round(e1.left+e1.width/2), y1=Math.round(e1.top+e1.height/2);
		var x2=Math.round(e2.left+e2.width/2), y2=Math.round(e2.top+e2.height/2);
		ev('mousedown',x1,y1); ev('mousemove',x2,y2); ev('mouseup',x2,y2);
		tab.overlay.setTool('annot');
		var arrow=tab.annotations.annotations.filter(function(a){return a.type==='arrow';})[0];
		window.__arrowId = arrow ? arrow.id : null;
		return { has:!!arrow, m1:arrow&&arrow.anchor&&arrow.anchor.mode, m2:arrow&&arrow.anchor2&&arrow.anchor2.mode,
			id1:arrow&&arrow.anchor&&arrow.anchor.elementId, id2:arrow&&arrow.anchor2&&arrow.anchor2.elementId };
	})()`);
	check('화살표 생성됨(type=arrow)', av.has === true);
	check('시작점 요소 앵커(S1-EL-001)', av.m1 === 'element' && av.id1 === 'S1-EL-001', 'm1=' + av.m1 + ' id1=' + av.id1);
	check('끝점 요소 앵커(S1-EL-002)', av.m2 === 'element' && av.id2 === 'S1-EL-002', 'm2=' + av.m2 + ' id2=' + av.id2);
	// [전체 이동] 몸통(hit line) 잡고 아래 빈 공간으로 → 양끝 함께 이동·재앵커(coord).
	const aw = await wc.executeJavaScript(`(function(){
		var tab=window.activeTab();
		var doc=tab.frame.contentDocument, win=tab.frame.contentWindow;
		var arrow=tab.annotations.annotations.find(function(a){return a.id===window.__arrowId;});
		var before=JSON.stringify({a:arrow.anchor,c:arrow.coord,a2:arrow.anchor2,c2:arrow.coord2});
		tab.overlay.select(arrow.id);
		var hit=doc.querySelector('#dd-overlay-root .dd-arrow .dd-arrow-hit');
		hit.dispatchEvent(new win.MouseEvent('mousedown',{clientX:100,clientY:100,button:0,bubbles:true})); // 몸통=e.target
		doc.dispatchEvent(new win.MouseEvent('mousemove',{clientX:100,clientY:360,button:0,bubbles:true}));  // +260 아래
		doc.dispatchEvent(new win.MouseEvent('mouseup',{clientX:100,clientY:360,button:0,bubbles:true}));
		var after=JSON.stringify({a:arrow.anchor,c:arrow.coord,a2:arrow.anchor2,c2:arrow.coord2});
		return { changed:before!==after, m1:arrow.anchor&&arrow.anchor.mode, m2:arrow.anchor2&&arrow.anchor2.mode };
	})()`);
	check('전체 이동 — 양끝 앵커 갱신됨', aw.changed === true);
	check('전체 이동 — 빈 공간 낙하 → 양끝 coord', aw.m1 === 'coord' && aw.m2 === 'coord', 'm1=' + aw.m1 + ' m2=' + aw.m2);
	// [끝점 이동] 끝점 핸들[1] 잡고 이동 → 잡은 끝만 재앵커, 반대 끝 불변.
	const ae = await wc.executeJavaScript(`(function(){
		var tab=window.activeTab();
		var doc=tab.frame.contentDocument, win=tab.frame.contentWindow;
		var arrow=tab.annotations.annotations.find(function(a){return a.id===window.__arrowId;});
		var end1Before=JSON.stringify({a:arrow.anchor,c:arrow.coord});
		var end2Before=JSON.stringify({a2:arrow.anchor2,c2:arrow.coord2});
		tab.overlay.select(arrow.id);
		var handles=doc.querySelectorAll('#dd-overlay-root .dd-arrow .dd-arrow-handle');
		handles[1].dispatchEvent(new win.MouseEvent('mousedown',{clientX:100,clientY:100,button:0,bubbles:true})); // 끝점 핸들=e.target
		doc.dispatchEvent(new win.MouseEvent('mousemove',{clientX:170,clientY:150,button:0,bubbles:true}));
		doc.dispatchEvent(new win.MouseEvent('mouseup',{clientX:170,clientY:150,button:0,bubbles:true}));
		return { handles:handles.length,
			end1Same: end1Before===JSON.stringify({a:arrow.anchor,c:arrow.coord}),
			end2Changed: end2Before!==JSON.stringify({a2:arrow.anchor2,c2:arrow.coord2}) };
	})()`);
	check('끝점 핸들 2개 존재', ae.handles === 2, 'handles=' + ae.handles);
	check('한 끝점 이동 — 반대 끝(시작점) 불변', ae.end1Same === true);
	check('한 끝점 이동 — 잡은 끝만 갱신', ae.end2Changed === true);
	// [미세이동] 방향키(nudgeSelected) — 양끝 평행이동·길이 유지(점 붕괴 회귀 가드).
	const an = await wc.executeJavaScript(`(function(){
		var tab=window.activeTab();
		var doc=tab.frame.contentDocument;
		var arrow=tab.annotations.annotations.find(function(a){return a.id===window.__arrowId;});
		tab.overlay.select(arrow.id);
		var before=JSON.stringify({a:arrow.anchor,c:arrow.coord,a2:arrow.anchor2,c2:arrow.coord2});
		tab.overlay.nudgeSelected(10,0);
		var vis=doc.querySelector('#dd-overlay-root .dd-arrow .dd-arrow-line');
		var len=Math.hypot(vis.getAttribute('x2')-vis.getAttribute('x1'), vis.getAttribute('y2')-vis.getAttribute('y1'));
		var after=JSON.stringify({a:arrow.anchor,c:arrow.coord,a2:arrow.anchor2,c2:arrow.coord2});
		return { changed:before!==after, len:Math.round(len) };
	})()`);
	check('방향키 미세이동 — 앵커 갱신', an.changed === true);
	check('미세이동 후 길이 유지(점 붕괴 아님)', an.len > 20, 'len=' + an.len);

	console.log('== 커넥터 (Phase 4) — 핀→핀 스냅·팔로잉·해제·자가치유 ==');
	// [스냅] 핀 2개 생성 → 화살표 도구로 핀A 중심에서 핀B 중심으로 긋기 → connect{from,to} 저장.
	const cn = await wc.executeJavaScript(`(function(){
		var tab=window.activeTab();
		var doc=tab.frame.contentDocument, win=tab.frame.contentWindow;
		function ev(t,x,y){ doc.dispatchEvent(new win.MouseEvent(t,{clientX:x,clientY:y,button:0,bubbles:true})); }
		tab.overlay.setTool('annot');
		var e1=doc.querySelector('[data-element-id="S1-EL-001"]').getBoundingClientRect();
		var e2=doc.querySelector('[data-element-id="S1-EL-002"]').getBoundingClientRect();
		ev('mousedown',Math.round(e1.left+30),Math.round(e1.top+e1.height/2)); ev('mouseup',Math.round(e1.left+30),Math.round(e1.top+e1.height/2));
		ev('mousedown',Math.round(e2.left+30),Math.round(e2.top+e2.height/2)); ev('mouseup',Math.round(e2.left+30),Math.round(e2.top+e2.height/2));
		var pins=tab.annotations.annotations.filter(function(a){return a.type==='pin';});
		var pA=pins[pins.length-2], pB=pins[pins.length-1];
		window.__pA=pA.id; window.__pB=pB.id;
		var nA=doc.querySelector('#dd-overlay-root [data-dd-id="'+pA.id+'"]').getBoundingClientRect();
		var nB=doc.querySelector('#dd-overlay-root [data-dd-id="'+pB.id+'"]').getBoundingClientRect();
		var ax=Math.round(nA.left+nA.width/2), ay=Math.round(nA.top+nA.height/2);
		var bx=Math.round(nB.left+nB.width/2), by=Math.round(nB.top+nB.height/2);
		tab.overlay.setTool('arrow');
		ev('mousedown',ax,ay); ev('mousemove',bx,by); ev('mouseup',bx,by);
		tab.overlay.setTool('annot');
		var ars=tab.annotations.annotations.filter(function(a){return a.type==='arrow';});
		var ar=ars[ars.length-1]; window.__cArrow=ar.id;
		return { pA:pA.id, pB:pB.id, from: ar.connect?ar.connect.from:null, to: ar.connect?ar.connect.to:null };
	})()`);
	check('핀 위에서 화살표 그리기 시작 가능(connect.from=핀A)', cn.from === cn.pA, 'from=' + cn.from);
	check('핀 위 드롭 — connect.to=핀B', cn.to === cn.pB, 'to=' + cn.to);
	// [팔로잉] 핀B 를 드래그 이동 → 화살표 끝점이 핀B 새 위치(가장자리)를 따라감.
	const cf = await wc.executeJavaScript(`(function(){
		var tab=window.activeTab();
		var doc=tab.frame.contentDocument, win=tab.frame.contentWindow;
		var nB=doc.querySelector('#dd-overlay-root [data-dd-id="'+window.__pB+'"]');
		var r=nB.getBoundingClientRect(); var sx=Math.round(r.left+r.width/2), sy=Math.round(r.top+r.height/2);
		nB.dispatchEvent(new win.MouseEvent('mousedown',{clientX:sx,clientY:sy,button:0,bubbles:true}));
		doc.dispatchEvent(new win.MouseEvent('mousemove',{clientX:sx+90,clientY:sy+70,button:0,bubbles:true}));
		doc.dispatchEvent(new win.MouseEvent('mouseup',{clientX:sx+90,clientY:sy+70,button:0,bubbles:true}));
		tab.overlay.relayout();
		var r2=nB.getBoundingClientRect(); var cx=r2.left+r2.width/2, cy=r2.top+r2.height/2;
		var ln=doc.querySelector('#dd-overlay-root [data-dd-id="'+window.__cArrow+'"] .dd-arrow-line');
		var rr=doc.getElementById('dd-overlay-root').getBoundingClientRect();
		var x2=parseFloat(ln.getAttribute('x2'))+rr.left, y2=parseFloat(ln.getAttribute('y2'))+rr.top;
		return { d: Math.round(Math.hypot(x2-cx, y2-cy)) };
	})()`);
	check('연결 대상 이동 — 화살표 끝점이 따라감(중심에서 가장자리 거리 ≤30px)', cf.d <= 30, 'd=' + cf.d);
	// [해제] 끝점 핸들을 빈 여백으로 드래그 → connect.to 해제, from 유지.
	const cd = await wc.executeJavaScript(`(function(){
		var tab=window.activeTab();
		var doc=tab.frame.contentDocument, win=tab.frame.contentWindow;
		var arrow=tab.annotations.annotations.find(function(a){return a.id===window.__cArrow;});
		tab.overlay.select(arrow.id);
		var node=doc.querySelector('#dd-overlay-root [data-dd-id="'+arrow.id+'"]');
		var handles=node.querySelectorAll('.dd-arrow-handle');
		handles[1].dispatchEvent(new win.MouseEvent('mousedown',{clientX:400,clientY:300,button:0,bubbles:true}));
		doc.dispatchEvent(new win.MouseEvent('mousemove',{clientX:400,clientY:560,button:0,bubbles:true})); // 아래 빈 여백으로
		doc.dispatchEvent(new win.MouseEvent('mouseup',{clientX:400,clientY:560,button:0,bubbles:true}));
		return { from: arrow.connect?arrow.connect.from:null, to: arrow.connect?arrow.connect.to:null,
			m2: arrow.anchor2&&arrow.anchor2.mode };
	})()`);
	check('끝점 빈 곳 드롭 — connect.to 해제·from 유지', cd.from === cn.pA && cd.to === null, 'from=' + cd.from + ' to=' + cd.to);
	// [자가치유] 연결 대상 핀A 삭제 → layout 이 connect.from 자가 해제 + 폴백 앵커로 계속 렌더.
	const ch = await wc.executeJavaScript(`(function(){
		var tab=window.activeTab();
		var doc=tab.frame.contentDocument;
		var arrow=tab.annotations.annotations.find(function(a){return a.id===window.__cArrow;});
		var had = !!(arrow.connect && arrow.connect.from);
		var idx=tab.annotations.annotations.findIndex(function(a){return a.id===window.__pA;});
		tab.annotations.annotations.splice(idx,1);
		tab.overlay.refresh();
		var node=doc.querySelector('#dd-overlay-root [data-dd-id="'+arrow.id+'"]');
		return { had:had, from: arrow.connect?arrow.connect.from:null, vis: node && node.style.display !== 'none' };
	})()`);
	check('대상 핀 삭제 — connect 자가 해제 + 폴백 앵커로 렌더 유지', ch.had === true && ch.from === null && ch.vis === true, 'from=' + ch.from + ' vis=' + ch.vis);

	console.log('== 화면 플로우맵 (v6, 안 2 자동초안+확정편집) ==');
	// 플로우 목업 로드(3화면 + goScreen 간선). 편집 켜고 플로우 뷰 진입 → 초안 자동 생성.
	await wc.executeJavaScript(`(async function(){ window.alert=function(){};window.confirm=function(){return true;}; await window.loadDocIntoTab(window.activeTab(), ${JSON.stringify(flowPath)}, {history:false}); return true; })()`);
	await wait(700);
	const fd = await wc.executeJavaScript(`(function(){
		var tab=window.activeTab();
		if(!tab.editMode) window.toggleEdit();       // 편집 모드
		window.toggleFlowView();                     // 플로우 뷰 진입 → ensureFlowDraft
		var fm=tab.annotations.flowMap;
		var host=tab.flowHost;
		return {
			view: tab.flowView===true,
			hostVisible: host && !host.classList.contains('hidden'),
			iframeHidden: tab.frame.classList.contains('hidden'),
			nodes: fm?fm.nodes.length:-1,
			edges: fm?fm.edges.length:-1,
			nodeEls: host.querySelectorAll('.flow-node').length,
			edgeEls: host.querySelectorAll('.flow-edge').length,
			navActive: !!document.querySelector('.flow-nav-row.is-active')
		};
	})()`);
	check('플로우 뷰 진입 — 캔버스 노출·iframe 숨김', fd.view && fd.hostVisible && fd.iframeHidden, JSON.stringify(fd));
	check('초안 노드 = 화면 3개 자동 배치', fd.nodes === 3 && fd.nodeEls === 3, 'nodes=' + fd.nodes + ' els=' + fd.nodeEls);
	check('초안 간선 = goScreen 파싱(F1→F2, F2→F3, F2→F1) 3개', fd.edges === 3 && fd.edgeEls === 3, 'edges=' + fd.edges + ' els=' + fd.edgeEls);
	check('좌측 네비 플로우맵 항목 활성', fd.navActive === true);
	// 노드 드래그 → x,y 비율 갱신
	const fdrag = await wc.executeJavaScript(`(function(){
		var tab=window.activeTab(); var host=tab.flowHost;
		var n0=tab.annotations.flowMap.nodes[0];
		var before={x:n0.x,y:n0.y};
		var el=host.querySelector('.flow-node[data-flow-id="'+n0.id+'"]');
		var r=el.getBoundingClientRect();
		var sx=Math.round(r.left+8), sy=Math.round(r.top+8);
		el.dispatchEvent(new MouseEvent('mousedown',{clientX:sx,clientY:sy,button:0,bubbles:true}));
		document.dispatchEvent(new MouseEvent('mousemove',{clientX:sx+120,clientY:sy+90,button:0,bubbles:true}));
		document.dispatchEvent(new MouseEvent('mouseup',{clientX:sx+120,clientY:sy+90,button:0,bubbles:true}));
		return { before:before, after:{x:n0.x,y:n0.y}, moved:(n0.x!==before.x||n0.y!==before.y) };
	})()`);
	check('노드 드래그 — x,y 비율 갱신', fdrag.moved === true, JSON.stringify(fdrag));
	// 간선 추가 — 노드3(F3, 간선 없던)의 포트에서 노드1로 드래그 → 새 간선
	const fedge = await wc.executeJavaScript(`(function(){
		var tab=window.activeTab(); var host=tab.flowHost; var fm=tab.annotations.flowMap;
		var before=fm.edges.length;
		var n3=fm.nodes[2], n1=fm.nodes[0];
		tab.flow.relayout();
		var el3=host.querySelector('.flow-node[data-flow-id="'+n3.id+'"]');
		var el1=host.querySelector('.flow-node[data-flow-id="'+n1.id+'"]');
		var port=el3.querySelector('.flow-port');
		var pr=port.getBoundingClientRect(), t=el1.getBoundingClientRect();
		var sx=Math.round(pr.left+8), sy=Math.round(pr.top+8);
		var tx=Math.round(t.left+t.width/2), ty=Math.round(t.top+t.height/2);
		port.dispatchEvent(new MouseEvent('mousedown',{clientX:sx,clientY:sy,button:0,bubbles:true}));
		document.dispatchEvent(new MouseEvent('mousemove',{clientX:tx,clientY:ty,button:0,bubbles:true}));
		document.dispatchEvent(new MouseEvent('mouseup',{clientX:tx,clientY:ty,button:0,bubbles:true}));
		var last=fm.edges[fm.edges.length-1];
		return { added: fm.edges.length===before+1, from:last&&last.from===n3.id, to:last&&last.to===n1.id, origin:last&&last.origin };
	})()`);
	check('간선 추가 — 포트 드래그로 F3→F1 새 간선', fedge.added && fedge.from && fedge.to, JSON.stringify(fedge));
	check('추가 간선 origin=manual', fedge.origin === 'manual', 'origin=' + fedge.origin);
	// 노드 삭제 → 연결 간선 동반 삭제
	const fdel = await wc.executeJavaScript(`(function(){
		var tab=window.activeTab(); var fm=tab.annotations.flowMap;
		var n2=fm.nodes[1]; // F2 — 간선 여러 개 연결
		var edgesTouching=fm.edges.filter(function(e){return e.from===n2.id||e.to===n2.id;}).length;
		tab.flow.rebuild();
		// 선택 후 삭제(컨트롤러 API)
		var host=tab.flowHost;
		var el=host.querySelector('.flow-node[data-flow-id="'+n2.id+'"]');
		el.dispatchEvent(new MouseEvent('mousedown',{clientX:el.getBoundingClientRect().left+8,clientY:el.getBoundingClientRect().top+8,button:0,bubbles:true}));
		document.dispatchEvent(new MouseEvent('mouseup',{clientX:el.getBoundingClientRect().left+8,clientY:el.getBoundingClientRect().top+8,button:0,bubbles:true}));
		var ok=tab.flow.deleteSelected();
		var nodeGone=!fm.nodes.some(function(n){return n.id===n2.id;});
		var edgesGone=!fm.edges.some(function(e){return e.from===n2.id||e.to===n2.id;});
		return { touched:edgesTouching, nodeGone:nodeGone, edgesGone:edgesGone };
	})()`);
	check('노드 삭제 — 연결 간선 동반 삭제', fdel.nodeGone && fdel.edgesGone && fdel.touched > 0, JSON.stringify(fdel));
	// 저장 왕복 — flowMap 이 저장본에 실리고 재개봉 시 복원되는지(embed/extract)
	const fsave = await wc.executeJavaScript(`(function(){
		var tab=window.activeTab(); var set=tab.annotations;
		var runtime={css:window.DDRuntimeSrc.RUNTIME_CSS, js:window.DDRuntimeSrc.RUNTIME_JS};
		var saved=window.DDHtmlIO.embed(tab.pure||tab.raw, set, runtime);
		var ex=window.DDHtmlIO.extract(saved);
		var mig=window.DDModel.migrate(ex.set);
		return {
			hasFlow: !!(mig.flowMap && Array.isArray(mig.flowMap.nodes)),
			nodes: mig.flowMap?mig.flowMap.nodes.length:-1,
			edges: mig.flowMap?mig.flowMap.edges.length:-1,
			valid: window.DDModel.validateSet(mig).ok
		};
	})()`);
	check('저장 왕복 — flowMap 저장본에 실림·복원·검증', fsave.hasFlow && fsave.valid && fsave.nodes >= 2, JSON.stringify(fsave));
	// 플로우 뷰 이탈 → 목업 복귀
	const fexit = await wc.executeJavaScript(`(function(){
		var tab=window.activeTab();
		window.toggleFlowView();
		return { view: tab.flowView, iframeShown: !tab.frame.classList.contains('hidden'), hostHidden: tab.flowHost.classList.contains('hidden') };
	})()`);
	check('플로우 뷰 이탈 — 목업 iframe 복귀', fexit.view === false && fexit.iframeShown && fexit.hostHidden, JSON.stringify(fexit));

	console.log('\n' + (failed === 0 ? 'ALL PASS' : failed + ' FAILED'));
	app.exit(failed === 0 ? 0 : 1);
}).catch((e) => { console.log('SMOKE ERROR ' + (e && e.stack ? e.stack : e)); app.exit(1); });
