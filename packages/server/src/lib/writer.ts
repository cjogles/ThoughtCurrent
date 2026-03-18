import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { CompilationItem, SourceType } from "@thoughtcurrent/shared";

const OUTPUT_DIR = resolve(import.meta.dir, "../../../../output");

function formatItem(item: CompilationItem): string {
	const date = new Date(item.timestamp).toLocaleDateString("en-US", {
		year: "numeric",
		month: "long",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});

	const lines = [
		`## ${item.title}`,
		"",
		`**Author:** ${item.author ?? "Unknown"}`,
		`**Date:** ${date}`,
		item.sourceUrl ? `**Source:** ${item.sourceUrl}` : null,
		"",
		item.content,
		"",
		"---",
		"",
	];

	return lines.filter((l) => l !== null).join("\n");
}

function getSourceFilename(source: SourceType): string {
	const filenames: Record<string, string> = {
		github: "issues-and-prs.md",
		slack: "channels.md",
		linear: "issues.md",
		granola: "transcripts.md",
		sentry: "errors.md",
		datadog: "logs.md",
		posthog: "sessions.md",
		trello: "cards.md",
		figma: "comments.md",
		gmail: "emails.md",
		manual: "uploaded-docs.md",
	};
	return filenames[source] ?? "output.md";
}

export async function writeSourceMarkdown(
	source: SourceType,
	items: CompilationItem[],
): Promise<void> {
	if (items.length === 0) return;

	const dir = resolve(OUTPUT_DIR, source);
	await mkdir(dir, { recursive: true });

	const filename = getSourceFilename(source);
	const header = `# ${source.charAt(0).toUpperCase() + source.slice(1)} — Compiled Output\n\n> ${items.length} items compiled on ${new Date().toLocaleDateString()}\n\n---\n\n`;
	const body = items.map(formatItem).join("");

	await Bun.write(resolve(dir, filename), header + body);
}

export async function writeCompiledMarkdown(
	items: CompilationItem[],
): Promise<void> {
	if (items.length === 0) return;

	// Sort all items chronologically across sources
	const sorted = [...items].sort(
		(a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
	);

	const header = `# ThoughtCurrent — Compiled Output\n\n> ${sorted.length} items from ${new Set(sorted.map((i) => i.source)).size} source(s), compiled on ${new Date().toLocaleDateString()}\n\n---\n\n`;
	const body = sorted.map(formatItem).join("");

	await Bun.write(resolve(OUTPUT_DIR, "_compiled.md"), header + body);
}
