import { homedir } from "node:os";
import { resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { clearPresetOutput, getJob, startCompilation } from "./compile.js";
import { logMcp } from "./logger.js";
import {
	deletePreset,
	getPresetByName,
	readPresets,
	savePreset,
} from "./presets.js";
import { SourceFilterConfigSchema } from "./schemas.js";
import { searchDms } from "./slack-dm.js";
import { listSlackChannels, listSlackUsers } from "./slack-meta.js";
import { checkAllStatus } from "./status.js";
import type { SourceFilterConfig } from "./types.js";

// Load .env from the centralized location
const ENV_PATH = resolve(homedir(), "work/ThoughtCurrent/.env");
try {
	const envFile = Bun.file(ENV_PATH);
	if (await envFile.exists()) {
		const content = await envFile.text();
		for (const line of content.split("\n")) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith("#")) continue;
			const eqIndex = trimmed.indexOf("=");
			if (eqIndex === -1) continue;
			const key = trimmed.slice(0, eqIndex).trim();
			const value = trimmed.slice(eqIndex + 1).trim();
			if (!process.env[key]) {
				process.env[key] = value;
			}
		}
	}
} catch {
	// .env may not exist yet
}

const server = new McpServer({
	name: "thoughtcurrent",
	version: "1.0.0",
});

await logMcp("info", "server", "ThoughtCurrent MCP server starting");

// --- Tool: compile ---
server.tool(
	"compile",
	"Compile data from configured sources for a named preset. Returns a job ID for polling.",
	{ preset: z.string().describe("Name of the preset to compile") },
	async ({ preset }) => {
		const presetData = await getPresetByName(preset);
		if (!presetData) {
			const allPresets = await readPresets();
			const names = allPresets.presets.map((p) => p.name).join(", ");
			return {
				content: [
					{
						type: "text" as const,
						text: `Preset "${preset}" not found. Available presets: ${names || "(none)"}`,
					},
				],
				isError: true,
			};
		}

		await logMcp(
			"info",
			"tool:compile",
			`Starting compilation for preset "${preset}"`,
		);
		const jobId = startCompilation(presetData);

		return {
			content: [
				{
					type: "text" as const,
					text: JSON.stringify(
						{ jobId, status: "running", preset: presetData.name },
						null,
						2,
					),
				},
			],
		};
	},
);

// --- Tool: check_compilation ---
server.tool(
	"check_compilation",
	"Check the status of a running or completed compilation job.",
	{ jobId: z.string().describe("The job ID returned by compile") },
	async ({ jobId }) => {
		const job = getJob(jobId);
		if (!job) {
			return {
				content: [
					{
						type: "text" as const,
						text: `Job "${jobId}" not found. It may have expired.`,
					},
				],
				isError: true,
			};
		}

		const completed = job.progress
			.filter((p) => p.status === "done")
			.map((p) => p.source);
		const failed = job.progress
			.filter((p) => p.status === "error")
			.map((p) => ({
				source: p.source,
				error: p.message,
			}));
		const pending = job.progress
			.filter((p) => p.status === "fetching")
			.map((p) => p.source);

		return {
			content: [
				{
					type: "text" as const,
					text: JSON.stringify(
						{
							status: job.status,
							completed,
							failed,
							pending,
							totalItems: job.totalItems,
							outputPath: job.outputPath,
							startedAt: job.startedAt,
							completedAt: job.completedAt,
						},
						null,
						2,
					),
				},
			],
		};
	},
);

// --- Tool: check_status ---
server.tool(
	"check_status",
	"Check the health/connection status of all configured data sources.",
	{},
	async () => {
		await logMcp("info", "tool:check_status", "Running health checks");
		const results = await checkAllStatus();

		return {
			content: [
				{
					type: "text" as const,
					text: JSON.stringify({ integrations: results }, null, 2),
				},
			],
		};
	},
);

// --- Tool: list_presets ---
server.tool(
	"list_presets",
	"List all saved compilation presets with their configurations.",
	{},
	async () => {
		const data = await readPresets();

		return {
			content: [
				{
					type: "text" as const,
					text: JSON.stringify(data, null, 2),
				},
			],
		};
	},
);

// --- Tool: save_preset ---
server.tool(
	"save_preset",
	"Create or update a named compilation preset with source configurations.",
	{
		name: z.string().describe("Preset name (e.g., 'messenger-recent')"),
		sourceConfigs: z
			.string()
			.describe("JSON string of SourceFilterConfig[] array"),
	},
	async ({ name, sourceConfigs: sourceConfigsStr }) => {
		let parsed: SourceFilterConfig[];
		try {
			parsed = JSON.parse(sourceConfigsStr);
			// Validate each config
			z.array(SourceFilterConfigSchema).parse(parsed);
		} catch (err) {
			return {
				content: [
					{
						type: "text" as const,
						text: `Invalid sourceConfigs: ${err instanceof Error ? err.message : String(err)}`,
					},
				],
				isError: true,
			};
		}

		await logMcp("info", "tool:save_preset", `Saving preset "${name}"`, {
			sourceCount: parsed.length,
		});
		const preset = await savePreset(name, parsed);

		return {
			content: [
				{
					type: "text" as const,
					text: JSON.stringify({ saved: true, preset }, null, 2),
				},
			],
		};
	},
);

// --- Tool: update_preset ---
server.tool(
	"update_preset",
	"Update an existing preset's source configurations.",
	{
		name: z.string().describe("Name of the preset to update"),
		sourceConfigs: z
			.string()
			.describe("JSON string of updated SourceFilterConfig[] array"),
	},
	async ({ name, sourceConfigs: sourceConfigsStr }) => {
		const existing = await getPresetByName(name);
		if (!existing) {
			return {
				content: [
					{
						type: "text" as const,
						text: `Preset "${name}" not found.`,
					},
				],
				isError: true,
			};
		}

		let parsed: SourceFilterConfig[];
		try {
			parsed = JSON.parse(sourceConfigsStr);
			z.array(SourceFilterConfigSchema).parse(parsed);
		} catch (err) {
			return {
				content: [
					{
						type: "text" as const,
						text: `Invalid sourceConfigs: ${err instanceof Error ? err.message : String(err)}`,
					},
				],
				isError: true,
			};
		}

		await logMcp("info", "tool:update_preset", `Updating preset "${name}"`);
		const preset = await savePreset(name, parsed);

		return {
			content: [
				{
					type: "text" as const,
					text: JSON.stringify({ updated: true, preset }, null, 2),
				},
			],
		};
	},
);

// --- Tool: delete_preset ---
server.tool(
	"delete_preset",
	"Delete a named preset.",
	{ name: z.string().describe("Name of the preset to delete") },
	async ({ name }) => {
		const deleted = await deletePreset(name);
		if (!deleted) {
			return {
				content: [
					{
						type: "text" as const,
						text: `Preset "${name}" not found.`,
					},
				],
				isError: true,
			};
		}

		await logMcp("info", "tool:delete_preset", `Deleted preset "${name}"`);

		return {
			content: [
				{
					type: "text" as const,
					text: JSON.stringify({ deleted: true, name }, null, 2),
				},
			],
		};
	},
);

// --- Tool: clear_output ---
server.tool(
	"clear_output",
	"Clear compiled output for a preset. Optionally clear only a specific source.",
	{
		preset: z.string().describe("Name of the preset whose output to clear"),
		source: z
			.string()
			.optional()
			.describe("Optional: specific source to clear (e.g., 'slack', 'github')"),
	},
	async ({ preset, source }) => {
		const presetData = await getPresetByName(preset);
		if (!presetData) {
			return {
				content: [
					{
						type: "text" as const,
						text: `Preset "${preset}" not found.`,
					},
				],
				isError: true,
			};
		}

		await logMcp(
			"info",
			"tool:clear_output",
			`Clearing output for "${preset}"`,
			{ source },
		);
		await clearPresetOutput(preset, source);

		return {
			content: [
				{
					type: "text" as const,
					text: JSON.stringify(
						{
							cleared: true,
							preset,
							source: source ?? "all",
						},
						null,
						2,
					),
				},
			],
		};
	},
);

// --- Tool: list_slack_channels ---
server.tool(
	"list_slack_channels",
	"List available Slack channels for preset configuration.",
	{},
	async () => {
		try {
			const channels = await listSlackChannels();
			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify({ channels }, null, 2),
					},
				],
			};
		} catch (err) {
			return {
				content: [
					{
						type: "text" as const,
						text: `Error: ${err instanceof Error ? err.message : String(err)}`,
					},
				],
				isError: true,
			};
		}
	},
);

// --- Tool: list_slack_users ---
server.tool(
	"list_slack_users",
	"List Slack workspace users for preset configuration.",
	{},
	async () => {
		try {
			const users = await listSlackUsers();
			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify({ users }, null, 2),
					},
				],
			};
		} catch (err) {
			return {
				content: [
					{
						type: "text" as const,
						text: `Error: ${err instanceof Error ? err.message : String(err)}`,
					},
				],
				isError: true,
			};
		}
	},
);

// --- Tool: search_dms ---
server.tool(
	"search_dms",
	"Search your Slack direct messages — both 1:1 DMs and group DMs (mpim). THIS IS THE WAY to read DMs — the compile/preset path and list_slack_channels use the bot token and CANNOT see your personal DMs; this tool uses your user token (im:history/mpim:history). For a 1:1 DM pass `person`; for a group DM pass `people` with 2+ members (it finds the group containing exactly you + them). Each identifier may be a Slack user ID (U0688…), @handle, full name, or email. Optionally filter by keywords + date range. Returns the actual messages from all participants, chronologically. Omit `query` to pull the whole thread. If no such DM exists it says so; an ambiguous group returns candidate channels.",
	{
		person: z
			.string()
			.optional()
			.describe(
				"For a 1:1 DM: Slack user ID (U…), @handle, full name, or email. Ambiguous names return the candidate list so you can retry with an exact handle/ID. Use `people` instead for group DMs.",
			),
		people: z
			.array(z.string())
			.optional()
			.describe(
				"For a GROUP DM: 2+ identifiers (IDs/@handles/names/emails) of the OTHER participants (you are implicit). Returns the group DM whose members are exactly you + these people. A single entry behaves like `person`.",
			),
		query: z
			.string()
			.optional()
			.describe(
				"Optional space-separated keywords; only messages containing ALL terms are returned (case-insensitive). Omit to get the entire DM thread.",
			),
		startDate: z
			.string()
			.optional()
			.describe("Optional ISO date/datetime lower bound (e.g. 2025-01-01)."),
		endDate: z
			.string()
			.optional()
			.describe("Optional ISO date/datetime upper bound (e.g. 2026-06-27)."),
		limit: z
			.number()
			.optional()
			.describe("Max messages to return (default 500, max 2000)."),
	},
	async ({ person, people, query, startDate, endDate, limit }) => {
		try {
			await logMcp(
				"info",
				"tool:search_dms",
				`Searching DMs with "${people?.join(", ") ?? person}"`,
				{
					hasQuery: !!query,
					group: !!people && people.length > 1,
				},
			);
			const result = await searchDms({
				person,
				people,
				query,
				startDate,
				endDate,
				limit,
			});
			return {
				content: [
					{ type: "text" as const, text: JSON.stringify(result, null, 2) },
				],
			};
		} catch (err) {
			return {
				content: [
					{
						type: "text" as const,
						text: `Error: ${err instanceof Error ? err.message : String(err)}`,
					},
				],
				isError: true,
			};
		}
	},
);

// Connect via stdio
const transport = new StdioServerTransport();
await server.connect(transport);

await logMcp("info", "server", "ThoughtCurrent MCP server connected via stdio");
