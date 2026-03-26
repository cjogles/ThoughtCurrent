import { rm } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { readCache, writeCache } from "./cache.js";
import {
	writeCompiledMarkdown,
	writeFigmaGranularOutput,
	writeGmailGranularOutput,
	writeGranolaGranularOutput,
	writeSlackGranularOutput,
	writeSourceMarkdown,
} from "./lib/writer.js";
import {
	CompilationLogger,
	clearErrorReport,
	logMcp,
	rotateCompilationLogs,
	writeErrorReport,
} from "./logger.js";
import { compileDatadog } from "./sources/datadog.js";
import { compileFigma } from "./sources/figma.js";
import { compileGitHub } from "./sources/github.js";
import { compileGmail } from "./sources/gmail.js";
import { compileGranola, compileGranolaWithConfig } from "./sources/granola.js";
import { compileHuggingFace } from "./sources/huggingface.js";
import { compileLinear } from "./sources/linear.js";
import { compileSentry } from "./sources/sentry.js";
import { compileSlack } from "./sources/slack.js";
import { compileTrello } from "./sources/trello.js";
import type {
	CompilationItem,
	CompilationMeta,
	CompilationProgress,
	FilterPreset,
	GenericSourceConfig,
	SourceCompilationFilter,
	SourceType,
} from "./types.js";

const BASE_DIR = resolve(homedir(), "work/ThoughtCurrent");

export type JobStatus = "running" | "completed" | "failed";

export interface CompilationJob {
	id: string;
	presetName: string;
	status: JobStatus;
	startedAt: string;
	completedAt: string | null;
	progress: CompilationProgress[];
	totalItems: number;
	outputPath: string;
	meta: CompilationMeta | null;
}

// In-memory job store
const jobs = new Map<string, CompilationJob>();

const genericSourceFetchers: Record<
	string,
	(filter: SourceCompilationFilter) => Promise<CompilationItem[]>
> = {
	github: compileGitHub,
	gmail: compileGmail,
	granola: compileGranola,
	linear: compileLinear,
	trello: compileTrello,
	sentry: compileSentry,
	datadog: compileDatadog,
	huggingface: compileHuggingFace,
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
		repos: config.repos,
		projects: config.projects,
		query: config.query,
		endpoints: config.endpoints,
	};
}

function getOutputDir(presetName: string): string {
	return resolve(BASE_DIR, `output/${presetName}`);
}

export function getJob(jobId: string): CompilationJob | undefined {
	return jobs.get(jobId);
}

export function startCompilation(preset: FilterPreset): string {
	const jobId = crypto.randomUUID();
	const outputDir = getOutputDir(preset.name);

	const job: CompilationJob = {
		id: jobId,
		presetName: preset.name,
		status: "running",
		startedAt: new Date().toISOString(),
		completedAt: null,
		progress: [],
		totalItems: 0,
		outputPath: outputDir,
		meta: null,
	};

	jobs.set(jobId, job);

	// Run compilation asynchronously
	runCompilation(job, preset).catch(async (err) => {
		job.status = "failed";
		job.completedAt = new Date().toISOString();
		await logMcp("error", "compile", `Job ${jobId} failed unexpectedly`, {
			error: err instanceof Error ? err.message : String(err),
		});
	});

	return jobId;
}

async function runCompilation(
	job: CompilationJob,
	preset: FilterPreset,
): Promise<void> {
	const logger = new CompilationLogger(preset.name, job.id);
	const outputDir = job.outputPath;
	const allItems: CompilationItem[] = [];

	await logger.log(
		"info",
		"compile",
		`Starting compilation for preset "${preset.name}"`,
		{
			sourceCount: preset.sourceConfigs.length,
			sources: preset.sourceConfigs.map((s) => s.source),
		},
	);

	const cache = await readCache(preset.name);

	for (const sourceConfig of preset.sourceConfigs) {
		const source = sourceConfig.source;
		const startTime = Date.now();

		job.progress.push({
			source,
			status: "fetching",
			itemsFetched: 0,
			message: `Fetching from ${source}...`,
		});

		await logger.sourceStart(source);

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
					const msg = `Source "${source}" not yet implemented`;
					job.progress.push({
						source,
						status: "error",
						itemsFetched: 0,
						message: msg,
					});
					await logger.sourceError(source, msg);
					continue;
				}
				items = await fetcher(genericConfigToLegacy(sourceConfig));
			}

			// Filter out already-cached items
			const cachedIds = new Set(
				(cache.sources[source] ?? []).map((e) => e.externalId),
			);
			const newItems = items.filter((item) => !cachedIds.has(item.externalId));

			await logger.cacheHit(source, items.length - newItems.length);
			await logger.cacheMiss(source, newItems.length);

			allItems.push(...newItems);

			// Write output
			if (source === "slack") {
				await writeSlackGranularOutput(outputDir, newItems);
			} else if (source === "granola") {
				await writeGranolaGranularOutput(outputDir, newItems);
			} else if (source === "figma") {
				await writeFigmaGranularOutput(outputDir, newItems);
			} else if (source === "gmail") {
				await writeGmailGranularOutput(outputDir, newItems);
			} else {
				await writeSourceMarkdown(outputDir, source, newItems);
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

			const durationMs = Date.now() - startTime;
			await logger.sourceComplete(source, newItems.length, durationMs);

			// Clear any previous error report for this source on success
			await clearErrorReport(preset.name, source);

			job.progress.push({
				source,
				status: "done",
				itemsFetched: newItems.length,
				message: `Fetched ${newItems.length} new items (${items.length - newItems.length} cached) in ${durationMs}ms`,
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			const stack = err instanceof Error ? err.stack : undefined;

			await logger.sourceError(source, message);

			// Write persistent error report
			const suggestedFix = getSuggestedFix(source, message);
			await writeErrorReport(
				preset.name,
				source,
				stack ?? message,
				sourceConfig,
				suggestedFix,
			);

			job.progress.push({
				source,
				status: "error",
				itemsFetched: 0,
				message,
			});
		}
	}

	cache.lastCompilation = new Date().toISOString();
	await writeCache(preset.name, cache);
	await writeCompiledMarkdown(outputDir, allItems);

	job.totalItems = allItems.length;
	job.status = "completed";
	job.completedAt = new Date().toISOString();
	job.meta = {
		id: job.id,
		filter: { sourceConfigs: preset.sourceConfigs },
		status: "completed",
		startedAt: job.startedAt,
		completedAt: job.completedAt,
		sourceCounts: Object.fromEntries(
			job.progress
				.filter((p) => p.status === "done")
				.map((p) => [p.source, p.itemsFetched]),
		),
	};

	await logger.log(
		"info",
		"compile",
		`Compilation complete: ${allItems.length} total items`,
		{
			sourceCounts: job.meta.sourceCounts,
		},
	);

	// Rotate old logs
	await rotateCompilationLogs(preset.name);
}

function getSuggestedFix(source: string, error: string): string {
	const lower = error.toLowerCase();

	if (
		lower.includes("token") ||
		lower.includes("unauthorized") ||
		lower.includes("401")
	) {
		return `Authentication issue. Re-run the auth script: \`! bun run ~/work/ThoughtCurrent/scripts/auth-${source}.ts\` or check your token in ~/work/ThoughtCurrent/.env`;
	}
	if (lower.includes("rate limit") || lower.includes("429")) {
		return "Rate limited. Wait a few minutes and try again.";
	}
	if (lower.includes("not found") || lower.includes("404")) {
		return `Resource not found. Check the ${source} configuration in your preset — the repo, channel, or file URL may have changed.`;
	}
	if (lower.includes("not set") || lower.includes("not configured")) {
		return `Missing configuration. Add the required environment variable to ~/work/ThoughtCurrent/.env`;
	}

	return `Check the error details above and verify your ${source} configuration.`;
}

export async function clearPresetOutput(
	presetName: string,
	source?: string,
): Promise<void> {
	const outputDir = getOutputDir(presetName);

	if (source) {
		// Clear a specific source within the preset
		await rm(resolve(outputDir, source), { recursive: true, force: true });
	} else {
		// Clear all output for this preset (except .meta for cache/presets)
		const glob = new Bun.Glob("*");
		for await (const entry of glob.scan({ cwd: outputDir, onlyFiles: false })) {
			if (entry === ".meta" || entry === ".logs" || entry === ".errors")
				continue;
			await rm(resolve(outputDir, entry), { recursive: true, force: true });
		}

		// Reset the cache for this preset
		await writeCache(presetName, {
			version: 1,
			lastCompilation: null,
			sources: {},
		});
	}
}
