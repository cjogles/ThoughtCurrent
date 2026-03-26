import type {
	CompilationItem,
	SourceCompilationFilter,
	SourceHealthCheck,
} from "../types.js";

function getApiKey(): string {
	const key = process.env.DATADOG_API_KEY;
	if (!key) throw new Error("DATADOG_API_KEY not set");
	return key;
}

function getAppKey(): string {
	const key = process.env.DATADOG_APP_KEY;
	if (!key) throw new Error("DATADOG_APP_KEY not set");
	return key;
}

function getSite(): string {
	return process.env.DATADOG_SITE ?? "datadoghq.com";
}

async function datadogPost<T>(
	path: string,
	body: Record<string, unknown>,
): Promise<T> {
	const site = getSite();
	const url = `https://api.${site}${path}`;
	const res = await fetch(url, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"DD-API-KEY": getApiKey(),
			"DD-APPLICATION-KEY": getAppKey(),
		},
		body: JSON.stringify(body),
	});

	if (!res.ok) {
		throw new Error(`Datadog API ${path} HTTP ${res.status}: ${res.statusText}`);
	}

	return res.json() as Promise<T>;
}

async function datadogGet<T>(path: string): Promise<T> {
	const site = getSite();
	const url = `https://api.${site}${path}`;
	const res = await fetch(url, {
		headers: {
			"DD-API-KEY": getApiKey(),
			"DD-APPLICATION-KEY": getAppKey(),
		},
	});

	if (!res.ok) {
		throw new Error(`Datadog API ${path} HTTP ${res.status}: ${res.statusText}`);
	}

	return res.json() as Promise<T>;
}

interface DatadogLogAttributes {
	message?: string;
	service?: string;
	host?: string;
	status?: string;
	timestamp?: string;
	tags?: string[];
}

interface DatadogLogEntry {
	id: string;
	attributes: DatadogLogAttributes;
}

interface DatadogSearchResponse {
	data: DatadogLogEntry[];
	meta?: {
		page?: {
			after?: string;
		};
	};
}

function matchesKeywords(
	text: string,
	keywords: string[] | undefined,
): boolean {
	if (!keywords || keywords.length === 0) return true;
	const lower = text.toLowerCase();
	return keywords.some((kw) => lower.includes(kw.toLowerCase()));
}

function truncate(text: string, max: number): string {
	if (text.length <= max) return text;
	return text.slice(0, max) + "...";
}

export async function compileDatadog(
	filter: SourceCompilationFilter,
): Promise<CompilationItem[]> {
	const items: CompilationItem[] = [];
	const site = getSite();
	const query = filter.query ?? "status:error @http.status_code:500";
	let cursor: string | undefined;

	while (true) {
		const body: Record<string, unknown> = {
			filter: {
				query,
				from: filter.startDate,
				to: filter.endDate,
			},
			sort: "timestamp",
			page: {
				limit: 100,
				...(cursor ? { cursor } : {}),
			},
		};

		const response = await datadogPost<DatadogSearchResponse>(
			"/api/v2/logs/events/search",
			body,
		);

		if (!response.data || response.data.length === 0) break;

		for (const log of response.data) {
			const message = log.attributes.message ?? "";

			if (!matchesKeywords(message, filter.keywords)) continue;

			const service = log.attributes.service;
			const host = log.attributes.host;
			const tags = log.attributes.tags;
			const status = log.attributes.status;

			const title = service
				? `[${service}] ${truncate(message, 100)}`
				: truncate(message, 100);

			// Build content
			const lines = [message];
			if (service) lines.push(`**Service:** ${service}`);
			if (host) lines.push(`**Host:** ${host}`);
			if (tags && tags.length > 0) lines.push(`**Tags:** ${tags.join(", ")}`);

			const sourceUrl = `https://app.${site}/logs?query=${encodeURIComponent(query)}`;

			items.push({
				source: "datadog",
				externalId: log.id,
				title,
				content: lines.join("\n"),
				author: service ?? null,
				sourceUrl,
				timestamp: log.attributes.timestamp ?? new Date().toISOString(),
				metadata: {
					type: "log",
					status,
					service,
					host,
					tags,
				},
			});
		}

		const after = response.meta?.page?.after;
		if (!after) break;
		cursor = after;
	}

	items.sort(
		(a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
	);

	return items;
}

let healthCache: { result: SourceHealthCheck; expiresAt: number } | null = null;

export async function checkDatadogHealth(): Promise<SourceHealthCheck> {
	if (healthCache && healthCache.expiresAt > Date.now()) {
		return healthCache.result;
	}

	const now = new Date().toISOString();
	const site = getSite();

	if (!process.env.DATADOG_API_KEY || !process.env.DATADOG_APP_KEY) {
		return {
			source: "datadog",
			status: "not_configured",
			message: "DATADOG_API_KEY or DATADOG_APP_KEY not set",
			checkedAt: now,
		};
	}

	try {
		await datadogGet<{ valid: boolean }>("/api/v1/validate");

		const result: SourceHealthCheck = {
			source: "datadog",
			status: "connected",
			message: `Connected to Datadog (${site})`,
			checkedAt: now,
		};
		healthCache = { result, expiresAt: Date.now() + 60000 };
		return result;
	} catch (err) {
		const result: SourceHealthCheck = {
			source: "datadog",
			status: "error",
			message: err instanceof Error ? err.message : String(err),
			checkedAt: now,
		};
		healthCache = { result, expiresAt: Date.now() + 60000 };
		return result;
	}
}
