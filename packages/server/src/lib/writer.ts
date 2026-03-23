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

export async function writeSlackGranularOutput(
	items: CompilationItem[],
): Promise<void> {
	if (items.length === 0) return;

	const slackDir = resolve(OUTPUT_DIR, "slack");

	// Group items by type
	const messages: CompilationItem[] = [];
	const files: CompilationItem[] = [];
	const images: CompilationItem[] = [];
	const canvases: CompilationItem[] = [];
	const pins: CompilationItem[] = [];
	const bookmarks: CompilationItem[] = [];

	for (const item of items) {
		const type = item.metadata.type as string;
		switch (type) {
			case "image":
				images.push(item);
				break;
			case "canvas":
				canvases.push(item);
				break;
			case "file":
				files.push(item);
				break;
			case "pin":
				pins.push(item);
				break;
			case "bookmark":
				bookmarks.push(item);
				break;
			default:
				messages.push(item);
				break;
		}
	}

	// Messages by channel
	if (messages.length > 0) {
		const byChannel = new Map<string, CompilationItem[]>();
		const byUser = new Map<string, CompilationItem[]>();
		const byDate = new Map<string, CompilationItem[]>();

		for (const msg of messages) {
			const channel = (msg.metadata.channel as string) ?? "unknown";
			const user = msg.author ?? "unknown";
			const date = msg.timestamp.split("T")[0];

			const chList = byChannel.get(channel) ?? [];
			chList.push(msg);
			byChannel.set(channel, chList);

			const uList = byUser.get(user) ?? [];
			uList.push(msg);
			byUser.set(user, uList);

			const dList = byDate.get(date) ?? [];
			dList.push(msg);
			byDate.set(date, dList);
		}

		// by-channel
		const channelDir = resolve(slackDir, "messages/by-channel");
		await mkdir(channelDir, { recursive: true });
		for (const [channel, msgs] of byChannel) {
			const safeName = channel.replace(/[^a-zA-Z0-9_-]/g, "-");
			const header = `# #${channel}\n\n> ${msgs.length} messages\n\n---\n\n`;
			await Bun.write(
				resolve(channelDir, `${safeName}.md`),
				header + msgs.map(formatItem).join(""),
			);
		}

		// by-user
		const userDir = resolve(slackDir, "messages/by-user");
		await mkdir(userDir, { recursive: true });
		for (const [user, msgs] of byUser) {
			const safeName = user.replace(/[^a-zA-Z0-9_-]/g, "-");
			const header = `# ${user}\n\n> ${msgs.length} messages\n\n---\n\n`;
			await Bun.write(
				resolve(userDir, `${safeName}.md`),
				header + msgs.map(formatItem).join(""),
			);
		}

		// by-date
		const dateDir = resolve(slackDir, "messages/by-date");
		await mkdir(dateDir, { recursive: true });
		for (const [date, msgs] of byDate) {
			const header = `# ${date}\n\n> ${msgs.length} messages\n\n---\n\n`;
			await Bun.write(
				resolve(dateDir, `${date}.md`),
				header + msgs.map(formatItem).join(""),
			);
		}
	}

	// Files
	if (files.length > 0) {
		const filesDir = resolve(slackDir, "files/documents");
		await mkdir(filesDir, { recursive: true });
		const header = `# Slack Files\n\n> ${files.length} files\n\n---\n\n`;
		await Bun.write(
			resolve(filesDir, "files.md"),
			header + files.map(formatItem).join(""),
		);
	}

	if (images.length > 0) {
		const imagesDir = resolve(slackDir, "files/images");
		await mkdir(imagesDir, { recursive: true });
		const header = `# Slack Images\n\n> ${images.length} images\n\n---\n\n`;
		await Bun.write(
			resolve(imagesDir, "images.md"),
			header + images.map(formatItem).join(""),
		);
	}

	if (canvases.length > 0) {
		const canvasDir = resolve(slackDir, "files/canvases");
		await mkdir(canvasDir, { recursive: true });
		const header = `# Slack Canvases\n\n> ${canvases.length} canvases\n\n---\n\n`;
		await Bun.write(
			resolve(canvasDir, "canvases.md"),
			header + canvases.map(formatItem).join(""),
		);
	}

	// Pins
	if (pins.length > 0) {
		const pinsDir = resolve(slackDir, "pins");
		await mkdir(pinsDir, { recursive: true });
		const header = `# Slack Pinned Items\n\n> ${pins.length} pins\n\n---\n\n`;
		await Bun.write(
			resolve(pinsDir, "pins.md"),
			header + pins.map(formatItem).join(""),
		);
	}

	// Bookmarks
	if (bookmarks.length > 0) {
		const bookmarksDir = resolve(slackDir, "bookmarks");
		await mkdir(bookmarksDir, { recursive: true });
		const header = `# Slack Bookmarks\n\n> ${bookmarks.length} bookmarks\n\n---\n\n`;
		await Bun.write(
			resolve(bookmarksDir, "bookmarks.md"),
			header + bookmarks.map(formatItem).join(""),
		);
	}

	// Index file with TOC
	const channelSet = new Set(
		messages.map((m) => (m.metadata.channel as string) ?? "unknown"),
	);
	const userSet = new Set(messages.map((m) => m.author ?? "unknown"));
	const dateSet = new Set(messages.map((m) => m.timestamp.split("T")[0]));

	const indexLines = [
		"# Slack Compilation Index",
		"",
		`> Compiled on ${new Date().toLocaleDateString()}`,
		"",
		"## Summary",
		"",
		`- **Messages:** ${messages.length}`,
		`- **Files:** ${files.length}`,
		`- **Images:** ${images.length}`,
		`- **Canvases:** ${canvases.length}`,
		`- **Pins:** ${pins.length}`,
		`- **Bookmarks:** ${bookmarks.length}`,
		"",
		`## Channels (${channelSet.size})`,
		"",
		...[...channelSet].sort().map((ch) => `- #${ch}`),
		"",
		`## Users (${userSet.size})`,
		"",
		...[...userSet].sort().map((u) => `- ${u}`),
		"",
		`## Dates (${dateSet.size})`,
		"",
		...[...dateSet].sort().map((d) => `- ${d}`),
		"",
	];

	await mkdir(slackDir, { recursive: true });
	await Bun.write(resolve(slackDir, "_index.md"), indexLines.join("\n"));
}

export async function writeGranolaGranularOutput(
	items: CompilationItem[],
): Promise<void> {
	if (items.length === 0) return;

	const granolaDir = resolve(OUTPUT_DIR, "granola");

	// By date
	const byDate = new Map<string, CompilationItem[]>();
	for (const item of items) {
		const date = item.timestamp.split("T")[0];
		const list = byDate.get(date) ?? [];
		list.push(item);
		byDate.set(date, list);
	}

	const dateDir = resolve(granolaDir, "by-date");
	await mkdir(dateDir, { recursive: true });
	for (const [date, dateItems] of byDate) {
		const header = `# Granola Transcripts — ${date}\n\n> ${dateItems.length} meeting(s)\n\n---\n\n`;
		await Bun.write(
			resolve(dateDir, `${date}.md`),
			header + dateItems.map(formatItem).join(""),
		);
	}

	// By meeting (each meeting gets its own file)
	const meetingsDir = resolve(granolaDir, "by-meeting");
	await mkdir(meetingsDir, { recursive: true });
	for (const item of items) {
		const safeName = (item.title || "untitled")
			.replace(/[^a-zA-Z0-9_-]/g, "-")
			.replace(/-+/g, "-")
			.substring(0, 80);
		const date = item.timestamp.split("T")[0];
		const header = `# ${item.title}\n\n**Date:** ${date}\n**Attendees:** ${item.author ?? "Unknown"}\n\n---\n\n`;
		await Bun.write(
			resolve(meetingsDir, `${date}-${safeName}.md`),
			header + item.content,
		);
	}

	// Index
	const indexLines = [
		"# Granola Compilation Index",
		"",
		`> Compiled on ${new Date().toLocaleDateString()}`,
		"",
		"## Summary",
		"",
		`- **Transcripts:** ${items.length}`,
		`- **Date range:** ${[...byDate.keys()].sort().join(", ")}`,
		"",
		"## Meetings",
		"",
		...items.map(
			(item) =>
				`- **${item.title}** (${item.timestamp.split("T")[0]}) — ${item.author ?? "Unknown"}`,
		),
		"",
	];

	await Bun.write(resolve(granolaDir, "_index.md"), indexLines.join("\n"));
}

export async function writeFigmaGranularOutput(
	items: CompilationItem[],
): Promise<void> {
	if (items.length === 0) return;

	const figmaDir = resolve(OUTPUT_DIR, "figma");

	const textItems = items.filter((i) => i.metadata.type === "text");
	const commentItems = items.filter((i) => i.metadata.type === "comment");
	const screenshotItems = items.filter(
		(i) => i.metadata.type === "screenshots",
	);

	// Text by page
	if (textItems.length > 0) {
		const textDir = resolve(figmaDir, "text");
		await mkdir(textDir, { recursive: true });
		for (const item of textItems) {
			const pageName = (item.metadata.pageName as string) ?? "unknown";
			const safeName = pageName
				.replace(/[^a-zA-Z0-9_-]/g, "-")
				.replace(/-+/g, "-")
				.substring(0, 60);
			const header = `# ${item.title}\n\n> ${item.metadata.textCount} text layers\n\n---\n\n`;
			await Bun.write(
				resolve(textDir, `${safeName}.md`),
				header + item.content,
			);
		}
	}

	// Comments
	if (commentItems.length > 0) {
		const commentsDir = resolve(figmaDir, "comments");
		await mkdir(commentsDir, { recursive: true });
		const header = `# Figma Comments\n\n> ${commentItems.length} threads\n\n---\n\n`;
		await Bun.write(
			resolve(commentsDir, "comments.md"),
			header + commentItems.map(formatItem).join(""),
		);
	}

	// Screenshots index
	if (screenshotItems.length > 0) {
		const screenshotsDir = resolve(figmaDir, "screenshots");
		await mkdir(screenshotsDir, { recursive: true });
		const header = "# Figma Screenshots\n\n---\n\n";
		await Bun.write(
			resolve(screenshotsDir, "_index.md"),
			header + screenshotItems.map(formatItem).join(""),
		);
	}

	// Index
	const indexLines = [
		"# Figma Compilation Index",
		"",
		`> Compiled on ${new Date().toLocaleDateString()}`,
		"",
		"## Summary",
		"",
		`- **Text pages:** ${textItems.length}`,
		`- **Comment threads:** ${commentItems.length}`,
		`- **Screenshot sets:** ${screenshotItems.length}`,
		"",
	];

	await mkdir(figmaDir, { recursive: true });
	await Bun.write(resolve(figmaDir, "_index.md"), indexLines.join("\n"));
}

export async function writeGmailGranularOutput(
	items: CompilationItem[],
): Promise<void> {
	if (items.length === 0) return;

	const gmailDir = resolve(OUTPUT_DIR, "gmail");

	// By date
	const byDate = new Map<string, CompilationItem[]>();
	const bySender = new Map<string, CompilationItem[]>();

	for (const item of items) {
		const date = item.timestamp.split("T")[0];
		const dateList = byDate.get(date) ?? [];
		dateList.push(item);
		byDate.set(date, dateList);

		const sender = item.author ?? "unknown";
		const senderList = bySender.get(sender) ?? [];
		senderList.push(item);
		bySender.set(sender, senderList);
	}

	// by-date
	const dateDir = resolve(gmailDir, "by-date");
	await mkdir(dateDir, { recursive: true });
	for (const [date, dateItems] of byDate) {
		const header = `# Gmail — ${date}\n\n> ${dateItems.length} email(s)\n\n---\n\n`;
		await Bun.write(
			resolve(dateDir, `${date}.md`),
			header + dateItems.map(formatItem).join(""),
		);
	}

	// by-sender
	const senderDir = resolve(gmailDir, "by-sender");
	await mkdir(senderDir, { recursive: true });
	for (const [sender, senderItems] of bySender) {
		const safeName = sender
			.replace(/[^a-zA-Z0-9_@.-]/g, "-")
			.replace(/-+/g, "-")
			.substring(0, 80);
		const header = `# ${sender}\n\n> ${senderItems.length} email(s)\n\n---\n\n`;
		await Bun.write(
			resolve(senderDir, `${safeName}.md`),
			header + senderItems.map(formatItem).join(""),
		);
	}

	// Index
	const indexLines = [
		"# Gmail Compilation Index",
		"",
		`> Compiled on ${new Date().toLocaleDateString()}`,
		"",
		"## Summary",
		"",
		`- **Emails:** ${items.length}`,
		`- **Dates:** ${byDate.size}`,
		`- **Senders:** ${bySender.size}`,
		"",
		"## By Date",
		"",
		...[...byDate.entries()]
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([date, msgs]) => `- ${date} (${msgs.length} emails)`),
		"",
		"## By Sender",
		"",
		...[...bySender.entries()]
			.sort(([, a], [, b]) => b.length - a.length)
			.map(([sender, msgs]) => `- ${sender} (${msgs.length} emails)`),
		"",
	];

	await Bun.write(resolve(gmailDir, "_index.md"), indexLines.join("\n"));
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
