import type { CompilationProgress } from "@thoughtcurrent/shared";
import { useState } from "react";
import { CompileForm } from "./components/CompileForm.js";
import { Dashboard } from "./components/Dashboard.js";

export function App() {
	const [progress, setProgress] = useState<CompilationProgress[]>([]);
	const [compiling, setCompiling] = useState(false);
	const [result, setResult] = useState<{
		totalItems: number;
		progress: CompilationProgress[];
	} | null>(null);

	async function handleClear() {
		try {
			await fetch("/api/compile/clear", { method: "DELETE" });
			setProgress([]);
			setResult(null);
		} catch (err) {
			console.error("Clear failed:", err);
		}
	}

	async function handleCompile(filter: {
		startDate: string;
		endDate: string;
		sources: string[];
		keywords?: string[];
	}) {
		setCompiling(true);
		setResult(null);
		setProgress(
			filter.sources.map((s) => ({
				source: s as CompilationProgress["source"],
				status: "pending" as const,
				itemsFetched: 0,
				message: "Waiting...",
			})),
		);

		try {
			const res = await fetch("/api/compile", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(filter),
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

			<CompileForm onCompile={handleCompile} disabled={compiling} />
			<Dashboard
				progress={progress}
				result={result}
				compiling={compiling}
				onClear={handleClear}
			/>
		</div>
	);
}
