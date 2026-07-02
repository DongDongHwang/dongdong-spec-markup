# Dong Dong Spec Markup for Windows

화면기획서(spec-html) 목업을 열어 **번호핀·범위박스·리치설명 주석**을 달고, **신규/기존·차수 마킹**을 찍고, **자기완결 HTML**로 저장하는 Electron 데스크톱 도구. 피그마 Dev Mode 의 "짚어서 설명" + 노션 서식을 화면기획 리뷰/핸드오프에 맞춰 가져왔다. 뷰어가 아니라 **주석·마킹 도구(markup)** 다 — 목업을 보기도 하지만 핵심은 그 위에 검토 의견을 얹는 것.

CmdMD(원본 맥 앱, [johnfkoo951/CmdMD](https://github.com/johnfkoo951/CmdMD))의 Electron 셸·IPC·빌드 파이프라인을 재활용했고, 주석 엔진·앵커 수학·저장 왕복은 이 프로젝트에서 새로 만들었다.

## 주요 기능

- **주석** — 목업 클릭 = 번호핀 / 드래그 = 범위박스. 요소 위면 요소에 앵커(리사이즈·화면전환 추종), 빈 곳이면 프레임/바디 비율 고정.
- **리치설명** — 자유 리치텍스트 + 5종 슬롯(기능/동작/데이터/비즈니스/기술) 토글.
- **신규/기존 마킹** — 핀마다 신규/기존을 직접 지정. 신규는 차수(1·2·3차)·날짜·사유까지 기록. 신규 초록 / 2·3차 황색 배지 / 기존 무배지.
- **번호 자유관리** — 자동 다음번호 / 수동 고정(계층 1-1·커스텀) / 삭제 시 당김 / 드래그 재정렬.
- **Figma/PPT식 단축키** — Ctrl+B 볼드, Ctrl+D 복제, Ctrl+C/V 복사·붙여넣기, 화살표 미세이동(Shift 큰폭), Delete 삭제, Ctrl+Z/Ctrl+Shift+Z 되돌리기/다시.
- **자기완결 저장** — 원본 목업 무변형 + `</body>` 앞에 주석 JSON·뷰어 런타임 인라인. dd 없이 브라우저로 열어도 핀·설명이 렌더된다. 저장 왕복 무손상·멱등.
- **문서 뷰** — 현재 화면 소속 핀을 seq 순 번호·설명 표로(인쇄/PDF 대응).
- **spec-html + generic 양쪽** — spec-html 목업이면 요소 앵커·화면 게이팅·초안 주입까지, 임의 HTML 이면 좌표 기반으로 동작.

## 스택

- Electron (Chromium) — 창·셸·IPC (CmdMD 윈도우판 재활용)
- 순수 코어 모듈(UMD) — 앵커 수학 / 번호 관리 / 저장 왕복 / 주석 모델. node·브라우저 양쪽에서 테스트.
- 목업은 `<iframe srcdoc>` 격리 렌더, 오버레이를 문서 내부에 주입해 단일 좌표계 유지.
- 전부 JavaScript — 단일 언어로 AI 보조 제작·유지.

## 실행

```bash
npm install        # electron 포함 전체 의존성
npm start          # 앱 실행
npm test           # 코어 로직 테스트(모델/앵커/저장왕복/번호/마킹)
npm run dist       # 윈도우 설치본(NSIS) 빌드
```

## 저장 형식 (데이터 계약)

저장본은 원본 목업 뒤 `</body>` 앞에 다음 블록을 붙인다. 마커·JSON id 는 **불변 계약**이라 바꾸지 않는다(기존 저장본 호환).

```html
<!-- dd-spec-viewer:begin -->
<script type="application/json" id="dd-annotations">{ ddVersion, tool, annotations[...] }</script>
<style id="dd-runtime-style">/* 자기완결 뷰어 CSS */</style>
<script id="dd-runtime">/* 저장본 렌더 런타임 */</script>
<!-- dd-spec-viewer:end -->
```

- `ddVersion` 2 — 사용자 마킹(mark) 도입. v1 저장본은 로드 시 무손실 승격.
- 불변식 — `extract(embed(pure, ann)) === {pure, ann}`(왕복 항등), `embed(embed(x)) === embed(x)`(멱등).

## 구조

```
src/core/      순수 코어 (테스트 대상)
  anchor.js            요소/좌표 앵커 수학
  annotation-model.js  주석 모델·검증·마킹(mark)·diff 상태
  numbering.js         번호 자유관리(seq/label/auto)
  html-io.js           저장 왕복(embed/strip/extract)
  vault-detect.js      Obsidian 볼트 자동 감지
src/main/      Electron 메인 (창·메뉴·파일 IPC)
src/renderer/  셸 UI + 오버레이 + 저장본 런타임
test/          코어 동작 테스트
```

## 참고

- 원본 셸 (맥 CmdMD): https://github.com/johnfkoo951/CmdMD
- 프로젝트 추적 문서 (디디 볼트): `20_Side/036.dongdong-spec-markup/ROADMAP.md`
