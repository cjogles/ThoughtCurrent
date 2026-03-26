#!/usr/bin/env bun
/**
 * Trello OAuth authentication script.
 * Spins up a temporary HTTP server on port 3141, opens the browser for token auth,
 * handles the callback (fragment-based), and writes the token to ~/work/ThoughtCurrent/.env
 */

import { resolve } from "node:path";
import { homedir } from "node:os";
import { readFileSync, existsSync } from "node:fs";

const ENV_PATH = resolve(homedir(), "work/ThoughtCurrent/.env");
const PORT = 3141;
const TRELLO_AUTH_URL = "https://trello.com/1/authorize";

// Load existing .env
function loadEnv(): void {
	if (!existsSync(ENV_PATH)) return;
	const content = readFileSync(ENV_PATH, "utf-8");
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

loadEnv();

const apiKey = process.env.TRELLO_API_KEY;

if (!apiKey) {
	console.error("ERROR: TRELLO_API_KEY must be set in", ENV_PATH);
	process.exit(1);
}

const callbackUrl = `http://localhost:${PORT}/api/auth/trello/callback`;
const authParams = new URLSearchParams({
	expiration: "never",
	name: "ThoughtCurrent",
	scope: "read",
	response_type: "fragment",
	key: apiKey,
	callback_url: callbackUrl,
	return_url: callbackUrl,
});

const authUrl = `${TRELLO_AUTH_URL}?${authParams.toString()}`;

console.log("\n  Trello Authentication");
console.log("  ====================\n");
console.log("  Opening browser for authorization...\n");

// Open browser
Bun.spawn(["open", authUrl]);

const server = Bun.serve({
	port: PORT,
	async fetch(req) {
		const url = new URL(req.url);

		// Callback page — reads the token from the URL fragment client-side
		if (url.pathname === "/api/auth/trello/callback") {
			return new Response(`
				<!DOCTYPE html>
				<html><head><title>Connecting Trello</title>
				<style>body{font-family:system-ui;background:#0a0a0a;color:#ededed;display:flex;justify-content:center;align-items:center;min-height:100vh}
				.card{background:#111;border:1px solid #222;border-radius:8px;padding:2rem;text-align:center}
				h1{font-size:1.25rem}.success{color:#22c55e}.error{color:#ef4444}p{color:#888}</style></head>
				<body><div class="card">
					<h1 id="title">Connecting Trello...</h1>
					<p id="message">Saving your authorization token...</p>
				</div>
				<script>
					(async () => {
						const hash = window.location.hash;
						const match = hash.match(/token=([^&]+)/);
						if (!match) {
							document.getElementById('title').textContent = 'Authorization Failed';
							document.getElementById('title').className = 'error';
							document.getElementById('message').textContent = 'No token found. Please try again.';
							return;
						}
						try {
							const res = await fetch('/api/auth/trello/save', {
								method: 'POST',
								headers: { 'Content-Type': 'application/json' },
								body: JSON.stringify({ token: match[1] }),
							});
							const data = await res.json();
							if (data.ok) {
								document.getElementById('title').textContent = 'Trello Connected!';
								document.getElementById('title').className = 'success';
								document.getElementById('message').textContent = 'You can close this tab.';
							} else {
								throw new Error(data.error || 'Unknown error');
							}
						} catch (err) {
							document.getElementById('title').textContent = 'Save Failed';
							document.getElementById('title').className = 'error';
							document.getElementById('message').textContent = err.message;
						}
					})();
				</script></body></html>
			`, { headers: { "Content-Type": "text/html" } });
		}

		// Save endpoint — receives token from client-side JS
		if (url.pathname === "/api/auth/trello/save" && req.method === "POST") {
			try {
				const body = await req.json() as { token?: string };
				const token = body?.token;

				if (!token || typeof token !== "string") {
					return Response.json({ ok: false, error: "Missing token" }, { status: 400 });
				}

				// Read existing .env, update or append TRELLO_TOKEN
				let envContent = "";
				if (existsSync(ENV_PATH)) {
					envContent = readFileSync(ENV_PATH, "utf-8");
				}

				if (envContent.includes("TRELLO_TOKEN=")) {
					envContent = envContent.replace(
						/TRELLO_TOKEN=.*/,
						`TRELLO_TOKEN=${token}`,
					);
				} else {
					envContent += `\n# Trello OAuth (auto-generated)\nTRELLO_TOKEN=${token}\n`;
				}

				await Bun.write(ENV_PATH, envContent);

				console.log("  Trello connected successfully!");
				console.log(`  Token saved to ${ENV_PATH}\n`);

				setTimeout(() => process.exit(0), 1000);

				return Response.json({ ok: true });
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				console.error(`  Save failed: ${msg}`);
				return Response.json({ ok: false, error: msg }, { status: 500 });
			}
		}

		return new Response("Not Found", { status: 404 });
	},
});

console.log(`  Waiting for Trello callback on http://localhost:${PORT}...\n`);
