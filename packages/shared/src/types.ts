export type SourceType =
	| "github"
	| "slack"
	| "linear"
	| "granola"
	| "sentry"
	| "datadog"
	| "posthog"
	| "trello"
	| "figma"
	| "gmail"
	| "manual";

export type CompilationStatus = "idle" | "running" | "completed" | "failed";

export type SourceStatus = "connected" | "not_configured" | "error";

export interface CompilationItem {
	source: SourceType;
	externalId: string;
	title: string;
	content: string;
	author: string | null;
	sourceUrl: string | null;
	timestamp: string; // ISO 8601
	metadata: Record<string, unknown>;
}

export interface CompilationFilter {
	startDate: string; // ISO 8601
	endDate: string;
	sources: SourceType[];
	keywords?: string[];
}

export interface CompilationMeta {
	id: string;
	filter: CompilationFilter;
	status: CompilationStatus;
	startedAt: string;
	completedAt: string | null;
	sourceCounts: Partial<Record<SourceType, number>>;
}

export interface CacheEntry {
	source: SourceType;
	externalId: string;
	fetchedAt: string;
	contentHash: string;
}

export interface CacheData {
	version: number;
	lastCompilation: string | null;
	sources: Partial<Record<SourceType, CacheEntry[]>>;
}

export interface SourceHealthCheck {
	source: SourceType;
	status: SourceStatus;
	message: string;
	checkedAt: string;
}

export interface SummaryCard {
	source: SourceType;
	title: string;
	summary: string;
	itemCount: number;
	generatedAt: string;
}

export interface SummariesData {
	version: number;
	summaries: SummaryCard[];
}

export interface CompilationProgress {
	source: SourceType;
	status: "pending" | "fetching" | "writing" | "done" | "error";
	itemsFetched: number;
	message: string;
}
