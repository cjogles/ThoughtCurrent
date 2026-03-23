import type { SourceFilterConfig, SourceType } from "@thoughtcurrent/shared";
import { useEffect, useState } from "react";
import { FigmaFilters } from "./FigmaFilters.js";
import { GenericFilters } from "./GenericFilters.js";
import { GranolaFilters } from "./GranolaFilters.js";
import { SlackFilters } from "./SlackFilters.js";

const SOURCE_LABELS: Record<SourceType, string> = {
	github: "GitHub",
	slack: "Slack",
	linear: "Linear",
	granola: "Granola",
	sentry: "Sentry",
	datadog: "Datadog",
	posthog: "PostHog",
	trello: "Trello",
	figma: "Figma",
	gmail: "Gmail",
	manual: "Manual Docs",
};

interface Props {
	source: SourceType;
	existingConfig: SourceFilterConfig | null;
	onSave: (config: SourceFilterConfig) => void;
	onClose: () => void;
}

export function SourceConfigModal({
	source,
	existingConfig,
	onSave,
	onClose,
}: Props) {
	const [sourceError, setSourceError] = useState<string | null>(null);
	const [sourceValidating, setSourceValidating] = useState(false);

	useEffect(() => {
		if (source === "slack") {
			setSourceValidating(true);
			fetch("/api/slack/validate")
				.then((res) => res.json())
				.then((data) => {
					if (data.error) setSourceError(data.error);
				})
				.catch(() => {
					setSourceError(
						"Failed to validate Slack connection. Make sure SLACK_BOT_TOKEN or SLACK_USER_TOKEN is configured.",
					);
				})
				.finally(() => setSourceValidating(false));
		} else if (
			source === "granola" ||
			source === "figma" ||
			source === "trello"
		) {
			setSourceValidating(true);
			fetch("/api/status")
				.then((res) => res.json())
				.then((data) => {
					const integration = data.integrations?.find(
						(i: { source: string }) => i.source === source,
					);
					if (integration && integration.status !== "connected") {
						setSourceError(integration.message);
					}
				})
				.catch(() => {
					setSourceError(
						`Failed to validate ${SOURCE_LABELS[source]} connection.`,
					);
				})
				.finally(() => setSourceValidating(false));
		}
	}, [source]);

	useEffect(() => {
		function handleKey(e: KeyboardEvent) {
			if (e.key === "Escape") onClose();
		}
		window.addEventListener("keydown", handleKey);
		return () => window.removeEventListener("keydown", handleKey);
	}, [onClose]);

	const overlayStyle: React.CSSProperties = {
		position: "fixed",
		inset: 0,
		background: "rgba(0, 0, 0, 0.6)",
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		zIndex: 1000,
	};

	const modalStyle: React.CSSProperties = {
		background: "var(--card-bg)",
		border: "1px solid var(--border)",
		borderRadius: "var(--radius)",
		width: "100%",
		maxWidth: 720,
		maxHeight: "90vh",
		display: "flex",
		flexDirection: "column",
	};

	const headerStyle: React.CSSProperties = {
		display: "flex",
		justifyContent: "space-between",
		alignItems: "center",
		padding: "1.25rem 1.5rem",
		borderBottom: "1px solid var(--border)",
	};

	const bodyStyle: React.CSSProperties = {
		padding: "1.5rem",
		overflowY: "auto",
		flex: 1,
	};

	const validatedSources = ["slack", "granola", "figma", "trello"] as const;
	const needsValidation = (validatedSources as readonly string[]).includes(
		source,
	);

	if (needsValidation && sourceError) {
		return (
			<div
				style={overlayStyle}
				onClick={(e) => {
					if (e.target === e.currentTarget) onClose();
				}}
				onKeyDown={() => {}}
			>
				<div style={modalStyle}>
					<div style={headerStyle}>
						<h2 style={{ fontSize: "1.125rem", fontWeight: 600 }}>
							{SOURCE_LABELS[source]} Filters
						</h2>
						<button
							type="button"
							onClick={onClose}
							style={{
								background: "none",
								border: "none",
								color: "var(--muted)",
								cursor: "pointer",
								fontSize: "1.25rem",
								lineHeight: 1,
							}}
						>
							x
						</button>
					</div>
					<div style={bodyStyle}>
						<div
							style={{
								padding: "1rem",
								background: "var(--bg)",
								borderRadius: "var(--radius)",
								border: "1px solid var(--error)",
								color: "var(--error)",
							}}
						>
							{sourceError}
						</div>
						{sourceError?.includes("/api/auth/") && (
							<a
								href={`/api/auth/${source}`}
								style={{
									display: "inline-block",
									marginTop: "1rem",
									padding: "0.5rem 1.25rem",
									background: "var(--accent)",
									color: "#fff",
									borderRadius: "var(--radius)",
									textDecoration: "none",
									fontSize: "0.875rem",
									fontWeight: 500,
								}}
							>
								Connect {SOURCE_LABELS[source]}
							</a>
						)}
					</div>
				</div>
			</div>
		);
	}

	if (needsValidation && sourceValidating) {
		return (
			<div
				style={overlayStyle}
				onClick={(e) => {
					if (e.target === e.currentTarget) onClose();
				}}
				onKeyDown={() => {}}
			>
				<div style={modalStyle}>
					<div style={headerStyle}>
						<h2 style={{ fontSize: "1.125rem", fontWeight: 600 }}>
							{SOURCE_LABELS[source]} Filters
						</h2>
						<button
							type="button"
							onClick={onClose}
							style={{
								background: "none",
								border: "none",
								color: "var(--muted)",
								cursor: "pointer",
								fontSize: "1.25rem",
								lineHeight: 1,
							}}
						>
							x
						</button>
					</div>
					<div
						style={{
							...bodyStyle,
							textAlign: "center",
							color: "var(--muted)",
						}}
					>
						Validating {SOURCE_LABELS[source]} connection...
					</div>
				</div>
			</div>
		);
	}

	return (
		<div
			style={overlayStyle}
			onClick={(e) => {
				if (e.target === e.currentTarget) onClose();
			}}
			onKeyDown={() => {}}
		>
			<div style={modalStyle}>
				<div style={headerStyle}>
					<h2 style={{ fontSize: "1.125rem", fontWeight: 600 }}>
						{SOURCE_LABELS[source]} Filters
					</h2>
					<button
						type="button"
						onClick={onClose}
						style={{
							background: "none",
							border: "none",
							color: "var(--muted)",
							cursor: "pointer",
							fontSize: "1.25rem",
							lineHeight: 1,
						}}
					>
						x
					</button>
				</div>
				<div style={bodyStyle}>
					{source === "slack" ? (
						<SlackFilters
							existingConfig={
								existingConfig?.source === "slack"
									? existingConfig.config
									: null
							}
							onSave={(config) => onSave({ source: "slack", config })}
							onCancel={onClose}
						/>
					) : source === "granola" ? (
						<GranolaFilters
							existingConfig={
								existingConfig?.source === "granola"
									? existingConfig.config
									: null
							}
							onSave={onSave}
							onCancel={onClose}
						/>
					) : source === "figma" ? (
						<FigmaFilters
							existingConfig={
								existingConfig?.source === "figma"
									? existingConfig.config
									: null
							}
							onSave={onSave}
							onCancel={onClose}
						/>
					) : (
						<GenericFilters
							source={source}
							existingConfig={
								existingConfig?.source !== "slack" &&
								existingConfig?.source !== "granola" &&
								existingConfig?.source !== "figma"
									? existingConfig
									: null
							}
							onSave={onSave}
							onCancel={onClose}
						/>
					)}
				</div>
			</div>
		</div>
	);
}
