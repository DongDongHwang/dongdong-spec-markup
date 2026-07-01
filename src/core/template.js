// 볼트 템플릿 토큰 치환 — CmdMD Vault.swift 의 VaultTemplate 충실 이식.
// {{title}}/{{date}}/{{time}}/{{timestamp}} 토큰과 {{content}} 본문 삽입을 처리한다.

'use strict';

function pad2(n) {
	return String(n).padStart(2, '0');
}

// 원본 DateFormatter 포맷 재현 — yyyy-MM-dd / HH:mm / HHmmss (로컬 시간 기준)
function formatDate(date) {
	return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}
function formatTime(date) {
	return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}
function formatTimestamp(date) {
	return `${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`;
}

// 토큰 치환 (content 는 별도 단계에서 처리)
function substitute(pattern, title, date) {
	return pattern
		.split('{{title}}').join(title)
		.split('{{date}}').join(formatDate(date))
		.split('{{time}}').join(formatTime(date))
		.split('{{timestamp}}').join(formatTimestamp(date));
}

// 파일명 생성 — 패턴이 비면 {{title}} 로 폴백
function generateFilename(template, title, date = new Date()) {
	const pattern = template.filenamePattern && template.filenamePattern.length > 0
		? template.filenamePattern
		: '{{title}}';
	return substitute(pattern, title, date);
}

// 본문 렌더 — {{content}} 가 있으면 그 자리에, 없으면 끝에 본문을 붙인다.
// 템플릿 본문이 비면 문서 본문을 그대로 반환 (사용자 내용 유실 방지, 원본 동일).
function renderContent(template, document, date = new Date()) {
	if (!template.content || template.content.length === 0) return document.content;
	let rendered = substitute(template.content, displayTitle(document), date);
	if (rendered.includes('{{content}}')) {
		rendered = rendered.split('{{content}}').join(document.content);
	} else {
		rendered += '\n\n' + document.content;
	}
	return rendered;
}

// MarkdownDocument.displayTitle 의 핵심 — title 우선, 없으면 첫 H1, 없으면 파일명
function displayTitle(document) {
	if (document.title && document.title.length > 0 && document.title !== 'Untitled') {
		return document.title;
	}
	const lines = (document.content || '').split(/\r?\n/);
	for (const line of lines) {
		const trimmed = line.trim();
		if (trimmed.startsWith('# ')) return trimmed.slice(2);
	}
	if (document.fileURL) {
		const parts = String(document.fileURL).split(/[\\/]/);
		const name = parts[parts.length - 1] || '';
		const dot = name.lastIndexOf('.');
		return dot > 0 ? name.slice(0, dot) : name;
	}
	return 'Untitled';
}

module.exports = {
	substitute,
	generateFilename,
	renderContent,
	displayTitle,
	formatDate,
	formatTime,
	formatTimestamp,
};
