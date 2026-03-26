import { appendFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import type {
	CompilationItem,
	FigmaFilterConfig,
	SourceHealthCheck,
} from "../types.js";

const FIGMA_API = "https://api.figma.com/v1";
const OUTPUT_DIR = resolve(import.meta.dir, "../../../../output");
const ERROR_LOG = resolve(OUTPUT_DIR, "figma/errors.log");

async function logError(message: string): Promise<void> {
	const timestamp = new Date().toISOString();
	const line = `[${timestamp}] ${message}\n`;
	console.log(`  ERROR: ${message}`);
	try {
		await mkdir(resolve(OUTPUT_DIR, "figma"), { recursive: true });
		await appendFile(ERROR_LOG, line);
	} catch {
		// ignore log write failures
	}
}

function getAccessToken(): string {
	const token = process.env.FIGMA_ACCESS_TOKEN;
	if (!token) throw new Error("FIGMA_ACCESS_TOKEN not set");
	return token;
}

function parseFileKey(urlOrKey: string): string {
	// Accept full URLs or just file keys
	const match = urlOrKey.match(/figma\.com\/(?:file|design)\/([a-zA-Z0-9]+)/);
	return match ? match[1] : urlOrKey;
}

// --- Figma API types based on actual responses ---

interface FigmaUser {
	id: string;
	handle: string;
	img_url: string;
}

interface FigmaNode {
	id: string;
	name: string;
	type: string;
	children?: FigmaNode[];
	characters?: string; // TEXT nodes only
	absoluteBoundingBox?: {
		x: number;
		y: number;
		width: number;
		height: number;
	};
}

interface FigmaFileResponse {
	document: FigmaNode;
	name: string;
	lastModified: string;
	version: string;
}

interface FigmaFileMetaResponse {
	file: {
		name: string;
		folder_name: string;
		last_touched_at: string;
		creator: FigmaUser;
		last_touched_by: FigmaUser;
		thumbnail_url: string;
		editorType: string;
		version: string;
		url: string;
		role: string;
	};
}

interface FigmaComment {
	id: string;
	uuid: string;
	file_key: string;
	parent_id: string;
	user: FigmaUser;
	created_at: string;
	resolved_at: string | null;
	message: string;
	reactions: Array<{ emoji: string; user: FigmaUser }>;
	client_meta: {
		node_id?: string;
		node_offset?: { x: number; y: number };
	};
	order_id: string;
}

interface FigmaCommentsResponse {
	comments: FigmaComment[];
}

interface FigmaImagesResponse {
	err: string | null;
	images: Record<string, string | null>;
}

interface FigmaNodesResponse {
	nodes: Record<string, { document: FigmaNode }>;
}

// --- Rate-limited API client ---

let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 2000; // ~30 req/min, back off on 429

async function figmaApi<T>(path: string, timeoutMs = 120_000): Promise<T> {
	const now = Date.now();
	const elapsed = now - lastRequestTime;
	if (elapsed < MIN_REQUEST_INTERVAL) {
		await new Promise((r) => setTimeout(r, MIN_REQUEST_INTERVAL - elapsed));
	}
	lastRequestTime = Date.now();

	const token = getAccessToken();
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);

	try {
		const res = await fetch(`${FIGMA_API}${path}`, {
			headers: { "X-Figma-Token": token },
			signal: controller.signal,
		});

		if (res.status === 429) {
			await logError("Rate limited by Figma API, waiting 60s...");
			await new Promise((r) => setTimeout(r, 60_000));
			return figmaApi<T>(path, timeoutMs);
		}

		if (!res.ok) {
			throw new Error(
				`Figma API ${path} HTTP ${res.status}: ${res.statusText}`,
			);
		}

		return res.json() as Promise<T>;
	} finally {
		clearTimeout(timeout);
	}
}

// --- Node tree walking ---

function collectTextNodes(node: FigmaNode): string[] {
	const texts: string[] = [];
	if (node.type === "TEXT" && node.characters) {
		const text = node.characters.trim();
		// Skip SF Symbol glyphs (single chars in private use area)
		if (text && text.length > 1) {
			texts.push(text);
		}
	}
	if (node.children) {
		for (const child of node.children) {
			texts.push(...collectTextNodes(child));
		}
	}
	return texts;
}

function collectTopLevelNodeIds(
	node: FigmaNode,
): { id: string; name: string; type: string }[] {
	const nodes: { id: string; name: string; type: string }[] = [];
	if (node.children) {
		for (const child of node.children) {
			if (
				child.type === "FRAME" ||
				child.type === "SECTION" ||
				child.type === "GROUP" ||
				child.type === "COMPONENT" ||
				child.type === "COMPONENT_SET"
			) {
				nodes.push({ id: child.id, name: child.name, type: child.type });
			}
		}
	}
	return nodes;
}

// --- Main compilation ---

async function fetchFileText(
	fileKey: string,
): Promise<{ pages: { name: string; id: string; texts: string[] }[] }> {
	// Get full file at unlimited depth to find all text nodes
	console.log("Figma: fetching file tree (full depth)...");
	const file = await figmaApi<FigmaFileResponse>(`/files/${fileKey}?depth=999`);

	const pages: { name: string; id: string; texts: string[] }[] = [];
	for (const page of file.document.children ?? []) {
		if (page.type !== "CANVAS") continue;
		// For each page, we need the full node tree to get TEXT nodes
		// The file endpoint at depth=999 should include them
		const texts = collectTextNodes(page);
		console.log(`  Page "${page.name}": ${texts.length} text nodes`);
		pages.push({ name: page.name, id: page.id, texts });
	}

	return { pages };
}

async function fetchFileTextViaNodes(
	fileKey: string,
	pageIds: string[],
): Promise<{ name: string; id: string; texts: string[] }[]> {
	// Use nodes endpoint for full depth per page
	const results: { name: string; id: string; texts: string[] }[] = [];

	for (let i = 0; i < pageIds.length; i++) {
		const pageId = pageIds[i];
		console.log(
			`Figma: fetching page ${i + 1}/${pageIds.length} (${pageId})...`,
		);
		const data = await figmaApi<FigmaNodesResponse>(
			`/files/${fileKey}/nodes?ids=${encodeURIComponent(pageId)}`,
			180_000, // 3 min timeout for large pages
		);

		const nodeData = data.nodes[pageId];
		if (!nodeData) continue;

		const texts = collectTextNodes(nodeData.document);
		console.log(
			`  Page "${nodeData.document.name}": ${texts.length} text nodes`,
		);
		results.push({
			name: nodeData.document.name,
			id: pageId,
			texts,
		});
	}

	return results;
}

async function fetchComments(fileKey: string): Promise<FigmaComment[]> {
	console.log("Figma: fetching comments...");
	const data = await figmaApi<FigmaCommentsResponse>(
		`/files/${fileKey}/comments`,
	);
	console.log(`  ${data.comments.length} comments found`);
	return data.comments;
}

async function fetchAndSaveScreenshots(
	fileKey: string,
	nodeIds: { id: string; name: string }[],
	fileLabel: string,
): Promise<string[]> {
	if (nodeIds.length === 0) return [];

	const screenshotsDir = resolve(OUTPUT_DIR, "figma/screenshots");
	await mkdir(screenshotsDir, { recursive: true });

	const savedPaths: string[] = [];

	// Export one node at a time — batching causes 400s when any node is too large
	for (let i = 0; i < nodeIds.length; i++) {
		const node = nodeIds[i];
		console.log(
			`Figma: screenshot ${i + 1}/${nodeIds.length} "${node.name}"...`,
		);

		let data: FigmaImagesResponse;
		try {
			data = await figmaApi<FigmaImagesResponse>(
				`/images/${fileKey}?ids=${encodeURIComponent(node.id)}&format=png&scale=1`,
			);
		} catch (err) {
			await logError(
				`Screenshot export failed for "${node.name}" (${node.id}): ${err instanceof Error ? err.message : err}`,
			);
			continue;
		}

		if (data.err) {
			await logError(
				`Screenshot export error for "${node.name}" (${node.id}): ${data.err}`,
			);
			continue;
		}

		const imageUrl = data.images[node.id];
		if (!imageUrl) {
			await logError(`No image URL returned for "${node.name}" (${node.id})`);
			continue;
		}

		try {
			const imgRes = await fetch(imageUrl);
			if (!imgRes.ok) {
				await logError(
					`Screenshot download failed for "${node.name}" (${node.id}) HTTP ${imgRes.status}`,
				);
				continue;
			}
			const buffer = Buffer.from(await imgRes.arrayBuffer());

			const safeName = node.name
				.replace(/[^a-zA-Z0-9_-]/g, "-")
				.replace(/-+/g, "-")
				.substring(0, 60);
			const safeId = node.id.replace(":", "-");
			const outPath = resolve(
				screenshotsDir,
				`${fileLabel}-${safeId}-${safeName}.png`,
			);

			await Bun.write(outPath, buffer);
			savedPaths.push(outPath);
			console.log(
				`  Saved "${node.name}" (${(buffer.length / 1024).toFixed(0)}KB)`,
			);
		} catch (err) {
			await logError(
				`Screenshot save failed for "${node.name}" (${node.id}): ${err instanceof Error ? err.message : err}`,
			);
		}
	}

	return savedPaths;
}

export async function compileFigma(
	config: FigmaFilterConfig,
): Promise<CompilationItem[]> {
	const items: CompilationItem[] = [];
	const includeText = config.includeText !== false;
	const includeComments = config.includeComments !== false;
	const includeScreenshots = config.includeScreenshots !== false;

	// Clear and start error log
	await mkdir(resolve(OUTPUT_DIR, "figma"), { recursive: true });
	await Bun.write(
		ERROR_LOG,
		`Figma compilation started at ${new Date().toISOString()}\nFiles: ${config.fileUrls.join(", ")}\n\n`,
	);

	for (const url of config.fileUrls) {
		const fileKey = parseFileKey(url);
		console.log(`Figma: processing file ${fileKey}...`);

		// Get file metadata
		const meta = await figmaApi<FigmaFileMetaResponse>(
			`/files/${fileKey}/meta`,
		);
		const fileName = meta.file.name;
		const fileUrl = meta.file.url;
		console.log(`  File: "${fileName}" by ${meta.file.creator.handle}`);

		// Get page structure (depth 2 for top-level frames)
		const structure = await figmaApi<FigmaFileResponse>(
			`/files/${fileKey}?depth=2`,
		);
		const pages =
			structure.document.children?.filter((c) => c.type === "CANVAS") ?? [];

		// Extract text from each page via nodes endpoint (full depth)
		if (includeText) {
			const pageResults = await fetchFileTextViaNodes(
				fileKey,
				pages.map((p) => p.id),
			);

			for (const page of pageResults) {
				if (page.texts.length === 0) continue;

				// Deduplicate texts
				const uniqueTexts = [...new Set(page.texts)];
				const content = uniqueTexts.join("\n");

				items.push({
					source: "figma",
					externalId: `${fileKey}-text-${page.id}`,
					title: `${fileName} — ${page.name} (Text)`,
					content,
					author: meta.file.creator.handle,
					sourceUrl: `${fileUrl}?node-id=${encodeURIComponent(page.id)}`,
					timestamp: meta.file.last_touched_at,
					metadata: {
						type: "text",
						fileKey,
						fileName,
						pageName: page.name,
						pageId: page.id,
						textCount: uniqueTexts.length,
					},
				});
			}
		}

		// Fetch comments
		if (includeComments) {
			const comments = await fetchComments(fileKey);

			// Group by thread (parent_id)
			const threads = new Map<string, FigmaComment[]>();
			for (const c of comments) {
				const key = c.parent_id || c.id;
				const list = threads.get(key) ?? [];
				list.push(c);
				threads.set(key, list);
			}

			for (const [threadId, threadComments] of threads) {
				// Sort by created_at
				threadComments.sort(
					(a, b) =>
						new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
				);

				const root = threadComments[0];
				const lines: string[] = [];
				for (const c of threadComments) {
					const date = new Date(c.created_at).toLocaleDateString("en-US", {
						year: "numeric",
						month: "long",
						day: "numeric",
						hour: "2-digit",
						minute: "2-digit",
					});
					const resolved = c.resolved_at ? " [RESOLVED]" : "";
					lines.push(`**${c.user.handle}** (${date})${resolved}`);
					lines.push(c.message);
					lines.push("");
				}

				const nodeId = root.client_meta?.node_id;

				items.push({
					source: "figma",
					externalId: `${fileKey}-comment-${threadId}`,
					title: `${fileName} — Comment by ${root.user.handle}`,
					content: lines.join("\n").trim(),
					author: root.user.handle,
					sourceUrl: nodeId
						? `${fileUrl}?node-id=${encodeURIComponent(nodeId)}`
						: fileUrl,
					timestamp: root.created_at,
					metadata: {
						type: "comment",
						fileKey,
						fileName,
						threadId,
						nodeId,
						replyCount: threadComments.length - 1,
						resolved: !!root.resolved_at,
					},
				});
			}
		}

		// Export screenshots of top-level frames/sections per page
		if (includeScreenshots) {
			const allFrameNodes: { id: string; name: string }[] = [];
			for (const page of pages) {
				const topLevel = collectTopLevelNodeIds(page);
				for (const node of topLevel) {
					allFrameNodes.push({
						id: node.id,
						name: `${page.name} - ${node.name}`,
					});
				}
			}

			console.log(`Figma: exporting ${allFrameNodes.length} screenshots...`);

			const safeFileLabel = fileName
				.replace(/[^a-zA-Z0-9_-]/g, "-")
				.substring(0, 30);
			const screenshotPaths = await fetchAndSaveScreenshots(
				fileKey,
				allFrameNodes,
				safeFileLabel,
			);

			if (screenshotPaths.length > 0) {
				const content = screenshotPaths.map((p) => `- ${p}`).join("\n");

				items.push({
					source: "figma",
					externalId: `${fileKey}-screenshots`,
					title: `${fileName} — Screenshots (${screenshotPaths.length})`,
					content: `Exported ${screenshotPaths.length} screenshots:\n\n${content}`,
					author: meta.file.creator.handle,
					sourceUrl: fileUrl,
					timestamp: meta.file.last_touched_at,
					metadata: {
						type: "screenshots",
						fileKey,
						fileName,
						count: screenshotPaths.length,
						paths: screenshotPaths,
					},
				});
			}
		}
	}

	items.sort(
		(a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
	);

	console.log(`Figma: done — ${items.length} items total`);
	return items;
}

export async function checkFigmaHealth(): Promise<SourceHealthCheck> {
	const now = new Date().toISOString();

	if (!process.env.FIGMA_ACCESS_TOKEN) {
		return {
			source: "figma",
			status: "not_configured",
			message: "FIGMA_ACCESS_TOKEN not set",
			checkedAt: now,
		};
	}

	try {
		const res = await fetch(`${FIGMA_API}/me`, {
			headers: { "X-Figma-Token": process.env.FIGMA_ACCESS_TOKEN },
		});

		if (!res.ok) {
			return {
				source: "figma",
				status: "error",
				message: `Token invalid or expired (HTTP ${res.status})`,
				checkedAt: now,
			};
		}

		const data = (await res.json()) as { handle: string; email: string };
		return {
			source: "figma",
			status: "connected",
			message: `Authenticated as ${data.handle} (${data.email})`,
			checkedAt: now,
		};
	} catch (err) {
		return {
			source: "figma",
			status: "error",
			message: err instanceof Error ? err.message : String(err),
			checkedAt: now,
		};
	}
}
