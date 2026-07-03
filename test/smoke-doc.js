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
<div class="pg on" id="pg-0"><div class="box" id="b0">화면0 콘텐츠</div></div>
<div class="pg" id="pg-1"><div class="box" id="b1">화면1 콘텐츠</div></div>
<div class="pg" id="pg-2"><div class="box" id="b2">화면2 콘텐츠</div></div>
<script>function showPage(i){var ps=document.querySelectorAll('.pg');for(var k=0;k<ps.length;k++)ps[k].classList.toggle('on',k===i);}</script>
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
fs.writeFileSync(specPath, SPEC_HTML, 'utf8');
fs.writeFileSync(storyPath, STORY_MULTI_HTML, 'utf8');
fs.writeFileSync(longPath, LONGSCROLL_HTML, 'utf8');
fs.writeFileSync(genPath, GENERIC_HTML, 'utf8');
fs.writeFileSync(adminPath, ADMIN_HTML, 'utf8');
fs.writeFileSync(adminNewPath, ADMIN_NEW_HTML, 'utf8');

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

	console.log('== spec-html 목업 (2화면 앵커) ==');
	const r1 = await wc.executeJavaScript(SPEC_SCENARIO);
	check('편집→핀 3개 주입', r1.total === 3, 'total=' + r1.total);
	check('문서 뷰 doc-mode 클래스 ON', r1.docMode === true);
	check('문서 뷰 버튼 is-on', r1.btnOn === true);
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
	await wait(850); // rAF + MutationObserver(class) → onScreenChange → 우측 표 재렌더 (여유 있게 — 400ms 는 flaky)
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
	await wait(850);
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
	await wait(850);
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
		var el=doc.getElementById('b0'); var r=el.getBoundingClientRect();
		var cx=Math.round(r.left+r.width/2), cy=Math.round(r.top+r.height/2);
		doc.dispatchEvent(new win.MouseEvent('mousedown',{clientX:cx,clientY:cy,button:0,bubbles:true}));
		doc.dispatchEvent(new win.MouseEvent('mouseup',{clientX:cx,clientY:cy,button:0,bubbles:true}));
		var a=tab.annotations.annotations[0];
		return { src:tab.annotations.source.kind, total:tab.annotations.annotations.length, screenSel:a&&a.anchor&&a.anchor.screenSel, visible:tab.overlay.stats().visible };
	})()`);
	check('STORY generic 판정', s1.src === 'generic', 'src=' + s1.src);
	check('화면0 핀 1개 — screenSel = #pg-0 감지', s1.screenSel === '#pg-0', 'screenSel=' + s1.screenSel);
	check('화면0에서 핀 표시 = 1', s1.visible === 1, 'visible=' + s1.visible);
	await wc.executeJavaScript(`(function(){ window.activeTab().frame.contentWindow.showPage(1); return true; })()`);
	await wait(850);
	const s2 = await wc.executeJavaScript(`(function(){ return { visible:window.activeTab().overlay.stats().visible }; })()`);
	check('화면1 전환 → 화면0 핀 숨김 = 0 (페이지마다 다른 주석)', s2.visible === 0, 'visible=' + s2.visible);
	await wc.executeJavaScript(`(function(){ window.activeTab().frame.contentWindow.showPage(0); return true; })()`);
	await wait(850);
	const s3 = await wc.executeJavaScript(`(function(){ var tab=window.activeTab(); return { visible:tab.overlay.stats().visible, cur:window.currentScreenId(tab) }; })()`);
	check('화면0 복귀 → 핀 복원 = 1', s3.visible === 1, 'visible=' + s3.visible);
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

	console.log('\n' + (failed === 0 ? 'ALL PASS' : failed + ' FAILED'));
	app.exit(failed === 0 ? 0 : 1);
}).catch((e) => { console.log('SMOKE ERROR ' + (e && e.stack ? e.stack : e)); app.exit(1); });
