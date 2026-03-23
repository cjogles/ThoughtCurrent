import type { FilterPreset } from "@thoughtcurrent/shared";
import { useState } from "react";

interface Props {
	presets: FilterPreset[];
	onSave: (name: string) => void;
	onLoad: (preset: FilterPreset) => void;
	onDelete: (id: string) => void;
	hasConfigs: boolean;
}

export function PresetManager({
	presets,
	onSave,
	onLoad,
	onDelete,
	hasConfigs,
}: Props) {
	const [showSave, setShowSave] = useState(false);
	const [presetName, setPresetName] = useState("");
	const [showDropdown, setShowDropdown] = useState(false);

	function handleSave() {
		if (!presetName.trim()) return;
		onSave(presetName.trim());
		setPresetName("");
		setShowSave(false);
	}

	const btnStyle: React.CSSProperties = {
		padding: "0.25rem 0.5rem",
		borderRadius: "var(--radius)",
		border: "1px solid var(--border)",
		background: "transparent",
		color: "var(--muted)",
		cursor: "pointer",
		fontSize: "0.75rem",
	};

	return (
		<div
			style={{
				display: "flex",
				gap: "0.5rem",
				alignItems: "center",
				position: "relative",
			}}
		>
			{/* Load preset dropdown */}
			{presets.length > 0 && (
				<div style={{ position: "relative" }}>
					<button
						type="button"
						onClick={() => setShowDropdown(!showDropdown)}
						style={btnStyle}
					>
						Load Preset
					</button>
					{showDropdown && (
						<div
							style={{
								position: "absolute",
								top: "100%",
								right: 0,
								marginTop: "0.25rem",
								background: "var(--card-bg)",
								border: "1px solid var(--border)",
								borderRadius: "var(--radius)",
								minWidth: 200,
								zIndex: 100,
								boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
							}}
						>
							{presets.map((p) => (
								<div
									key={p.id}
									style={{
										display: "flex",
										justifyContent: "space-between",
										alignItems: "center",
										padding: "0.5rem 0.75rem",
										borderBottom: "1px solid var(--border)",
										fontSize: "0.8125rem",
									}}
								>
									<button
										type="button"
										onClick={() => {
											onLoad(p);
											setShowDropdown(false);
										}}
										style={{
											background: "none",
											border: "none",
											color: "var(--fg)",
											cursor: "pointer",
											flex: 1,
											textAlign: "left",
											padding: 0,
											fontSize: "0.8125rem",
										}}
									>
										{p.name}
									</button>
									<button
										type="button"
										onClick={(e) => {
											e.stopPropagation();
											onDelete(p.id);
										}}
										style={{
											background: "none",
											border: "none",
											color: "var(--error)",
											cursor: "pointer",
											fontSize: "0.75rem",
											marginLeft: "0.5rem",
										}}
									>
										x
									</button>
								</div>
							))}
						</div>
					)}
				</div>
			)}

			{/* Save preset */}
			{hasConfigs &&
				(showSave ? (
					<div
						style={{ display: "flex", gap: "0.25rem", alignItems: "center" }}
					>
						<input
							type="text"
							value={presetName}
							onChange={(e) => setPresetName(e.target.value)}
							placeholder="Preset name"
							onKeyDown={(e) => {
								if (e.key === "Enter") handleSave();
								if (e.key === "Escape") setShowSave(false);
							}}
							style={{
								background: "var(--bg)",
								border: "1px solid var(--border)",
								borderRadius: "var(--radius)",
								color: "var(--fg)",
								padding: "0.25rem 0.5rem",
								fontSize: "0.75rem",
								width: 120,
							}}
						/>
						<button
							type="button"
							onClick={handleSave}
							style={{
								...btnStyle,
								borderColor: "var(--accent)",
								color: "var(--accent)",
							}}
						>
							Save
						</button>
						<button
							type="button"
							onClick={() => setShowSave(false)}
							style={btnStyle}
						>
							x
						</button>
					</div>
				) : (
					<button
						type="button"
						onClick={() => setShowSave(true)}
						style={btnStyle}
					>
						Save Preset
					</button>
				))}
		</div>
	);
}
