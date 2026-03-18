import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { Hono } from "hono";
import { exchangeCodeForTokens, getGmailAuthUrl } from "../sources/gmail.js";

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
