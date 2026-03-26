import { z } from "zod";

export const sourceTypes = [
	"github",
	"slack",
	"linear",
	"granola",
	"sentry",
	"datadog",
	"posthog",
	"trello",
	"figma",
	"gmail",
	"manual",
] as const;

export const SourceTypeSchema = z.enum(sourceTypes);

export const SlackContentTypeSchema = z.enum([
	"messages",
	"files",
	"canvases",
	"images",
	"pins",
	"bookmarks",
]);

export const SlackHasFilterSchema = z.enum(["pin", "link", "reaction", "file"]);

export const SlackFilterConfigSchema = z.object({
	channels: z.array(z.string()).optional(),
	users: z.array(z.string()).optional(),
	searchQuery: z.string().optional(),
	contentTypes: z.array(SlackContentTypeSchema).optional(),
	hasFilters: z.array(SlackHasFilterSchema).optional(),
	keywords: z.array(z.string()).optional(),
	dmKeywords: z.array(z.string()).optional(),
	exactPhrases: z.array(z.string()).optional(),
	exclusions: z.array(z.string()).optional(),
	startDate: z.string(),
	endDate: z.string(),
});

export const SlackSourceConfigSchema = z.object({
	source: z.literal("slack"),
	config: SlackFilterConfigSchema,
});

export const GranolaFilterConfigSchema = z.object({
	keywords: z.array(z.string()).optional(),
	startDate: z.string().optional(),
	endDate: z.string().optional(),
});

export const GranolaSourceConfigSchema = z.object({
	source: z.literal("granola"),
	config: GranolaFilterConfigSchema,
});

export const FigmaFilterConfigSchema = z.object({
	fileUrls: z.array(z.string()).min(1),
	includeText: z.boolean().optional(),
	includeComments: z.boolean().optional(),
	includeScreenshots: z.boolean().optional(),
});

export const FigmaSourceConfigSchema = z.object({
	source: z.literal("figma"),
	config: FigmaFilterConfigSchema,
});

export const GenericSourceConfigSchema = z.object({
	source: SourceTypeSchema.exclude(["slack", "granola", "figma"]),
	startDate: z.string(),
	endDate: z.string(),
	keywords: z.array(z.string()).optional(),
	senders: z.array(z.string()).optional(),
	repos: z.array(z.string()).optional(),
});

export const SourceFilterConfigSchema = z.discriminatedUnion("source", [
	SlackSourceConfigSchema,
	GranolaSourceConfigSchema,
	FigmaSourceConfigSchema,
	GenericSourceConfigSchema,
]);

export const CompilationFilterSchema = z.object({
	sourceConfigs: z.array(SourceFilterConfigSchema).min(1),
});

export const CompilationItemSchema = z.object({
	source: SourceTypeSchema,
	externalId: z.string(),
	title: z.string(),
	content: z.string(),
	author: z.string().nullable(),
	sourceUrl: z.string().url().nullable(),
	timestamp: z.string().datetime(),
	metadata: z.record(z.unknown()),
});

export const FilterPresetSchema = z.object({
	id: z.string(),
	name: z.string().min(1),
	createdAt: z.string(),
	sourceConfigs: z.array(SourceFilterConfigSchema),
});

export const PresetsDataSchema = z.object({
	version: z.number(),
	presets: z.array(FilterPresetSchema),
});
