import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import type { CacheData } from "./types.js";

const BASE_DIR = resolve(homedir(), "work/ThoughtCurrent");

function getCachePath(presetName: string): string {
	return resolve(BASE_DIR, `output/${presetName}/.meta/cache.json`);
}

export async function readCache(presetName: string): Promise<CacheData> {
	try {
		const file = Bun.file(getCachePath(presetName));
		return (await file.json()) as CacheData;
	} catch {
		return { version: 1, lastCompilation: null, sources: {} };
	}
}

export async function writeCache(
	presetName: string,
	cache: CacheData,
): Promise<void> {
	const cachePath = getCachePath(presetName);
	await mkdir(resolve(cachePath, ".."), { recursive: true });
	await Bun.write(cachePath, `${JSON.stringify(cache, null, 2)}\n`);
}
