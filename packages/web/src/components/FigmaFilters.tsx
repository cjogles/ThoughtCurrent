import type {
	FigmaFilterConfig,
	SourceFilterConfig,
} from "@thoughtcurrent/shared";
import { useState } from "react";

interface Props {
	existingConfig: FigmaFilterConfig | null;
	onSave: (config: SourceFilterConfig) => void;
	onCancel: () => void;
}

export function FigmaFilters({ existingConfig, onSave, onCancel }: Props) {
	const [fileUrls, setFileUrls] = useState(
		existingConfig?.fileUrls?.join("\n") ?? "",
	);
	const [includeText, setIncludeText] = useState(
		existingConfig?.includeText !== false,
	);
	const [includeComments, setIncludeComments] = useState(
		existingConfig?.includeComments !== false,
	);
	const [includeScreenshots, setIncludeScreenshots] = useState(
		existingConfig?.includeScreenshots !== false,
	);

	function handleSave() {
		const urls = fileUrls
			.split("\n")
			.map((u) => u.trim())
			.filter(Boolean);

		if (urls.length === 0) return;

		const config: FigmaFilterConfig = {
			fileUrls: urls,
			includeText,
			includeComments,
			includeScreenshots,
		};

		onSave({ source: "figma", config });
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
		padding: "0.25rem 0",
		fontSize: "0.8125rem",
	};

	return (
		<div>
			{/* File URLs */}
			<div style={sectionStyle}>
				<label>
					<span style={labelStyle}>Figma File URLs (one per line)</span>
					<textarea
						value={fileUrls}
						onChange={(e) => setFileUrls(e.target.value)}
						placeholder="https://www.figma.com/design/abc123/MyFile..."
						rows={4}
						style={{
							...inputStyle,
							resize: "vertical",
							fontFamily: "monospace",
							fontSize: "0.8125rem",
						}}
					/>
				</label>
				<p
					style={{
						fontSize: "0.6875rem",
						color: "var(--muted)",
						marginTop: "0.25rem",
					}}
				>
					Paste full Figma URLs or just file keys. All pages in each file will
					be processed.
				</p>
			</div>

			{/* Content Types */}
			<div style={sectionStyle}>
				<span style={labelStyle}>What to extract</span>
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						gap: "0.25rem",
					}}
				>
					<label style={checkboxItemStyle}>
						<input
							type="checkbox"
							checked={includeText}
							onChange={(e) => setIncludeText(e.target.checked)}
						/>
						<span>Text layers (all text from every page)</span>
					</label>
					<label style={checkboxItemStyle}>
						<input
							type="checkbox"
							checked={includeComments}
							onChange={(e) => setIncludeComments(e.target.checked)}
						/>
						<span>Comments (all threads and replies)</span>
					</label>
					<label style={checkboxItemStyle}>
						<input
							type="checkbox"
							checked={includeScreenshots}
							onChange={(e) => setIncludeScreenshots(e.target.checked)}
						/>
						<span>
							Screenshots (PNG export of every top-level frame/section)
						</span>
					</label>
				</div>
				<p
					style={{
						fontSize: "0.6875rem",
						color: "var(--muted)",
						marginTop: "0.5rem",
					}}
				>
					Screenshots are rate-limited (~15 req/min). Large files with many
					frames may take a few minutes.
				</p>
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
					disabled={
						fileUrls
							.split("\n")
							.map((u) => u.trim())
							.filter(Boolean).length === 0
					}
					style={{
						...btnStyle,
						background: "var(--accent)",
						color: "#fff",
						opacity:
							fileUrls
								.split("\n")
								.map((u) => u.trim())
								.filter(Boolean).length === 0
								? 0.5
								: 1,
					}}
				>
					Save & Close
				</button>
			</div>
		</div>
	);
}
