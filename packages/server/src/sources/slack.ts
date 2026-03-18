import type {
	CompilationFilter,
	CompilationItem,
	SourceHealthCheck,
} from "@thoughtcurrent/shared";

const SLACK_API = "https://slack.com/api";

interface SlackChannel {
	id: string;
	name: string;
	is_member: boolean;
	is_archived: boolean;
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
}

interface SlackUser {
	id: string;
	real_name: string;
	name: string;
}

// User token for compilation (sees everything you see), bot token as fallback
function getUserToken(): string | null {
	return process.env.SLACK_USER_TOKEN ?? null;
}

function getBotToken(): string | null {
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

async function slackApi<T>(
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

async function resolveUser(userId: string): Promise<string> {
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

async function fetchChannels(): Promise<SlackChannel[]> {
	const channels: SlackChannel[] = [];
	let cursor = "";

	do {
		const params: Record<string, string> = {
			types: "public_channel,private_channel",
			exclude_archived: "true",
			limit: "200",
		};
		if (cursor) params.cursor = cursor;

		// Bot token has channels:read/groups:read needed for listing
		const botToken = getBotToken();
		const data = await slackApi<{
			channels: SlackChannel[];
			response_metadata?: { next_cursor?: string };
		}>("conversations.list", params, botToken ?? undefined);

		channels.push(...data.channels.filter((ch) => ch.is_member));
		cursor = data.response_metadata?.next_cursor ?? "";
	} while (cursor);

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

function slackTsToIso(ts: string): string {
	return new Date(Number.parseFloat(ts) * 1000).toISOString();
}

function isoToSlackTs(iso: string): string {
	return (new Date(iso).getTime() / 1000).toFixed(6);
}

export async function compileSlack(
	filter: CompilationFilter,
): Promise<CompilationItem[]> {
	const items: CompilationItem[] = [];
	const oldest = isoToSlackTs(filter.startDate);
	const latest = isoToSlackTs(filter.endDate);

	const channels = await fetchChannels();

	for (const channel of channels) {
		const messages = await fetchMessages(channel.id, oldest, latest);

		for (const msg of messages) {
			if (!msg.text || msg.type !== "message") continue;
			if (!matchesKeywords(msg.text, filter.keywords)) continue;

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
						if (!matchesKeywords(reply.text, filter.keywords)) continue;

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
					// Skip thread replies on error, still capture the parent
				}
			}
		}
	}

	// Sort chronologically
	items.sort(
		(a, b) =>
			new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
	);

	// Clear user cache after compilation
	userCache.clear();

	return items;
}

// Cache health check for 60s to avoid rate limiting
let healthCache: { result: SourceHealthCheck; expiresAt: number } | null =
	null;

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
