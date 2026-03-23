import type {
	GranolaFilterConfig,
	SourceFilterConfig,
} from "@thoughtcurrent/shared";
import { useState } from "react";

interface Props {
	existingConfig: GranolaFilterConfig | null;
	onSave: (config: SourceFilterConfig) => void;
	onCancel: () => void;
}

export function GranolaFilters({ existingConfig, onSave, onCancel }: Props) {
	const [keywords, setKeywords] = useState(
		existingConfig?.keywords?.join(", ") ?? "",
	);
	const [useDateRange, setUseDateRange] = useState(
		!!(existingConfig?.startDate || existingConfig?.endDate),
	);
	const today = new Date().toISOString().split("T")[0];
	const [startDate, setStartDate] = useState(
		existingConfig?.startDate ? existingConfig.startDate.split("T")[0] : today,
	);
	const [endDate, setEndDate] = useState(
		existingConfig?.endDate ? existingConfig.endDate.split("T")[0] : today,
	);

	function handleSave() {
		const config: GranolaFilterConfig = {};

		const kw = keywords
			.split(",")
			.map((k) => k.trim())
			.filter(Boolean);
		if (kw.length > 0) config.keywords = kw;

		if (useDateRange) {
			config.startDate = new Date(startDate).toISOString();
			config.endDate = new Date(`${endDate}T23:59:59`).toISOString();
		}

		onSave({ source: "granola", config });
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

	const sectionStyle: React.CSSProperties = {
		marginBottom: "1.25rem",
	};

	const btnStyle: React.CSSProperties = {
		padding: "0.5rem 1.25rem",
		borderRadius: "var(--radius)",
		border: "none",
		fontSize: "0.875rem",
		fontWeight: 500,
		cursor: "pointer",
	};

	const checkboxItemStyle: React.CSSProperties = {
		display: "flex",
		alignItems: "center",
		gap: "0.5rem",
		fontSize: "0.8125rem",
	};

	return (
		<div>
			{/* Keywords */}
			<div style={sectionStyle}>
				<label>
					<span style={labelStyle}>
						Keywords (comma-separated, matches title, attendees, and transcript)
					</span>
					<input
						type="text"
						value={keywords}
						onChange={(e) => setKeywords(e.target.value)}
						placeholder="e.g. Photopharmics, Celeste, Pentara"
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
					Leave empty to get all transcripts. Any transcript whose title,
					attendees, or content matches will be included.
				</p>
			</div>

			{/* Optional date range */}
			<div style={sectionStyle}>
				<label style={checkboxItemStyle}>
					<input
						type="checkbox"
						checked={useDateRange}
						onChange={(e) => setUseDateRange(e.target.checked)}
					/>
					<span style={{ fontSize: "0.8125rem" }}>Limit to date range</span>
				</label>
				<p
					style={{
						fontSize: "0.6875rem",
						color: "var(--muted)",
						marginTop: "0.25rem",
						marginBottom: "0.5rem",
					}}
				>
					When unchecked, searches your entire Granola history.
				</p>

				{useDateRange && (
					<div
						style={{
							display: "grid",
							gridTemplateColumns: "1fr 1fr",
							gap: "1rem",
							marginTop: "0.5rem",
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
				)}
			</div>

			{/* Footer */}
			<div
				style={{
					display: "flex",
					gap: "0.75rem",
					justifyContent: "flex-end",
					paddingTop: "0.75rem",
					borderTop: "1px solid var(--border)",
				}}
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
					style={{
						...btnStyle,
						background: "var(--accent)",
						color: "#fff",
					}}
				>
					Save & Close
				</button>
			</div>
		</div>
	);
}
