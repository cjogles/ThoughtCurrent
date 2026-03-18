import type { SourceHealthCheck, SourceType } from "@thoughtcurrent/shared";
import { Hono } from "hono";
import { checkGitHubHealth } from "../sources/github.js";
import { checkGmailHealth } from "../sources/gmail.js";
import { checkGranolaHealth } from "../sources/granola.js";
import { checkLinearHealth } from "../sources/linear.js";
import { checkSlackHealth } from "../sources/slack.js";
import { checkTrelloHealth } from "../sources/trello.js";

export const statusRoutes = new Hono();

const healthCheckers: Partial<
	Record<SourceType, () => Promise<SourceHealthCheck>>
> = {
	github: checkGitHubHealth,
	gmail: checkGmailHealth,
	granola: checkGranolaHealth,
	linear: checkLinearHealth,
	slack: checkSlackHealth,
	trello: checkTrelloHealth,
};

statusRoutes.get("/", async (c) => {
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

	return c.json({ integrations: results });
});
