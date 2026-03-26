import {
	getBotToken,
	getUserToken,
	resolveUser,
	slackApi,
} from "./sources/slack.js";
import type { SlackChannelMeta, SlackUserMeta } from "./types.js";

// In-memory caches with 5-minute TTL
let channelCache: { data: SlackChannelMeta[]; expiresAt: number } | null = null;
let userListCache: { data: SlackUserMeta[]; expiresAt: number } | null = null;
const CACHE_TTL = 5 * 60 * 1000;

export async function listSlackChannels(): Promise<SlackChannelMeta[]> {
	if (channelCache && channelCache.expiresAt > Date.now()) {
		return channelCache.data;
	}

	const botToken = getBotToken();
	const userToken = getUserToken();
	const token = botToken ?? userToken;
	if (!token) {
		throw new Error("No Slack token configured");
	}

	const channels: SlackChannelMeta[] = [];
	let cursor = "";

	do {
		const params: Record<string, string> = {
			types: "public_channel,private_channel,mpim,im",
			exclude_archived: "true",
			limit: "200",
		};
		if (cursor) params.cursor = cursor;

		const data = await slackApi<{
			channels: Array<{
				id: string;
				name: string;
				is_channel: boolean;
				is_group: boolean;
				is_im: boolean;
				is_mpim: boolean;
				is_private: boolean;
				is_member: boolean;
				num_members: number;
				user?: string;
				purpose?: { value: string };
			}>;
			response_metadata?: { next_cursor?: string };
		}>("conversations.list", params, token);

		for (const ch of data.channels) {
			let type: SlackChannelMeta["type"] = "public";
			if (ch.is_im) type = "im";
			else if (ch.is_mpim) type = "mpim";
			else if (ch.is_private || ch.is_group) type = "private";

			let displayName = ch.name;
			if (ch.is_im && ch.user) {
				displayName = await resolveUser(ch.user);
			} else if (ch.is_mpim) {
				displayName = ch.purpose?.value || ch.name;
			}

			channels.push({
				id: ch.id,
				name: ch.name,
				type,
				memberCount: ch.num_members ?? 0,
				displayName,
			});
		}

		cursor = data.response_metadata?.next_cursor ?? "";
	} while (cursor);

	channelCache = { data: channels, expiresAt: Date.now() + CACHE_TTL };
	return channels;
}

export async function listSlackUsers(): Promise<SlackUserMeta[]> {
	if (userListCache && userListCache.expiresAt > Date.now()) {
		return userListCache.data;
	}

	const token = getUserToken() ?? getBotToken();
	if (!token) {
		throw new Error("No Slack token configured");
	}

	const users: SlackUserMeta[] = [];
	let cursor = "";

	do {
		const params: Record<string, string> = { limit: "200" };
		if (cursor) params.cursor = cursor;

		const data = await slackApi<{
			members: Array<{
				id: string;
				name: string;
				real_name: string;
				deleted: boolean;
				is_bot: boolean;
				is_app_user: boolean;
				profile?: { image_48?: string };
			}>;
			response_metadata?: { next_cursor?: string };
		}>("users.list", params, token);

		for (const member of data.members) {
			if (member.deleted || member.is_bot || member.is_app_user) continue;
			if (member.id === "USLACKBOT") continue;

			users.push({
				id: member.id,
				name: member.name,
				realName: member.real_name || member.name,
				avatar: member.profile?.image_48 ?? null,
			});
		}

		cursor = data.response_metadata?.next_cursor ?? "";
	} while (cursor);

	userListCache = { data: users, expiresAt: Date.now() + CACHE_TTL };
	return users;
}
