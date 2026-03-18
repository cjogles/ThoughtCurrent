import type {
	CompilationFilter,
	CompilationItem,
	SourceHealthCheck,
} from "@thoughtcurrent/shared";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";

function getClientId(): string {
	const id = process.env.GOOGLE_CLIENT_ID;
	if (!id) throw new Error("GOOGLE_CLIENT_ID not set");
	return id;
}

function getClientSecret(): string {
	const secret = process.env.GOOGLE_CLIENT_SECRET;
	if (!secret) throw new Error("GOOGLE_CLIENT_SECRET not set");
	return secret;
}

function getRefreshToken(): string | null {
	return process.env.GOOGLE_REFRESH_TOKEN ?? null;
}

function getRedirectUri(): string {
	const port = Number(process.env.PORT) || 3141;
	return `http://localhost:${port}/api/auth/gmail/callback`;
}

export function getGmailAuthUrl(): string {
	const params = new URLSearchParams({
		client_id: getClientId(),
		redirect_uri: getRedirectUri(),
		response_type: "code",
		scope: "https://www.googleapis.com/auth/gmail.readonly",
		access_type: "offline",
		prompt: "consent",
	});
	return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

export async function exchangeCodeForTokens(code: string): Promise<{
	access_token: string;
	refresh_token: string;
	expires_in: number;
}> {
	const res = await fetch(GOOGLE_TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			code,
			client_id: getClientId(),
			client_secret: getClientSecret(),
			redirect_uri: getRedirectUri(),
			grant_type: "authorization_code",
		}),
	});

	if (!res.ok) {
		const text = await res.text();
		throw new Error(`Token exchange failed: ${text}`);
	}

	return res.json();
}

// In-memory access token cache
let cachedAccessToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
	const now = Date.now();
	if (cachedAccessToken && cachedAccessToken.expiresAt > now + 60000) {
		return cachedAccessToken.token;
	}

	const refreshToken = getRefreshToken();
	if (!refreshToken) {
		throw new Error(
			"GOOGLE_REFRESH_TOKEN not set. Run the OAuth flow first: visit /api/auth/gmail",
		);
	}

	const res = await fetch(GOOGLE_TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			refresh_token: refreshToken,
			client_id: getClientId(),
			client_secret: getClientSecret(),
			grant_type: "refresh_token",
		}),
	});

	if (!res.ok) {
		const text = await res.text();
		throw new Error(`Token refresh failed: ${text}`);
	}

	const data = (await res.json()) as {
		access_token: string;
		expires_in: number;
	};
	cachedAccessToken = {
		token: data.access_token,
		expiresAt: now + data.expires_in * 1000,
	};

	return data.access_token;
}

interface GmailMessage {
	id: string;
	threadId: string;
}

interface GmailMessageFull {
	id: string;
	threadId: string;
	internalDate: string;
	snippet: string;
	payload: {
		headers: Array<{ name: string; value: string }>;
		mimeType: string;
		body?: { data?: string; size: number };
		parts?: Array<{
			mimeType: string;
			body?: { data?: string; size: number };
			parts?: Array<{
				mimeType: string;
				body?: { data?: string; size: number };
			}>;
		}>;
	};
}

async function gmailApi<T>(
	path: string,
	params: Record<string, string> = {},
): Promise<T> {
	const token = await getAccessToken();
	const url = new URL(`${GMAIL_API}${path}`);
	for (const [k, v] of Object.entries(params)) {
		url.searchParams.set(k, v);
	}

	const res = await fetch(url.toString(), {
		headers: { Authorization: `Bearer ${token}` },
	});

	if (!res.ok) {
		const text = await res.text();
		throw new Error(`Gmail API ${path} failed (${res.status}): ${text}`);
	}

	return res.json();
}

function decodeBase64Url(data: string): string {
	const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
	return atob(base64);
}

function extractTextBody(payload: GmailMessageFull["payload"]): string {
	// Try direct body first
	if (payload.body?.data) {
		return decodeBase64Url(payload.body.data);
	}

	// Search parts for text/plain, then text/html
	if (payload.parts) {
		for (const part of payload.parts) {
			if (part.mimeType === "text/plain" && part.body?.data) {
				return decodeBase64Url(part.body.data);
			}
			// Check nested parts (multipart/alternative inside multipart/mixed)
			if (part.parts) {
				for (const nested of part.parts) {
					if (nested.mimeType === "text/plain" && nested.body?.data) {
						return decodeBase64Url(nested.body.data);
					}
				}
			}
		}
		// Fallback to html if no plain text
		for (const part of payload.parts) {
			if (part.mimeType === "text/html" && part.body?.data) {
				const html = decodeBase64Url(part.body.data);
				return html
					.replace(/<[^>]*>/g, " ")
					.replace(/\s+/g, " ")
					.trim();
			}
		}
	}

	return "(no text body)";
}

function getHeader(
	headers: Array<{ name: string; value: string }>,
	name: string,
): string | null {
	const h = headers.find((h) => h.name.toLowerCase() === name.toLowerCase());
	return h?.value ?? null;
}

function matchesKeywords(
	text: string,
	keywords: string[] | undefined,
): boolean {
	if (!keywords || keywords.length === 0) return true;
	const lower = text.toLowerCase();
	return keywords.some((kw) => lower.includes(kw.toLowerCase()));
}

export async function compileGmail(
	filter: CompilationFilter,
): Promise<CompilationItem[]> {
	const items: CompilationItem[] = [];

	// Gmail search query with date range
	const startDate = new Date(filter.startDate);
	const endDate = new Date(filter.endDate);
	const afterEpoch = Math.floor(startDate.getTime() / 1000);
	const beforeEpoch = Math.floor(endDate.getTime() / 1000);

	let query = `after:${afterEpoch} before:${beforeEpoch}`;
	if (filter.keywords && filter.keywords.length > 0) {
		const keywordQuery = filter.keywords.map((kw) => `"${kw}"`).join(" OR ");
		query = `${query} {${keywordQuery}}`;
	}

	// List messages matching the query
	let pageToken: string | undefined;
	const messageIds: string[] = [];

	do {
		const params: Record<string, string> = {
			q: query,
			maxResults: "100",
		};
		if (pageToken) params.pageToken = pageToken;

		const data = await gmailApi<{
			messages?: GmailMessage[];
			nextPageToken?: string;
			resultSizeEstimate: number;
		}>("/users/me/messages", params);

		if (data.messages) {
			messageIds.push(...data.messages.map((m) => m.id));
		}
		pageToken = data.nextPageToken;
	} while (pageToken);

	// Fetch each message's full content
	for (const msgId of messageIds) {
		try {
			const msg = await gmailApi<GmailMessageFull>(
				`/users/me/messages/${msgId}`,
				{ format: "full" },
			);

			const from = getHeader(msg.payload.headers, "From") ?? "Unknown";
			const subject =
				getHeader(msg.payload.headers, "Subject") ?? "(no subject)";
			const to = getHeader(msg.payload.headers, "To") ?? "";
			const date = getHeader(msg.payload.headers, "Date") ?? "";
			const body = extractTextBody(msg.payload);

			if (!matchesKeywords(`${subject} ${body}`, filter.keywords)) continue;

			const timestamp = new Date(Number(msg.internalDate)).toISOString();

			items.push({
				source: "gmail",
				externalId: msg.id,
				title: subject,
				content: `From: ${from}\nTo: ${to}\nDate: ${date}\nSubject: ${subject}\n\n${body}`,
				author: from,
				sourceUrl: null,
				timestamp,
				metadata: {
					type: "email",
					threadId: msg.threadId,
					from,
					to,
					subject,
				},
			});
		} catch {
			// Skip individual messages on error
		}
	}

	// Sort chronologically
	items.sort(
		(a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
	);

	return items;
}

export async function checkGmailHealth(): Promise<SourceHealthCheck> {
	const now = new Date().toISOString();

	if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
		return {
			source: "gmail",
			status: "not_configured",
			message:
				"GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET not set. Create OAuth credentials in Google Cloud Console.",
			checkedAt: now,
		};
	}

	if (!getRefreshToken()) {
		return {
			source: "gmail",
			status: "error",
			message:
				"GOOGLE_REFRESH_TOKEN not set. Visit /api/auth/gmail to authorize.",
			checkedAt: now,
		};
	}

	try {
		const token = await getAccessToken();
		const data = await gmailApi<{ emailAddress: string }>("/users/me/profile");

		return {
			source: "gmail",
			status: "connected",
			message: `Authenticated as ${data.emailAddress}`,
			checkedAt: now,
		};
	} catch (err) {
		return {
			source: "gmail",
			status: "error",
			message: err instanceof Error ? err.message : String(err),
			checkedAt: now,
		};
	}
}
