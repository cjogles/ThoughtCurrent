import { resolve } from "node:path";
import type { CacheData } from "@thoughtcurrent/shared";

const CACHE_PATH = resolve(
	import.meta.dir,
	"../../../../output/.meta/cache.json",
);

export async function readCache(): Promise<CacheData> {
	try {
		const file = Bun.file(CACHE_PATH);
		return (await file.json()) as CacheData;
	} catch {
		return { version: 1, lastCompilation: null, sources: {} };
	}
}

export async function writeCache(cache: CacheData): Promise<void> {
	await Bun.write(CACHE_PATH, `${JSON.stringify(cache, null, 2)}\n`);
}
