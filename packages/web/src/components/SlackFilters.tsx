import type {
	SlackChannelMeta,
	SlackContentType,
	SlackFilterConfig,
	SlackHasFilter,
	SlackUserMeta,
} from "@thoughtcurrent/shared";
import { useEffect, useState } from "react";

interface Props {
	existingConfig: SlackFilterConfig | null;
	onSave: (config: SlackFilterConfig) => void;
	onCancel: () => void;
}

const CONTENT_TYPE_OPTIONS: { id: SlackContentType; label: string }[] = [
	{ id: "messages", label: "Messages" },
	{ id: "files", label: "Files" },
	{ id: "canvases", label: "Canvases" },
	{ id: "images", label: "Images" },
	{ id: "pins", label: "Pinned Items" },
	{ id: "bookmarks", label: "Bookmarks" },
];

const HAS_FILTER_OPTIONS: { id: SlackHasFilter; label: string }[] = [
	{ id: "pin", label: "has:pin" },
	{ id: "link", label: "has:link" },
	{ id: "reaction", label: "has:reaction" },
	{ id: "file", label: "has:file" },
];

export function SlackFilters({ existingConfig, onSave, onCancel }: Props) {
	const today = new Date().toISOString().split("T")[0];

	const [startDate, setStartDate] = useState(
		existingConfig?.startDate ? existingConfig.startDate.split("T")[0] : today,
	);
	const [endDate, setEndDate] = useState(
		existingConfig?.endDate ? existingConfig.endDate.split("T")[0] : today,
	);

	// Channels
	const [channels, setChannels] = useState<SlackChannelMeta[]>([]);
	const [channelsLoading, setChannelsLoading] = useState(true);
	const [selectedChannels, setSelectedChannels] = useState<Set<string>>(
		new Set(existingConfig?.channels ?? []),
	);
	const [channelSearch, setChannelSearch] = useState("");

	// Users
	const [users, setUsers] = useState<SlackUserMeta[]>([]);
	const [usersLoading, setUsersLoading] = useState(true);
	const [selectedUsers, setSelectedUsers] = useState<Set<string>>(
		new Set(existingConfig?.users ?? []),
	);
	const [userSearch, setUserSearch] = useState("");

	// Search query
	const [searchQuery, setSearchQuery] = useState(
		existingConfig?.searchQuery ?? "",
	);
	const [hasUserToken, setHasUserToken] = useState(true);

	// Content types
	const [contentTypes, setContentTypes] = useState<Set<SlackContentType>>(
		new Set(existingConfig?.contentTypes ?? ["messages"]),
	);

	// Has filters
	const [hasFilters, setHasFilters] = useState<Set<SlackHasFilter>>(
		new Set(existingConfig?.hasFilters ?? []),
	);

	// Keywords, DM keywords, phrases, exclusions
	const [keywords, setKeywords] = useState(
		existingConfig?.keywords?.join(", ") ?? "",
	);
	const [dmKeywords, setDmKeywords] = useState(
		existingConfig?.dmKeywords?.join(", ") ?? "",
	);
	const [exactPhrases, setExactPhrases] = useState(
		existingConfig?.exactPhrases?.join(", ") ?? "",
	);
	const [exclusions, setExclusions] = useState(
		existingConfig?.exclusions?.join(", ") ?? "",
	);

	// Fetch channels and users on mount
	useEffect(() => {
		fetch("/api/slack/channels")
			.then((res) => res.json())
			.then((data) => setChannels(data.channels ?? []))
			.catch(() => {})
			.finally(() => setChannelsLoading(false));

		fetch("/api/slack/users")
			.then((res) => res.json())
			.then((data) => setUsers(data.users ?? []))
			.catch(() => {})
			.finally(() => setUsersLoading(false));

		fetch("/api/slack/validate")
			.then((res) => res.json())
			.then((data) => {
				setHasUserToken(data.hasUserToken ?? false);
			})
			.catch(() => setHasUserToken(false));
	}, []);

	function handleSave() {
		const parseComma = (s: string) =>
			s
				.split(",")
				.map((v) => v.trim())
				.filter(Boolean);

		const config: SlackFilterConfig = {
			startDate: new Date(startDate).toISOString(),
			endDate: new Date(`${endDate}T23:59:59`).toISOString(),
		};

		if (selectedChannels.size > 0) config.channels = [...selectedChannels];
		if (selectedUsers.size > 0) config.users = [...selectedUsers];
		if (searchQuery.trim()) config.searchQuery = searchQuery.trim();
		if (contentTypes.size > 0) config.contentTypes = [...contentTypes];
		if (hasFilters.size > 0) config.hasFilters = [...hasFilters];

		const kw = parseComma(keywords);
		if (kw.length > 0) config.keywords = kw;

		const dmKw = parseComma(dmKeywords);
		if (dmKw.length > 0) config.dmKeywords = dmKw;

		const phrases = parseComma(exactPhrases);
		if (phrases.length > 0) config.exactPhrases = phrases;

		const excl = parseComma(exclusions);
		if (excl.length > 0) config.exclusions = excl;

		onSave(config);
	}

	// Group channels by type
	const channelGroups: Record<string, SlackChannelMeta[]> = {
		public: [],
		private: [],
		im: [],
		mpim: [],
	};
	const channelSearchLower = channelSearch.toLowerCase();
	for (const ch of channels) {
		if (
			channelSearchLower &&
			!(ch.displayName ?? "").toLowerCase().includes(channelSearchLower) &&
			!(ch.name ?? "").toLowerCase().includes(channelSearchLower)
		)
			continue;
		channelGroups[ch.type].push(ch);
	}

	const filteredUsers = userSearch
		? users.filter(
				(u) =>
					u.realName.toLowerCase().includes(userSearch.toLowerCase()) ||
					u.name.toLowerCase().includes(userSearch.toLowerCase()),
			)
		: users;

	const inputStyle: React.CSSProperties = {
		background: "var(--bg)",
		border: "1px solid var(--border)",
		borderRadius: "var(--radius)",
		color: "var(--fg)",
		padding: "0.5rem 0.75rem",
		fontSize: "0.875rem",
		width: "100%",
	};

	const labelStyle: React.CSSProperties = {
		display: "block",
		fontSize: "0.75rem",
		color: "var(--muted)",
		marginBottom: "0.25rem",
	};

	const sectionStyle: React.CSSProperties = {
		marginBottom: "1.25rem",
	};

	const checkboxListStyle: React.CSSProperties = {
		maxHeight: 200,
		overflowY: "auto",
		border: "1px solid var(--border)",
		borderRadius: "var(--radius)",
		padding: "0.5rem",
		background: "var(--bg)",
	};

	const checkboxItemStyle: React.CSSProperties = {
		display: "flex",
		alignItems: "center",
		gap: "0.5rem",
		padding: "0.25rem 0",
		fontSize: "0.8125rem",
	};

	const btnStyle: React.CSSProperties = {
		padding: "0.5rem 1.25rem",
		borderRadius: "var(--radius)",
		border: "none",
		fontSize: "0.875rem",
		fontWeight: 500,
		cursor: "pointer",
	};

	const groupLabelStyle: React.CSSProperties = {
		fontSize: "0.6875rem",
		fontWeight: 600,
		textTransform: "uppercase" as const,
		color: "var(--muted)",
		marginTop: "0.5rem",
		marginBottom: "0.25rem",
		display: "flex",
		justifyContent: "space-between",
		alignItems: "center",
	};

	const groupLabels: Record<string, string> = {
		public: "Public Channels",
		private: "Private Channels",
		im: "Direct Messages",
		mpim: "Group DMs",
	};

	function toggleAllInGroup(type: string) {
		const groupChannels = channelGroups[type];
		const allSelected = groupChannels.every((ch) =>
			selectedChannels.has(ch.id),
		);
		setSelectedChannels((prev) => {
			const next = new Set(prev);
			for (const ch of groupChannels) {
				if (allSelected) next.delete(ch.id);
				else next.add(ch.id);
			}
			return next;
		});
	}

	return (
		<div>
			{/* 1. Date Range */}
			<div style={sectionStyle}>
				<div
					style={{
						display: "grid",
						gridTemplateColumns: "1fr 1fr",
						gap: "1rem",
					}}
				>
					<label>
						<span style={labelStyle}>Start Date</span>
						<input
							type="date"
							value={startDate}
							onChange={(e) => setStartDate(e.target.value)}
							style={inputStyle}
						/>
					</label>
					<label>
						<span style={labelStyle}>End Date</span>
						<input
							type="date"
							value={endDate}
							onChange={(e) => setEndDate(e.target.value)}
							style={inputStyle}
						/>
					</label>
				</div>
			</div>

			{/* 2. Channels */}
			<div style={sectionStyle}>
				<span style={labelStyle}>
					Channels{" "}
					{selectedChannels.size > 0 && `(${selectedChannels.size} selected)`}
				</span>
				<input
					type="text"
					placeholder="Search channels..."
					value={channelSearch}
					onChange={(e) => setChannelSearch(e.target.value)}
					style={{ ...inputStyle, marginBottom: "0.5rem" }}
				/>
				{channelsLoading ? (
					<p style={{ color: "var(--muted)", fontSize: "0.8125rem" }}>
						Loading channels...
					</p>
				) : (
					<div style={checkboxListStyle}>
						{(
							Object.entries(channelGroups) as [string, SlackChannelMeta[]][]
						).map(([type, chs]) =>
							chs.length > 0 ? (
								<div key={type}>
									<div style={groupLabelStyle}>
										<span>{groupLabels[type]}</span>
										<button
											type="button"
											onClick={() => toggleAllInGroup(type)}
											style={{
												background: "none",
												border: "none",
												color: "var(--accent)",
												cursor: "pointer",
												fontSize: "0.625rem",
												textTransform: "uppercase",
											}}
										>
											{chs.every((ch) => selectedChannels.has(ch.id))
												? "Deselect all"
												: "Select all"}
										</button>
									</div>
									{chs.map((ch) => (
										<label key={ch.id} style={checkboxItemStyle}>
											<input
												type="checkbox"
												checked={selectedChannels.has(ch.id)}
												onChange={() => {
													setSelectedChannels((prev) => {
														const next = new Set(prev);
														if (next.has(ch.id)) next.delete(ch.id);
														else next.add(ch.id);
														return next;
													});
												}}
											/>
											<span>
												{type === "im" || type === "mpim"
													? ch.displayName
													: `#${ch.displayName}`}
											</span>
											{ch.memberCount > 0 && (
												<span
													style={{
														color: "var(--muted)",
														fontSize: "0.6875rem",
													}}
												>
													({ch.memberCount})
												</span>
											)}
										</label>
									))}
								</div>
							) : null,
						)}
						{channels.length === 0 && (
							<p
								style={{
									color: "var(--muted)",
									fontSize: "0.8125rem",
								}}
							>
								No channels found
							</p>
						)}
					</div>
				)}
			</div>

			{/* 3. Users */}
			<div style={sectionStyle}>
				<span style={labelStyle}>
					Users {selectedUsers.size > 0 && `(${selectedUsers.size} selected)`}
				</span>
				<input
					type="text"
					placeholder="Search users..."
					value={userSearch}
					onChange={(e) => setUserSearch(e.target.value)}
					style={{ ...inputStyle, marginBottom: "0.5rem" }}
				/>
				{usersLoading ? (
					<p style={{ color: "var(--muted)", fontSize: "0.8125rem" }}>
						Loading users...
					</p>
				) : (
					<div style={checkboxListStyle}>
						{filteredUsers.map((u) => (
							<label key={u.id} style={checkboxItemStyle}>
								<input
									type="checkbox"
									checked={selectedUsers.has(u.id)}
									onChange={() => {
										setSelectedUsers((prev) => {
											const next = new Set(prev);
											if (next.has(u.id)) next.delete(u.id);
											else next.add(u.id);
											return next;
										});
									}}
								/>
								<span>{u.realName}</span>
								<span
									style={{
										color: "var(--muted)",
										fontSize: "0.6875rem",
									}}
								>
									@{u.name}
								</span>
							</label>
						))}
						{filteredUsers.length === 0 && (
							<p
								style={{
									color: "var(--muted)",
									fontSize: "0.8125rem",
								}}
							>
								No users found
							</p>
						)}
					</div>
				)}
			</div>

			{/* 4. Search Query */}
			<div style={sectionStyle}>
				<label>
					<span style={labelStyle}>Search Query (Slack search syntax)</span>
					<input
						type="text"
						value={searchQuery}
						onChange={(e) => setSearchQuery(e.target.value)}
						placeholder='e.g. from:@user "exact phrase" in:#channel'
						disabled={!hasUserToken}
						style={{
							...inputStyle,
							opacity: hasUserToken ? 1 : 0.5,
						}}
					/>
				</label>
				{!hasUserToken && (
					<p
						style={{
							fontSize: "0.6875rem",
							color: "var(--warning)",
							marginTop: "0.25rem",
						}}
					>
						Search requires a user token (SLACK_USER_TOKEN). Bot tokens cannot
						use search.messages.
					</p>
				)}
				{hasUserToken && (
					<p
						style={{
							fontSize: "0.6875rem",
							color: "var(--muted)",
							marginTop: "0.25rem",
						}}
					>
						Uses search.messages API. Supports Slack search modifiers.
					</p>
				)}
			</div>

			{/* 5. Content Types */}
			<div style={sectionStyle}>
				<span style={labelStyle}>Content Types</span>
				<div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
					{CONTENT_TYPE_OPTIONS.map((ct) => (
						<label key={ct.id} style={checkboxItemStyle}>
							<input
								type="checkbox"
								checked={contentTypes.has(ct.id)}
								onChange={() => {
									setContentTypes((prev) => {
										const next = new Set(prev);
										if (next.has(ct.id)) next.delete(ct.id);
										else next.add(ct.id);
										return next;
									});
								}}
							/>
							<span>{ct.label}</span>
						</label>
					))}
				</div>
			</div>

			{/* 6. Has Filters */}
			<div style={sectionStyle}>
				<span style={labelStyle}>Has Filters</span>
				<div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
					{HAS_FILTER_OPTIONS.map((hf) => (
						<label key={hf.id} style={checkboxItemStyle}>
							<input
								type="checkbox"
								checked={hasFilters.has(hf.id)}
								onChange={() => {
									setHasFilters((prev) => {
										const next = new Set(prev);
										if (next.has(hf.id)) next.delete(hf.id);
										else next.add(hf.id);
										return next;
									});
								}}
							/>
							<span style={{ fontFamily: "monospace", fontSize: "0.8125rem" }}>
								{hf.label}
							</span>
						</label>
					))}
				</div>
			</div>

			{/* 7. Keywords */}
			<div style={sectionStyle}>
				<label>
					<span style={labelStyle}>
						Channel Keywords (comma-separated, leave empty to get everything)
					</span>
					<input
						type="text"
						value={keywords}
						onChange={(e) => setKeywords(e.target.value)}
						placeholder="Leave empty to get all channel messages"
						style={inputStyle}
					/>
				</label>
			</div>

			{/* 7b. DM Keywords */}
			<div style={sectionStyle}>
				<label>
					<span style={labelStyle}>
						DM Keywords (comma-separated, filter DMs/group DMs only)
					</span>
					<input
						type="text"
						value={dmKeywords}
						onChange={(e) => setDmKeywords(e.target.value)}
						placeholder="e.g. photopharmics, celeste"
						style={inputStyle}
					/>
				</label>
				<p
					style={{
						fontSize: "0.6875rem",
						color: "var(--muted)",
						marginTop: "0.25rem",
					}}
				>
					Channels get all messages. DMs are filtered to only include messages
					matching these keywords.
				</p>
			</div>

			{/* 8. Exact Phrases */}
			<div style={sectionStyle}>
				<label>
					<span style={labelStyle}>
						Exact Phrases (comma-separated, will be quoted)
					</span>
					<input
						type="text"
						value={exactPhrases}
						onChange={(e) => setExactPhrases(e.target.value)}
						placeholder="e.g. deployment failed, out of memory"
						style={inputStyle}
					/>
				</label>
			</div>

			{/* 9. Exclusions */}
			<div style={sectionStyle}>
				<label>
					<span style={labelStyle}>
						Exclusions (comma-separated, will be negated)
					</span>
					<input
						type="text"
						value={exclusions}
						onChange={(e) => setExclusions(e.target.value)}
						placeholder="e.g. bot, automated, test"
						style={inputStyle}
					/>
				</label>
			</div>

			{/* Footer */}
			<div
				style={{
					display: "flex",
					gap: "0.75rem",
					justifyContent: "flex-end",
					paddingTop: "0.75rem",
					borderTop: "1px solid var(--border)",
				}}
			>
				<button
					type="button"
					onClick={onCancel}
					style={{
						...btnStyle,
						background: "transparent",
						border: "1px solid var(--border)",
						color: "var(--muted)",
					}}
				>
					Cancel
				</button>
				<button
					type="button"
					onClick={handleSave}
					style={{
						...btnStyle,
						background: "var(--accent)",
						color: "#fff",
					}}
				>
					Save & Close
				</button>
			</div>
		</div>
	);
}
