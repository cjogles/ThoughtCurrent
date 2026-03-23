import type {
	FilterPreset,
	SourceFilterConfig,
	SourceHealthCheck,
	SourceType,
} from "@thoughtcurrent/shared";
import { useCallback, useEffect, useState } from "react";
import { PresetManager } from "./PresetManager.js";
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
	onCompile: () => void;
	disabled: boolean;
	sourceConfigs: Map<SourceType, SourceFilterConfig>;
	onSourceClick: (source: SourceType) => void;
	onRemoveSource: (source: SourceType) => void;
	presets: FilterPreset[];
	onSavePreset: (name: string) => void;
	onLoadPreset: (preset: FilterPreset) => void;
	onDeletePreset: (id: string) => void;
}

export function CompileForm({
	onCompile,
	disabled,
	sourceConfigs,
	onSourceClick,
	onRemoveSource,
	presets,
	onSavePreset,
	onLoadPreset,
	onDeletePreset,
}: Props) {
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

		function onFocus() {
			fetchStatuses();
		}
		window.addEventListener("focus", onFocus);
		return () => window.removeEventListener("focus", onFocus);
	}, [fetchStatuses]);

	function handleSourceClick(id: SourceType) {
		// Manual docs opens upload dialog instead of modal
		if (id === "manual") {
			setUploadOpen(true);
			return;
		}

		// If turning ON an OAuth source, check if it needs auth
		if (!sourceConfigs.has(id) && id in OAUTH_SOURCES) {
			const status = sourceStatuses[id];
			const needsAuth =
				!status ||
				status.status === "not_configured" ||
				(status.status === "error" &&
					status.message.includes("GOOGLE_REFRESH_TOKEN"));

			if (needsAuth) {
				window.open(OAUTH_SOURCES[id], "_blank");
				return;
			}
		}

		// If already configured, clicking again opens the modal to edit
		// If not configured, opens modal to create config
		onSourceClick(id);
	}

	function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		if (sourceConfigs.size === 0) return;
		onCompile();
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

	return (
		<form onSubmit={handleSubmit} style={cardStyle}>
			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					alignItems: "center",
					marginBottom: "1rem",
				}}
			>
				<h2 style={{ fontSize: "1rem", fontWeight: 600 }}>Compile Sources</h2>
				<PresetManager
					presets={presets}
					onSave={onSavePreset}
					onLoad={onLoadPreset}
					onDelete={onDeletePreset}
					hasConfigs={sourceConfigs.size > 0}
				/>
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
					Sources — click to configure filters
				</span>
				<div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
					{AVAILABLE_SOURCES.map((s) => {
						const indicator = getSourceIndicator(s.id);
						const isConfigured = sourceConfigs.has(s.id);
						return (
							<button
								key={s.id}
								type="button"
								onClick={() => handleSourceClick(s.id)}
								onContextMenu={(e) => {
									e.preventDefault();
									if (isConfigured) onRemoveSource(s.id);
								}}
								style={{
									padding: "0.375rem 0.75rem",
									borderRadius: "var(--radius)",
									border: `1px solid ${isConfigured ? "var(--accent)" : "var(--border)"}`,
									background: isConfigured ? "var(--accent)" : "transparent",
									color: isConfigured ? "#fff" : "var(--muted)",
									cursor: "pointer",
									fontSize: "0.8125rem",
									position: "relative",
								}}
							>
								{s.label}
								{isConfigured && (
									<span
										style={{
											display: "inline-block",
											width: 6,
											height: 6,
											borderRadius: "50%",
											background: "#fff",
											marginLeft: "0.375rem",
											verticalAlign: "middle",
										}}
									/>
								)}
								{indicator && !isConfigured && (
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
				{sourceConfigs.size > 0 && (
					<p
						style={{
							fontSize: "0.6875rem",
							color: "var(--muted)",
							marginTop: "0.375rem",
						}}
					>
						Right-click a source to remove it
					</p>
				)}
			</div>

			<button
				type="submit"
				disabled={disabled || sourceConfigs.size === 0}
				style={{
					padding: "0.5rem 1.5rem",
					borderRadius: "var(--radius)",
					border: "none",
					background:
						disabled || sourceConfigs.size === 0
							? "var(--border)"
							: "var(--accent)",
					color: "#fff",
					cursor:
						disabled || sourceConfigs.size === 0 ? "not-allowed" : "pointer",
					fontSize: "0.875rem",
					fontWeight: 500,
				}}
			>
				{disabled
					? "Compiling..."
					: `Compile (${sourceConfigs.size} source${sourceConfigs.size === 1 ? "" : "s"})`}
			</button>

			<UploadDialog open={uploadOpen} onClose={() => setUploadOpen(false)} />
		</form>
	);
}
