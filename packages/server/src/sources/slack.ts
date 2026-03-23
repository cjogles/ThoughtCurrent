import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import type {
	CompilationItem,
	SlackFilterConfig,
	SourceHealthCheck,
} from "@thoughtcurrent/shared";
import {
	extractTextFromBuffer,
	extractVideoScreenshots,
} from "../lib/extract.js";

const OUTPUT_DIR = resolve(import.meta.dir, "../../../../output");

const SLACK_API = "https://slack.com/api";

interface SlackChannel {
	id: string;
	name: string;
	is_member: boolean;
	is_archived: boolean;
	is_im: boolean;
	is_mpim: boolean;
	num_members: number;
}

interface SlackMessage {
	type: string;
	ts: string;
	user?: string;
	text: string;
	thread_ts?: string;
	reply_count?: number;
	reactions?: Array<{ name: string; count: number }>;
	files?: Array<{ id: string; name: string; url_private: string }>;
	attachments?: Array<{ fallback?: string }>;
}

interface SlackUser {
	id: string;
	real_name: string;
	name: string;
}

interface SlackFile {
	id: string;
	name: string;
	title: string;
	mimetype: string;
	filetype: string;
	user: string;
	timestamp: number;
	url_private: string;
	channels: string[];
	size: number;
}

// User token for compilation (sees everything you see), bot token as fallback
export function getUserToken(): string | null {
	return process.env.SLACK_USER_TOKEN ?? null;
}

export function getBotToken(): string | null {
	return process.env.SLACK_BOT_TOKEN ?? null;
}

function getToken(): string {
	const token = getUserToken() ?? getBotToken();
	if (!token) {
		throw new Error(
			"Neither SLACK_USER_TOKEN nor SLACK_BOT_TOKEN is set. Set at least one.",
		);
	}
	return token;
}

const MAX_RETRIES = 3;

export async function slackApi<T>(
	method: string,
	params: Record<string, string> = {},
	tokenOverride?: string,
): Promise<T> {
	const token = tokenOverride ?? getToken();
	const url = new URL(`${SLACK_API}/${method}`);
	for (const [k, v] of Object.entries(params)) {
		url.searchParams.set(k, v);
	}

	for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
		const res = await fetch(url.toString(), {
			headers: { Authorization: `Bearer ${token}` },
		});

		if (res.status === 429) {
			const retryAfter = Number(res.headers.get("Retry-After") ?? "5");
			console.log(
				`Slack rate limited on ${method}, waiting ${retryAfter}s (attempt ${attempt + 1}/${MAX_RETRIES + 1})`,
			);
			await new Promise((r) => setTimeout(r, retryAfter * 1000));
			continue;
		}

		if (!res.ok) {
			throw new Error(
				`Slack API ${method} HTTP ${res.status}: ${res.statusText}`,
			);
		}

		const data = (await res.json()) as {
			ok: boolean;
			error?: string;
		} & T;

		if (!data.ok && data.error === "ratelimited") {
			console.log(
				`Slack rate limited on ${method} (body), waiting 5s (attempt ${attempt + 1}/${MAX_RETRIES + 1})`,
			);
			await new Promise((r) => setTimeout(r, 5000));
			continue;
		}

		if (!data.ok) {
			throw new Error(`Slack API ${method} error: ${data.error}`);
		}

		return data;
	}

	throw new Error(
		`Slack API ${method} rate limited after ${MAX_RETRIES + 1} attempts`,
	);
}

// Cache user lookups within a single compilation run
const userCache = new Map<string, string>();

export async function resolveUser(userId: string): Promise<string> {
	if (userCache.has(userId)) {
		return userCache.get(userId) as string;
	}

	try {
		const data = await slackApi<{ user: SlackUser }>("users.info", {
			user: userId,
		});
		const name = data.user.real_name || data.user.name;
		userCache.set(userId, name);
		return name;
	} catch {
		userCache.set(userId, userId);
		return userId;
	}
}

// Channel name cache for resolving IDs
const channelNameCache = new Map<string, string>();

async function resolveChannelName(channelId: string): Promise<string> {
	if (channelNameCache.has(channelId)) {
		return channelNameCache.get(channelId) as string;
	}
	try {
		const data = await slackApi<{
			channel: { name: string; is_im: boolean; user?: string };
		}>("conversations.info", { channel: channelId });
		let name = data.channel.name;
		if (data.channel.is_im && data.channel.user) {
			name = await resolveUser(data.channel.user);
		}
		channelNameCache.set(channelId, name);
		return name;
	} catch {
		channelNameCache.set(channelId, channelId);
		return channelId;
	}
}

async function fetchChannels(
	channelTypes = "public_channel,private_channel",
	channelFilter?: string[],
): Promise<SlackChannel[]> {
	const channels: SlackChannel[] = [];
	let cursor = "";

	do {
		const params: Record<string, string> = {
			types: channelTypes,
			exclude_archived: "true",
			limit: "200",
		};
		if (cursor) params.cursor = cursor;

		const botToken = getBotToken();
		const data = await slackApi<{
			channels: SlackChannel[];
			response_metadata?: { next_cursor?: string };
		}>("conversations.list", params, botToken ?? undefined);

		channels.push(...data.channels.filter((ch) => ch.is_member));
		cursor = data.response_metadata?.next_cursor ?? "";
	} while (cursor);

	if (channelFilter && channelFilter.length > 0) {
		const filterSet = new Set(channelFilter);
		return channels.filter((ch) => filterSet.has(ch.id));
	}

	return channels;
}

async function fetchMessages(
	channelId: string,
	oldest: string,
	latest: string,
): Promise<SlackMessage[]> {
	const messages: SlackMessage[] = [];
	let cursor = "";

	do {
		const params: Record<string, string> = {
			channel: channelId,
			oldest,
			latest,
			limit: "200",
			inclusive: "true",
		};
		if (cursor) params.cursor = cursor;

		const data = await slackApi<{
			messages: SlackMessage[];
			has_more: boolean;
			response_metadata?: { next_cursor?: string };
		}>("conversations.history", params);

		messages.push(...data.messages);
		cursor = data.response_metadata?.next_cursor ?? "";
	} while (cursor);

	return messages;
}

async function fetchThreadReplies(
	channelId: string,
	threadTs: string,
	oldest: string,
	latest: string,
): Promise<SlackMessage[]> {
	const params: Record<string, string> = {
		channel: channelId,
		ts: threadTs,
		oldest,
		latest,
		limit: "200",
		inclusive: "true",
	};

	const data = await slackApi<{
		messages: SlackMessage[];
	}>("conversations.replies", params);

	// First message in replies is the parent — skip it
	return data.messages.slice(1);
}

function matchesKeywords(
	text: string,
	keywords: string[] | undefined,
): boolean {
	if (!keywords || keywords.length === 0) return true;
	const lower = text.toLowerCase();
	return keywords.some((kw) => lower.includes(kw.toLowerCase()));
}

function matchesExactPhrases(
	text: string,
	phrases: string[] | undefined,
): boolean {
	if (!phrases || phrases.length === 0) return true;
	const lower = text.toLowerCase();
	return phrases.some((p) => lower.includes(p.toLowerCase()));
}

function matchesExclusions(
	text: string,
	exclusions: string[] | undefined,
): boolean {
	if (!exclusions || exclusions.length === 0) return true;
	const lower = text.toLowerCase();
	return !exclusions.some((ex) => lower.includes(ex.toLowerCase()));
}

function matchesHasFilters(
	msg: SlackMessage,
	hasFilters: string[] | undefined,
): boolean {
	if (!hasFilters || hasFilters.length === 0) return true;
	for (const f of hasFilters) {
		if (f === "reaction" && (!msg.reactions || msg.reactions.length === 0))
			return false;
		if (f === "file" && (!msg.files || msg.files.length === 0)) return false;
		if (f === "link" && !msg.text.includes("http")) return false;
		if (f === "pin") continue; // pins are fetched separately
	}
	return true;
}

async function downloadSlackFile(
	url: string,
	filename: string,
	fileId: string,
): Promise<{ buffer: Buffer; savedPath: string } | null> {
	try {
		const token = getToken();
		const res = await fetch(url, {
			headers: { Authorization: `Bearer ${token}` },
		});
		if (!res.ok) return null;

		const buffer = Buffer.from(await res.arrayBuffer());

		// Save to output/slack/files/downloads/ with fileId prefix to avoid collisions
		const downloadsDir = resolve(OUTPUT_DIR, "slack/files/downloads");
		await mkdir(downloadsDir, { recursive: true });
		const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "-");
		const uniqueName = `${fileId}-${safeName}`;
		const savedPath = resolve(downloadsDir, uniqueName);
		await Bun.write(savedPath, buffer);

		return { buffer, savedPath };
	} catch (err) {
		console.log(
			`Failed to download Slack file ${filename}: ${err instanceof Error ? err.message : err}`,
		);
		return null;
	}
}

async function fetchCanvasContent(canvasId: string): Promise<string | null> {
	try {
		// Try canvases.sections.lookup first
		const userToken = getUserToken();
		const token = userToken ?? getBotToken();
		if (!token) return null;

		const data = await slackApi<{
			sections: Array<{
				type: string;
				elements?: Array<{
					type: string;
					text?: string;
					elements?: Array<{ text?: string }>;
				}>;
			}>;
		}>("canvases.sections.lookup", { canvas_id: canvasId }, token);

		const textParts: string[] = [];
		for (const section of data.sections ?? []) {
			if (section.elements) {
				for (const el of section.elements) {
					if (el.text) textParts.push(el.text);
					if (el.elements) {
						for (const nested of el.elements) {
							if (nested.text) textParts.push(nested.text);
						}
					}
				}
			}
		}

		return textParts.length > 0 ? textParts.join("\n") : null;
	} catch {
		return null;
	}
}

async function fetchFileTranscript(fileId: string): Promise<string | null> {
	try {
		const data = await slackApi<{
			file: {
				transcription?: {
					status: string;
					locale?: string;
				};
			};
			content_html?: string;
		}>("files.info", { file: fileId });

		// Check if transcription exists and is complete
		if (data.file.transcription?.status === "complete") {
			// Fetch the actual transcript content
			const transcriptData = await slackApi<{
				content: string;
				content_html?: string;
			}>("files.completeUploadExternal", { file: fileId }).catch(() => null);
			if (transcriptData?.content) return transcriptData.content;
		}

		// Try fetching transcript via conversations (Slack stores transcript as a reply)
		// For audio clips, check if there's a vtt or text transcript
		return null;
	} catch {
		return null;
	}
}

function slackTsToIso(ts: string): string {
	return new Date(Number.parseFloat(ts) * 1000).toISOString();
}

function isoToSlackTs(iso: string): string {
	return (new Date(iso).getTime() / 1000).toFixed(6);
}

async function fetchFiles(
	config: SlackFilterConfig,
): Promise<CompilationItem[]> {
	const items: CompilationItem[] = [];
	const tsFrom = Math.floor(new Date(config.startDate).getTime() / 1000);
	const tsTo = Math.floor(new Date(config.endDate).getTime() / 1000);

	const params: Record<string, string> = {
		ts_from: tsFrom.toString(),
		ts_to: tsTo.toString(),
		count: "100",
	};

	// Map content types to Slack file types
	const types: string[] = [];
	if (config.contentTypes?.includes("images")) types.push("images");
	if (config.contentTypes?.includes("canvases")) types.push("docs");
	if (
		config.contentTypes?.includes("files") ||
		(!config.contentTypes?.includes("images") &&
			!config.contentTypes?.includes("canvases"))
	) {
		types.push("all");
	}
	if (types.length > 0 && !types.includes("all")) {
		params.types = types.join(",");
	}

	if (config.users?.length === 1) {
		params.user = config.users[0];
	}

	// files.list only accepts one channel at a time, so fetch per-channel
	// If no channels specified, fetch once without channel filter
	const channelIds = config.channels?.length ? config.channels : [undefined];
	const channelFilterSet = config.channels?.length
		? new Set(config.channels)
		: null;

	for (const channelId of channelIds) {
		const reqParams = { ...params };
		if (channelId) reqParams.channel = channelId;

		let page = 1;
		let totalPages = 1;

		do {
			reqParams.page = page.toString();
			const data = await slackApi<{
				files: SlackFile[];
				paging: { pages: number; page: number };
			}>("files.list", reqParams);

			for (const file of data.files) {
				// Skip files not in selected channels
				if (
					channelFilterSet &&
					!file.channels.some((ch) => channelFilterSet.has(ch))
				)
					continue;

				const author = file.user ? await resolveUser(file.user) : "Unknown";
				const channelName =
					file.channels.length > 0
						? await resolveChannelName(file.channels[0])
						: "unknown";

				const isImage = file.mimetype?.startsWith("image/");
				const isCanvas = file.filetype === "quip" || file.filetype === "canvas";
				const isVideo =
					file.mimetype?.startsWith("video/") ||
					["mp4", "mov", "webm", "avi"].includes(file.filetype);
				const isAudio =
					file.mimetype?.startsWith("audio/") ||
					["m4a", "mp3", "wav", "ogg", "aac"].includes(file.filetype);

				let extractedText: string | null = null;
				let savedPath: string | null = null;
				const screenshotPaths: string[] = [];

				if (isCanvas) {
					extractedText = await fetchCanvasContent(file.id);
				}

				// Download the file
				if (file.url_private) {
					const downloaded = await downloadSlackFile(
						file.url_private,
						file.name,
						file.id,
					);
					if (downloaded) {
						savedPath = downloaded.savedPath;

						if (isVideo) {
							// Extract screenshots from video
							const screenshotsDir = resolve(
								OUTPUT_DIR,
								"slack/files/screenshots",
							);
							const shots = await extractVideoScreenshots(
								downloaded.savedPath,
								screenshotsDir,
								file.id,
							);
							screenshotPaths.push(...shots);

							// Try Slack transcript
							const transcript = await fetchFileTranscript(file.id);
							if (transcript) extractedText = transcript;
						} else if (isAudio) {
							// Try Slack transcript for audio
							const transcript = await fetchFileTranscript(file.id);
							if (transcript) extractedText = transcript;
						} else if (!isImage) {
							// Extract text from documents
							if (!extractedText) {
								extractedText = await extractTextFromBuffer(
									downloaded.buffer,
									file.filetype,
									file.mimetype,
								);
							}
						}
					}
				}

				const label = isImage
					? "Image"
					: isCanvas
						? "Canvas"
						: isVideo
							? "Video"
							: isAudio
								? "Audio"
								: "File";
				const contentParts = [
					`[${label}] ${file.title || file.name}`,
					`Type: ${file.filetype}`,
					`Size: ${file.size} bytes`,
					`URL: ${file.url_private}`,
				];
				if (savedPath) {
					contentParts.push(`Downloaded: ${savedPath}`);
				}
				if (screenshotPaths.length > 0) {
					contentParts.push(
						`Screenshots: ${screenshotPaths.length} frames captured`,
					);
					for (const sp of screenshotPaths) {
						contentParts.push(`  - ${sp}`);
					}
				}
				if (extractedText) {
					contentParts.push("", "--- Extracted Content ---", "", extractedText);
				}

				const metaType = isImage
					? "image"
					: isCanvas
						? "canvas"
						: isVideo
							? "video"
							: isAudio
								? "audio"
								: "file";

				items.push({
					source: "slack",
					externalId: `file-${file.id}`,
					title: file.title || file.name,
					content: contentParts.join("\n"),
					author,
					sourceUrl: file.url_private,
					timestamp: new Date(file.timestamp * 1000).toISOString(),
					metadata: {
						type: metaType,
						channel: channelName,
						filetype: file.filetype,
						mimetype: file.mimetype,
						size: file.size,
						savedPath,
						screenshotPaths:
							screenshotPaths.length > 0 ? screenshotPaths : undefined,
						hasExtractedText: !!extractedText,
					},
				});
			}

			totalPages = data.paging.pages;
			page++;
		} while (page <= totalPages);
	}

	return items;
}

async function fetchPins(channelIds: string[]): Promise<CompilationItem[]> {
	const items: CompilationItem[] = [];

	for (const channelId of channelIds) {
		try {
			const data = await slackApi<{
				items: Array<{
					type: string;
					message?: SlackMessage;
					channel: string;
					created: number;
					created_by: string;
				}>;
			}>("pins.list", { channel: channelId });

			const channelName = await resolveChannelName(channelId);

			for (const pin of data.items) {
				if (pin.type !== "message" || !pin.message) continue;
				const author = pin.message.user
					? await resolveUser(pin.message.user)
					: "Unknown";

				items.push({
					source: "slack",
					externalId: `pin-${channelId}-${pin.message.ts}`,
					title: `Pinned in #${channelName}`,
					content: pin.message.text,
					author,
					sourceUrl: null,
					timestamp: new Date(pin.created * 1000).toISOString(),
					metadata: {
						type: "pin",
						channel: channelName,
						channelId,
						pinnedBy: pin.created_by,
					},
				});
			}
		} catch {
			// Skip channels where pins.list fails
		}
	}

	return items;
}

async function fetchBookmarks(
	channelIds: string[],
): Promise<CompilationItem[]> {
	const items: CompilationItem[] = [];

	for (const channelId of channelIds) {
		try {
			const data = await slackApi<{
				bookmarks: Array<{
					id: string;
					title: string;
					link: string;
					type: string;
					created: number;
					updated: number;
				}>;
			}>("bookmarks.list", { channel_id: channelId });

			const channelName = await resolveChannelName(channelId);

			for (const bm of data.bookmarks) {
				items.push({
					source: "slack",
					externalId: `bookmark-${bm.id}`,
					title: `Bookmark: ${bm.title}`,
					content: `${bm.title}\nLink: ${bm.link}`,
					author: null,
					sourceUrl: bm.link,
					timestamp: new Date(bm.created * 1000).toISOString(),
					metadata: {
						type: "bookmark",
						channel: channelName,
						channelId,
						bookmarkType: bm.type,
					},
				});
			}
		} catch {
			// Skip channels where bookmarks.list fails
		}
	}

	return items;
}

async function searchMessages(
	config: SlackFilterConfig,
): Promise<CompilationItem[]> {
	const userToken = getUserToken();
	if (!userToken) return [];

	const items: CompilationItem[] = [];
	const queryParts: string[] = [];

	if (config.searchQuery) {
		queryParts.push(config.searchQuery);
	}

	if (config.keywords?.length) {
		queryParts.push(config.keywords.join(" "));
	}

	if (config.exactPhrases?.length) {
		for (const phrase of config.exactPhrases) {
			queryParts.push(`"${phrase}"`);
		}
	}

	if (config.exclusions?.length) {
		for (const ex of config.exclusions) {
			queryParts.push(`-${ex}`);
		}
	}

	if (config.hasFilters?.length) {
		for (const f of config.hasFilters) {
			queryParts.push(`has:${f}`);
		}
	}

	// Date range
	const afterDate = config.startDate.split("T")[0];
	const beforeDate = config.endDate.split("T")[0];
	queryParts.push(`after:${afterDate}`);
	queryParts.push(`before:${beforeDate}`);

	// Channel filters
	if (config.channels?.length) {
		for (const chId of config.channels) {
			const name = await resolveChannelName(chId);
			queryParts.push(`in:#${name}`);
		}
	}

	// User filters
	if (config.users?.length) {
		for (const userId of config.users) {
			const name = await resolveUser(userId);
			queryParts.push(`from:@${name}`);
		}
	}

	const query = queryParts.join(" ");
	if (!query.trim()) return [];

	let page = 1;
	let totalPages = 1;

	do {
		const data = await slackApi<{
			messages: {
				matches: Array<{
					ts: string;
					text: string;
					user: string;
					channel: { id: string; name: string };
					permalink: string;
				}>;
				paging: { pages: number; page: number };
			};
		}>(
			"search.messages",
			{ query, page: page.toString(), count: "100" },
			userToken,
		);

		for (const match of data.messages.matches) {
			const author = match.user ? await resolveUser(match.user) : "Unknown";

			items.push({
				source: "slack",
				externalId: `search-${match.channel.id}-${match.ts}`,
				title: `#${match.channel.name}`,
				content: match.text,
				author,
				sourceUrl: match.permalink,
				timestamp: slackTsToIso(match.ts),
				metadata: {
					type: "search_result",
					channel: match.channel.name,
					channelId: match.channel.id,
				},
			});
		}

		totalPages = data.messages.paging.pages;
		page++;
	} while (page <= totalPages && page <= 10); // Cap at 10 pages

	return items;
}

async function compileChannelBased(
	config: SlackFilterConfig,
): Promise<CompilationItem[]> {
	const items: CompilationItem[] = [];
	const oldest = isoToSlackTs(config.startDate);
	const latest = isoToSlackTs(config.endDate);

	const channelTypes = "public_channel,private_channel,im,mpim";
	const channels = await fetchChannels(channelTypes, config.channels);
	const userFilterSet = config.users?.length ? new Set(config.users) : null;

	for (const channel of channels) {
		const isDm = channel.is_im || channel.is_mpim;
		// For DMs: use dmKeywords if provided, otherwise fall back to general keywords
		// For channels: use general keywords (if any), but typically left empty to get everything
		const effectiveKeywords = isDm
			? (config.dmKeywords ?? config.keywords)
			: config.keywords;

		const messages = await fetchMessages(channel.id, oldest, latest);

		for (const msg of messages) {
			if (!msg.text || msg.type !== "message") continue;
			if (userFilterSet && msg.user && !userFilterSet.has(msg.user)) continue;
			if (!matchesKeywords(msg.text, effectiveKeywords)) continue;
			if (!matchesExactPhrases(msg.text, config.exactPhrases)) continue;
			if (!matchesExclusions(msg.text, config.exclusions)) continue;
			if (!matchesHasFilters(msg, config.hasFilters)) continue;

			const author = msg.user ? await resolveUser(msg.user) : "Unknown";
			const timestamp = slackTsToIso(msg.ts);

			items.push({
				source: "slack",
				externalId: `${channel.id}-${msg.ts}`,
				title: `#${channel.name}`,
				content: msg.text,
				author,
				sourceUrl: null,
				timestamp,
				metadata: {
					type: "message",
					channel: channel.name,
					channelId: channel.id,
					hasThread: (msg.reply_count ?? 0) > 0,
					replyCount: msg.reply_count ?? 0,
				},
			});

			// Fetch thread replies if present
			if (msg.reply_count && msg.reply_count > 0 && msg.thread_ts) {
				try {
					const replies = await fetchThreadReplies(
						channel.id,
						msg.thread_ts,
						oldest,
						latest,
					);

					for (const reply of replies) {
						if (!reply.text) continue;
						if (userFilterSet && reply.user && !userFilterSet.has(reply.user))
							continue;
						if (!matchesKeywords(reply.text, effectiveKeywords)) continue;
						if (!matchesExactPhrases(reply.text, config.exactPhrases)) continue;
						if (!matchesExclusions(reply.text, config.exclusions)) continue;

						const replyAuthor = reply.user
							? await resolveUser(reply.user)
							: "Unknown";

						items.push({
							source: "slack",
							externalId: `${channel.id}-${reply.ts}`,
							title: `#${channel.name} (thread)`,
							content: reply.text,
							author: replyAuthor,
							sourceUrl: null,
							timestamp: slackTsToIso(reply.ts),
							metadata: {
								type: "thread_reply",
								channel: channel.name,
								channelId: channel.id,
								parentTs: msg.ts,
							},
						});
					}
				} catch {
					// Skip thread replies on error
				}
			}
		}
	}

	return items;
}

export async function compileSlack(
	config: SlackFilterConfig,
): Promise<CompilationItem[]> {
	const items: CompilationItem[] = [];
	const contentTypes = config.contentTypes ?? ["messages"];
	const hasUserToken = !!getUserToken();
	const useSearch =
		hasUserToken && config.searchQuery && config.searchQuery.trim().length > 0;

	// Strategy A: search.messages when user token + searchQuery provided
	// Strategy B: channel-based fetching otherwise
	if (contentTypes.includes("messages")) {
		if (useSearch) {
			const searchResults = await searchMessages(config);
			items.push(...searchResults);
		} else {
			const channelResults = await compileChannelBased(config);
			items.push(...channelResults);
		}
	}

	// Fetch additional content types
	if (
		contentTypes.includes("files") ||
		contentTypes.includes("images") ||
		contentTypes.includes("canvases")
	) {
		const fileItems = await fetchFiles(config);
		items.push(...fileItems);
	}

	if (contentTypes.includes("pins")) {
		const channelIds =
			config.channels ?? (await fetchChannels()).map((ch) => ch.id);
		const pinItems = await fetchPins(channelIds);
		items.push(...pinItems);
	}

	if (contentTypes.includes("bookmarks")) {
		const channelIds =
			config.channels ?? (await fetchChannels()).map((ch) => ch.id);
		const bookmarkItems = await fetchBookmarks(channelIds);
		items.push(...bookmarkItems);
	}

	// Sort chronologically
	items.sort(
		(a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
	);

	// Clear user cache after compilation
	userCache.clear();
	channelNameCache.clear();

	return items;
}

// Cache health check for 60s to avoid rate limiting
let healthCache: { result: SourceHealthCheck; expiresAt: number } | null = null;

export async function checkSlackHealth(): Promise<SourceHealthCheck> {
	if (healthCache && healthCache.expiresAt > Date.now()) {
		return healthCache.result;
	}

	const now = new Date().toISOString();
	const userToken = getUserToken();
	const botToken = getBotToken();

	if (!userToken && !botToken) {
		return {
			source: "slack",
			status: "not_configured",
			message: "Neither SLACK_USER_TOKEN nor SLACK_BOT_TOKEN is set",
			checkedAt: now,
		};
	}

	try {
		// auth.test is Tier 4 (100+ req/min) so it's safe
		const token = (userToken ?? botToken) as string;
		const data = await slackApi<{
			team: string;
			user: string;
			team_id: string;
		}>("auth.test", {}, token);

		const tokenType = userToken ? "user token" : "bot token";

		const result: SourceHealthCheck = {
			source: "slack",
			status: "connected",
			message: `Authenticated as ${data.user} in ${data.team} via ${tokenType}`,
			checkedAt: now,
		};

		healthCache = { result, expiresAt: Date.now() + 60000 };
		return result;
	} catch (err) {
		const result: SourceHealthCheck = {
			source: "slack",
			status: "error",
			message: err instanceof Error ? err.message : String(err),
			checkedAt: now,
		};

		healthCache = { result, expiresAt: Date.now() + 60000 };
		return result;
	}
}
