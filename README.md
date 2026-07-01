# Dong Dong MD Viewer for Windows

맥용 [CmdMD](https://github.com/johnfkoo951/CmdMD)(Swift/SwiftUI, review-first 마크다운 리더 + Obsidian 볼트 라우터)의 **윈도우판 — Dong Dong MD Viewer**. 맥 버전은 그대로 두고, 윈도우는 같은 동작을 Electron 으로 새로 만든다. 원본 Swift 는 한 줄도 컴파일되지 않으므로 이식이 아니라 재작성이며, 렌더 자산·마크다운 스펙·라우팅/템플릿/frontmatter 로직만 재활용한다.

## 스택

- Electron (Chromium) — 창·셸
- 프리뷰 렌더: markdown-it + highlight.js + Mermaid 11 + KaTeX 0.16(+mhchem), 원본과 동일하게 CDN 로드
- 에디터(예정): Monaco 또는 CodeMirror 6 — 원본 NSTextView 커스텀 에디터를 대체
- frontmatter: js-yaml (타입 보존)
- 전부 JavaScript/TypeScript — 단일 언어로 AI 보조 제작·유지 용이

## 상태 (2026-06-30)

- 코어 로직 이식 완료 — 라우팅 매처 / 템플릿 토큰 / frontmatter 타입 보존(bool↔int 데이터손실 방지). **`npm test` 19/19 통과.**
- Electron 셸 스캐폴딩 완료 — 파일 열기 → frontmatter 분리 → 렌더 프리뷰, Obsidian 볼트 자동 감지(%APPDATA%\obsidian\obsidian.json).
- 윈도우 파일 연결 — `.md`·`.markdown`·`.mdown` 을 더블클릭·"연결 프로그램"으로 Dong Dong MD Viewer 에 연결해 바로 렌더(single-instance — 떠 있으면 같은 창에서 열기). 아래 §파일 연결 참고.
- 렌더 파리티(진행) — 콜아웃 접기, 태스크 체크박스(시각 토글, 파일 미저장), 이미지 임베드 인라인 표시 추가.
- 미완료 — 7개 CSS 테마, 노트 임베드 재귀 렌더, 에디터(Monaco), 3분할/탭/사이드바/인스펙터 UI, 보내기 시트, 앱 아이콘·서명.

## 실행

```bash
npm install        # electron 포함 전체 의존성
npm start          # 앱 실행
npm test           # 코어 로직 동작 동일성 테스트
npm run dist       # 윈도우 설치본(NSIS) 빌드
```

## 파일 연결 (.md 더블클릭으로 열기)

설치본(`npm run dist`)을 설치하면 `.md`·`.markdown`·`.mdown` 이 Dong Dong MD Viewer 에 등록된다. 탐색기에서 파일 우클릭 → **연결 프로그램** → Dong Dong MD Viewer 를 고르면 바로 렌더된다. 앱이 이미 떠 있으면 새 창 대신 기존 창에서 열린다.

> Windows 10/11 은 설치만으로 기본 앱을 강제하지 않는다. 더블클릭 기본 동작까지 바꾸려면 한 번 우클릭 → 연결 프로그램 → Dong Dong MD Viewer → "항상 이 앱으로 열기" 를 선택한다. 기존에 메모장·VS Code·Obsidian 이 `.md` 기본 앱이면 그 설정이 우선한다(OS 정책이라 버그가 아니다).

## 구조

```
src/core/      재활용 코어 (순수 로직, 테스트 대상)
  routing.js       라우팅 규칙 매처 (Vault.swift RoutingCondition 이식)
  template.js      템플릿 토큰 치환 (VaultTemplate 이식)
  frontmatter.js   frontmatter 파서/직렬화 (FrontmatterValue 이식)
  vault-detect.js  Obsidian 볼트 자동 감지 (윈도우 경로)
src/main/      Electron 메인 (창·메뉴·파일 열기 IPC)
src/renderer/  프리뷰 (마크다운 변환 파이프라인 + 테마)
test/          코어 동작 동일성 테스트
```

## 참고

- 원본 (맥): https://github.com/johnfkoo951/CmdMD
- 프로젝트 추적 문서 (디디 볼트): `20_Side/031.cmdmd-win/README.md`
