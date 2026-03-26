import type {
	CompilationItem,
	SourceCompilationFilter,
	SourceHealthCheck,
} from "../types.js";

const SENTRY_API = "https://sentry.io/api/0";

function getAuthToken(): string {
	const token = process.env.SENTRY_AUTH_TOKEN;
	if (!token) throw new Error("SENTRY_AUTH_TOKEN not set");
	return token;
}

function getOrg(): string {
	return process.env.SENTRY_ORG ?? "hq-en";
}

interface SentryIssue {
	id: string;
	title: string;
	type: string;
	culprit: string;
	level: string;
	status: string;
	count: string;
	firstSeen: string;
	lastSeen: string;
	permalink: string;
	metadata: { value?: string; type?: string };
	assignedTo: { name: string } | null;
	project: { slug: string };
	latestEvent?: SentryEvent;
}

interface SentryEvent {
	entries: SentryEventEntry[];
}

interface SentryEventEntry {
	type: string;
	data: {
		values?: SentryExceptionValue[];
	};
}

interface SentryExceptionValue {
	type: string;
	value: string;
	stacktrace?: {
		frames: SentryFrame[];
	};
}

interface SentryFrame {
	filename: string;
	function: string;
	lineNo: number | null;
	colNo: number | null;
	absPath: string | null;
}

interface SentryOrg {
	slug: string;
	name: string;
}

interface PaginationResult<T> {
	data: T;
	nextCursor: string | null;
}

function parseLinkHeader(header: string | null): string | null {
	if (!header) return null;

	// Sentry Link header contains entries like:
	// <url>; rel="next"; results="true"; cursor="..."
	const parts = header.split(",");
	for (const part of parts) {
		if (
			part.includes('rel="next"') &&
			part.includes('results="true"')
		) {
			const cursorMatch = part.match(/cursor="([^"]+)"/);
			if (cursorMatch) return cursorMatch[1];
		}
	}
	return null;
}

async function sentryGet<T>(
	path: string,
	params = "",
): Promise<PaginationResult<T>> {
	const url = params
		? `${SENTRY_API}${path}?${params}`
		: `${SENTRY_API}${path}`;
	const res = await fetch(url, {
		headers: {
			Authorization: `Bearer ${getAuthToken()}`,
		},
	});

	if (res.status === 429) {
		const retryAfter = Number(res.headers.get("Retry-After") ?? "10");
		await new Promise((r) => setTimeout(r, retryAfter * 1000));
		return sentryGet<T>(path, params);
	}

	if (!res.ok) {
		throw new Error(`Sentry API ${path} HTTP ${res.status}: ${res.statusText}`);
	}

	const data = (await res.json()) as T;
	const nextCursor = parseLinkHeader(res.headers.get("Link"));

	return { data, nextCursor };
}

function matchesKeywords(
	text: string,
	keywords: string[] | undefined,
): boolean {
	if (!keywords || keywords.length === 0) return true;
	const lower = text.toLowerCase();
	return keywords.some((kw) => lower.includes(kw.toLowerCase()));
}

function formatStackTrace(event: SentryEvent | undefined): string {
	if (!event) return "";

	const exceptionEntry = event.entries.find(
		(entry) => entry.type === "exception",
	);
	if (!exceptionEntry?.data?.values) return "";

	const lines: string[] = ["", "### Stack Trace", ""];

	for (const exc of exceptionEntry.data.values) {
		lines.push(`**${exc.type}:** ${exc.value}`, "");

		if (exc.stacktrace?.frames) {
			const frames = [...exc.stacktrace.frames].reverse().slice(0, 15);
			lines.push("```");
			for (const frame of frames) {
				const loc = frame.lineNo
					? `:${frame.lineNo}${frame.colNo ? `:${frame.colNo}` : ""}`
					: "";
				const fn = frame.function || "<anonymous>";
				const file = frame.filename || frame.absPath || "<unknown>";
				lines.push(`  ${fn} (${file}${loc})`);
			}
			lines.push("```", "");
		}
	}

	return lines.join("\n");
}

function buildIssueContent(issue: SentryIssue): string {
	const lines = [
		`**Type:** ${issue.type}`,
		`**Culprit:** ${issue.culprit}`,
		`**Level:** ${issue.level}`,
		`**Status:** ${issue.status}`,
		`**Count:** ${issue.count}`,
		`**First Seen:** ${issue.firstSeen}`,
		`**Last Seen:** ${issue.lastSeen}`,
	];

	const stackTrace = formatStackTrace(issue.latestEvent);
	if (stackTrace) {
		lines.push(stackTrace);
	}

	return lines.join("\n");
}

async function fetchIssuesWithPagination(
	path: string,
	baseParams: string,
): Promise<SentryIssue[]> {
	const allIssues: SentryIssue[] = [];
	let cursor: string | null = null;

	do {
		const params: string = cursor
			? `${baseParams}&cursor=${cursor}`
			: baseParams;
		const result: PaginationResult<SentryIssue[]> = await sentryGet<SentryIssue[]>(path, params);
		allIssues.push(...result.data);
		cursor = result.nextCursor;
	} while (cursor);

	return allIssues;
}

export async function compileSentry(
	filter: SourceCompilationFilter,
): Promise<CompilationItem[]> {
	const items: CompilationItem[] = [];
	const org = getOrg();

	const baseParams = new URLSearchParams({
		expand: "latestEvent",
		query: "is:unresolved",
		start: filter.startDate,
		end: filter.endDate,
	}).toString();

	let allIssues: SentryIssue[];

	if (filter.projects && filter.projects.length > 0) {
		allIssues = [];
		for (const projectSlug of filter.projects) {
			const issues = await fetchIssuesWithPagination(
				`/projects/${org}/${projectSlug}/issues/`,
				baseParams,
			);
			allIssues.push(...issues);
		}
	} else {
		allIssues = await fetchIssuesWithPagination(
			`/organizations/${org}/issues/`,
			baseParams,
		);
	}

	for (const issue of allIssues) {
		const searchText = [
			issue.title,
			issue.culprit,
			issue.metadata.value ?? "",
		].join(" ");
		if (!matchesKeywords(searchText, filter.keywords)) continue;

		items.push({
			source: "sentry",
			externalId: issue.id,
			title: issue.title,
			content: buildIssueContent(issue),
			author: issue.assignedTo?.name ?? null,
			sourceUrl: issue.permalink,
			timestamp: issue.lastSeen,
			metadata: {
				type: issue.type,
				project: issue.project.slug,
				status: issue.status,
				level: issue.level,
				count: issue.count,
				firstSeen: issue.firstSeen,
				lastSeen: issue.lastSeen,
				assignee: issue.assignedTo?.name ?? null,
			},
		});
	}

	items.sort(
		(a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
	);

	return items;
}

let healthCache: { result: SourceHealthCheck; expiresAt: number } | null = null;

export async function checkSentryHealth(): Promise<SourceHealthCheck> {
	if (healthCache && healthCache.expiresAt > Date.now()) {
		return healthCache.result;
	}

	const now = new Date().toISOString();

	if (!process.env.SENTRY_AUTH_TOKEN) {
		return {
			source: "sentry",
			status: "not_configured",
			message: "SENTRY_AUTH_TOKEN not set",
			checkedAt: now,
		};
	}

	try {
		const org = getOrg();
		const { data } = await sentryGet<SentryOrg>(
			`/organizations/${org}/`,
		);

		const result: SourceHealthCheck = {
			source: "sentry",
			status: "connected",
			message: `Connected to organization: ${data.slug}`,
			checkedAt: now,
		};
		healthCache = { result, expiresAt: Date.now() + 60000 };
		return result;
	} catch (err) {
		const result: SourceHealthCheck = {
			source: "sentry",
			status: "error",
			message: err instanceof Error ? err.message : String(err),
			checkedAt: now,
		};
		healthCache = { result, expiresAt: Date.now() + 60000 };
		return result;
	}
}
