import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { promisify } from "node:util";
import ExcelJS from "exceljs";
import { unzipSync } from "fflate";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";

const execFileAsync = promisify(execFile);

function stripHtml(html: string): string {
	return html
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<\/?(p|div|h[1-6]|li|tr|blockquote)[^>]*>/gi, "\n")
		.replace(/<[^>]*>/g, "")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&nbsp;/g, " ")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

function extractPptxText(buffer: Buffer): string | null {
	try {
		const files = unzipSync(new Uint8Array(buffer));
		const textParts: string[] = [];

		const slideEntries: [string, Uint8Array][] = [];
		for (const [name, data] of Object.entries(files)) {
			if (name.startsWith("ppt/slides/slide") && name.endsWith(".xml")) {
				slideEntries.push([name, data]);
			}
		}

		slideEntries.sort(([a], [b]) => {
			const numA = Number.parseInt(a.match(/slide(\d+)/)?.[1] ?? "0");
			const numB = Number.parseInt(b.match(/slide(\d+)/)?.[1] ?? "0");
			return numA - numB;
		});

		for (const [name, data] of slideEntries) {
			const xml = new TextDecoder().decode(data);
			const texts: string[] = [];
			const regex = /<a:t>([^<]*)<\/a:t>/g;
			let match = regex.exec(xml);
			while (match !== null) {
				if (match[1].trim()) texts.push(match[1]);
				match = regex.exec(xml);
			}
			if (texts.length > 0) {
				const slideNum = name.match(/slide(\d+)/)?.[1] ?? "?";
				textParts.push(`## Slide ${slideNum}`);
				textParts.push(texts.join(" "));
				textParts.push("");
			}
		}

		return textParts.length > 0 ? textParts.join("\n").trim() : null;
	} catch {
		return null;
	}
}

export function extractZipContents(
	buffer: Buffer,
): Map<string, { data: Uint8Array; name: string }> {
	try {
		const files = unzipSync(new Uint8Array(buffer));
		const result = new Map<string, { data: Uint8Array; name: string }>();
		for (const [name, data] of Object.entries(files)) {
			// Skip directories and OS metadata
			if (name.endsWith("/") || name.includes("__MACOSX")) continue;
			result.set(name, { data, name: basename(name) });
		}
		return result;
	} catch {
		return new Map();
	}
}

export async function extractTextFromZip(
	buffer: Buffer,
): Promise<string | null> {
	const files = extractZipContents(buffer);
	if (files.size === 0) return null;

	const parts: string[] = [];
	parts.push(`Archive contains ${files.size} file(s):\n`);

	for (const [path, { data, name }] of files) {
		const ext = name.split(".").pop()?.toLowerCase() ?? "";
		const mimetype = guessMimetype(ext);
		const fileBuffer = Buffer.from(data);

		parts.push(`### ${path}`);

		const text = await extractTextFromBuffer(fileBuffer, ext, mimetype);
		if (text) {
			parts.push(text);
		} else {
			parts.push(`(binary file, ${data.length} bytes)`);
		}
		parts.push("");
	}

	return parts.join("\n").trim();
}

function guessMimetype(ext: string): string {
	const map: Record<string, string> = {
		pdf: "application/pdf",
		docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
		csv: "text/csv",
		txt: "text/plain",
		md: "text/markdown",
		html: "text/html",
		json: "application/json",
		xml: "text/xml",
		png: "image/png",
		jpg: "image/jpeg",
		jpeg: "image/jpeg",
		gif: "image/gif",
		svg: "image/svg+xml",
	};
	return map[ext] ?? "application/octet-stream";
}

export async function extractVideoScreenshots(
	videoPath: string,
	outputDir: string,
	fileId: string,
): Promise<string[]> {
	const savedPaths: string[] = [];

	try {
		await execFileAsync("ffmpeg", ["-version"]);
	} catch {
		return [];
	}

	try {
		await mkdir(outputDir, { recursive: true });

		// Get video duration
		const { stdout: durationOut } = await execFileAsync("ffprobe", [
			"-v",
			"quiet",
			"-show_entries",
			"format=duration",
			"-of",
			"csv=p=0",
			videoPath,
		]);
		const duration = Number.parseFloat(durationOut.trim());
		if (Number.isNaN(duration) || duration <= 0) return [];

		// Grab up to 4 screenshots at evenly spaced intervals
		const count = Math.min(4, Math.max(1, Math.floor(duration / 10)));
		const interval = duration / (count + 1);

		for (let i = 1; i <= count; i++) {
			const timestamp = (interval * i).toFixed(2);
			const outPath = resolve(outputDir, `${fileId}-frame-${i}.png`);
			await execFileAsync("ffmpeg", [
				"-ss",
				timestamp,
				"-i",
				videoPath,
				"-vframes",
				"1",
				"-q:v",
				"2",
				"-y",
				outPath,
			]);
			savedPaths.push(outPath);
		}
	} catch (err) {
		console.log(
			`Video screenshot extraction failed: ${err instanceof Error ? err.message : err}`,
		);
	}

	return savedPaths;
}

export async function extractTextFromBuffer(
	buffer: Buffer,
	filetype: string,
	mimetype: string,
): Promise<string | null> {
	try {
		// PDF
		if (filetype === "pdf" || mimetype === "application/pdf") {
			const parser = new PDFParse({ data: new Uint8Array(buffer) });
			const result = await parser.getText();
			await parser.destroy();
			return result.text?.trim() || null;
		}

		// Word docs
		if (
			filetype === "docx" ||
			mimetype ===
				"application/vnd.openxmlformats-officedocument.wordprocessingml.document"
		) {
			const result = await mammoth.extractRawText({ buffer });
			return result.value?.trim() || null;
		}

		// Old .doc format
		if (filetype === "doc" || mimetype === "application/msword") {
			try {
				const result = await mammoth.extractRawText({ buffer });
				return result.value?.trim() || null;
			} catch {
				return null;
			}
		}

		// PowerPoint
		if (
			filetype === "pptx" ||
			mimetype ===
				"application/vnd.openxmlformats-officedocument.presentationml.presentation"
		) {
			return extractPptxText(buffer);
		}

		// Excel
		if (
			filetype === "xlsx" ||
			filetype === "xls" ||
			filetype === "csv" ||
			mimetype ===
				"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
			mimetype === "application/vnd.ms-excel" ||
			mimetype === "text/csv"
		) {
			const workbook = new ExcelJS.Workbook();
			await workbook.xlsx.load(new Uint8Array(buffer).buffer as ArrayBuffer);
			const lines: string[] = [];
			for (const sheet of workbook.worksheets) {
				lines.push(`## Sheet: ${sheet.name}`);
				const rows: string[] = [];
				sheet.eachRow((row) => {
					const values = row.values as (string | number | null | undefined)[];
					// ExcelJS row.values is 1-indexed (index 0 is undefined)
					rows.push(
						values
							.slice(1)
							.map((v) => v ?? "")
							.join(","),
					);
				});
				lines.push(rows.join("\n"));
				lines.push("");
			}
			return lines.join("\n").trim() || null;
		}

		// ZIP archives
		if (
			filetype === "zip" ||
			mimetype === "application/zip" ||
			mimetype === "application/x-zip-compressed"
		) {
			return extractTextFromZip(buffer);
		}

		// Slack canvases (quip format) — HTML content, strip tags
		if (filetype === "quip" || filetype === "canvas") {
			return stripHtml(buffer.toString("utf-8"));
		}

		// HTML files — strip tags to get clean text
		if (filetype === "html" || mimetype === "text/html") {
			return stripHtml(buffer.toString("utf-8"));
		}

		// Plain text / markdown / code
		if (
			mimetype.startsWith("text/") ||
			filetype === "md" ||
			filetype === "markdown" ||
			filetype === "txt" ||
			filetype === "json" ||
			filetype === "yaml" ||
			filetype === "yml" ||
			filetype === "xml"
		) {
			return buffer.toString("utf-8").trim() || null;
		}

		return null;
	} catch (err) {
		console.log(
			`Text extraction failed for ${filetype}/${mimetype}: ${err instanceof Error ? err.message : err}`,
		);
		return null;
	}
}
