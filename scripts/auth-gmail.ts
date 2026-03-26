#!/usr/bin/env bun
/**
 * Gmail OAuth authentication script.
 * Spins up a temporary HTTP server on port 3141, opens the browser for OAuth consent,
 * handles the callback, and writes the refresh token to ~/work/ThoughtCurrent/.env
 */

import { resolve } from "node:path";
import { homedir } from "node:os";
import { readFileSync, existsSync } from "node:fs";

const ENV_PATH = resolve(homedir(), "work/ThoughtCurrent/.env");
const PORT = 3141;
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const REDIRECT_URI = `http://localhost:${PORT}/api/auth/gmail/callback`;

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

const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

if (!clientId || !clientSecret) {
	console.error("ERROR: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in", ENV_PATH);
	process.exit(1);
}

// Build auth URL
const authParams = new URLSearchParams({
	client_id: clientId,
	redirect_uri: REDIRECT_URI,
	response_type: "code",
	scope: "https://www.googleapis.com/auth/gmail.readonly",
	access_type: "offline",
	prompt: "consent",
});

const authUrl = `${GOOGLE_AUTH_URL}?${authParams.toString()}`;

console.log("\n  Gmail OAuth Authentication");
console.log("  ========================\n");
console.log("  Opening browser for authorization...\n");

// Open browser
Bun.spawn(["open", authUrl]);

// Start temporary server to handle callback
const server = Bun.serve({
	port: PORT,
	async fetch(req) {
		const url = new URL(req.url);

		if (url.pathname === "/api/auth/gmail/callback") {
			const code = url.searchParams.get("code");
			const error = url.searchParams.get("error");

			if (error) {
				console.error(`  Authorization failed: ${error}`);
				setTimeout(() => process.exit(1), 500);
				return new Response(`<h1>Authorization Failed</h1><p>${error}</p>`, {
					headers: { "Content-Type": "text/html" },
					status: 400,
				});
			}

			if (!code) {
				console.error("  No authorization code received");
				setTimeout(() => process.exit(1), 500);
				return new Response("<h1>Missing Code</h1>", {
					headers: { "Content-Type": "text/html" },
					status: 400,
				});
			}

			// Exchange code for tokens
			try {
				const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
					method: "POST",
					headers: { "Content-Type": "application/x-www-form-urlencoded" },
					body: new URLSearchParams({
						code,
						client_id: clientId,
						client_secret: clientSecret,
						redirect_uri: REDIRECT_URI,
						grant_type: "authorization_code",
					}),
				});

				if (!tokenRes.ok) {
					const text = await tokenRes.text();
					throw new Error(`Token exchange failed: ${text}`);
				}

				const tokens = await tokenRes.json() as { refresh_token?: string };

				if (tokens.refresh_token) {
					// Read existing .env, update or append GOOGLE_REFRESH_TOKEN
					let envContent = "";
					if (existsSync(ENV_PATH)) {
						envContent = readFileSync(ENV_PATH, "utf-8");
					}

					if (envContent.includes("GOOGLE_REFRESH_TOKEN=")) {
						envContent = envContent.replace(
							/GOOGLE_REFRESH_TOKEN=.*/,
							`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`,
						);
					} else {
						envContent += `\n# Gmail OAuth (auto-generated)\nGOOGLE_REFRESH_TOKEN=${tokens.refresh_token}\n`;
					}

					await Bun.write(ENV_PATH, envContent);

					console.log("  Gmail connected successfully!");
					console.log(`  Refresh token saved to ${ENV_PATH}\n`);
				} else {
					console.log("  Warning: No refresh token received. Try revoking access and re-authenticating.\n");
				}

				setTimeout(() => process.exit(0), 1000);

				return new Response(`
					<!DOCTYPE html>
					<html><head><title>Gmail Connected</title>
					<style>body{font-family:system-ui;background:#0a0a0a;color:#ededed;display:flex;justify-content:center;align-items:center;min-height:100vh}
					.card{background:#111;border:1px solid #222;border-radius:8px;padding:2rem;text-align:center}
					h1{color:#22c55e;font-size:1.25rem}p{color:#888}</style></head>
					<body><div class="card"><h1>Gmail Connected</h1><p>You can close this tab.</p></div></body></html>
				`, { headers: { "Content-Type": "text/html" } });
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				console.error(`  Token exchange failed: ${msg}`);
				setTimeout(() => process.exit(1), 500);
				return new Response(`<h1>Failed</h1><p>${msg}</p>`, {
					headers: { "Content-Type": "text/html" },
					status: 500,
				});
			}
		}

		return new Response("Not Found", { status: 404 });
	},
});

console.log(`  Waiting for OAuth callback on http://localhost:${PORT}...\n`);
