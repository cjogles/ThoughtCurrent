import type {
	CompilationItem,
	SourceCompilationFilter,
	SourceHealthCheck,
} from "@thoughtcurrent/shared";

const TRELLO_API = "https://api.trello.com/1";
const TRELLO_AUTH_URL = "https://trello.com/1/authorize";

function getApiKey(): string {
	const key = process.env.TRELLO_API_KEY;
	if (!key) throw new Error("TRELLO_API_KEY not set");
	return key;
}

function getToken(): string {
	const token = process.env.TRELLO_TOKEN;
	if (!token) throw new Error("TRELLO_TOKEN not set");
	return token;
}

export function getTrelloAuthUrl(): string {
	const port = Number(process.env.PORT) || 3141;
	const callbackUrl = `http://localhost:${port}/api/auth/trello/callback`;
	const params = new URLSearchParams({
		expiration: "never",
		name: "ThoughtCurrent",
		scope: "read",
		response_type: "fragment",
		key: getApiKey(),
		callback_url: callbackUrl,
		return_url: callbackUrl,
	});
	return `${TRELLO_AUTH_URL}?${params.toString()}`;
}

function authParams(): string {
	return `key=${getApiKey()}&token=${getToken()}`;
}

async function trelloGet<T>(path: string, params = ""): Promise<T> {
	const sep = params ? "&" : "";
	const url = `${TRELLO_API}${path}?${authParams()}${sep}${params}`;
	const res = await fetch(url);

	if (res.status === 429) {
		const retryAfter = Number(res.headers.get("Retry-After") ?? "10");
		await new Promise((r) => setTimeout(r, retryAfter * 1000));
		return trelloGet<T>(path, params);
	}

	if (!res.ok) {
		throw new Error(`Trello API ${path} HTTP ${res.status}: ${res.statusText}`);
	}

	return res.json() as Promise<T>;
}

interface TrelloBoard {
	id: string;
	name: string;
	url: string;
	closed: boolean;
}

interface TrelloCard {
	id: string;
	name: string;
	desc: string;
	url: string;
	dateLastActivity: string;
	idMembers: string[];
	labels: Array<{ name: string; color: string }>;
	closed: boolean;
}

interface TrelloCheckItem {
	id: string;
	name: string;
	state: "complete" | "incomplete";
}

interface TrelloChecklist {
	id: string;
	name: string;
	checkItems: TrelloCheckItem[];
}

interface TrelloAction {
	id: string;
	type: string;
	date: string;
	data: {
		text?: string;
		card?: { name: string };
		list?: { name: string };
	};
	memberCreator?: {
		fullName: string;
		username: string;
	};
}

interface TrelloMember {
	id: string;
	fullName: string;
	username: string;
}

// Cache member lookups per compilation
const memberCache = new Map<string, string>();

async function resolveMember(memberId: string): Promise<string> {
	if (memberCache.has(memberId)) return memberCache.get(memberId) as string;

	try {
		const data = await trelloGet<TrelloMember>(
			`/members/${memberId}`,
			"fields=fullName,username",
		);
		const name = data.fullName || data.username;
		memberCache.set(memberId, name);
		return name;
	} catch {
		memberCache.set(memberId, memberId);
		return memberId;
	}
}

function matchesKeywords(
	text: string,
	keywords: string[] | undefined,
): boolean {
	if (!keywords || keywords.length === 0) return true;
	const lower = text.toLowerCase();
	return keywords.some((kw) => lower.includes(kw.toLowerCase()));
}

export async function compileTrello(
	filter: SourceCompilationFilter,
): Promise<CompilationItem[]> {
	const items: CompilationItem[] = [];

	const boards = await trelloGet<TrelloBoard[]>(
		"/members/me/boards",
		"filter=open&fields=id,name,url,closed",
	);

	const startMs = new Date(filter.startDate).getTime();
	const endMs = new Date(filter.endDate).getTime();

	for (const board of boards) {
		const cards = await trelloGet<TrelloCard[]>(
			`/boards/${board.id}/cards`,
			"fields=id,name,desc,url,dateLastActivity,idMembers,labels,closed",
		);

		for (const card of cards) {
			// Filter by dateLastActivity in code — the Trello API's since/before
			// params on /boards/{id}/cards filter by creation date, not activity
			const activityMs = new Date(card.dateLastActivity).getTime();
			if (activityMs < startMs || activityMs > endMs) continue;

			const searchText = `${card.name} ${card.desc}`;
			if (!matchesKeywords(searchText, filter.keywords)) continue;

			// Fetch comments and checklists for this card
			const [actions, checklists] = await Promise.all([
				trelloGet<TrelloAction[]>(
					`/cards/${card.id}/actions`,
					`filter=commentCard&since=${filter.startDate}&before=${filter.endDate}`,
				),
				trelloGet<TrelloChecklist[]>(`/cards/${card.id}/checklists`),
			]);

			const assignees: string[] = [];
			for (const mid of card.idMembers) {
				assignees.push(await resolveMember(mid));
			}

			// Build content
			const lines = [card.desc || "*(no description)*"];
			const labels = card.labels.map((l) => l.name).filter(Boolean);
			if (labels.length > 0) {
				lines.push("", `**Labels:** ${labels.join(", ")}`);
			}

			if (checklists.length > 0) {
				for (const cl of checklists) {
					lines.push("", `### ${cl.name}`, "");
					for (const item of cl.checkItems) {
						const check = item.state === "complete" ? "x" : " ";
						lines.push(`- [${check}] ${item.name}`);
					}
				}
			}

			if (actions.length > 0) {
				lines.push("", "### Comments", "");
				for (const a of actions) {
					const author = a.memberCreator?.fullName ?? "Unknown";
					const date = new Date(a.date).toLocaleDateString();
					lines.push(`**${author}** (${date}):`, a.data.text ?? "", "");
				}
			}

			items.push({
				source: "trello",
				externalId: card.id,
				title: `${board.name} / ${card.name}`,
				content: lines.join("\n"),
				author: assignees.join(", ") || null,
				sourceUrl: card.url,
				timestamp: card.dateLastActivity,
				metadata: {
					type: "card",
					board: board.name,
					labels,
					commentCount: actions.length,
				},
			});
		}
	}

	memberCache.clear();

	items.sort(
		(a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
	);

	return items;
}

let healthCache: { result: SourceHealthCheck; expiresAt: number } | null = null;

export async function checkTrelloHealth(): Promise<SourceHealthCheck> {
	if (healthCache && healthCache.expiresAt > Date.now()) {
		return healthCache.result;
	}

	const now = new Date().toISOString();

	if (!process.env.TRELLO_API_KEY) {
		return {
			source: "trello",
			status: "not_configured",
			message:
				"TRELLO_API_KEY not set. Create a Trello Workspace, then get your API key at trello.com/power-ups/admin.",
			checkedAt: now,
		};
	}

	if (!process.env.TRELLO_TOKEN) {
		return {
			source: "trello",
			status: "error",
			message: "TRELLO_TOKEN not set. Visit /api/auth/trello to authorize.",
			checkedAt: now,
		};
	}

	try {
		const data = await trelloGet<TrelloMember>(
			"/members/me",
			"fields=fullName,username",
		);

		const result: SourceHealthCheck = {
			source: "trello",
			status: "connected",
			message: `Authenticated as ${data.fullName} (@${data.username})`,
			checkedAt: now,
		};
		healthCache = { result, expiresAt: Date.now() + 60000 };
		return result;
	} catch (err) {
		const result: SourceHealthCheck = {
			source: "trello",
			status: "error",
			message: err instanceof Error ? err.message : String(err),
			checkedAt: now,
		};
		healthCache = { result, expiresAt: Date.now() + 60000 };
		return result;
	}
}
