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

export const CompilationFilterSchema = z.object({
	startDate: z.string().datetime(),
	endDate: z.string().datetime(),
	sources: z.array(SourceTypeSchema).min(1),
	keywords: z.array(z.string()).optional(),
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
