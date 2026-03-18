import type { SourceHealthCheck, SourceType } from "@thoughtcurrent/shared";
import { useCallback, useEffect, useState } from "react";
import { UploadDialog } from "./UploadDialog.js";

const AVAILABLE_SOURCES: { id: SourceType; label: string }[] = [
	{ id: "github", label: "GitHub" },
	{ id: "slack", label: "Slack" },
	{ id: "linear", label: "Linear" },
	{ id: "granola", label: "Granola" },
	{ id: "sentry", label: "Sentry" },
	{ id: "datadog", label: "Datadog" },
	{ id: "posthog", label: "PostHog" },
	{ id: "trello", label: "Trello" },
	{ id: "figma", label: "Figma" },
	{ id: "gmail", label: "Gmail" },
	{ id: "manual", label: "Manual Docs" },
];

// Sources that require OAuth and have an auth endpoint
const OAUTH_SOURCES: Partial<Record<SourceType, string>> = {
	gmail: "/api/auth/gmail",
};

interface Props {
	onCompile: (filter: {
		startDate: string;
		endDate: string;
		sources: string[];
		keywords?: string[];
	}) => void;
	disabled: boolean;
}

export function CompileForm({ onCompile, disabled }: Props) {
	const today = new Date().toISOString().split("T")[0];
	const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000)
		.toISOString()
		.split("T")[0];

	const [startDate, setStartDate] = useState(today);
	const [endDate, setEndDate] = useState(today);
	const [sources, setSources] = useState<Set<string>>(new Set(["github"]));
	const [keywords, setKeywords] = useState("");
	const [sourceStatuses, setSourceStatuses] = useState<
		Record<string, SourceHealthCheck>
	>({});
	const [uploadOpen, setUploadOpen] = useState(false);

	const fetchStatuses = useCallback(async () => {
		try {
			const res = await fetch("/api/status");
			const data = await res.json();
			const map: Record<string, SourceHealthCheck> = {};
			for (const s of data.integrations) {
				map[s.source] = s;
			}
			setSourceStatuses(map);
		} catch {
			// ignore
		}
	}, []);

	useEffect(() => {
		fetchStatuses();

		// Re-check statuses when window regains focus (after OAuth redirect)
		function onFocus() {
			fetchStatuses();
		}
		window.addEventListener("focus", onFocus);
		return () => window.removeEventListener("focus", onFocus);
	}, [fetchStatuses]);

	async function toggleSource(id: SourceType) {
		// Manual docs opens upload dialog instead of toggling
		if (id === "manual") {
			setUploadOpen(true);
			return;
		}

		// If turning ON an OAuth source, check if it needs auth
		if (!sources.has(id) && id in OAUTH_SOURCES) {
			const status = sourceStatuses[id];
			const needsAuth =
				!status ||
				status.status === "not_configured" ||
				(status.status === "error" &&
					status.message.includes("GOOGLE_REFRESH_TOKEN"));

			if (needsAuth) {
				// Open OAuth flow in a new tab
				window.open(OAUTH_SOURCES[id], "_blank");
				return;
			}
		}

		setSources((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}

	function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		if (sources.size === 0) return;

		onCompile({
			startDate: new Date(startDate).toISOString(),
			endDate: new Date(`${endDate}T23:59:59`).toISOString(),
			sources: [...sources],
			keywords: keywords
				.split(",")
				.map((k) => k.trim())
				.filter(Boolean),
		});
	}

	function getSourceIndicator(id: SourceType): string {
		const status = sourceStatuses[id];
		if (!status) return "";
		if (status.status === "connected") return " \u2713";
		if (status.status === "error" || status.status === "not_configured")
			return " \u00B7";
		return "";
	}

	const cardStyle: React.CSSProperties = {
		background: "var(--card-bg)",
		border: "1px solid var(--border)",
		borderRadius: "var(--radius)",
		padding: "1.5rem",
		marginBottom: "1.5rem",
	};

	const inputStyle: React.CSSProperties = {
		background: "var(--bg)",
		border: "1px solid var(--border)",
		borderRadius: "var(--radius)",
		color: "var(--fg)",
		padding: "0.5rem 0.75rem",
		fontSize: "0.875rem",
		width: "100%",
	};

	return (
		<form onSubmit={handleSubmit} style={cardStyle}>
			<h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "1rem" }}>
				Compile Sources
			</h2>

			<div
				style={{
					display: "grid",
					gridTemplateColumns: "1fr 1fr",
					gap: "1rem",
					marginBottom: "1rem",
				}}
			>
				<label>
					<span
						style={{
							display: "block",
							fontSize: "0.75rem",
							color: "var(--muted)",
							marginBottom: "0.25rem",
						}}
					>
						Start Date
					</span>
					<input
						type="date"
						value={startDate}
						onChange={(e) => setStartDate(e.target.value)}
						style={inputStyle}
					/>
				</label>
				<label>
					<span
						style={{
							display: "block",
							fontSize: "0.75rem",
							color: "var(--muted)",
							marginBottom: "0.25rem",
						}}
					>
						End Date
					</span>
					<input
						type="date"
						value={endDate}
						onChange={(e) => setEndDate(e.target.value)}
						style={inputStyle}
					/>
				</label>
			</div>

			<div style={{ marginBottom: "1rem" }}>
				<span
					style={{
						display: "block",
						fontSize: "0.75rem",
						color: "var(--muted)",
						marginBottom: "0.5rem",
					}}
				>
					Sources
				</span>
				<div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
					{AVAILABLE_SOURCES.map((s) => {
						const indicator = getSourceIndicator(s.id);
						const isSelected = sources.has(s.id);
						return (
							<button
								key={s.id}
								type="button"
								onClick={() => toggleSource(s.id)}
								style={{
									padding: "0.375rem 0.75rem",
									borderRadius: "var(--radius)",
									border: `1px solid ${isSelected ? "var(--accent)" : "var(--border)"}`,
									background: isSelected ? "var(--accent)" : "transparent",
									color: isSelected ? "#fff" : "var(--muted)",
									cursor: "pointer",
									fontSize: "0.8125rem",
								}}
							>
								{s.label}
								{indicator && (
									<span
										style={{
											color: indicator.includes("\u2713")
												? "var(--success)"
												: "var(--warning)",
											marginLeft: "0.25rem",
										}}
									>
										{indicator}
									</span>
								)}
							</button>
						);
					})}
				</div>
			</div>

			<div style={{ marginBottom: "1rem" }}>
				<label>
					<span
						style={{
							display: "block",
							fontSize: "0.75rem",
							color: "var(--muted)",
							marginBottom: "0.25rem",
						}}
					>
						Keywords (comma-separated, optional)
					</span>
					<input
						type="text"
						value={keywords}
						onChange={(e) => setKeywords(e.target.value)}
						placeholder="e.g. auth, login, SSO"
						style={inputStyle}
					/>
				</label>
			</div>

			<button
				type="submit"
				disabled={disabled || sources.size === 0}
				style={{
					padding: "0.5rem 1.5rem",
					borderRadius: "var(--radius)",
					border: "none",
					background:
						disabled || sources.size === 0 ? "var(--border)" : "var(--accent)",
					color: "#fff",
					cursor: disabled || sources.size === 0 ? "not-allowed" : "pointer",
					fontSize: "0.875rem",
					fontWeight: 500,
				}}
			>
				{disabled ? "Compiling..." : "Compile"}
			</button>

			<UploadDialog open={uploadOpen} onClose={() => setUploadOpen(false)} />
		</form>
	);
}
