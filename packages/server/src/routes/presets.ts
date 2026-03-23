import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { FilterPreset, PresetsData } from "@thoughtcurrent/shared";
import { Hono } from "hono";

export const presetRoutes = new Hono();

const PRESETS_FILE = resolve(
	import.meta.dir,
	"../../../../output/.meta/presets.json",
);

async function readPresets(): Promise<PresetsData> {
	try {
		const file = Bun.file(PRESETS_FILE);
		if (await file.exists()) {
			return (await file.json()) as PresetsData;
		}
	} catch {
		// ignore
	}
	return { version: 1, presets: [] };
}

async function writePresets(data: PresetsData): Promise<void> {
	await mkdir(resolve(PRESETS_FILE, ".."), { recursive: true });
	await Bun.write(PRESETS_FILE, JSON.stringify(data, null, 2));
}

presetRoutes.get("/", async (c) => {
	const data = await readPresets();
	return c.json(data);
});

presetRoutes.post("/", async (c) => {
	const body = await c.req.json();
	const { name, sourceConfigs } = body;

	if (!name || !sourceConfigs || !Array.isArray(sourceConfigs)) {
		return c.json({ error: "name and sourceConfigs are required" }, 400);
	}

	const data = await readPresets();
	const preset: FilterPreset = {
		id: crypto.randomUUID(),
		name,
		createdAt: new Date().toISOString(),
		sourceConfigs,
	};

	data.presets.push(preset);
	await writePresets(data);

	return c.json({ preset });
});

presetRoutes.delete("/:id", async (c) => {
	const id = c.req.param("id");
	const data = await readPresets();
	const index = data.presets.findIndex((p) => p.id === id);

	if (index === -1) {
		return c.json({ error: "Preset not found" }, 404);
	}

	data.presets.splice(index, 1);
	await writePresets(data);

	return c.json({ deleted: true });
});
