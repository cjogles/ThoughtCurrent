import type {
	CompilationFilter,
	CompilationItem,
	SourceHealthCheck,
} from "@thoughtcurrent/shared";

const TRELLO_API = "https://api.trello.com/1";

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
	filter: CompilationFilter,
): Promise<CompilationItem[]> {
	const items: CompilationItem[] = [];

	const boards = await trelloGet<TrelloBoard[]>(
		"/members/me/boards",
		"filter=open&fields=id,name,url,closed",
	);

	for (const board of boards) {
		const cards = await trelloGet<TrelloCard[]>(
			`/boards/${board.id}/cards`,
			`fields=id,name,desc,url,dateLastActivity,idMembers,labels,closed&since=${filter.startDate}&before=${filter.endDate}`,
		);

		for (const card of cards) {
			const searchText = `${card.name} ${card.desc}`;
			if (!matchesKeywords(searchText, filter.keywords)) continue;

			// Fetch comments for this card
			const actions = await trelloGet<TrelloAction[]>(
				`/cards/${card.id}/actions`,
				`filter=commentCard&since=${filter.startDate}&before=${filter.endDate}`,
			);

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

	if (!process.env.TRELLO_API_KEY || !process.env.TRELLO_TOKEN) {
		return {
			source: "trello",
			status: "not_configured",
			message: "TRELLO_API_KEY and/or TRELLO_TOKEN not set",
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
