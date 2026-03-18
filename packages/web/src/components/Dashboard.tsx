import type { CompilationProgress } from "@thoughtcurrent/shared";

interface Props {
	progress: CompilationProgress[];
	result: { totalItems: number; progress: CompilationProgress[] } | null;
	compiling: boolean;
	onClear: () => void;
}

const statusColors: Record<string, string> = {
	pending: "var(--muted)",
	fetching: "var(--accent)",
	writing: "var(--accent)",
	done: "var(--success)",
	error: "var(--error)",
};

const statusLabels: Record<string, string> = {
	pending: "Waiting...",
	fetching: "Fetching...",
	writing: "Writing...",
	done: "Done",
	error: "Error",
};

function deduplicateProgress(
	progress: CompilationProgress[],
): CompilationProgress[] {
	const latest = new Map<string, CompilationProgress>();
	for (const p of progress) {
		latest.set(p.source, p);
	}
	return [...latest.values()];
}

function Spinner() {
	return (
		<span
			style={{
				display: "inline-block",
				width: "14px",
				height: "14px",
				border: "2px solid var(--border)",
				borderTopColor: "var(--accent)",
				borderRadius: "50%",
				animation: "spin 0.8s linear infinite",
			}}
		/>
	);
}

function StatusIcon({ status }: { status: string }) {
	if (status === "pending" || status === "fetching" || status === "writing") {
		return <Spinner />;
	}
	if (status === "done") {
		return (
			<span style={{ color: "var(--success)", fontFamily: "monospace" }}>
				{"\u2713"}
			</span>
		);
	}
	if (status === "error") {
		return (
			<span style={{ color: "var(--error)", fontFamily: "monospace" }}>
				{"\u2717"}
			</span>
		);
	}
	return null;
}

export function Dashboard({ progress, result, compiling, onClear }: Props) {
	if (progress.length === 0 && !result) {
		return (
			<div
				style={{
					textAlign: "center",
					padding: "3rem",
					color: "var(--muted)",
				}}
			>
				<p>Select sources and a date range to begin compilation.</p>
			</div>
		);
	}

	const dedupedProgress = deduplicateProgress(progress);

	const cardStyle: React.CSSProperties = {
		background: "var(--card-bg)",
		border: "1px solid var(--border)",
		borderRadius: "var(--radius)",
		padding: "1.5rem",
		marginBottom: "1.5rem",
	};

	const doneCount = dedupedProgress.filter((p) => p.status === "done").length;
	const totalCount = dedupedProgress.length;

	return (
		<div>
			<style>{"@keyframes spin { to { transform: rotate(360deg); } }"}</style>

			{compiling && (
				<div style={{ ...cardStyle, borderColor: "var(--accent)" }}>
					<div
						style={{
							display: "flex",
							alignItems: "center",
							gap: "0.75rem",
							marginBottom: "0.75rem",
						}}
					>
						<Spinner />
						<h2 style={{ fontSize: "1rem", fontWeight: 600 }}>
							Compiling... ({doneCount}/{totalCount} sources)
						</h2>
					</div>
					<div
						style={{
							background: "var(--bg)",
							borderRadius: "4px",
							height: "4px",
							overflow: "hidden",
						}}
					>
						<div
							style={{
								background: "var(--accent)",
								height: "100%",
								width: `${totalCount > 0 ? (doneCount / totalCount) * 100 : 0}%`,
								transition: "width 0.3s ease",
							}}
						/>
					</div>
				</div>
			)}

			{dedupedProgress.length > 0 && (
				<div style={cardStyle}>
					<h2
						style={{
							fontSize: "1rem",
							fontWeight: 600,
							marginBottom: "1rem",
						}}
					>
						Source Progress
					</h2>
					<div
						style={{
							display: "flex",
							flexDirection: "column",
							gap: "0.5rem",
						}}
					>
						{dedupedProgress.map((p) => (
							<div
								key={p.source}
								style={{
									display: "flex",
									alignItems: "center",
									gap: "0.75rem",
									padding: "0.5rem 0.75rem",
									background: "var(--bg)",
									borderRadius: "var(--radius)",
									fontSize: "0.875rem",
									borderLeft: `3px solid ${statusColors[p.status] ?? "var(--border)"}`,
								}}
							>
								<StatusIcon status={p.status} />
								<span style={{ fontWeight: 500, minWidth: "80px" }}>
									{p.source}
								</span>
								<span
									style={{
										color: statusColors[p.status],
										fontSize: "0.75rem",
										minWidth: "70px",
									}}
								>
									{statusLabels[p.status]}
								</span>
								<span style={{ color: "var(--muted)", flex: 1 }}>
									{p.status === "done" || p.status === "error" ? p.message : ""}
								</span>
								{p.itemsFetched > 0 && (
									<span
										style={{
											color: "var(--success)",
											fontSize: "0.8125rem",
											fontWeight: 500,
										}}
									>
										{p.itemsFetched} items
									</span>
								)}
							</div>
						))}
					</div>
				</div>
			)}

			{result && !compiling && (
				<div style={{ ...cardStyle, borderColor: "var(--success)" }}>
					<div
						style={{
							display: "flex",
							justifyContent: "space-between",
							alignItems: "center",
						}}
					>
						<div>
							<h2
								style={{
									fontSize: "1rem",
									fontWeight: 600,
									marginBottom: "0.25rem",
									color: "var(--success)",
								}}
							>
								Compilation Complete
							</h2>
							<p style={{ color: "var(--muted)", fontSize: "0.875rem" }}>
								{result.totalItems} total items written to output/
							</p>
						</div>
						<button
							type="button"
							onClick={onClear}
							style={{
								padding: "0.375rem 0.75rem",
								borderRadius: "var(--radius)",
								border: "1px solid var(--border)",
								background: "transparent",
								color: "var(--muted)",
								cursor: "pointer",
								fontSize: "0.8125rem",
							}}
						>
							Clear Outputs
						</button>
					</div>
				</div>
			)}
		</div>
	);
}
