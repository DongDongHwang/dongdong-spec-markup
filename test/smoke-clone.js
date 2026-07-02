// M5.6 클론 인프라 스모크 (Electron 헤드리스) — listScreens + snapshotScreen.
//   실행:  npx electron test/smoke-clone.js
//   핵심 리스크 2종 검증 — (1) 신버전 innerHTML 교체형 목업에서 goScreen 후 클론 타이밍
//   (rAF 두 틱)이 올바른 화면을 뜨는가, (2) 클론을 iframe 내부에 append 할 때 목업 <style>이 적용(스타일 격리)되는가.
//   무거운 실목업은 헤드리스 hang 위험 → 경량 목업으로 신버전 패턴(innerHTML 통째 교체)만 재현.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = path.join(os.tmpdir(), 'dd-smoke-clone');
try { fs.mkdirSync(TMP, { recursive: true }); } catch (_) {}

// 신버전 spec-html 재현 — goScreen 이 #wireframe innerHTML 을 통째 재작성(한 시점 1화면만 DOM 존재).
//   .el 색은 목업 <style> 이 소유 → 클론이 그 색을 받는지로 스타일 격리를 검증한다.
const INNERHTML_HTML = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>
body{margin:0;font-family:sans-serif}
#wireframe .stage{padding:20px}
.el{padding:16px;border:1px solid #bbb;color:rgb(120,96,217)}
</style></head><body>
<div id="wireframe"></div>
<script>
const APP_DATA={currentScreen:"S1",screens:{S1:{id:"S1",name:"화면 1"},S2:{id:"S2",name:"화면 2"},S3:{id:"S3",name:"화면 3"}}};
function render(id){document.getElementById('wireframe').innerHTML='<div class="stage" data-cur="'+id+'"><div class="el" data-element-id="'+id+'-EL">'+APP_DATA.screens[id].name+' 콘텐츠</div></div>';}
function goScreen(id){if(!APP_DATA.screens[id])return;APP_DATA.currentScreen=id;render(id);}
render("S1");
</script>
</body></html>`;

const innerPath = path.join(TMP, 'inner.html');
fs.writeFileSync(innerPath, INNERHTML_HTML, 'utf8');

const { app, BrowserWindow } = require('electron');
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');
process.argv.push(innerPath);
require('../src/main/main.js');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let failed = 0;
function check(name, cond, detail) {
	if (cond) { console.log('  ok   ' + name); }
	else { failed++; console.log('  FAIL ' + name + (detail ? '\n       ' + detail : '')); }
}

app.whenReady().then(async () => {
	await wait(1600); // 창 + index.html + iframe(srcdoc) onload + APP_DATA 준비
	const win = BrowserWindow.getAllWindows()[0];
	if (!win) { console.log('FAIL 창이 없음'); app.exit(1); return; }
	const wc = win.webContents;

	console.log('== listScreens (신버전 APP_DATA.screens) ==');
	const ls = await wc.executeJavaScript(`(function(){
		var t=window.activeTab();
		var s=DDOverlay.listScreens(t.frame);
		return { n:s.length, ids:s.map(function(x){return x.id;}).join(','), names:s.map(function(x){return x.name;}).join(',') };
	})()`);
	check('화면 3개 목록화', ls.n === 3, 'n=' + ls.n);
	check('id·순서 = S1,S2,S3', ls.ids === 'S1,S2,S3', 'ids=' + ls.ids);
	check('name 추출 = 화면 1,화면 2,화면 3', ls.names === '화면 1,화면 2,화면 3', 'names=' + ls.names);

	console.log('== snapshotScreen (innerHTML 교체형 클론 + 스타일 격리) ==');
	const snap = await wc.executeJavaScript(`(async function(){
		var t=window.activeTab();
		var s1=await DDOverlay.snapshotScreen(t.frame,'S1');
		var s2=await DDOverlay.snapshotScreen(t.frame,'S2');
		var s3=await DDOverlay.snapshotScreen(t.frame,'S3');
		// 클론을 iframe 내부에 임시 append → 목업 <style>이 클론에 적용되는지 computed 로 확인
		var doc=t.frame.contentDocument, win=t.frame.contentWindow;
		var host=doc.createElement('div'); host.style.position='absolute'; host.style.left='-9999px';
		host.appendChild(s2.clone); doc.body.appendChild(host);
		var el=s2.clone.querySelector('.el');
		var color=el?win.getComputedStyle(el).color:null;
		var txt2=s2.clone.textContent||'';
		doc.body.removeChild(host);
		return {
			s1txt:((s1&&s1.clone&&s1.clone.textContent)||'').indexOf('화면 1 콘텐츠')>=0,
			s2txt:txt2.indexOf('화면 2 콘텐츠')>=0,
			s3txt:((s3&&s3.clone&&s3.clone.textContent)||'').indexOf('화면 3 콘텐츠')>=0,
			cloneColor:color,
			hasElId:!!s2.clone.querySelector('[data-element-id="S2-EL"]')
		};
	})()`);
	check('S1 클론 콘텐츠 정확', snap.s1txt === true);
	check('S2 클론 콘텐츠 정확 (innerHTML 교체 후 타이밍)', snap.s2txt === true);
	check('S3 클론 콘텐츠 정확', snap.s3txt === true);
	check('클론 스타일 격리 — iframe 내부 append 시 목업 색 적용', snap.cloneColor === 'rgb(120, 96, 217)', 'color=' + snap.cloneColor);
	check('클론에 data-element-id 보존', snap.hasElId === true);

	console.log('\n' + (failed === 0 ? 'ALL PASS' : failed + ' FAILED'));
	app.exit(failed === 0 ? 0 : 1);
}).catch((e) => { console.log('SMOKE ERROR ' + (e && e.stack ? e.stack : e)); app.exit(1); });
