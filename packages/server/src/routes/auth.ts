import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Hono } from "hono";
import { exchangeCodeForTokens, getGmailAuthUrl } from "../sources/gmail.js";
import { getTrelloAuthUrl } from "../sources/trello.js";

export const authRoutes = new Hono();

const ENV_PATH = resolve(import.meta.dir, "../../../../.env");

authRoutes.get("/gmail", (c) => {
	const url = getGmailAuthUrl();
	return c.redirect(url);
});

authRoutes.get("/gmail/callback", async (c) => {
	const code = c.req.query("code");
	const error = c.req.query("error");

	if (error) {
		return c.html(
			`<h1>Authorization Failed</h1><p>Error: ${error}</p><p>Go back and try again.</p>`,
			400,
		);
	}

	if (!code) {
		return c.html(
			"<h1>Missing Code</h1><p>No authorization code received.</p>",
			400,
		);
	}

	try {
		const tokens = await exchangeCodeForTokens(code);

		// Append refresh token to .env
		if (tokens.refresh_token) {
			appendFileSync(
				ENV_PATH,
				`\n# Gmail OAuth (auto-generated)\nGOOGLE_REFRESH_TOKEN=${tokens.refresh_token}\n`,
			);

			// Also set it in the current process
			process.env.GOOGLE_REFRESH_TOKEN = tokens.refresh_token;
		}

		// Brief success message then redirect back to dashboard
		return c.html(`
			<!DOCTYPE html>
			<html>
			<head><title>ThoughtCurrent - Gmail Connected</title>
			<meta http-equiv="refresh" content="2;url=http://localhost:5173" />
			<style>
				body { font-family: -apple-system, sans-serif; background: #0a0a0a; color: #ededed; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
				.card { background: #111; border: 1px solid #222; border-radius: 8px; padding: 2rem; max-width: 480px; text-align: center; }
				h1 { color: #22c55e; font-size: 1.25rem; }
				p { color: #888; font-size: 0.875rem; line-height: 1.6; }
			</style>
			</head>
			<body>
				<div class="card">
					<h1>Gmail Connected</h1>
					<p>Redirecting back to ThoughtCurrent...</p>
				</div>
			</body>
			</html>
		`);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return c.html(`<h1>Token Exchange Failed</h1><p>${message}</p>`, 500);
	}
});

// --- Trello OAuth ---

authRoutes.get("/trello", (c) => {
	try {
		const url = getTrelloAuthUrl();
		return c.redirect(url);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return c.html(
			`<h1>Trello Auth Error</h1><p>${message}</p><p>Make sure TRELLO_API_KEY is set in your .env file.</p>`,
			400,
		);
	}
});

// Trello redirects back with the token in the URL fragment (#token=...).
// This page reads it client-side and POSTs it to our save endpoint.
authRoutes.get("/trello/callback", (c) => {
	return c.html(`
		<!DOCTYPE html>
		<html>
		<head><title>ThoughtCurrent - Connecting Trello</title>
		<style>
			body { font-family: -apple-system, sans-serif; background: #0a0a0a; color: #ededed; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
			.card { background: #111; border: 1px solid #222; border-radius: 8px; padding: 2rem; max-width: 480px; text-align: center; }
			h1 { font-size: 1.25rem; }
			p { color: #888; font-size: 0.875rem; line-height: 1.6; }
			.success { color: #22c55e; }
			.error { color: #ef4444; }
		</style>
		</head>
		<body>
			<div class="card">
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
						document.getElementById('message').textContent = 'No token found in the redirect. Please try again.';
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
							document.getElementById('message').textContent = 'Redirecting back to ThoughtCurrent...';
							setTimeout(() => { window.location.href = 'http://localhost:5173'; }, 1500);
						} else {
							throw new Error(data.error || 'Unknown error');
						}
					} catch (err) {
						document.getElementById('title').textContent = 'Save Failed';
						document.getElementById('title').className = 'error';
						document.getElementById('message').textContent = err.message;
					}
				})();
			</script>
		</body>
		</html>
	`);
});

authRoutes.post("/trello/save", async (c) => {
	const body = await c.req.json();
	const token = body?.token;

	if (!token || typeof token !== "string") {
		return c.json({ ok: false, error: "Missing token" }, 400);
	}

	// Update or append TRELLO_TOKEN in .env
	if (existsSync(ENV_PATH)) {
		const content = readFileSync(ENV_PATH, "utf-8");
		if (content.includes("TRELLO_TOKEN=")) {
			writeFileSync(
				ENV_PATH,
				content.replace(/TRELLO_TOKEN=.*/g, `TRELLO_TOKEN=${token}`),
			);
		} else {
			appendFileSync(
				ENV_PATH,
				`\n# Trello OAuth (auto-generated)\nTRELLO_TOKEN=${token}\n`,
			);
		}
	} else {
		writeFileSync(
			ENV_PATH,
			`# Trello OAuth (auto-generated)\nTRELLO_TOKEN=${token}\n`,
		);
	}

	process.env.TRELLO_TOKEN = token;

	return c.json({ ok: true });
});
