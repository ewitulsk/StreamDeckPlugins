/** Subset of Discord RPC payload shapes used by this plugin. */

export type User = {
	id: string;
	username: string;
	global_name?: string | null;
	discriminator?: string;
	avatar?: string | null;
	bot?: boolean;
};

export type Guild = {
	id: string;
	name: string;
	icon_url?: string | null;
};

export const ChannelType = {
	GuildText: 0,
	GuildVoice: 2,
	GuildCategory: 4,
	GuildStageVoice: 13,
} as const;

export type PartialChannel = { id: string; name: string; type: number };

export type VoiceStateFlags = {
	mute: boolean;
	deaf: boolean;
	self_mute: boolean;
	self_deaf: boolean;
	suppress: boolean;
};

/** A participant's voice state as reported by RPC (GET_CHANNEL / VOICE_STATE_* events). */
export type VoiceState = {
	nick?: string | null;
	/** Muted locally by the current user. */
	mute: boolean;
	/** Local volume, 0–200 (100 = default). */
	volume: number;
	pan?: { left: number; right: number };
	voice_state: VoiceStateFlags;
	user: User;
};

export type Channel = {
	id: string;
	guild_id?: string | null;
	name: string;
	type: number;
	position?: number;
	user_limit?: number;
	bitrate?: number;
	voice_states?: VoiceState[];
};

export type VoiceSettings = {
	mute: boolean;
	deaf: boolean;
	[key: string]: unknown;
};

export type SpeakingEvent = { user_id: string; channel_id?: string };

export type RpcError = { code: number; message: string };
