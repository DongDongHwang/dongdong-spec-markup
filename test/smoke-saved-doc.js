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
// M5.6 — 저장 시 캐싱되는 표지·History 스냅샷(saveTab 이 채우는 것). 저장본이 목업 스크립트 없이도 표지 렌더.
set.docMeta = DDModel.normalizeDocMeta({ title: '테스트 기능', version: 'v1.0', history: [{ no: 1, date: '2026-07-03', ver: 'v1.0', content: '최초 작성', author: '동동이' }] });

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
			newBadges:document.querySelectorAll('#dd-panel .dd-p-badge.dd-b-new').length,
			docFront:!!document.querySelector('#dd-panel .dd-p-front'),
			coverTitle:(document.querySelector('#dd-panel .dd-cover-title')||{}).textContent,
			histRows:document.querySelectorAll('#dd-panel .dd-hist-tbl tbody tr').length
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
	check('저장본 표지 블록(dd-p-front) 렌더', r.docFront === true);
	check('저장본 표지 제목 = docMeta.title', r.coverTitle === '테스트 기능', 'title=' + r.coverTitle);
	check('저장본 History 표 1행', r.histRows === 1, 'histRows=' + r.histRows);

	await wc.executeJavaScript(`(function(){ window.goScreen('S2'); return true; })()`);
	await wait(450); // class 변경 → MutationObserver → layout → 문서 뷰 재렌더
	const r2 = await wc.executeJavaScript(`(function(){ return { rows:document.querySelectorAll('#dd-panel .dd-p-row').length }; })()`);
	check('화면 전환(S2) 후 문서 뷰 목록 = 1행', r2.rows === 1, 'rows=' + r2.rows);

	// 전체 보기 복귀 — 다시 3행
	const r3 = await wc.executeJavaScript(`(function(){ document.querySelectorAll('#dd-panel .dd-p-btns .dd-p-toggle')[0].click(); return { rows:document.querySelectorAll('#dd-panel .dd-p-row').length }; })()`);
	check('전체 보기 복귀 → 3행', r3.rows === 3, 'rows=' + r3.rows);

	console.log('== M5.6c 전 화면 인쇄 (페이지 스택 조립 — win.print 없이 스택만 검증) ==');
	// __ddBuildPrintStack = 각 화면 전환→rAF2→스테이지 클론+핀 굽기+설명표. 표지 앞 페이지.
	const rp = await wc.executeJavaScript(`window.__ddBuildPrintStack().then(function(stack){
		var pages = stack.querySelectorAll('.dd-print-page');
		var p1 = pages[1], p2 = pages[2];
		return {
			isPromiseOk: true,
			pageCount: pages.length,
			hasCover: !!stack.querySelector('.dd-print-cover'),
			coverTitle: (stack.querySelector('.dd-print-cover .dd-cover-title')||{}).textContent,
			histRows: stack.querySelectorAll('.dd-print-cover .dd-hist-tbl tbody tr').length,
			hd1: p1 ? p1.querySelector('.dd-print-hd').textContent : '',
			hd2: p2 ? p2.querySelector('.dd-print-hd').textContent : '',
			s1pins: p1 ? p1.querySelectorAll('.dd-sp-pin, .dd-sp-box').length : -1,
			s2pins: p2 ? p2.querySelectorAll('.dd-sp-pin, .dd-sp-box').length : -1,
			s1cloneEl: p1 ? !!p1.querySelector('[data-element-id="S1-EL-001"]') : false,
			s1desc: p1 ? p1.querySelectorAll('.dd-print-desc tbody tr').length : -1,
			s2desc: p2 ? p2.querySelectorAll('.dd-print-desc tbody tr').length : -1,
			curRestored: (typeof APP_DATA !== 'undefined' && APP_DATA) ? APP_DATA.currentScreen : null
		};
	})`);
	check('스택 = 표지1 + 화면2 = 3페이지', rp.pageCount === 3, 'pageCount=' + rp.pageCount);
	check('표지 페이지 존재', rp.hasCover === true);
	check('표지 제목 = docMeta.title', rp.coverTitle === '테스트 기능', 'coverTitle=' + rp.coverTitle);
	check('표지 History 표 1행', rp.histRows === 1, 'histRows=' + rp.histRows);
	check('S1 페이지 헤더 = 화면 1', rp.hd1 === '화면 1', 'hd1=' + rp.hd1);
	check('S2 페이지 헤더 = 화면 2', rp.hd2 === '화면 2', 'hd2=' + rp.hd2);
	check('S1 페이지 핀 2개 굽힘', rp.s1pins === 2, 's1pins=' + rp.s1pins);
	check('S2 페이지 핀 1개(좌표) 굽힘', rp.s2pins === 1, 's2pins=' + rp.s2pins);
	check('S1 클론에 목업 요소 보존(data-element-id)', rp.s1cloneEl === true);
	check('S1 설명표 2행', rp.s1desc === 2, 's1desc=' + rp.s1desc);
	check('S2 설명표 1행', rp.s2desc === 1, 's2desc=' + rp.s2desc);
	check('조립 후 원래 화면(S2) 복귀', rp.curRestored === 'S2', 'cur=' + rp.curRestored);

	console.log('== 커넥터(Phase 4) 저장본 — 연결 화살표 팔로잉 ==');
	// 별도 저장본(기존 케이스 개수 무영향) — S1 핀 2개 + 핀1→핀2 connect 화살표. dd 없이 브라우저 런타임만으로
	// 화살표 끝점이 연결 핀 "가장자리"에 스냅되는지, 대상 핀 노드 기준 거리로 검사한다.
	const set2 = DDModel.createSet('spec-html');
	DDNumbering.add(set2, DDModel.createAnnotation({ type: 'pin', anchor: { mode: 'element', elementId: 'S1-EL-001', screenId: 'S1' }, body: { format: 'html', html: '<p>A</p>', plain: 'A' } }));
	DDNumbering.add(set2, DDModel.createAnnotation({ type: 'pin', anchor: { mode: 'element', elementId: 'S1-EL-002', screenId: 'S1' }, body: { format: 'html', html: '<p>B</p>', plain: 'B' } }));
	const cpFrom = set2.annotations[0].id, cpTo = set2.annotations[1].id;
	DDNumbering.add(set2, DDModel.createAnnotation({
		type: 'arrow',
		anchor: { mode: 'element', elementId: 'S1-EL-001', screenId: 'S1' },
		anchor2: { mode: 'element', elementId: 'S1-EL-002' },
		connect: { from: cpFrom, to: cpTo },
	}));
	const saved2 = DDHtmlIO.embed(PURE, set2, runtime);
	const saved2Path = path.join(TMP, 'saved-connect.html');
	fs.writeFileSync(saved2Path, saved2, 'utf8');
	await win.loadFile(saved2Path);
	await wait(600);
	const cc = await win.webContents.executeJavaScript(`(function(){
		var pinB=document.querySelector('#dd-overlay-root [data-dd-id="${cpTo}"]');
		var ar=document.querySelector('#dd-overlay-root svg.dd-arrow') || document.querySelector('#dd-overlay-root .dd-arrow');
		if(!pinB||!ar) return { found:false };
		var ln=ar.querySelector('.dd-arrow-line');
		var rr=document.getElementById('dd-overlay-root').getBoundingClientRect();
		var r=pinB.getBoundingClientRect(); var cx=r.left+r.width/2, cy=r.top+r.height/2;
		var x2=parseFloat(ln.getAttribute('x2'))+rr.left, y2=parseFloat(ln.getAttribute('y2'))+rr.top;
		return { found:true, vis: ar.style.display!=='none', d: Math.round(Math.hypot(x2-cx,y2-cy)) };
	})()`);
	check('저장본 커넥터 — 화살표 렌더 + 끝점이 연결 핀 가장자리(≤30px)', cc.found === true && cc.vis === true && cc.d <= 30, JSON.stringify(cc));

	console.log('\n' + (failed === 0 ? 'ALL PASS' : failed + ' FAILED'));
	app.exit(failed === 0 ? 0 : 1);
}).catch((e) => { console.log('SMOKE ERROR ' + (e && e.stack ? e.stack : e)); app.exit(1); });
