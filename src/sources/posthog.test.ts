import { describe, expect, test } from "bun:test";
import {
	formatTimelineRow,
	parseElementsChain,
	redactEmails,
	renderQueryTable,
	renderSession,
	toHogqlDateTime,
} from "./posthog.js";

// Real elements_chain strings captured from production project 138211,
// session 019f6165-6aa2-757a-badb-f6c4f3bad036 (the wipe-investigation session).
const CHAIN_SAVE =
	'button.iqHFke.sc-cfxfcM:attr__class="sc-cfxfcM iqHFke"attr__data-testid="editor-save-button"nth-child="1"nth-of-type="1"text="Save changes";div.hyDLWa.sc-aXZVg:attr__class="sc-aXZVg hyDLWa"nth-child="3"nth-of-type="3";body:attr__class=""nth-child="2"nth-of-type="1"';

const CHAIN_DELETE =
	'svg.fFVTAU.hmePbs.sc-dAlyuH.sc-dcJsrY:attr__aria-label="Delete"attr__class="sc-dcJsrY hmePbs sc-dAlyuH fFVTAU"attr__clickable="0"attr__data-testid="overlay-delete-icon"attr__height="16"attr__viewBox="0 0 16 16"attr__width="16"nth-child="2"nth-of-type="1";div.cNMlQc.hYbDhD.sc-aXZVg.sc-gEvEer:attr__class="sc-aXZVg hYbDhD sc-gEvEer cNMlQc"nth-child="4"nth-of-type="4";body:attr__class=""nth-child="2"nth-of-type="1"';

const CHAIN_CUSTOMIZE =
	'button.eIHgWo.sc-cfxfcM:attr__class="sc-cfxfcM eIHgWo"attr__data-testid="customize-button"attr__href="/editor/d765bf89?access=fh_admin&lang=en"href="/editor/d765bf89?access=fh_admin&lang=en"nth-child="1"nth-of-type="1"text="Customize";a.cgkQLM.sc-iHbSHJ:attr__class="sc-iHbSHJ cgkQLM"nth-child="1"nth-of-type="1"';

describe("parseElementsChain", () => {
	test("extracts testid + inner text from the save-button chain (no aria-label)", () => {
		const parsed = parseElementsChain(CHAIN_SAVE);
		expect(parsed.testid).toBe("editor-save-button");
		expect(parsed.text).toBe("Save changes");
		expect(parsed.ariaLabel).toBeUndefined();
	});

	test("extracts testid + aria-label from the delete-icon chain (no inner text)", () => {
		const parsed = parseElementsChain(CHAIN_DELETE);
		expect(parsed.testid).toBe("overlay-delete-icon");
		expect(parsed.ariaLabel).toBe("Delete");
		expect(parsed.text).toBeUndefined();
	});

	test("extracts testid + text from the customize-button chain", () => {
		const parsed = parseElementsChain(CHAIN_CUSTOMIZE);
		expect(parsed.testid).toBe("customize-button");
		expect(parsed.text).toBe("Customize");
	});

	test("does NOT mistake an attribute like attr__data-text for the element's inner text", () => {
		// A naive /text="([^"]+)"/ would wrongly grab ATTR_VALUE; the lookbehind must skip it.
		const chain =
			'button:attr__data-testid="x"attr__data-text="ATTR_VALUE"nth-child="1"text="REAL_TEXT"';
		expect(parseElementsChain(chain).text).toBe("REAL_TEXT");
	});

	test("returns empty object for null / empty / testid-less chains", () => {
		expect(parseElementsChain(null)).toEqual({});
		expect(parseElementsChain("")).toEqual({});
		expect(parseElementsChain(undefined)).toEqual({});
		expect(parseElementsChain('div:nth-child="1"')).toEqual({});
	});
});

describe("redactEmails", () => {
	test("redacts a single email", () => {
		expect(redactEmails("ping jordan@builtbyhq.com please")).toBe(
			"ping [email redacted] please",
		);
	});

	test("redacts multiple emails in one string", () => {
		expect(redactEmails("a@x.io and b.c+tag@sub.example.co.uk")).toBe(
			"[email redacted] and [email redacted]",
		);
	});

	test("leaves email-free text untouched", () => {
		const s = "no emails here — just /editor/d765bf89 and $autocapture";
		expect(redactEmails(s)).toBe(s);
	});
});

describe("toHogqlDateTime", () => {
	test("pads a date+time to seconds", () => {
		expect(toHogqlDateTime("2026-07-14 15:00")).toBe("2026-07-14 15:00:00");
	});

	test("expands a bare date to start / end of day", () => {
		expect(toHogqlDateTime("2026-07-14")).toBe("2026-07-14 00:00:00");
		expect(toHogqlDateTime("2026-07-14", true)).toBe("2026-07-14 23:59:59");
	});

	test("normalizes an ISO-Z datetime with microseconds", () => {
		expect(toHogqlDateTime("2026-07-14T16:11:04.430000Z")).toBe(
			"2026-07-14 16:11:04",
		);
	});
});

describe("formatTimelineRow", () => {
	test("renders a delete click as a table row with testid + aria-label", () => {
		const row = formatTimelineRow({
			timestamp: "2026-07-14T16:13:46.309000Z",
			event: "$autocapture",
			eventType: "click",
			elementsChain: CHAIN_DELETE,
			url: null,
		});
		expect(row).toContain("2026-07-14 16:13:46");
		expect(row).toContain("$autocapture (click)");
		expect(row).toContain("overlay-delete-icon");
		expect(row).toContain("Delete");
		// Must be a single markdown table row.
		expect(row.startsWith("| ")).toBe(true);
		expect(row.endsWith(" |")).toBe(true);
	});

	test("escapes pipe characters in cell content so the table can't break", () => {
		const row = formatTimelineRow({
			timestamp: "2026-07-14T16:00:00.000000Z",
			event: "$autocapture",
			eventType: "click",
			elementsChain: 'button:text="a | b"',
			url: null,
		});
		expect(row).toContain("a \\| b");
	});
});

describe("renderSession", () => {
	test("renders the wipe signature: delete clicks then a save, with a replay link", () => {
		const sessionId = "019f6165-6aa2-757a-badb-f6c4f3bad036";
		const mk = (timestamp: string, chain: string) => ({
			timestamp,
			event: "$autocapture",
			eventType: "click",
			url: "https://www.mydesignerlab.com/editor/d765bf89",
			elementsChain: chain,
			distinctId: "019f6165-6aa4-7823-99e7-2e3456ccd615",
		});
		const md = renderSession({
			sessionId,
			distinctId: "019f6165-6aa4-7823-99e7-2e3456ccd615",
			truncated: false,
			recording: {
				id: sessionId,
				distinctId: "019f6165-6aa4-7823-99e7-2e3456ccd615",
				durationSeconds: 5111,
				startTime: "2026-07-14T16:11:06.518000Z",
				endTime: "2026-07-14T17:36:17.760000Z",
				clickCount: 593,
				keypressCount: 1035,
				consoleErrorCount: 0,
				startUrl: "https://www.mydesignerlab.com/preview/x",
			},
			events: [
				mk("2026-07-14T16:13:46.309000Z", CHAIN_DELETE),
				mk("2026-07-14T16:13:47.892000Z", CHAIN_DELETE),
				mk("2026-07-14T16:15:27.824000Z", CHAIN_SAVE),
			],
		});

		expect(md).toContain(`/replay/${sessionId}`);
		expect(md).toContain(
			"| Time (UTC) | Event | testid | text | aria-label | url |",
		);
		expect(md).toContain("2026-07-14 16:13:46");
		expect(md).toContain("2026-07-14 16:13:47");
		expect(md).toContain("2026-07-14 16:15:27");
		expect(md).toContain("overlay-delete-icon");
		expect(md).toContain("editor-save-button");
		// Testid tally counts the two delete clicks.
		expect(md).toContain("`overlay-delete-icon` ×2");
		expect(md).toContain("Recording:** available");
	});
});

describe("renderQueryTable", () => {
	test("renders a header, rows, and a count; escapes pipes", () => {
		const md = renderQueryTable(
			["event", "count"],
			[
				["$rageclick", 4],
				["a | b", 1],
			],
		);
		expect(md).toContain("| event | count |");
		expect(md).toContain("| $rageclick | 4 |");
		expect(md).toContain("a \\| b");
		expect(md).toContain("2 row(s)");
	});
});
