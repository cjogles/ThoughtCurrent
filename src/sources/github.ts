import type {
	CompilationItem,
	SourceCompilationFilter,
	SourceHealthCheck,
} from "../types.js";

interface GitHubIssue {
	number: number;
	title: string;
	body: string | null;
	user: { login: string };
	html_url: string;
	created_at: string;
	updated_at: string;
	state: string;
	labels: Array<{ name: string }>;
	comments: number;
}

interface GitHubPR {
	number: number;
	title: string;
	body: string | null;
	user: { login: string };
	html_url: string;
	created_at: string;
	updated_at: string;
	state: string;
	labels: Array<{ name: string }>;
	draft: boolean;
	merged_at: string | null;
}

interface GitHubComment {
	id: number;
	body: string;
	user: { login: string };
	html_url: string;
	created_at: string;
	updated_at: string;
}

async function gh(args: string[]): Promise<string> {
	const proc = Bun.spawn(["gh", ...args], {
		stdout: "pipe",
		stderr: "pipe",
	});

	const stdout = await new Response(proc.stdout).text();
	const stderr = await new Response(proc.stderr).text();
	const exitCode = await proc.exited;

	if (exitCode !== 0) {
		throw new Error(`gh ${args.join(" ")} failed: ${stderr}`);
	}

	return stdout.trim();
}

function matchesKeywords(
	text: string,
	keywords: string[] | undefined,
): boolean {
	if (!keywords || keywords.length === 0) return true;
	const lower = text.toLowerCase();
	return keywords.some((kw) => lower.includes(kw.toLowerCase()));
}

async function compileRepo(
	repo: string,
	filter: SourceCompilationFilter,
): Promise<CompilationItem[]> {
	const items: CompilationItem[] = [];

	// Fetch issues
	const issuesJson = await gh([
		"api",
		`/repos/${repo}/issues`,
		"--paginate",
		"-q",
		".",
		"--jq",
		`.[] | select(.pull_request == null) | select(.created_at >= "${filter.startDate}" and .created_at <= "${filter.endDate}")`,
	]);

	if (issuesJson) {
		const issues: GitHubIssue[] = issuesJson
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line));

		for (const issue of issues) {
			const text = `# ${issue.title}\n\n${issue.body ?? ""}\n\nState: ${issue.state}\nLabels: ${issue.labels.map((l) => l.name).join(", ") || "none"}`;

			if (!matchesKeywords(text, filter.keywords)) continue;

			items.push({
				source: "github",
				externalId: `issue-${issue.number}`,
				title: `Issue #${issue.number}: ${issue.title}`,
				content: text,
				author: issue.user.login,
				sourceUrl: issue.html_url,
				timestamp: issue.created_at,
				metadata: {
					type: "issue",
					state: issue.state,
					labels: issue.labels.map((l) => l.name),
					commentCount: issue.comments,
				},
			});

			// Fetch comments if the issue has any
			if (issue.comments > 0) {
				try {
					const commentsJson = await gh([
						"api",
						`/repos/${repo}/issues/${issue.number}/comments`,
						"--jq",
						".[]",
					]);

					if (commentsJson) {
						const comments: GitHubComment[] = commentsJson
							.split("\n")
							.filter(Boolean)
							.map((line) => JSON.parse(line));

						for (const comment of comments) {
							if (
								comment.created_at < filter.startDate ||
								comment.created_at > filter.endDate
							)
								continue;

							items.push({
								source: "github",
								externalId: `issue-${issue.number}-comment-${comment.id}`,
								title: `Comment on Issue #${issue.number}: ${issue.title}`,
								content: comment.body,
								author: comment.user.login,
								sourceUrl: comment.html_url,
								timestamp: comment.created_at,
								metadata: {
									type: "issue_comment",
									issueNumber: issue.number,
								},
							});
						}
					}
				} catch {
					// Skip comments on error, still capture the issue itself
				}
			}
		}
	}

	// Fetch PRs
	const prsJson = await gh([
		"api",
		`/repos/${repo}/pulls`,
		"--paginate",
		"-q",
		".",
		"--jq",
		`.[] | select(.created_at >= "${filter.startDate}" and .created_at <= "${filter.endDate}")`,
	]);

	if (prsJson) {
		const prs: GitHubPR[] = prsJson
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line));

		for (const pr of prs) {
			const text = `# ${pr.title}\n\n${pr.body ?? ""}\n\nState: ${pr.state}${pr.merged_at ? " (merged)" : ""}${pr.draft ? " [DRAFT]" : ""}\nLabels: ${pr.labels.map((l) => l.name).join(", ") || "none"}`;

			if (!matchesKeywords(text, filter.keywords)) continue;

			items.push({
				source: "github",
				externalId: `pr-${pr.number}`,
				title: `PR #${pr.number}: ${pr.title}`,
				content: text,
				author: pr.user.login,
				sourceUrl: pr.html_url,
				timestamp: pr.created_at,
				metadata: {
					type: "pull_request",
					state: pr.state,
					draft: pr.draft,
					merged: pr.merged_at !== null,
					labels: pr.labels.map((l) => l.name),
				},
			});
		}
	}

	// Sort chronologically
	items.sort(
		(a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
	);

	return items;
}

export async function compileGitHub(
	filter: SourceCompilationFilter,
): Promise<CompilationItem[]> {
	const repos = filter.repos;
	if (!repos || repos.length === 0) {
		throw new Error(
			'No repos configured. Add repos to your preset\'s GitHub source config (e.g. ["org/repo"])',
		);
	}

	const allItems: CompilationItem[] = [];
	for (const repo of repos) {
		const items = await compileRepo(repo, filter);
		allItems.push(...items);
	}

	allItems.sort(
		(a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
	);

	return allItems;
}

export async function checkGitHubHealth(): Promise<SourceHealthCheck> {
	const now = new Date().toISOString();

	try {
		await gh(["auth", "status"]);

		return {
			source: "github",
			status: "connected",
			message: "gh CLI authenticated. Repos are configured per-preset.",
			checkedAt: now,
		};
	} catch (err) {
		return {
			source: "github",
			status: "error",
			message: err instanceof Error ? err.message : String(err),
			checkedAt: now,
		};
	}
}
