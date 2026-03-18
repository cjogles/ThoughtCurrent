import type {
	CompilationFilter,
	CompilationItem,
	SourceHealthCheck,
} from "@thoughtcurrent/shared";

const LINEAR_API = "https://api.linear.app/graphql";

function getApiKey(): string {
	const key = process.env.LINEAR_API_KEY;
	if (!key) throw new Error("LINEAR_API_KEY not set");
	return key;
}

interface GqlResponse<T> {
	data: T;
	errors?: Array<{ message: string }>;
}

async function linearGql<T>(
	query: string,
	variables: Record<string, unknown> = {},
): Promise<T> {
	const res = await fetch(LINEAR_API, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: getApiKey(),
		},
		body: JSON.stringify({ query, variables }),
	});

	if (!res.ok) {
		throw new Error(`Linear API HTTP ${res.status}: ${res.statusText}`);
	}

	const json = (await res.json()) as GqlResponse<T>;
	if (json.errors?.length) {
		throw new Error(`Linear GraphQL: ${json.errors[0].message}`);
	}

	return json.data;
}

interface LinearIssue {
	id: string;
	identifier: string;
	title: string;
	description: string | null;
	createdAt: string;
	updatedAt: string;
	url: string;
	state: { name: string } | null;
	assignee: { name: string } | null;
	labels: { nodes: Array<{ name: string }> };
	comments: {
		nodes: Array<{
			body: string;
			createdAt: string;
			user: { name: string } | null;
		}>;
	};
}

interface IssuesResponse {
	issues: {
		nodes: LinearIssue[];
		pageInfo: { hasNextPage: boolean; endCursor: string | null };
	};
}

const ISSUES_QUERY = `
query Issues($after: String, $startDate: DateTime!, $endDate: DateTime!) {
  issues(
    first: 50
    after: $after
    orderBy: updatedAt
    filter: {
      updatedAt: { gte: $startDate, lte: $endDate }
    }
  ) {
    nodes {
      id
      identifier
      title
      description
      createdAt
      updatedAt
      url
      state { name }
      assignee { name }
      labels { nodes { name } }
      comments {
        nodes {
          body
          createdAt
          user { name }
        }
      }
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}
`;

function matchesKeywords(
	text: string,
	keywords: string[] | undefined,
): boolean {
	if (!keywords || keywords.length === 0) return true;
	const lower = text.toLowerCase();
	return keywords.some((kw) => lower.includes(kw.toLowerCase()));
}

export async function compileLinear(
	filter: CompilationFilter,
): Promise<CompilationItem[]> {
	const items: CompilationItem[] = [];
	let cursor: string | null = null;
	let hasMore = true;

	while (hasMore) {
		const data: IssuesResponse = await linearGql<IssuesResponse>(ISSUES_QUERY, {
			after: cursor,
			startDate: filter.startDate,
			endDate: filter.endDate,
		});

		for (const issue of data.issues.nodes) {
			const searchText = [issue.title, issue.description ?? ""].join(" ");
			if (!matchesKeywords(searchText, filter.keywords)) continue;

			const labels = issue.labels.nodes.map((l: { name: string }) => l.name);
			const state = issue.state?.name ?? "Unknown";

			// Build content with comments
			const lines = [issue.description ?? "*(no description)*"];
			if (issue.comments.nodes.length > 0) {
				lines.push("", "### Comments", "");
				for (const c of issue.comments.nodes) {
					const author = c.user?.name ?? "Unknown";
					const date = new Date(c.createdAt).toLocaleDateString();
					lines.push(`**${author}** (${date}):`, c.body, "");
				}
			}

			items.push({
				source: "linear",
				externalId: issue.id,
				title: `${issue.identifier}: ${issue.title}`,
				content: lines.join("\n"),
				author: issue.assignee?.name ?? null,
				sourceUrl: issue.url,
				timestamp: issue.updatedAt,
				metadata: {
					type: "issue",
					state,
					labels,
					identifier: issue.identifier,
					commentCount: issue.comments.nodes.length,
				},
			});
		}

		hasMore = data.issues.pageInfo.hasNextPage;
		cursor = data.issues.pageInfo.endCursor;
	}

	items.sort(
		(a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
	);

	return items;
}

let healthCache: { result: SourceHealthCheck; expiresAt: number } | null = null;

export async function checkLinearHealth(): Promise<SourceHealthCheck> {
	if (healthCache && healthCache.expiresAt > Date.now()) {
		return healthCache.result;
	}

	const now = new Date().toISOString();

	if (!process.env.LINEAR_API_KEY) {
		return {
			source: "linear",
			status: "not_configured",
			message: "LINEAR_API_KEY not set",
			checkedAt: now,
		};
	}

	try {
		const data = await linearGql<{
			viewer: { name: string; email: string };
		}>("{ viewer { name email } }");

		const result: SourceHealthCheck = {
			source: "linear",
			status: "connected",
			message: `Authenticated as ${data.viewer.name} (${data.viewer.email})`,
			checkedAt: now,
		};
		healthCache = { result, expiresAt: Date.now() + 60000 };
		return result;
	} catch (err) {
		const result: SourceHealthCheck = {
			source: "linear",
			status: "error",
			message: err instanceof Error ? err.message : String(err),
			checkedAt: now,
		};
		healthCache = { result, expiresAt: Date.now() + 60000 };
		return result;
	}
}
