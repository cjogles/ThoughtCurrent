import { Hono } from "hono";
import { cors } from "hono/cors";
import { authRoutes } from "./routes/auth.js";
import { compileRoutes } from "./routes/compile.js";
import { statusRoutes } from "./routes/status.js";
import { uploadRoutes } from "./routes/upload.js";

const app = new Hono();

app.use(
	"*",
	cors({ origin: ["http://localhost:5173", "http://localhost:5174"] }),
);

app.route("/api/auth", authRoutes);
app.route("/api/compile", compileRoutes);
app.route("/api/status", statusRoutes);
app.route("/api/upload", uploadRoutes);

app.get("/api/health", (c) => c.json({ status: "ok" }));

const port = Number(process.env.PORT) || 3141;

console.log(`ThoughtCurrent server running on http://localhost:${port}`);

export default {
	port,
	fetch: app.fetch,
	idleTimeout: 120,
};
