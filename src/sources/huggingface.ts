import type {
	CompilationItem,
	SourceCompilationFilter,
	SourceHealthCheck,
} from "../types.js";

const HF_API = "https://api.endpoints.huggingface.cloud/v2";

function getToken(): string {
	const token = process.env.HF_TOKEN;
	if (!token) throw new Error("HF_TOKEN not set");
	return token;
}

function getNamespace(): string {
	return process.env.HF_NAMESPACE ?? "BuiltByHQ";
}

async function hfGet<T>(path: string): Promise<T> {
	const url = `${HF_API}${path}`;
	const res = await fetch(url, {
		headers: {
			Authorization: `Bearer ${getToken()}`,
		},
	});

	if (!res.ok) {
		throw new Error(`HF API ${path} HTTP ${res.status}: ${res.statusText}`);
	}

	return res.json() as Promise<T>;
}

interface HFEndpointStatus {
	state: string;
	message?: string;
	createdAt?: string;
	updatedAt?: string;
	errorMessage?: string;
}

interface HFEndpointModel {
	repository: string;
	framework?: string;
	task?: string;
}

interface HFEndpointCompute {
	instanceType?: string;
	instanceSize?: string;
	scaling?: {
		minReplicas?: number;
		maxReplicas?: number;
	};
}

interface HFEndpoint {
	name: string;
	status: HFEndpointStatus;
	model: HFEndpointModel;
	compute?: HFEndpointCompute;
}

interface HFEndpointListResponse {
	items?: HFEndpoint[];
}

function matchesKeywords(
	text: string,
	keywords: string[] | undefined,
): boolean {
	if (!keywords || keywords.length === 0) return true;
	const lower = text.toLowerCase();
	return keywords.some((kw) => lower.includes(kw.toLowerCase()));
}

export async function compileHuggingFace(
	filter: SourceCompilationFilter,
): Promise<CompilationItem[]> {
	const namespace = getNamespace();

	const response = await hfGet<HFEndpoint[] | HFEndpointListResponse>(
		`/endpoint/${namespace}`,
	);

	// Handle both array response and object-with-items response
	const allEndpoints: HFEndpoint[] = Array.isArray(response)
		? response
		: (response.items ?? []);

	// Filter by endpoint names if specified
	const endpoints =
		filter.endpoints && filter.endpoints.length > 0
			? allEndpoints.filter((ep) => filter.endpoints!.includes(ep.name))
			: allEndpoints;

	const items: CompilationItem[] = [];

	for (const ep of endpoints) {
		const searchText = `${ep.name} ${ep.model.repository}`;
		if (!matchesKeywords(searchText, filter.keywords)) continue;

		const state = ep.status.state;
		const statusMessage = ep.status.message ?? "";
		const errorDetail = ep.status.errorMessage ?? "";

		const lines = [
			`**Name:** ${ep.name}`,
			"",
			"### Status",
			`- **State:** ${state}`,
		];

		if (statusMessage) {
			lines.push(`- **Message:** ${statusMessage}`);
		}
		if (errorDetail) {
			lines.push(`- **Error:** ${errorDetail}`);
		}

		lines.push("", "### Model");
		lines.push(`- **Repository:** ${ep.model.repository}`);
		if (ep.model.framework) {
			lines.push(`- **Framework:** ${ep.model.framework}`);
		}
		if (ep.model.task) {
			lines.push(`- **Task:** ${ep.model.task}`);
		}

		if (ep.compute) {
			lines.push("", "### Compute");
			if (ep.compute.instanceType) {
				lines.push(`- **Instance Type:** ${ep.compute.instanceType}`);
			}
			if (ep.compute.instanceSize) {
				lines.push(`- **Instance Size:** ${ep.compute.instanceSize}`);
			}
			if (ep.compute.scaling) {
				lines.push(
					`- **Scaling:** ${ep.compute.scaling.minReplicas ?? 0} – ${ep.compute.scaling.maxReplicas ?? 1} replicas`,
				);
			}
		}

		const timestamp =
			ep.status.updatedAt ?? ep.status.createdAt ?? new Date().toISOString();

		items.push({
			source: "huggingface",
			externalId: `hf-${ep.name}`,
			title: ep.name,
			content: lines.join("\n"),
			author: null,
			sourceUrl: `https://ui.endpoints.huggingface.co/${namespace}/${ep.name}`,
			timestamp,
			metadata: {
				type: "endpoint",
				state,
				model: ep.model.repository,
				instanceType: ep.compute?.instanceType,
			},
		});
	}

	items.sort(
		(a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
	);

	return items;
}

let healthCache: { result: SourceHealthCheck; expiresAt: number } | null = null;

export async function checkHuggingFaceHealth(): Promise<SourceHealthCheck> {
	if (healthCache && healthCache.expiresAt > Date.now()) {
		return healthCache.result;
	}

	const now = new Date().toISOString();

	if (!process.env.HF_TOKEN) {
		return {
			source: "huggingface",
			status: "not_configured",
			message: "HF_TOKEN not set",
			checkedAt: now,
		};
	}

	try {
		const namespace = getNamespace();
		const response = await hfGet<HFEndpoint[] | HFEndpointListResponse>(
			`/endpoint/${namespace}`,
		);

		const endpoints: HFEndpoint[] = Array.isArray(response)
			? response
			: (response.items ?? []);

		const result: SourceHealthCheck = {
			source: "huggingface",
			status: "connected",
			message: `Found ${endpoints.length} endpoint${endpoints.length === 1 ? "" : "s"} in namespace ${namespace}`,
			checkedAt: now,
		};
		healthCache = { result, expiresAt: Date.now() + 60000 };
		return result;
	} catch (err) {
		const result: SourceHealthCheck = {
			source: "huggingface",
			status: "error",
			message: err instanceof Error ? err.message : String(err),
			checkedAt: now,
		};
		healthCache = { result, expiresAt: Date.now() + 60000 };
		return result;
	}
}
