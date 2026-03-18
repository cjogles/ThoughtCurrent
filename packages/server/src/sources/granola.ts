import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import type {
	CompilationFilter,
	CompilationItem,
	SourceHealthCheck,
} from "@thoughtcurrent/shared";

const GRANOLA_API = "https://api.granola.ai";
const SUPABASE_JSON_PATH = resolve(
	homedir(),
	"Library/Application Support/Granola/supabase.json",
);

interface GranolaPerson {
	name: string;
	email?: string;
}

interface GranolaDocument {
	id: string;
	title: string;
	created_at: string;
	updated_at: string;
	people?: {
		creator?: GranolaPerson;
		attendees?: GranolaPerson[];
	};
}

interface TranscriptEntry {
	source: "microphone" | "system";
	text: string;
	start_timestamp: string; // ISO 8601
	end_timestamp: string; // ISO 8601
}

async function getAccessToken(): Promise<string> {
	const raw = await readFile(SUPABASE_JSON_PATH, "utf-8");
	const data = JSON.parse(raw);
	const workosTokens = JSON.parse(data.workos_tokens);

	if (!workosTokens.access_token) {
		throw new Error(
			"No WorkOS access token in Granola config. Open the Granola desktop app to refresh.",
		);
	}

	return workosTokens.access_token;
}

async function granolaApi<T>(
	path: string,
	body: Record<string, unknown>,
): Promise<T> {
	const token = await getAccessToken();
	const res = await fetch(`${GRANOLA_API}${path}`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(body),
	});

	if (res.status === 401 || res.status === 403) {
		throw new Error(
			"Granola token expired. Open the Granola desktop app to refresh authentication.",
		);
	}

	if (!res.ok) {
		throw new Error(
			`Granola API ${path} HTTP ${res.status}: ${res.statusText}`,
		);
	}

	return res.json() as Promise<T>;
}

async function fetchDocuments(
	startDate: string,
	endDate: string,
): Promise<GranolaDocument[]> {
	const docs: GranolaDocument[] = [];
	const start = new Date(startDate).getTime();
	const end = new Date(endDate).getTime();
	let offset = 0;
	const limit = 100;
	let hasMore = true;

	while (hasMore) {
		const data = await granolaApi<{ docs: GranolaDocument[] }>(
			"/v2/get-documents",
			{ limit, offset, include_last_viewed_panel: false },
		);

		const batch = data.docs;
		if (!batch || batch.length === 0) break;

		for (const doc of batch) {
			const docTime = new Date(doc.created_at).getTime();
			if (docTime >= start && docTime <= end) {
				docs.push(doc);
			}
		}

		if (batch.length < limit) break;

		// Documents come newest-first — stop if oldest in batch is before our range
		const oldestInBatch = new Date(
			batch[batch.length - 1].created_at,
		).getTime();
		if (oldestInBatch < start) {
			hasMore = false;
		} else {
			offset += limit;
		}
	}

	return docs;
}

async function fetchTranscript(documentId: string): Promise<TranscriptEntry[]> {
	const data = await granolaApi<
		TranscriptEntry[] | { transcript: TranscriptEntry[] }
	>("/v1/get-document-transcript", { document_id: documentId });

	if (Array.isArray(data)) return data;
	if (data && "transcript" in data) return data.transcript;
	return [];
}

function formatTranscript(entries: TranscriptEntry[]): string {
	return entries
		.map((e) => {
			const speaker = e.source === "microphone" ? "You" : "Other";
			return `[${speaker}] ${e.text}`;
		})
		.join("\n");
}

function getAttendees(doc: GranolaDocument): string[] {
	const names: string[] = [];
	if (doc.people?.creator?.name) names.push(doc.people.creator.name);
	if (doc.people?.attendees) {
		for (const a of doc.people.attendees) {
			if (a.name) names.push(a.name);
		}
	}
	return names;
}

function matchesKeywords(
	text: string,
	keywords: string[] | undefined,
): boolean {
	if (!keywords || keywords.length === 0) return true;
	const lower = text.toLowerCase();
	return keywords.some((kw) => lower.includes(kw.toLowerCase()));
}

export async function compileGranola(
	filter: CompilationFilter,
): Promise<CompilationItem[]> {
	const items: CompilationItem[] = [];
	const documents = await fetchDocuments(filter.startDate, filter.endDate);

	for (const doc of documents) {
		try {
			const transcript = await fetchTranscript(doc.id);
			if (transcript.length === 0) continue;

			const content = formatTranscript(transcript);
			if (!content) continue;
			if (!matchesKeywords(content, filter.keywords)) continue;

			const attendees = getAttendees(doc);

			items.push({
				source: "granola",
				externalId: doc.id,
				title: doc.title || "Untitled Meeting",
				content,
				author: attendees.join(", ") || null,
				sourceUrl: null,
				timestamp: doc.created_at,
				metadata: {
					type: "transcript",
					attendees,
				},
			});
		} catch {
			console.log(
				`Skipping Granola document ${doc.id}: transcript unavailable`,
			);
		}
	}

	items.sort(
		(a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
	);

	return items;
}

// Cache health check for 60s
let healthCache: { result: SourceHealthCheck; expiresAt: number } | null = null;

export async function checkGranolaHealth(): Promise<SourceHealthCheck> {
	if (healthCache && healthCache.expiresAt > Date.now()) {
		return healthCache.result;
	}

	const now = new Date().toISOString();

	try {
		const raw = await readFile(SUPABASE_JSON_PATH, "utf-8");
		const data = JSON.parse(raw);
		const userInfo = JSON.parse(data.user_info);
		const workosTokens = JSON.parse(data.workos_tokens);

		if (!workosTokens.access_token) {
			return {
				source: "granola",
				status: "not_configured",
				message: "Granola desktop app found but no access token",
				checkedAt: now,
			};
		}

		// Lightweight check — fetch 1 document to verify token works
		const res = await fetch(`${GRANOLA_API}/v2/get-documents`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${workosTokens.access_token}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ limit: 1, offset: 0 }),
		});

		if (!res.ok) {
			const result: SourceHealthCheck = {
				source: "granola",
				status: "error",
				message: `Token expired or invalid (HTTP ${res.status}). Open Granola app to refresh.`,
				checkedAt: now,
			};
			healthCache = { result, expiresAt: Date.now() + 60000 };
			return result;
		}

		const result: SourceHealthCheck = {
			source: "granola",
			status: "connected",
			message: `Authenticated as ${userInfo.email} via desktop app`,
			checkedAt: now,
		};
		healthCache = { result, expiresAt: Date.now() + 60000 };
		return result;
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);

		if (message.includes("ENOENT")) {
			return {
				source: "granola",
				status: "not_configured",
				message: "Granola desktop app not installed",
				checkedAt: now,
			};
		}

		const result: SourceHealthCheck = {
			source: "granola",
			status: "error",
			message,
			checkedAt: now,
		};
		healthCache = { result, expiresAt: Date.now() + 60000 };
		return result;
	}
}
