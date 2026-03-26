import type { SourceHealthCheck, SourceType } from "./types.js";
import { checkFigmaHealth } from "./sources/figma.js";
import { checkGitHubHealth } from "./sources/github.js";
import { checkGmailHealth } from "./sources/gmail.js";
import { checkGranolaHealth } from "./sources/granola.js";
import { checkLinearHealth } from "./sources/linear.js";
import { checkSlackHealth } from "./sources/slack.js";
import { checkTrelloHealth } from "./sources/trello.js";

const healthCheckers: Partial<
	Record<SourceType, () => Promise<SourceHealthCheck>>
> = {
	figma: checkFigmaHealth,
	github: checkGitHubHealth,
	gmail: checkGmailHealth,
	granola: checkGranolaHealth,
	linear: checkLinearHealth,
	slack: checkSlackHealth,
	trello: checkTrelloHealth,
};

export async function checkAllStatus(): Promise<SourceHealthCheck[]> {
	const results: SourceHealthCheck[] = [];

	for (const [source, checker] of Object.entries(healthCheckers)) {
		try {
			results.push(await checker());
		} catch {
			results.push({
				source: source as SourceType,
				status: "error",
				message: "Health check failed unexpectedly",
				checkedAt: new Date().toISOString(),
			});
		}
	}

	return results;
}
