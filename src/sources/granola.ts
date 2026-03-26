import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import type {
	CompilationItem,
	GranolaFilterConfig,
	SourceCompilationFilter,
	SourceHealthCheck,
} from "../types.js";

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
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 30_000);

	try {
		const res = await fetch(`${GRANOLA_API}${path}`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(body),
			signal: controller.signal,
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
	} finally {
		clearTimeout(timeout);
	}
}

async function fetchDocuments(
	startDate?: string,
	endDate?: string,
): Promise<GranolaDocument[]> {
	const docs: GranolaDocument[] = [];
	const start = startDate ? new Date(startDate).getTime() : null;
	const end = endDate ? new Date(endDate).getTime() : null;
	let offset = 0;
	const limit = 100;

	while (true) {
		const data = await granolaApi<{ docs: GranolaDocument[] }>(
			"/v2/get-documents",
			{ limit, offset, include_last_viewed_panel: false },
		);

		const batch = data.docs;
		if (!batch || batch.length === 0) break;

		for (const doc of batch) {
			const docTime = new Date(doc.created_at).getTime();
			if (start && docTime < start) continue;
			if (end && docTime > end) continue;
			docs.push(doc);
		}

		if (batch.length < limit) break;

		// Documents come newest-first — stop if oldest in batch is before our start
		if (start) {
			const oldestInBatch = new Date(
				batch[batch.length - 1].created_at,
			).getTime();
			if (oldestInBatch < start) break;
		}

		offset += limit;
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

async function processDocument(
	doc: GranolaDocument,
	keywords: string[] | undefined,
): Promise<CompilationItem | null> {
	const attendees = getAttendees(doc);
	const date = doc.created_at.split("T")[0];
	const label = `"${doc.title}" (${date})`;
	const metadataText = [doc.title, ...attendees].join(" ");
	const metadataMatch = matchesKeywords(metadataText, keywords);
	const hasKeywords = keywords && keywords.length > 0;

	const transcript = await fetchTranscript(doc.id);
	if (transcript.length === 0) {
		console.log(`  SKIP ${label} — no transcript`);
		return null;
	}

	const content = formatTranscript(transcript);
	if (!content) {
		console.log(`  SKIP ${label} — empty transcript`);
		return null;
	}

	if (hasKeywords && !metadataMatch) {
		if (!matchesKeywords(content, keywords)) {
			console.log(`  SKIP ${label} — no keyword match`);
			return null;
		}
		console.log(`  MATCH ${label} — keyword found in transcript`);
	} else if (hasKeywords && metadataMatch) {
		console.log(`  MATCH ${label} — keyword found in title/attendees`);
	} else {
		console.log(`  INCLUDE ${label} — no keyword filter`);
	}

	return {
		source: "granola",
		externalId: doc.id,
		title: doc.title || "Untitled Meeting",
		content,
		author: attendees.join(", ") || null,
		sourceUrl: `https://app.granola.ai/docs/${doc.id}`,
		timestamp: doc.created_at,
		metadata: {
			type: "transcript",
			attendees,
		},
	};
}

const BATCH_CONCURRENCY = 5;

export async function compileGranolaWithConfig(
	config: GranolaFilterConfig,
): Promise<CompilationItem[]> {
	const startTime = Date.now();
	console.log(
		`Granola: fetching document list${config.startDate ? ` from ${config.startDate.split("T")[0]}` : ""}${config.endDate ? ` to ${config.endDate.split("T")[0]}` : " (all history)"}...`,
	);

	const documents = await fetchDocuments(config.startDate, config.endDate);
	const hasKeywords = config.keywords && config.keywords.length > 0;
	const listTime = ((Date.now() - startTime) / 1000).toFixed(1);
	console.log(
		`Granola: found ${documents.length} documents in ${listTime}s${hasKeywords ? `\n  Keywords: ${config.keywords?.join(", ")}` : ""}`,
	);

	if (documents.length === 0) return [];

	// Log the date range of docs found
	const oldest = documents[documents.length - 1].created_at.split("T")[0];
	const newest = documents[0].created_at.split("T")[0];
	console.log(`Granola: date range of docs: ${oldest} to ${newest}`);

	const items: CompilationItem[] = [];
	const transcriptStart = Date.now();

	for (let i = 0; i < documents.length; i += BATCH_CONCURRENCY) {
		const batch = documents.slice(i, i + BATCH_CONCURRENCY);
		const batchNum = Math.floor(i / BATCH_CONCURRENCY) + 1;
		const totalBatches = Math.ceil(documents.length / BATCH_CONCURRENCY);
		console.log(
			`Granola: batch ${batchNum}/${totalBatches} (docs ${i + 1}-${i + batch.length})`,
		);

		const results = await Promise.allSettled(
			batch.map((doc) => processDocument(doc, config.keywords)),
		);

		for (let j = 0; j < results.length; j++) {
			const result = results[j];
			if (result.status === "fulfilled" && result.value) {
				items.push(result.value);
			} else if (result.status === "rejected") {
				const doc = batch[j];
				console.log(`  ERROR "${doc.title}" (${doc.id}): ${result.reason}`);
			}
		}
	}

	const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
	const transcriptTime = ((Date.now() - transcriptStart) / 1000).toFixed(1);
	console.log(
		`Granola: done — ${items.length}/${documents.length} matched, ${transcriptTime}s for transcripts, ${totalTime}s total`,
	);

	items.sort(
		(a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
	);

	return items;
}

export async function compileGranola(
	filter: SourceCompilationFilter,
): Promise<CompilationItem[]> {
	return compileGranolaWithConfig({
		keywords: filter.keywords,
		startDate: filter.startDate,
		endDate: filter.endDate,
	});
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
