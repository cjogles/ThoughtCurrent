import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { CompilationFilterSchema } from "@thoughtcurrent/shared";
import type {
	CompilationFilter,
	CompilationItem,
	CompilationMeta,
	CompilationProgress,
} from "@thoughtcurrent/shared";
import { Hono } from "hono";
import { readCache, writeCache } from "../lib/cache.js";
import { writeCompiledMarkdown, writeSourceMarkdown } from "../lib/writer.js";
import { compileGitHub } from "../sources/github.js";
import { compileGmail } from "../sources/gmail.js";
import { compileGranola } from "../sources/granola.js";
import { compileLinear } from "../sources/linear.js";
import { compileSlack } from "../sources/slack.js";
import { compileTrello } from "../sources/trello.js";

export const compileRoutes = new Hono();

compileRoutes.post("/", async (c) => {
	const body = await c.req.json();
	const parsed = CompilationFilterSchema.safeParse(body);

	if (!parsed.success) {
		return c.json({ error: parsed.error.flatten() }, 400);
	}

	const filter = parsed.data;
	const compilationId = crypto.randomUUID();
	const progress: CompilationProgress[] = [];
	const allItems: CompilationItem[] = [];

	const sourceFetchers: Record<
		string,
		(filter: CompilationFilter) => Promise<CompilationItem[]>
	> = {
		github: compileGitHub,
		gmail: compileGmail,
		granola: compileGranola,
		linear: compileLinear,
		slack: compileSlack,
		trello: compileTrello,
	};

	const cache = await readCache();

	for (const source of filter.sources) {
		const fetcher = sourceFetchers[source];
		if (!fetcher) {
			progress.push({
				source,
				status: "error",
				itemsFetched: 0,
				message: `Source "${source}" not yet implemented`,
			});
			continue;
		}

		progress.push({
			source,
			status: "fetching",
			itemsFetched: 0,
			message: `Fetching from ${source}...`,
		});

		try {
			const items = await fetcher(filter);

			// Filter out already-cached items
			const cachedIds = new Set(
				(cache.sources[source] ?? []).map((e) => e.externalId),
			);
			const newItems = items.filter((item) => !cachedIds.has(item.externalId));

			allItems.push(...newItems);
			await writeSourceMarkdown(source, newItems);

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

	return c.json({ compilation: meta, progress, totalItems: allItems.length });
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

	// Reset cache and summaries
	await writeCache({ version: 1, lastCompilation: null, sources: {} });
	await Bun.write(
		resolve(OUTPUT_DIR, ".meta/summaries.json"),
		'{\n  "version": 1,\n  "summaries": []\n}\n',
	);

	return c.json({ cleared: true });
});
