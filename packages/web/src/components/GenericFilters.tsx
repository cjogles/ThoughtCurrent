import type {
	GenericSourceConfig,
	SourceFilterConfig,
	SourceType,
} from "@thoughtcurrent/shared";
import { useState } from "react";

const SOURCES_WITH_SENDERS: SourceType[] = ["gmail"];

interface Props {
	source: Exclude<SourceType, "slack" | "granola" | "figma">;
	existingConfig: GenericSourceConfig | null;
	onSave: (config: SourceFilterConfig) => void;
	onCancel: () => void;
}

export function GenericFilters({
	source,
	existingConfig,
	onSave,
	onCancel,
}: Props) {
	const today = new Date().toISOString().split("T")[0];

	const [startDate, setStartDate] = useState(
		existingConfig?.startDate ? existingConfig.startDate.split("T")[0] : today,
	);
	const [endDate, setEndDate] = useState(
		existingConfig?.endDate ? existingConfig.endDate.split("T")[0] : today,
	);
	const [keywords, setKeywords] = useState(
		existingConfig?.keywords?.join(", ") ?? "",
	);
	const [senders, setSenders] = useState(
		existingConfig?.senders?.join(", ") ?? "",
	);

	const showSenders = SOURCES_WITH_SENDERS.includes(source);

	function handleSave() {
		const config: GenericSourceConfig = {
			source,
			startDate: new Date(startDate).toISOString(),
			endDate: new Date(`${endDate}T23:59:59`).toISOString(),
			keywords: keywords
				.split(",")
				.map((k) => k.trim())
				.filter(Boolean),
		};

		if (showSenders) {
			const senderList = senders
				.split(",")
				.map((s) => s.trim())
				.filter(Boolean);
			if (senderList.length > 0) config.senders = senderList;
		}

		onSave(config);
	}

	const inputStyle: React.CSSProperties = {
		background: "var(--bg)",
		border: "1px solid var(--border)",
		borderRadius: "var(--radius)",
		color: "var(--fg)",
		padding: "0.5rem 0.75rem",
		fontSize: "0.875rem",
		width: "100%",
	};

	const labelStyle: React.CSSProperties = {
		display: "block",
		fontSize: "0.75rem",
		color: "var(--muted)",
		marginBottom: "0.25rem",
	};

	const btnStyle: React.CSSProperties = {
		padding: "0.5rem 1.25rem",
		borderRadius: "var(--radius)",
		border: "none",
		fontSize: "0.875rem",
		fontWeight: 500,
		cursor: "pointer",
	};

	return (
		<div>
			<div
				style={{
					display: "grid",
					gridTemplateColumns: "1fr 1fr",
					gap: "1rem",
					marginBottom: "1rem",
				}}
			>
				<label>
					<span style={labelStyle}>Start Date</span>
					<input
						type="date"
						value={startDate}
						onChange={(e) => setStartDate(e.target.value)}
						style={inputStyle}
					/>
				</label>
				<label>
					<span style={labelStyle}>End Date</span>
					<input
						type="date"
						value={endDate}
						onChange={(e) => setEndDate(e.target.value)}
						style={inputStyle}
					/>
				</label>
			</div>

			<div style={{ marginBottom: "1rem" }}>
				<label>
					<span style={labelStyle}>Keywords (comma-separated, optional)</span>
					<input
						type="text"
						value={keywords}
						onChange={(e) => setKeywords(e.target.value)}
						placeholder="e.g. Photopharmics, Celeste, Pentara"
						style={inputStyle}
					/>
				</label>
			</div>

			{showSenders && (
				<div style={{ marginBottom: "1.5rem" }}>
					<label>
						<span style={labelStyle}>
							From / Senders (comma-separated, optional)
						</span>
						<input
							type="text"
							value={senders}
							onChange={(e) => setSenders(e.target.value)}
							placeholder="e.g. Brett, brett@company.com"
							style={inputStyle}
						/>
					</label>
					<p
						style={{
							fontSize: "0.6875rem",
							color: "var(--muted)",
							marginTop: "0.25rem",
						}}
					>
						Emails matching ANY keyword OR from ANY sender will be included.
					</p>
				</div>
			)}

			<div
				style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}
			>
				<button
					type="button"
					onClick={onCancel}
					style={{
						...btnStyle,
						background: "transparent",
						border: "1px solid var(--border)",
						color: "var(--muted)",
					}}
				>
					Cancel
				</button>
				<button
					type="button"
					onClick={handleSave}
					style={{ ...btnStyle, background: "var(--accent)", color: "#fff" }}
				>
					Save & Close
				</button>
			</div>
		</div>
	);
}
