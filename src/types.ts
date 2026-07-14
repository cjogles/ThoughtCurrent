export type SourceType =
	| "github"
	| "slack"
	| "linear"
	| "granola"
	| "sentry"
	| "datadog"
	| "huggingface"
	| "trello"
	| "figma"
	| "gmail"
	| "posthog"
	| "manual";

export type CompilationStatus = "idle" | "running" | "completed" | "failed";

export type SourceStatus = "connected" | "not_configured" | "error";

export type SlackContentType =
	| "messages"
	| "files"
	| "canvases"
	| "images"
	| "pins"
	| "bookmarks";

export type SlackHasFilter = "pin" | "link" | "reaction" | "file";

export interface SlackFilterConfig {
	channels?: string[];
	users?: string[];
	searchQuery?: string;
	contentTypes?: SlackContentType[];
	hasFilters?: SlackHasFilter[];
	keywords?: string[];
	dmKeywords?: string[];
	exactPhrases?: string[];
	exclusions?: string[];
	startDate: string;
	endDate: string;
}

export interface SlackSourceConfig {
	source: "slack";
	config: SlackFilterConfig;
}

export interface GranolaFilterConfig {
	keywords?: string[];
	startDate?: string;
	endDate?: string;
}

export interface GranolaSourceConfig {
	source: "granola";
	config: GranolaFilterConfig;
}

export interface FigmaFilterConfig {
	fileUrls: string[];
	includeText?: boolean;
	includeComments?: boolean;
	includeScreenshots?: boolean;
}

export interface FigmaSourceConfig {
	source: "figma";
	config: FigmaFilterConfig;
}

export interface PosthogFilterConfig {
	startDate: string; // required window lower bound (UTC), e.g. "2026-07-14 15:00"
	endDate: string; // required window upper bound (UTC)
	urlContains?: string[]; // discover sessions by $current_url substring (order ids, route fragments)
	sessionIds?: string[]; // pull these sessions directly
	testids?: string[]; // discover sessions by $autocapture data-testid
	events?: string[]; // restrict to these event names (default: all)
	includeRecordingsList?: boolean; // enrich sessions with recording metadata (default: true)
	hogql?: string[]; // escape hatch: raw HogQL queries rendered as tables
	limit?: number; // per-query row cap, paginated (default: 300)
}

export interface PosthogSourceConfig {
	source: "posthog";
	config: PosthogFilterConfig;
}

export interface GenericSourceConfig {
	source: Exclude<SourceType, "slack" | "granola" | "figma" | "posthog">;
	startDate: string;
	endDate: string;
	keywords?: string[];
	senders?: string[];
	repos?: string[];
	projects?: string[];
	query?: string;
	endpoints?: string[];
}

export type SourceFilterConfig =
	| SlackSourceConfig
	| GranolaSourceConfig
	| FigmaSourceConfig
	| PosthogSourceConfig
	| GenericSourceConfig;

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
	sourceConfigs: SourceFilterConfig[];
}

export interface SourceCompilationFilter {
	startDate: string;
	endDate: string;
	sources: SourceType[];
	keywords?: string[];
	senders?: string[];
	repos?: string[];
	projects?: string[];
	query?: string;
	endpoints?: string[];
}

export interface FilterPreset {
	id: string;
	name: string;
	createdAt: string;
	sourceConfigs: SourceFilterConfig[];
}

export interface PresetsData {
	version: number;
	presets: FilterPreset[];
}

export interface SlackChannelMeta {
	id: string;
	name: string;
	type: "public" | "private" | "im" | "mpim";
	memberCount: number;
	displayName: string;
}

export interface SlackUserMeta {
	id: string;
	name: string;
	realName: string;
	avatar: string | null;
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
