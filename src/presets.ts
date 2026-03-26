import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { homedir } from "node:os";
import type { FilterPreset, PresetsData } from "./types.js";

const BASE_DIR = resolve(homedir(), "work/ThoughtCurrent");
const PRESETS_FILE = resolve(BASE_DIR, ".meta/presets.json");

export async function readPresets(): Promise<PresetsData> {
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

export async function writePresets(data: PresetsData): Promise<void> {
	await mkdir(resolve(PRESETS_FILE, ".."), { recursive: true });
	await Bun.write(PRESETS_FILE, `${JSON.stringify(data, null, 2)}\n`);
}

export async function getPresetByName(name: string): Promise<FilterPreset | null> {
	const data = await readPresets();
	return data.presets.find((p) => p.name === name) ?? null;
}

export async function savePreset(name: string, sourceConfigs: FilterPreset["sourceConfigs"]): Promise<FilterPreset> {
	const data = await readPresets();

	const existing = data.presets.findIndex((p) => p.name === name);
	const preset: FilterPreset = {
		id: existing >= 0 ? data.presets[existing].id : crypto.randomUUID(),
		name,
		createdAt: existing >= 0 ? data.presets[existing].createdAt : new Date().toISOString(),
		sourceConfigs,
	};

	if (existing >= 0) {
		data.presets[existing] = preset;
	} else {
		data.presets.push(preset);
	}

	await writePresets(data);
	return preset;
}

export async function deletePreset(name: string): Promise<boolean> {
	const data = await readPresets();
	const index = data.presets.findIndex((p) => p.name === name);

	if (index === -1) return false;

	data.presets.splice(index, 1);
	await writePresets(data);
	return true;
}
