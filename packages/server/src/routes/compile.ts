import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { CompilationFilterSchema } from "@thoughtcurrent/shared";
import type {
	CompilationFilter,
	CompilationItem,
	CompilationMeta,
	CompilationProgress,
	GenericSourceConfig,
	SourceCompilationFilter,
} from "@thoughtcurrent/shared";
import { Hono } from "hono";
import { readCache, writeCache } from "../lib/cache.js";
import {
	writeCompiledMarkdown,
	writeFigmaGranularOutput,
	writeGmailGranularOutput,
	writeGranolaGranularOutput,
	writeSlackGranularOutput,
	writeSourceMarkdown,
} from "../lib/writer.js";
import { compileFigma } from "../sources/figma.js";
import { compileGitHub } from "../sources/github.js";
import { compileGmail } from "../sources/gmail.js";
import {
	compileGranola,
	compileGranolaWithConfig,
} from "../sources/granola.js";
import { compileLinear } from "../sources/linear.js";
import { compileSlack } from "../sources/slack.js";
import { compileTrello } from "../sources/trello.js";

export const compileRoutes = new Hono();

const genericSourceFetchers: Record<
	string,
	(filter: SourceCompilationFilter) => Promise<CompilationItem[]>
> = {
	github: compileGitHub,
	gmail: compileGmail,
	granola: compileGranola,
	linear: compileLinear,
	trello: compileTrello,
};

function genericConfigToLegacy(
	config: GenericSourceConfig,
): SourceCompilationFilter {
	return {
		startDate: config.startDate,
		endDate: config.endDate,
		sources: [config.source],
		keywords: config.keywords,
		senders: config.senders,
	};
}

compileRoutes.post("/", async (c) => {
	const body = await c.req.json();
	const parsed = CompilationFilterSchema.safeParse(body);

	if (!parsed.success) {
		return c.json({ error: parsed.error.flatten() }, 400);
	}

	const filter = parsed.data as CompilationFilter;
	const compilationId = crypto.randomUUID();
	const progress: CompilationProgress[] = [];
	const allItems: CompilationItem[] = [];

	const cache = await readCache();

	for (const sourceConfig of filter.sourceConfigs) {
		const source = sourceConfig.source;

		progress.push({
			source,
			status: "fetching",
			itemsFetched: 0,
			message: `Fetching from ${source}...`,
		});

		try {
			let items: CompilationItem[];

			if (sourceConfig.source === "slack") {
				items = await compileSlack(sourceConfig.config);
			} else if (sourceConfig.source === "granola") {
				items = await compileGranolaWithConfig(sourceConfig.config);
			} else if (sourceConfig.source === "figma") {
				items = await compileFigma(sourceConfig.config);
			} else {
				const fetcher = genericSourceFetchers[source];
				if (!fetcher) {
					progress.push({
						source,
						status: "error",
						itemsFetched: 0,
						message: `Source "${source}" not yet implemented`,
					});
					continue;
				}
				items = await fetcher(genericConfigToLegacy(sourceConfig));
			}

			// Filter out already-cached items
			const cachedIds = new Set(
				(cache.sources[source] ?? []).map((e) => e.externalId),
			);
			const newItems = items.filter((item) => !cachedIds.has(item.externalId));

			allItems.push(...newItems);

			// Write output — granular for Slack/Granola/Gmail, standard for others
			if (source === "slack") {
				await writeSlackGranularOutput(newItems);
			} else if (source === "granola") {
				await writeGranolaGranularOutput(newItems);
			} else if (source === "figma") {
				await writeFigmaGranularOutput(newItems);
			} else if (source === "gmail") {
				await writeGmailGranularOutput(newItems);
			} else {
				await writeSourceMarkdown(source, newItems);
			}

			// Update cache
			const now = new Date().toISOString();
			cache.sources[source] = [
				...(cache.sources[source] ?? []),
				...newItems.map((item) => ({
					source,
					externalId: item.externalId,
					fetchedAt: now,
					contentHash: Bun.hash(item.content).toString(16),
				})),
			];

			progress.push({
				source,
				status: "done",
				itemsFetched: newItems.length,
				message: `Fetched ${newItems.length} new items (${items.length - newItems.length} cached)`,
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			progress.push({
				source,
				status: "error",
				itemsFetched: 0,
				message,
			});
		}
	}

	cache.lastCompilation = new Date().toISOString();
	await writeCache(cache);
	await writeCompiledMarkdown(allItems);

	const meta: CompilationMeta = {
		id: compilationId,
		filter,
		status: "completed",
		startedAt: new Date().toISOString(),
		completedAt: new Date().toISOString(),
		sourceCounts: Object.fromEntries(
			progress
				.filter((p) => p.status === "done")
				.map((p) => [p.source, p.itemsFetched]),
		),
	};

	return c.json({
		compilation: meta,
		progress,
		totalItems: allItems.length,
	});
});

const OUTPUT_DIR = resolve(import.meta.dir, "../../../../output");

compileRoutes.delete("/clear", async (c) => {
	// Remove all source directories and compiled markdown
	const entries = await Array.fromAsync(
		new Bun.Glob("*").scan({ cwd: OUTPUT_DIR, onlyFiles: false }),
	);

	for (const entry of entries) {
		if (entry === ".gitkeep" || entry === ".meta") continue;
		await rm(resolve(OUTPUT_DIR, entry), { recursive: true, force: true });
	}

	// Reset cache and summaries (presets survive)
	await writeCache({ version: 1, lastCompilation: null, sources: {} });
	await Bun.write(
		resolve(OUTPUT_DIR, ".meta/summaries.json"),
		'{\n  "version": 1,\n  "summaries": []\n}\n',
	);

	return c.json({ cleared: true });
});
