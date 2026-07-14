import { listSlackUsers } from "./slack-meta.js";
import {
	buildSlackPermalink,
	getBotToken,
	getUserToken,
	getWorkspaceDomain,
	resolveUser,
	slackApi,
	slackTsToIso,
} from "./sources/slack.js";

export type ResolvedPerson = {
	id: string;
	name: string;
	realName: string;
};

export type DmMessage = {
	author: string;
	authorId: string;
	timestamp: string; // ISO 8601
	text: string;
	permalink: string | null;
	hasFiles: boolean;
};

export type GroupDmCandidate = {
	channelId: string;
	memberNames: string[];
};

export type SearchDmsResult = {
	conversationType: "im" | "mpim";
	participants: ResolvedPerson[];
	channelId: string | null;
	matchCount: number;
	totalInThread: number;
	messages: DmMessage[];
	note?: string;
	candidates?: GroupDmCandidate[];
};

export type SearchDmsOptions = {
	// One of `person` (1:1) or `people` (group, 2+) is required. `person` is a
	// convenience alias for `people: [person]`.
	person?: string;
	people?: string[];
	query?: string;
	startDate?: string;
	endDate?: string;
	limit?: number;
};

const USER_ID_RE = /^U[A-Z0-9]{6,}$/i;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 2000;

// Resolve a freeform identifier (user ID, @handle, handle, real name, or email)
// to a single Slack user. Throws a helpful error when ambiguous or not found.
export async function resolvePerson(
	identifier: string,
): Promise<ResolvedPerson> {
	const raw = identifier.trim();
	if (!raw) throw new Error("person is required");

	// Direct Slack user ID (e.g. U068AT2F9GS)
	if (USER_ID_RE.test(raw)) {
		const realName = await resolveUser(raw);
		return { id: raw, name: raw, realName };
	}

	// Email — needs users:read.email. The bot token has it; the user token does not.
	if (EMAIL_RE.test(raw)) {
		const botToken = getBotToken();
		if (botToken) {
			try {
				const data = await slackApi<{
					user: { id: string; name: string; real_name: string };
				}>("users.lookupByEmail", { email: raw }, botToken);
				return {
					id: data.user.id,
					name: data.user.name,
					realName: data.user.real_name || data.user.name,
				};
			} catch {
				// fall through to name matching
			}
		}
	}

	// Match against the workspace user list by handle / real name
	const needle = raw.replace(/^@/, "").toLowerCase();
	const users = await listSlackUsers();
	const exact = users.filter(
		(u) =>
			u.name.toLowerCase() === needle || u.realName.toLowerCase() === needle,
	);
	const candidates =
		exact.length > 0
			? exact
			: users.filter(
					(u) =>
						u.name.toLowerCase().includes(needle) ||
						u.realName.toLowerCase().includes(needle),
				);

	if (candidates.length === 0) {
		throw new Error(
			`No Slack user matches "${identifier}". Try a @handle, full name, email, or user ID (run list_slack_users to browse).`,
		);
	}
	if (candidates.length > 1) {
		const list = candidates
			.slice(0, 8)
			.map((u) => `${u.realName} (@${u.name}, ${u.id})`)
			.join("; ");
		throw new Error(
			`"${identifier}" is ambiguous — ${candidates.length} matches: ${list}. Re-run with the exact @handle or user ID.`,
		);
	}
	const u = candidates[0];
	return { id: u.id, name: u.name, realName: u.realName };
}

// The token owner's user ID (auth.test), cached for the process.
let cachedAuthUserId: string | null = null;
async function getAuthUserId(): Promise<string> {
	if (cachedAuthUserId) return cachedAuthUserId;
	const token = getUserToken();
	if (!token) throw new Error("SLACK_USER_TOKEN is required to read DMs.");
	const data = await slackApi<{ user_id: string }>("auth.test", {}, token);
	cachedAuthUserId = data.user_id;
	return cachedAuthUserId;
}

// List every conversation of the given type the user can see (user token), paginated.
async function listConversations(
	type: "im" | "mpim",
): Promise<Array<{ id: string; user?: string; name?: string }>> {
	const token = getUserToken();
	if (!token) {
		throw new Error(
			"SLACK_USER_TOKEN is required to read DMs (scopes im:read / mpim:read).",
		);
	}
	const all: Array<{ id: string; user?: string; name?: string }> = [];
	let cursor = "";
	do {
		const params: Record<string, string> = { types: type, limit: "200" };
		if (cursor) params.cursor = cursor;
		const data = await slackApi<{
			channels: Array<{ id: string; user?: string; name?: string }>;
			response_metadata?: { next_cursor?: string };
		}>("conversations.list", params, token);
		all.push(...data.channels);
		cursor = data.response_metadata?.next_cursor ?? "";
	} while (cursor);
	return all;
}

// Find the 1:1 DM (im) channel id for a user. Uses the USER token so dormant DMs
// are included — the bot token only sees DMs the bot itself is a member of.
export async function findDmChannelId(userId: string): Promise<string | null> {
	const ims = await listConversations("im");
	return ims.find((c) => c.user === userId)?.id ?? null;
}

async function fetchMembers(channelId: string): Promise<string[]> {
	const token = getUserToken();
	if (!token) throw new Error("SLACK_USER_TOKEN is required to read DMs.");
	const members: string[] = [];
	let cursor = "";
	do {
		const params: Record<string, string> = { channel: channelId, limit: "200" };
		if (cursor) params.cursor = cursor;
		const data = await slackApi<{
			members: string[];
			response_metadata?: { next_cursor?: string };
		}>("conversations.members", params, token);
		members.push(...data.members);
		cursor = data.response_metadata?.next_cursor ?? "";
	} while (cursor);
	return members;
}

export type GroupDmMatch =
	| { kind: "found"; channelId: string }
	| { kind: "ambiguous"; candidates: GroupDmCandidate[] }
	| { kind: "none" };

// Find the group DM (mpim) whose participants are exactly the requested people
// plus the token owner. Slack keeps one mpim per unique member set, so an exact
// set match is unique. If only larger groups contain everyone, those are returned
// as candidates rather than silently picking a superset.
export async function findGroupDm(
	requestedUserIds: string[],
): Promise<GroupDmMatch> {
	const ownerId = await getAuthUserId();
	const expected = new Set<string>([...requestedUserIds, ownerId]);

	const mpims = await listConversations("mpim");
	const memberLists = await Promise.all(mpims.map((m) => fetchMembers(m.id)));

	const supersets: Array<{ channelId: string; members: string[] }> = [];
	let exact: { channelId: string; members: string[] } | null = null;
	for (let i = 0; i < mpims.length; i++) {
		const members = memberLists[i];
		const memberSet = new Set(members);
		const containsAll = [...expected].every((id) => memberSet.has(id));
		if (!containsAll) continue;
		if (memberSet.size === expected.size) {
			exact = { channelId: mpims[i].id, members };
		} else {
			supersets.push({ channelId: mpims[i].id, members });
		}
	}

	if (exact) return { kind: "found", channelId: exact.channelId };
	if (supersets.length === 0) return { kind: "none" };

	const candidates: GroupDmCandidate[] = [];
	for (const s of supersets) {
		const names = await Promise.all(s.members.map((id) => resolveUser(id)));
		candidates.push({ channelId: s.channelId, memberNames: names });
	}
	return { kind: "ambiguous", candidates };
}

// Pull a conversation's full history (paginated, user token), optionally bounded
// by date, then keyword-filter client-side. Returns matches + total in range.
async function readConversation(
	channelId: string,
	opts: { query?: string; startDate?: string; endDate?: string; limit: number },
): Promise<{
	messages: DmMessage[];
	matchCount: number;
	totalInThread: number;
}> {
	const token = getUserToken();
	if (!token) throw new Error("SLACK_USER_TOKEN is required to read DMs.");

	const oldest = opts.startDate
		? String(new Date(opts.startDate).getTime() / 1000)
		: undefined;
	const latest = opts.endDate
		? String(new Date(opts.endDate).getTime() / 1000)
		: undefined;

	type RawMsg = {
		type: string;
		ts: string;
		user?: string;
		text?: string;
		files?: unknown[];
	};
	const rawMessages: RawMsg[] = [];
	let cursor = "";
	do {
		const params: Record<string, string> = {
			channel: channelId,
			limit: "200",
			inclusive: "true",
		};
		if (oldest) params.oldest = oldest;
		if (latest) params.latest = latest;
		if (cursor) params.cursor = cursor;
		const data = await slackApi<{
			messages: RawMsg[];
			response_metadata?: { next_cursor?: string };
		}>("conversations.history", params, token);
		rawMessages.push(...data.messages);
		cursor = data.response_metadata?.next_cursor ?? "";
	} while (cursor);

	rawMessages.sort((a, b) => Number(a.ts) - Number(b.ts));
	const totalInThread = rawMessages.filter((m) => m.type === "message").length;

	// Keyword filter: AND across whitespace-separated terms, case-insensitive.
	const terms = (opts.query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
	const matched = rawMessages.filter((m) => {
		if (m.type !== "message" || !m.text) return false;
		if (terms.length === 0) return true;
		const text = m.text.toLowerCase();
		return terms.every((t) => text.includes(t));
	});

	const limited = matched.slice(0, opts.limit);
	const workspace = await getWorkspaceDomain();
	const messages: DmMessage[] = [];
	for (const m of limited) {
		messages.push({
			author: m.user ? await resolveUser(m.user) : "Unknown",
			authorId: m.user ?? "",
			timestamp: slackTsToIso(m.ts),
			text: m.text ?? "",
			permalink: buildSlackPermalink(workspace, channelId, m.ts),
			hasFiles: Array.isArray(m.files) && m.files.length > 0,
		});
	}

	return { messages, matchCount: matched.length, totalInThread };
}

// Read a 1:1 DM (pass `person`) or a group DM (pass `people` with 2+ members),
// optionally filtered by keywords + date range. Full history via the user token.
export async function searchDms(
	opts: SearchDmsOptions,
): Promise<SearchDmsResult> {
	const identifiers =
		opts.people && opts.people.length > 0
			? opts.people
			: opts.person
				? [opts.person]
				: [];
	if (identifiers.length === 0) {
		throw new Error("Provide `person` (1:1 DM) or `people` (group DM).");
	}

	// Resolve + de-duplicate participants by user ID.
	const resolvedAll: ResolvedPerson[] = [];
	const seen = new Set<string>();
	for (const id of identifiers) {
		const p = await resolvePerson(id);
		if (!seen.has(p.id)) {
			seen.add(p.id);
			resolvedAll.push(p);
		}
	}

	// The token owner is always implicitly part of their own DMs. Strip them so
	// callers can include themselves harmlessly and routing stays correct.
	const ownerId = await getAuthUserId();
	const resolved = resolvedAll.filter((p) => p.id !== ownerId);
	if (resolved.length === 0) {
		throw new Error(
			"List at least one other person — you are always implicitly included.",
		);
	}

	const limit = Math.min(opts.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
	const isGroup = resolved.length > 1;
	const conversationType: "im" | "mpim" = isGroup ? "mpim" : "im";

	const overLimitNote = (matchCount: number): string | undefined =>
		matchCount > limit
			? `Showing first ${limit} of ${matchCount} matches. Narrow with query/date range or raise limit (max ${MAX_LIMIT}).`
			: undefined;

	if (!isGroup) {
		const channelId = await findDmChannelId(resolved[0].id);
		if (!channelId) {
			return {
				conversationType,
				participants: resolved,
				channelId: null,
				matchCount: 0,
				totalInThread: 0,
				messages: [],
				note: `No 1:1 DM channel exists with ${resolved[0].realName} (@${resolved[0].name}). You may have never direct-messaged them.`,
			};
		}
		const read = await readConversation(channelId, { ...opts, limit });
		return {
			conversationType,
			participants: resolved,
			channelId,
			...read,
			note: overLimitNote(read.matchCount),
		};
	}

	// Group DM
	const who = resolved.map((p) => `${p.realName} (@${p.name})`).join(", ");
	const match = await findGroupDm(resolved.map((p) => p.id));
	if (match.kind === "none") {
		return {
			conversationType,
			participants: resolved,
			channelId: null,
			matchCount: 0,
			totalInThread: 0,
			messages: [],
			note: `No group DM exists with exactly you + ${who}.`,
		};
	}
	if (match.kind === "ambiguous") {
		return {
			conversationType,
			participants: resolved,
			channelId: null,
			matchCount: 0,
			totalInThread: 0,
			messages: [],
			candidates: match.candidates,
			note: `No group DM with exactly you + ${who}, but ${match.candidates.length} larger group(s) include everyone. Re-run with all members listed in a candidate to target one.`,
		};
	}
	const read = await readConversation(match.channelId, { ...opts, limit });
	return {
		conversationType,
		participants: resolved,
		channelId: match.channelId,
		...read,
		note: overLimitNote(read.matchCount),
	};
}
