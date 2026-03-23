import type {
	CompilationProgress,
	FilterPreset,
	SourceFilterConfig,
	SourceType,
} from "@thoughtcurrent/shared";
import { useCallback, useEffect, useState } from "react";
import { CompileForm } from "./components/CompileForm.js";
import { Dashboard } from "./components/Dashboard.js";
import { SourceConfigModal } from "./components/SourceConfigModal.js";

export function App() {
	const [progress, setProgress] = useState<CompilationProgress[]>([]);
	const [compiling, setCompiling] = useState(false);
	const [result, setResult] = useState<{
		totalItems: number;
		progress: CompilationProgress[];
	} | null>(null);

	const [clearFlash, setClearFlash] = useState(false);
	const [sourceConfigs, setSourceConfigs] = useState<
		Map<SourceType, SourceFilterConfig>
	>(new Map());
	const [activeModal, setActiveModal] = useState<SourceType | null>(null);
	const [presets, setPresets] = useState<FilterPreset[]>([]);

	const fetchPresets = useCallback(async () => {
		try {
			const res = await fetch("/api/presets");
			const data = await res.json();
			setPresets(data.presets ?? []);
		} catch {
			// ignore
		}
	}, []);

	useEffect(() => {
		fetchPresets();
	}, [fetchPresets]);

	async function handleClear() {
		try {
			await fetch("/api/compile/clear", { method: "DELETE" });
			setProgress([]);
			setResult(null);
			setClearFlash(true);
			setTimeout(() => setClearFlash(false), 2500);
		} catch (err) {
			console.error("Clear failed:", err);
		}
	}

	async function handleCompile() {
		if (sourceConfigs.size === 0) return;

		const configs = [...sourceConfigs.values()];
		setCompiling(true);
		setResult(null);
		setProgress(
			configs.map((sc) => ({
				source: sc.source as CompilationProgress["source"],
				status: "pending" as const,
				itemsFetched: 0,
				message: "Waiting...",
			})),
		);

		try {
			const res = await fetch("/api/compile", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ sourceConfigs: configs }),
			});

			const data = await res.json();

			if (!res.ok) {
				console.error("Compilation error:", data);
				return;
			}

			setProgress(data.progress);
			setResult(data);
		} catch (err) {
			console.error("Compilation failed:", err);
		} finally {
			setCompiling(false);
		}
	}

	function handleOpenModal(source: SourceType) {
		setActiveModal(source);
	}

	function handleCloseModal() {
		setActiveModal(null);
	}

	function handleSourceConfigSave(config: SourceFilterConfig) {
		setSourceConfigs((prev) => {
			const next = new Map(prev);
			next.set(config.source, config);
			return next;
		});
		setActiveModal(null);
	}

	function handleRemoveSource(source: SourceType) {
		setSourceConfigs((prev) => {
			const next = new Map(prev);
			next.delete(source);
			return next;
		});
	}

	async function handleSavePreset(name: string) {
		try {
			const res = await fetch("/api/presets", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					name,
					sourceConfigs: [...sourceConfigs.values()],
				}),
			});
			if (res.ok) {
				await fetchPresets();
			}
		} catch {
			// ignore
		}
	}

	function handleLoadPreset(preset: FilterPreset) {
		const configMap = new Map<SourceType, SourceFilterConfig>();
		for (const sc of preset.sourceConfigs) {
			configMap.set(sc.source, sc);
		}
		setSourceConfigs(configMap);
	}

	async function handleDeletePreset(id: string) {
		try {
			const res = await fetch(`/api/presets/${id}`, { method: "DELETE" });
			if (res.ok) {
				await fetchPresets();
			}
		} catch {
			// ignore
		}
	}

	return (
		<div style={{ maxWidth: 960, margin: "0 auto", padding: "2rem 1rem" }}>
			<header
				style={{
					marginBottom: "2rem",
					display: "flex",
					justifyContent: "space-between",
					alignItems: "center",
				}}
			>
				<div>
					<h1 style={{ fontSize: "1.5rem", fontWeight: 600 }}>
						ThoughtCurrent
					</h1>
					<p style={{ color: "var(--muted)", fontSize: "0.875rem" }}>
						Compile text from multiple sources into a single source of truth
					</p>
				</div>
				<button
					type="button"
					onClick={handleClear}
					style={{
						padding: "0.375rem 0.75rem",
						borderRadius: "8px",
						border: "1px solid var(--border)",
						background: "transparent",
						color: "var(--muted)",
						cursor: "pointer",
						fontSize: "0.8125rem",
					}}
				>
					Clear Outputs
				</button>
			</header>

			{clearFlash && (
				<div
					style={{
						padding: "0.75rem 1rem",
						background: "var(--card-bg)",
						border: "1px solid var(--success)",
						borderRadius: "var(--radius)",
						marginBottom: "1rem",
						color: "var(--success)",
						fontSize: "0.875rem",
						animation: "fadeIn 0.2s ease",
					}}
				>
					Outputs cleared successfully.
				</div>
			)}

			<CompileForm
				onCompile={handleCompile}
				disabled={compiling}
				sourceConfigs={sourceConfigs}
				onSourceClick={handleOpenModal}
				onRemoveSource={handleRemoveSource}
				presets={presets}
				onSavePreset={handleSavePreset}
				onLoadPreset={handleLoadPreset}
				onDeletePreset={handleDeletePreset}
			/>

			<Dashboard
				progress={progress}
				result={result}
				compiling={compiling}
				onClear={handleClear}
			/>

			{activeModal && (
				<SourceConfigModal
					source={activeModal}
					existingConfig={sourceConfigs.get(activeModal) ?? null}
					onSave={handleSourceConfigSave}
					onClose={handleCloseModal}
				/>
			)}
		</div>
	);
}
