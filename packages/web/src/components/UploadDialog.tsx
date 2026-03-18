import { useCallback, useRef, useState } from "react";

interface Props {
	open: boolean;
	onClose: () => void;
}

interface UploadedFile {
	name: string;
	size: number;
	status: "pending" | "uploading" | "done" | "error";
	message?: string;
}

function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function UploadDialog({ open, onClose }: Props) {
	const [files, setFiles] = useState<File[]>([]);
	const [uploaded, setUploaded] = useState<UploadedFile[]>([]);
	const [uploading, setUploading] = useState(false);
	const [dragOver, setDragOver] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);

	const addFiles = useCallback((incoming: FileList | File[]) => {
		const arr = Array.from(incoming);
		setFiles((prev) => [...prev, ...arr]);
	}, []);

	function removeFile(index: number) {
		setFiles((prev) => prev.filter((_, i) => i !== index));
	}

	async function handleUpload() {
		if (files.length === 0) return;
		setUploading(true);
		setUploaded([]);

		const results: UploadedFile[] = [];

		for (const file of files) {
			results.push({
				name: file.name,
				size: file.size,
				status: "uploading",
			});
			setUploaded([...results]);

			try {
				const formData = new FormData();
				formData.append("file", file);

				const res = await fetch("/api/upload", {
					method: "POST",
					body: formData,
				});

				if (!res.ok) {
					const data = await res.json();
					results[results.length - 1] = {
						name: file.name,
						size: file.size,
						status: "error",
						message: data.error ?? "Upload failed",
					};
				} else {
					const data = await res.json();
					results[results.length - 1] = {
						name: file.name,
						size: file.size,
						status: "done",
						message: data.message,
					};
				}
			} catch {
				results[results.length - 1] = {
					name: file.name,
					size: file.size,
					status: "error",
					message: "Network error",
				};
			}

			setUploaded([...results]);
		}

		setFiles([]);
		setUploading(false);
	}

	function handleClose() {
		setFiles([]);
		setUploaded([]);
		onClose();
	}

	if (!open) return null;

	const overlayStyle: React.CSSProperties = {
		position: "fixed",
		inset: 0,
		background: "rgba(0, 0, 0, 0.6)",
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		zIndex: 1000,
	};

	const dialogStyle: React.CSSProperties = {
		background: "var(--card-bg)",
		border: "1px solid var(--border)",
		borderRadius: "var(--radius)",
		padding: "1.5rem",
		width: "100%",
		maxWidth: 520,
		maxHeight: "80vh",
		overflow: "auto",
	};

	const dropZoneStyle: React.CSSProperties = {
		border: `2px dashed ${dragOver ? "var(--accent)" : "var(--border)"}`,
		borderRadius: "var(--radius)",
		padding: "2rem",
		textAlign: "center",
		cursor: "pointer",
		background: dragOver ? "rgba(99, 102, 241, 0.05)" : "var(--bg)",
		transition: "border-color 0.2s, background 0.2s",
	};

	const btnStyle: React.CSSProperties = {
		padding: "0.5rem 1.5rem",
		borderRadius: "var(--radius)",
		border: "none",
		background: "var(--accent)",
		color: "#fff",
		cursor: "pointer",
		fontSize: "0.875rem",
		fontWeight: 500,
	};

	return (
		<div
			style={overlayStyle}
			onClick={(e) => {
				if (e.target === e.currentTarget) handleClose();
			}}
			onKeyDown={(e) => {
				if (e.key === "Escape") handleClose();
			}}
		>
			<div style={dialogStyle}>
				<div
					style={{
						display: "flex",
						justifyContent: "space-between",
						alignItems: "center",
						marginBottom: "1rem",
					}}
				>
					<h2 style={{ fontSize: "1rem", fontWeight: 600 }}>
						Upload Manual Docs
					</h2>
					<button
						type="button"
						onClick={handleClose}
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

				<button
					type="button"
					style={dropZoneStyle}
					onClick={() => inputRef.current?.click()}
					onDragOver={(e) => {
						e.preventDefault();
						setDragOver(true);
					}}
					onDragLeave={() => setDragOver(false)}
					onDrop={(e) => {
						e.preventDefault();
						setDragOver(false);
						if (e.dataTransfer.files.length > 0) {
							addFiles(e.dataTransfer.files);
						}
					}}
				>
					<p style={{ color: "var(--muted)", fontSize: "0.875rem" }}>
						Drop files here or click to browse
					</p>
					<p
						style={{
							color: "var(--muted)",
							fontSize: "0.75rem",
							marginTop: "0.5rem",
						}}
					>
						Supports .md, .txt, .pdf, .png, .jpg, .jpeg, .gif, .webp
					</p>
					<input
						ref={inputRef}
						type="file"
						multiple
						accept=".md,.txt,.pdf,.png,.jpg,.jpeg,.gif,.webp"
						style={{ display: "none" }}
						onChange={(e) => {
							if (e.target.files) addFiles(e.target.files);
							e.target.value = "";
						}}
					/>
				</button>

				{files.length > 0 && (
					<div style={{ marginTop: "1rem" }}>
						<p
							style={{
								fontSize: "0.75rem",
								color: "var(--muted)",
								marginBottom: "0.5rem",
							}}
						>
							{files.length} file(s) selected
						</p>
						{files.map((f, i) => (
							<div
								key={`${f.name}-${i}`}
								style={{
									display: "flex",
									justifyContent: "space-between",
									alignItems: "center",
									padding: "0.375rem 0.5rem",
									background: "var(--bg)",
									borderRadius: "var(--radius)",
									marginBottom: "0.25rem",
									fontSize: "0.8125rem",
								}}
							>
								<span>
									{f.name}{" "}
									<span style={{ color: "var(--muted)" }}>
										({formatSize(f.size)})
									</span>
								</span>
								<button
									type="button"
									onClick={() => removeFile(i)}
									style={{
										background: "none",
										border: "none",
										color: "var(--muted)",
										cursor: "pointer",
										fontSize: "0.875rem",
									}}
								>
									x
								</button>
							</div>
						))}
						<button
							type="button"
							onClick={handleUpload}
							disabled={uploading}
							style={{
								...btnStyle,
								marginTop: "0.75rem",
								background: uploading ? "var(--border)" : "var(--accent)",
								cursor: uploading ? "not-allowed" : "pointer",
							}}
						>
							{uploading ? "Uploading..." : "Upload"}
						</button>
					</div>
				)}

				{uploaded.length > 0 && (
					<div style={{ marginTop: "1rem" }}>
						<p
							style={{
								fontSize: "0.75rem",
								color: "var(--muted)",
								marginBottom: "0.5rem",
							}}
						>
							Results
						</p>
						{uploaded.map((u, i) => (
							<div
								key={`${u.name}-${i}`}
								style={{
									display: "flex",
									alignItems: "center",
									gap: "0.5rem",
									padding: "0.375rem 0.5rem",
									background: "var(--bg)",
									borderRadius: "var(--radius)",
									marginBottom: "0.25rem",
									fontSize: "0.8125rem",
									borderLeft: `3px solid ${
										u.status === "done"
											? "var(--success)"
											: u.status === "error"
												? "var(--error)"
												: "var(--accent)"
									}`,
								}}
							>
								<span style={{ flex: 1 }}>{u.name}</span>
								<span
									style={{
										color:
											u.status === "done"
												? "var(--success)"
												: u.status === "error"
													? "var(--error)"
													: "var(--muted)",
										fontSize: "0.75rem",
									}}
								>
									{u.message ?? u.status}
								</span>
							</div>
						))}
					</div>
				)}
			</div>
		</div>
	);
}
