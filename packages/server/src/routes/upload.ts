import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { Hono } from "hono";

const OUTPUT_DIR = resolve(import.meta.dir, "../../../../output/manual");
const IMAGES_DIR = resolve(OUTPUT_DIR, "images");

const TEXT_EXTENSIONS = new Set([".md", ".txt"]);
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);
const PDF_EXTENSIONS = new Set([".pdf"]);
const ALLOWED_EXTENSIONS = new Set([
	...TEXT_EXTENSIONS,
	...IMAGE_EXTENSIONS,
	...PDF_EXTENSIONS,
]);

function getExtension(filename: string): string {
	const dot = filename.lastIndexOf(".");
	if (dot === -1) return "";
	return filename.slice(dot).toLowerCase();
}

export const uploadRoutes = new Hono();

uploadRoutes.post("/", async (c) => {
	const body = await c.req.parseBody();
	const file = body.file;

	if (!file || !(file instanceof File)) {
		return c.json({ error: "No file provided" }, 400);
	}

	const ext = getExtension(file.name);
	if (!ALLOWED_EXTENSIONS.has(ext)) {
		return c.json(
			{
				error: `Unsupported file type: ${ext}. Allowed: ${[...ALLOWED_EXTENSIONS].join(", ")}`,
			},
			400,
		);
	}

	// Sanitize filename — keep only alphanumeric, dashes, underscores, dots
	const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");

	if (IMAGE_EXTENSIONS.has(ext)) {
		await mkdir(IMAGES_DIR, { recursive: true });
		const dest = resolve(IMAGES_DIR, safeName);
		await Bun.write(dest, await file.arrayBuffer());
		return c.json({ message: `Saved image: ${safeName}`, path: dest });
	}

	if (PDF_EXTENSIONS.has(ext)) {
		await mkdir(OUTPUT_DIR, { recursive: true });
		const dest = resolve(OUTPUT_DIR, safeName);
		await Bun.write(dest, await file.arrayBuffer());
		return c.json({ message: `Saved PDF: ${safeName}`, path: dest });
	}

	// Text files — save as-is
	await mkdir(OUTPUT_DIR, { recursive: true });
	const content = await file.text();
	const dest = resolve(OUTPUT_DIR, safeName);
	await Bun.write(dest, content);
	return c.json({
		message: `Saved: ${safeName}`,
		path: dest,
	});
});
