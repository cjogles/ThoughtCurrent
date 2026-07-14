import type {
	CompilationItem,
	PosthogFilterConfig,
	SourceHealthCheck,
} from "../types.js";

// ---------------------------------------------------------------------------
// Config / env
// ---------------------------------------------------------------------------

function getApiKey(): string {
	const key = process.env.POSTHOG_API_KEY;
	if (!key) throw new Error("POSTHOG_API_KEY not set");
	return key;
}

function getHost(): string {
	// Normalize: strip any trailing slash so `${host}/api/...` is well-formed.
	return (process.env.POSTHOG_HOST ?? "https://us.posthog.com").replace(
		/\/+$/,
		"",
	);
}

function getProjectId(): string {
	return process.env.POSTHOG_PROJECT_ID ?? "138211";
}

const DEFAULT_LIMIT = 300;
// Personal API keys reject OFFSET, so both discovery and timelines use keyset
// pagination on `timestamp` (verified against production 2026-07-14). These are
// safety bounds on the keyset loops, surfaced as truncation flags — never silent.
const MAX_DISCOVERY_SESSIONS = 5000;
const MAX_EVENTS_PER_SESSION = 2000; // per-session timeline cap (flagged in output)
const RECORDING_ID_BATCH = 20; // session_recordings?session_ids=[...] chunk size

// ---------------------------------------------------------------------------
// PostHog API types (subset of real responses, verified 2026-07-14)
// ---------------------------------------------------------------------------

interface HogQLResponse {
	results: unknown[][];
	columns: string[];
	error?: string | null;
	hasMore?: boolean;
	clickhouse?: string;
	hogql?: string;
}

interface RecordingApiRow {
	id: string;
	distinct_id?: string | null;
	recording_duration?: number | null;
	start_time?: string | null;
	end_time?: string | null;
	click_count?: number | null;
	keypress_count?: number | null;
	mouse_activity_count?: number | null;
	console_error_count?: number | null;
	start_url?: string | null;
}

interface RecordingListResponse {
	results?: RecordingApiRow[];
	has_next?: boolean;
}

// ---------------------------------------------------------------------------
// Internal domain model
// ---------------------------------------------------------------------------

interface EventRow {
	timestamp: string;
	event: string;
	eventType: string | null;
	url: string | null;
	elementsChain: string | null;
	distinctId: string | null;
}

export interface RecordingMeta {
	id: string;
	distinctId: string | null;
	durationSeconds: number | null;
	startTime: string | null;
	endTime: string | null;
	clickCount: number | null;
	keypressCount: number | null;
	consoleErrorCount: number | null;
	startUrl: string | null;
}

interface DiscoveredSession {
	sessionId: string;
	distinctId: string | null;
	events: EventRow[];
	truncated: boolean;
	recording: RecordingMeta | null;
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit tests)
// ---------------------------------------------------------------------------

/**
 * Parse a PostHog `elements_chain` string (a flat, non-structured blob on
 * `$autocapture` events) and pull out the useful identifiers. Our frontends
 * stamp registry `data-testid`s, so the testid is the highest-signal field.
 *
 * Real chain shape (verified against production):
 *   button.eIHgWo.sc-cfxfcM:attr__class="…"attr__data-testid="customize-button"…text="Customize";a.…
 */
export function parseElementsChain(chain: string | null | undefined): {
	testid?: string;
	text?: string;
	ariaLabel?: string;
} {
	if (!chain) return {};
	const testid = chain.match(/data-testid="([^"]+)"/)?.[1];
	// The element's own inner text is a bare `text="…"` key — never preceded by a
	// word char or hyphen (that would be an attribute like `attr__data-text=`).
	const text = chain.match(/(?<![\w-])text="([^"]+)"/)?.[1];
	const ariaLabel = chain.match(/aria-label="([^"]+)"/)?.[1];
	const out: { testid?: string; text?: string; ariaLabel?: string } = {};
	if (testid) out.testid = testid;
	if (text) out.text = text;
	if (ariaLabel) out.ariaLabel = ariaLabel;
	return out;
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** Redact anything email-shaped — same PII posture as the messenger Sentry scrub. */
export function redactEmails(text: string): string {
	return text.replace(EMAIL_RE, "[email redacted]");
}

/**
 * Normalize a user-supplied date/datetime into HogQL's `toDateTime` literal
 * form `YYYY-MM-DD HH:MM:SS` (interpreted UTC). Accepts `2026-07-14`,
 * `2026-07-14 15:00`, `2026-07-14T15:00:00Z`, etc.
 */
export function toHogqlDateTime(input: string, endOfDay = false): string {
	const t = input.trim().replace("T", " ").replace("Z", "").split(".")[0];
	const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(t);
	if (dateOnly) return `${t} ${endOfDay ? "23:59:59" : "00:00:00"}`;
	const [d, time = ""] = t.split(/\s+/);
	const [hh = "00", mm = "00", ss = "00"] = time.split(":");
	return `${d} ${hh.padStart(2, "0")}:${mm.padStart(2, "0")}:${ss.padStart(2, "0")}`;
}

/** Escape a single-quoted HogQL/SQL string literal by doubling quotes. */
function escapeHogql(s: string): string {
	return s.replace(/'/g, "''");
}

/** `2026-07-14T16:11:04.430000Z` → `2026-07-14 16:11:04.430000` for toDateTime64. */
function toDateTime64Literal(iso: string): string {
	return iso.replace("T", " ").replace("Z", "");
}

/** Make a value safe to drop inside a markdown table cell. */
function cell(value: unknown): string {
	if (value === null || value === undefined) return "";
	return redactEmails(String(value))
		.replace(/\|/g, "\\|")
		.replace(/\r?\n/g, " ")
		.trim();
}

/** `2026-07-14T16:13:46.309000Z` → `2026-07-14 16:13:46` */
function formatTs(ts: string): string {
	return ts.replace("T", " ").replace("Z", "").split(".")[0];
}

/** Path (no origin, no query) of a URL, for compact display. */
function urlPath(url: string | null | undefined): string {
	if (!url) return "";
	try {
		return new URL(url).pathname;
	} catch {
		return url;
	}
}

/**
 * Render one timeline event as a markdown table row:
 * `| time | event | testid | text | aria-label | url |`
 * The `url` shown is decided by the caller (empty string suppresses it).
 */
export function formatTimelineRow(r: {
	timestamp: string;
	event: string;
	eventType?: string | null;
	elementsChain?: string | null;
	url?: string | null;
}): string {
	const { testid, text, ariaLabel } = parseElementsChain(r.elementsChain);
	const eventLabel = r.eventType ? `${r.event} (${r.eventType})` : r.event;
	return `| ${formatTs(r.timestamp)} | ${cell(eventLabel)} | ${cell(testid ? `\`${testid}\`` : "")} | ${cell(text)} | ${cell(ariaLabel)} | ${cell(r.url ?? "")} |`;
}

/**
 * Render a discovered session as a markdown BODY (no leading heading — the
 * writer / compiled-output formatter adds the `##` title). This exact rendering
 * — a chronological table with extracted testid/text/aria per row — is what let
 * us prove production "page wipes" were user deletions (overlay-delete-icon →
 * editor-save-button).
 */
export function renderSession(s: DiscoveredSession): string {
	const host = getHost();
	const projectId = getProjectId();
	const events = s.events;
	const start = events.length > 0 ? events[0].timestamp : null;
	const end = events.length > 0 ? events[events.length - 1].timestamp : null;
	const replay = `${host}/project/${projectId}/replay/${s.sessionId}`;

	const lines: string[] = [];
	lines.push(`**Session ID:** \`${s.sessionId}\``);
	lines.push(`**Distinct ID:** \`${cell(s.distinctId ?? "unknown")}\``);
	if (start) lines.push(`**Start:** ${formatTs(start)} UTC`);
	if (end) lines.push(`**End:** ${formatTs(end)} UTC`);
	lines.push(
		`**Events:** ${events.length}${s.truncated ? " (truncated)" : ""}`,
	);
	lines.push(`**Replay:** ${replay}`);

	if (s.recording) {
		const r = s.recording;
		const parts: string[] = [];
		if (r.durationSeconds != null) parts.push(`${r.durationSeconds}s`);
		if (r.clickCount != null) parts.push(`${r.clickCount} clicks`);
		if (r.keypressCount != null) parts.push(`${r.keypressCount} keypresses`);
		if (r.consoleErrorCount != null && r.consoleErrorCount > 0)
			parts.push(`${r.consoleErrorCount} console errors`);
		lines.push(
			`**Recording:** available${parts.length ? ` — ${parts.join(" · ")}` : ""}`,
		);
	} else {
		lines.push("**Recording:** none found for this session");
	}

	// Testid click tally — the fastest way to spot high-signal interactions.
	const testidCounts = new Map<string, number>();
	for (const e of events) {
		const { testid } = parseElementsChain(e.elementsChain);
		if (testid) testidCounts.set(testid, (testidCounts.get(testid) ?? 0) + 1);
	}
	if (testidCounts.size > 0) {
		const tally = [...testidCounts.entries()]
			.sort((a, b) => b[1] - a[1])
			.map(([id, n]) => `\`${id}\`${n > 1 ? ` ×${n}` : ""}`)
			.join(", ");
		lines.push("", `**Testids interacted:** ${tally}`);
	}

	// Distinct URLs visited, in first-seen order.
	const seenUrls = new Set<string>();
	const urls: string[] = [];
	for (const e of events) {
		const p = urlPath(e.url);
		if (p && !seenUrls.has(p)) {
			seenUrls.add(p);
			urls.push(p);
		}
	}
	if (urls.length > 0) {
		lines.push("", "**URLs visited:**");
		for (const u of urls.slice(0, 40)) lines.push(`- ${cell(u)}`);
		if (urls.length > 40) lines.push(`- …and ${urls.length - 40} more`);
	}

	// Chronological timeline. URL cell only shows on page transitions to cut noise.
	lines.push("", "### Timeline", "");
	lines.push("| Time (UTC) | Event | testid | text | aria-label | url |");
	lines.push("|---|---|---|---|---|---|");
	let lastPath = "";
	for (const e of events) {
		const p = urlPath(e.url);
		const showUrl = p && p !== lastPath ? p : "";
		if (p) lastPath = p;
		lines.push(
			formatTimelineRow({
				timestamp: e.timestamp,
				event: e.event,
				eventType: e.eventType,
				elementsChain: e.elementsChain,
				url: showUrl,
			}),
		);
	}
	if (s.truncated) {
		lines.push(
			"",
			`> ⚠️ Timeline truncated at ${MAX_EVENTS_PER_SESSION} events. Raise \`limit\` or narrow the window to see the rest.`,
		);
	}

	return lines.join("\n");
}

/** Render a raw HogQL passthrough result set as a markdown table. */
export function renderQueryTable(columns: string[], rows: unknown[][]): string {
	if (columns.length === 0) return "_(no columns returned)_";
	const lines: string[] = [];
	lines.push(`| ${columns.map((c) => cell(c)).join(" | ")} |`);
	lines.push(`|${columns.map(() => "---").join("|")}|`);
	for (const row of rows) {
		lines.push(`| ${columns.map((_, i) => cell(row[i])).join(" | ")} |`);
	}
	lines.push("", `_${rows.length} row(s)._`);
	return lines.join("\n");
}

// ---------------------------------------------------------------------------
// API client — read-only. POST is only ever the query endpoint (itself a read).
// ---------------------------------------------------------------------------

function friendly403(body: string): string {
	return `PostHog 403 Forbidden — the personal API key lacks the required scope (need query:read / session_recording:read) or is scoped to a different project than POSTHOG_PROJECT_ID=${getProjectId()}. Org-level endpoints are never allowed. Body: ${body.slice(0, 300)}`;
}

async function posthogQuery(
	query: string,
	retriedOn429 = false,
): Promise<HogQLResponse> {
	const res = await fetch(
		`${getHost()}/api/projects/${getProjectId()}/query/`,
		{
			method: "POST",
			headers: {
				Authorization: `Bearer ${getApiKey()}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ query: { kind: "HogQLQuery", query } }),
		},
	);

	if (res.status === 429 && !retriedOn429) {
		const retryAfter = Number(res.headers.get("Retry-After") ?? "10");
		await new Promise((r) => setTimeout(r, Math.min(retryAfter, 60) * 1000));
		return posthogQuery(query, true);
	}

	const text = await res.text();
	if (res.status === 403) throw new Error(friendly403(text));
	if (res.status === 429)
		throw new Error(
			`PostHog 429 rate limited (after retry). Body: ${text.slice(0, 200)}`,
		);
	if (!res.ok)
		throw new Error(`PostHog query HTTP ${res.status}: ${text.slice(0, 400)}`);

	let json: HogQLResponse;
	try {
		json = JSON.parse(text) as HogQLResponse;
	} catch {
		throw new Error(`PostHog query returned non-JSON: ${text.slice(0, 200)}`);
	}
	if (json.error) throw new Error(`PostHog HogQL error: ${json.error}`);
	return json;
}

async function posthogGet<T>(
	pathAndQuery: string,
	retriedOn429 = false,
): Promise<T> {
	const res = await fetch(
		`${getHost()}/api/projects/${getProjectId()}/${pathAndQuery}`,
		{ headers: { Authorization: `Bearer ${getApiKey()}` } },
	);

	if (res.status === 429 && !retriedOn429) {
		const retryAfter = Number(res.headers.get("Retry-After") ?? "10");
		await new Promise((r) => setTimeout(r, Math.min(retryAfter, 60) * 1000));
		return posthogGet<T>(pathAndQuery, true);
	}

	const text = await res.text();
	if (res.status === 403) throw new Error(friendly403(text));
	if (res.status === 429)
		throw new Error(
			`PostHog 429 rate limited (after retry). Body: ${text.slice(0, 200)}`,
		);
	if (!res.ok)
		throw new Error(
			`PostHog GET ${pathAndQuery} HTTP ${res.status}: ${text.slice(0, 400)}`,
		);

	return JSON.parse(text) as T;
}

/** Map positional HogQL result rows to objects keyed by their column alias. */
function rowsToObjects(resp: HogQLResponse): Record<string, unknown>[] {
	return resp.results.map((row) => {
		const obj: Record<string, unknown> = {};
		resp.columns.forEach((col, i) => {
			obj[col] = row[i];
		});
		return obj;
	});
}

// ---------------------------------------------------------------------------
// Discovery + timeline + recordings
// ---------------------------------------------------------------------------

function eventInClause(events: string[] | undefined): string {
	if (!events || events.length === 0) return "";
	const list = events.map((e) => `'${escapeHogql(e)}'`).join(", ");
	return ` AND event IN (${list})`;
}

/** Discover session ids in the window, seeded by url substrings / testids. */
async function discoverSessionIds(
	config: PosthogFilterConfig,
	start: string,
	end: string,
	pageSize: number,
): Promise<Map<string, string | null>> {
	const sessions = new Map<string, string | null>();

	const seeds: string[] = [];
	for (const frag of config.urlContains ?? []) {
		seeds.push(`properties.$current_url LIKE '%${escapeHogql(frag)}%'`);
	}
	for (const tid of config.testids ?? []) {
		seeds.push(`elements_chain LIKE '%data-testid="${escapeHogql(tid)}"%'`);
	}

	// If the only thing the user gave us is explicit sessionIds, don't broad-scan.
	const hasExplicitSessions =
		(config.sessionIds?.length ?? 0) > 0 && seeds.length === 0;
	if (hasExplicitSessions) return sessions;

	const seedClause = seeds.length > 0 ? ` AND (${seeds.join(" OR ")})` : "";

	// Keyset pagination on min(timestamp): personal API keys reject OFFSET. The
	// `>=` cursor re-reads the boundary tie group; the Map dedupes by session id.
	let cursor: string | null = null;
	while (sessions.size < MAX_DISCOVERY_SESSIONS) {
		const havingClause = cursor
			? ` HAVING min(timestamp) >= toDateTime64('${toDateTime64Literal(cursor)}', 6)`
			: "";
		const query = `
SELECT properties.$session_id AS session_id, any(distinct_id) AS distinct_id, min(timestamp) AS first_seen
FROM events
WHERE timestamp >= toDateTime('${start}') AND timestamp <= toDateTime('${end}')
  AND properties.$session_id != ''${eventInClause(config.events)}${seedClause}
GROUP BY session_id${havingClause}
ORDER BY first_seen
LIMIT ${pageSize}`;
		const resp = await posthogQuery(query);
		const rows = rowsToObjects(resp);
		let added = 0;
		let lastFirst: string | null = null;
		for (const row of rows) {
			lastFirst = (row.first_seen as string | null) ?? lastFirst;
			const sid = row.session_id as string | null;
			if (sid && !sessions.has(sid)) {
				sessions.set(sid, (row.distinct_id as string | null) ?? null);
				added++;
			}
		}
		if (rows.length < pageSize) break;
		// Stuck guard: a single-timestamp tie group larger than one page.
		if (lastFirst === cursor && added === 0) break;
		cursor = lastFirst;
	}

	return sessions;
}

/**
 * Pull the full chronological timeline for one session. Keyset-paginated on
 * `timestamp` (personal API keys reject OFFSET). The `>=` cursor re-reads the
 * boundary tie group each page; a fingerprint set dedupes the overlap so no
 * events are dropped or double-counted (verified against production).
 */
async function fetchSessionTimeline(
	sessionId: string,
	config: PosthogFilterConfig,
	pageSize: number,
): Promise<{ events: EventRow[]; truncated: boolean }> {
	const events: EventRow[] = [];
	const seen = new Set<string>();
	let cursor: string | null = null;
	let truncated = false;

	while (events.length < MAX_EVENTS_PER_SESSION) {
		const cursorClause = cursor
			? ` AND timestamp >= toDateTime64('${toDateTime64Literal(cursor)}', 6)`
			: "";
		const query = `
SELECT timestamp, event, properties.$event_type AS event_type,
       properties.$current_url AS url, elements_chain, distinct_id
FROM events
WHERE properties.$session_id = '${escapeHogql(sessionId)}'${eventInClause(config.events)}${cursorClause}
ORDER BY timestamp
LIMIT ${pageSize}`;
		const resp = await posthogQuery(query);
		const rows = rowsToObjects(resp);
		let added = 0;
		let lastTs: string | null = null;
		for (const row of rows) {
			const ts = String(row.timestamp);
			lastTs = ts;
			const chain = (row.elements_chain as string | null) ?? null;
			const fingerprint = `${ts}|${String(row.event)}|${chain ?? ""}`;
			if (seen.has(fingerprint)) continue;
			seen.add(fingerprint);
			events.push({
				timestamp: ts,
				event: String(row.event),
				eventType: (row.event_type as string | null) ?? null,
				url: (row.url as string | null) ?? null,
				elementsChain: chain,
				distinctId: (row.distinct_id as string | null) ?? null,
			});
			added++;
		}
		if (rows.length < pageSize) break;
		// Stuck guard: a single-timestamp tie group larger than one page.
		if (lastTs === cursor && added === 0) {
			truncated = true;
			break;
		}
		cursor = lastTs;
	}

	if (events.length >= MAX_EVENTS_PER_SESSION) truncated = true;
	return { events, truncated };
}

/** Fetch recording metadata for the given session ids (batched, targeted). */
async function fetchRecordings(
	sessionIds: string[],
): Promise<Map<string, RecordingMeta>> {
	const map = new Map<string, RecordingMeta>();

	for (let i = 0; i < sessionIds.length; i += RECORDING_ID_BATCH) {
		const batch = sessionIds.slice(i, i + RECORDING_ID_BATCH);
		const params = new URLSearchParams({ session_ids: JSON.stringify(batch) });
		const resp = await posthogGet<RecordingListResponse>(
			`session_recordings?${params.toString()}`,
		);
		for (const r of resp.results ?? []) {
			map.set(r.id, {
				id: r.id,
				distinctId: r.distinct_id ?? null,
				durationSeconds: r.recording_duration ?? null,
				startTime: r.start_time ?? null,
				endTime: r.end_time ?? null,
				clickCount: r.click_count ?? null,
				keypressCount: r.keypress_count ?? null,
				consoleErrorCount: r.console_error_count ?? null,
				startUrl: r.start_url ?? null,
			});
		}
	}

	return map;
}

// ---------------------------------------------------------------------------
// Compilation entry point
// ---------------------------------------------------------------------------

export async function compilePosthog(
	config: PosthogFilterConfig,
): Promise<CompilationItem[]> {
	const items: CompilationItem[] = [];
	const host = getHost();
	const projectId = getProjectId();
	const pageSize =
		config.limit && config.limit > 0 ? config.limit : DEFAULT_LIMIT;
	const start = toHogqlDateTime(config.startDate);
	const end = toHogqlDateTime(config.endDate, true);

	// 1. Discover session ids (seeded by url/testid, or a bounded window scan),
	//    then union in any explicitly-requested sessions.
	const discovered = await discoverSessionIds(config, start, end, pageSize);
	for (const sid of config.sessionIds ?? []) {
		if (!discovered.has(sid)) discovered.set(sid, null);
	}

	// 2. Pull each session's full timeline.
	const sessions: DiscoveredSession[] = [];
	for (const [sessionId, distinctId] of discovered) {
		const { events, truncated } = await fetchSessionTimeline(
			sessionId,
			config,
			pageSize,
		);
		if (events.length === 0) continue;
		sessions.push({
			sessionId,
			distinctId: distinctId ?? events[0].distinctId ?? null,
			events,
			truncated,
			recording: null,
		});
	}

	// 3. Enrich with recording metadata (targeted by session id — the reliable
	//    path; the date-range list is DESC + capped and misses older sessions).
	if (config.includeRecordingsList !== false && sessions.length > 0) {
		const recordings = await fetchRecordings(sessions.map((s) => s.sessionId));
		for (const s of sessions) {
			s.recording = recordings.get(s.sessionId) ?? null;
		}
	}

	// 4. Emit one CompilationItem per session.
	for (const s of sessions) {
		const sessionStart = s.events[0].timestamp;
		const testids = new Set<string>();
		let rageclicks = 0;
		for (const e of s.events) {
			const { testid } = parseElementsChain(e.elementsChain);
			if (testid) testids.add(testid);
			if (e.event === "$rageclick") rageclicks++;
		}
		const shortId = s.sessionId.slice(0, 8);
		const rageTag = rageclicks > 0 ? ` · ${rageclicks} rageclick(s)` : "";
		items.push({
			source: "posthog",
			externalId: `posthog-session-${s.sessionId}`,
			title: `Session ${shortId}… — ${s.events.length} events${rageTag}`,
			content: renderSession(s),
			author: s.distinctId,
			sourceUrl: `${host}/project/${projectId}/replay/${s.sessionId}`,
			timestamp: sessionStart,
			metadata: {
				type: "session",
				sessionId: s.sessionId,
				distinctId: s.distinctId,
				eventCount: s.events.length,
				rageclicks,
				testids: [...testids],
				hasRecording: !!s.recording,
				recordingDurationSeconds: s.recording?.durationSeconds ?? null,
				truncated: s.truncated,
			},
		});
	}

	// 5. Raw HogQL passthroughs → query tables.
	const rawQueries = config.hogql ?? [];
	for (let i = 0; i < rawQueries.length; i++) {
		const raw = rawQueries[i];
		const resp = await posthogQuery(raw);
		const content = [
			"```sql",
			raw.trim(),
			"```",
			"",
			renderQueryTable(resp.columns, resp.results),
		].join("\n");
		items.push({
			source: "posthog",
			externalId: `posthog-query-${i}-${Bun.hash(raw).toString(16)}`,
			title: `HogQL query #${i + 1}`,
			content,
			author: null,
			sourceUrl: `${host}/project/${projectId}/sql`,
			// Stamp with the window end so raw queries sort after the sessions.
			timestamp: new Date(`${end.replace(" ", "T")}Z`).toISOString(),
			metadata: {
				type: "query",
				rowCount: resp.results.length,
				columns: resp.columns,
			},
		});
	}

	items.sort(
		(a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
	);
	return items;
}

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

let healthCache: { result: SourceHealthCheck; expiresAt: number } | null = null;

export async function checkPosthogHealth(): Promise<SourceHealthCheck> {
	if (healthCache && healthCache.expiresAt > Date.now()) {
		return healthCache.result;
	}

	const now = new Date().toISOString();

	if (!process.env.POSTHOG_API_KEY) {
		return {
			source: "posthog",
			status: "not_configured",
			message: "POSTHOG_API_KEY not set",
			checkedAt: now,
		};
	}

	try {
		const resp = await posthogQuery("SELECT 1 AS ok");
		const ok = resp.results?.[0]?.[0] === 1;
		if (!ok) throw new Error("SELECT 1 did not return 1");
		// The generated ClickHouse echoes `readonly=2` — proof the key is read-only.
		const readonly = /readonly=2/.test(resp.clickhouse ?? "");
		const result: SourceHealthCheck = {
			source: "posthog",
			status: "connected",
			message: `connected — project ${getProjectId()} (read-only key${readonly ? ", readonly=2" : ""})`,
			checkedAt: now,
		};
		healthCache = { result, expiresAt: Date.now() + 60000 };
		return result;
	} catch (err) {
		const result: SourceHealthCheck = {
			source: "posthog",
			status: "error",
			message: err instanceof Error ? err.message : String(err),
			checkedAt: now,
		};
		healthCache = { result, expiresAt: Date.now() + 60000 };
		return result;
	}
}
