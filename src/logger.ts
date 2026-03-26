import { appendFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { homedir } from "node:os";

const BASE_DIR = resolve(homedir(), "work/ThoughtCurrent");
const MCP_LOG = resolve(BASE_DIR, ".logs/mcp.log");

export type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: Record<LogLevel, number> = {
	debug: 0,
	info: 1,
	warn: 2,
	error: 3,
};

let minLevel: LogLevel = "debug";

export function setLogLevel(level: LogLevel): void {
	minLevel = level;
}

function formatTimestamp(): string {
	return new Date().toISOString();
}

function formatMessage(level: LogLevel, component: string, message: string, data?: Record<string, unknown>): string {
	const parts = [`[${formatTimestamp()}] [${level.toUpperCase()}] [${component}] ${message}`];
	if (data) {
		parts.push(` ${JSON.stringify(data)}`);
	}
	return parts.join("") + "\n";
}

async function writeToFile(filePath: string, message: string): Promise<void> {
	await mkdir(resolve(filePath, ".."), { recursive: true });
	await appendFile(filePath, message);
}

export async function logMcp(level: LogLevel, component: string, message: string, data?: Record<string, unknown>): Promise<void> {
	if (LOG_LEVELS[level] < LOG_LEVELS[minLevel]) return;
	const formatted = formatMessage(level, component, message, data);
	await writeToFile(MCP_LOG, formatted);
}

export class CompilationLogger {
	private logFile: string;
	private lines: string[] = [];

	constructor(presetName: string, jobId: string) {
		this.logFile = resolve(BASE_DIR, `output/${presetName}/.logs/${jobId}.log`);
	}

	async log(level: LogLevel, component: string, message: string, data?: Record<string, unknown>): Promise<void> {
		const formatted = formatMessage(level, component, message, data);
		this.lines.push(formatted);
		await writeToFile(this.logFile, formatted);
	}

	async apiCall(source: string, url: string, status: number, durationMs: number): Promise<void> {
		await this.log("debug", source, `API ${status} ${url}`, { durationMs });
	}

	async cacheHit(source: string, count: number): Promise<void> {
		await this.log("debug", source, `Cache hit: ${count} items skipped`);
	}

	async cacheMiss(source: string, count: number): Promise<void> {
		await this.log("debug", source, `New items: ${count}`);
	}

	async sourceStart(source: string): Promise<void> {
		await this.log("info", source, `Starting fetch`);
	}

	async sourceComplete(source: string, itemCount: number, durationMs: number): Promise<void> {
		await this.log("info", source, `Completed: ${itemCount} items`, { durationMs });
	}

	async sourceError(source: string, error: string): Promise<void> {
		await this.log("error", source, `Failed: ${error}`);
	}
}

export async function writeErrorReport(
	presetName: string,
	source: string,
	error: string,
	filterConfig: unknown,
	suggestedFix?: string,
): Promise<void> {
	const date = new Date().toISOString().split("T")[0];
	const errorDir = resolve(BASE_DIR, `output/${presetName}/.errors`);
	await mkdir(errorDir, { recursive: true });

	const errorFile = resolve(errorDir, `${source}_${date}.md`);
	const content = [
		`# Error: ${source}`,
		"",
		`**Date:** ${new Date().toISOString()}`,
		`**Preset:** ${presetName}`,
		`**Source:** ${source}`,
		"",
		"## Error",
		"",
		"```",
		error,
		"```",
		"",
		"## Filter Config",
		"",
		"```json",
		JSON.stringify(filterConfig, null, 2),
		"```",
		"",
		suggestedFix ? `## Suggested Fix\n\n${suggestedFix}\n` : "",
	].join("\n");

	await writeToFile(errorFile, content);
}

export async function clearErrorReport(presetName: string, source: string): Promise<void> {
	const errorDir = resolve(BASE_DIR, `output/${presetName}/.errors`);
	const glob = new Bun.Glob(`${source}_*.md`);

	for await (const file of glob.scan({ cwd: errorDir })) {
		try {
			const { unlink } = await import("node:fs/promises");
			await unlink(resolve(errorDir, file));
		} catch {
			// File may already be deleted
		}
	}
}

export async function rotateCompilationLogs(presetName: string, keepCount = 10): Promise<void> {
	const logsDir = resolve(BASE_DIR, `output/${presetName}/.logs`);

	try {
		const glob = new Bun.Glob("*.log");
		const files: { name: string; mtime: number }[] = [];

		for await (const file of glob.scan({ cwd: logsDir })) {
			const stat = await Bun.file(resolve(logsDir, file)).lastModified;
			files.push({ name: file, mtime: stat });
		}

		files.sort((a, b) => b.mtime - a.mtime);

		if (files.length > keepCount) {
			const { unlink } = await import("node:fs/promises");
			for (const file of files.slice(keepCount)) {
				await unlink(resolve(logsDir, file.name));
			}
		}
	} catch {
		// Directory may not exist yet
	}
}
