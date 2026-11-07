import { EventEmitter } from "node:events";
import type { Channel, Guild, User, VoiceSettings, VoiceState } from "../discord/types.js";

export type ConnectionStatus = "disconnected" | "connecting" | "authorizing" | "ready" | "error" | "unconfigured";

export type VoiceChannelInfo = {
	id: string;
	guildId: string;
	name: string;
	type: number;
	position: number;
	userLimit: number;
	members: VoiceState[];
};

/**
 * Single source of truth for everything the UI renders. Emits "change" (with a reason tag)
 * whenever something visible changes; screens re-render from the store.
 */
export class Store extends EventEmitter {
	status: ConnectionStatus = "disconnected";
	statusDetail = "";
	me?: User;
	guilds = new Map<string, Guild>();
	/** guildId -> voice channels, sorted by position. */
	voiceChannels = new Map<string, VoiceChannelInfo[]>();
	/** Members of the channel the user is currently in, keyed by user id. */
	callMembers = new Map<string, VoiceState>();
	selectedChannel?: { id: string; guildId?: string | null; name: string };
	voiceSettings: Pick<VoiceSettings, "mute" | "deaf"> = { mute: false, deaf: false };
	speaking = new Set<string>();

	setStatus(status: ConnectionStatus, detail = ""): void {
		this.status = status;
		this.statusDetail = detail;
		if (status !== "ready") {
			this.selectedChannel = undefined;
			this.callMembers.clear();
			this.speaking.clear();
		}
		this.changed("status");
	}

	setGuilds(guilds: Guild[]): void {
		this.guilds = new Map(guilds.map((g) => [g.id, g]));
		this.changed("guilds");
	}

	setVoiceChannels(guildId: string, channels: Channel[]): void {
		const list = channels.map(toInfo(guildId)).sort((a, b) => a.position - b.position);
		this.voiceChannels.set(guildId, list);
		this.changed("channels");
	}

	setSelectedChannel(channel: Channel | null): void {
		this.callMembers.clear();
		this.speaking.clear();
		if (channel) {
			this.selectedChannel = { id: channel.id, guildId: channel.guild_id, name: channel.name };
			for (const vs of channel.voice_states ?? []) this.callMembers.set(vs.user.id, vs);
			if (channel.guild_id) this.patchChannelMembers(channel.guild_id, channel.id, [...this.callMembers.values()]);
		} else {
			this.selectedChannel = undefined;
		}
		this.changed("call");
	}

	upsertMember(channelId: string, vs: VoiceState): void {
		if (this.selectedChannel?.id === channelId) this.callMembers.set(vs.user.id, vs);
		this.mutateChannel(channelId, (members) => {
			const i = members.findIndex((m) => m.user.id === vs.user.id);
			if (i >= 0) members[i] = vs;
			else members.push(vs);
		});
		this.changed("call");
	}

	removeMember(channelId: string, userId: string): void {
		if (this.selectedChannel?.id === channelId) {
			this.callMembers.delete(userId);
			this.speaking.delete(userId);
		}
		this.mutateChannel(channelId, (members) => {
			const i = members.findIndex((m) => m.user.id === userId);
			if (i >= 0) members.splice(i, 1);
		});
		this.changed("call");
	}

	/** Patch local per-user settings (mute/volume) optimistically. */
	patchMember(userId: string, patch: Partial<Pick<VoiceState, "mute" | "volume">>): void {
		const vs = this.callMembers.get(userId);
		if (!vs) return;
		this.callMembers.set(userId, { ...vs, ...patch });
		this.changed("call");
	}

	setSpeaking(userId: string, speaking: boolean): void {
		const had = this.speaking.has(userId);
		if (speaking === had) return;
		if (speaking) this.speaking.add(userId);
		else this.speaking.delete(userId);
		this.changed("speaking");
	}

	setVoiceSettings(settings: Partial<Pick<VoiceSettings, "mute" | "deaf">>): void {
		this.voiceSettings = { ...this.voiceSettings, ...settings };
		this.changed("self");
	}

	/** Voice channels for a guild: occupied ones first, each group in Discord's order. */
	sortedVoiceChannels(guildId: string): VoiceChannelInfo[] {
		const list = this.voiceChannels.get(guildId) ?? [];
		return sortChannelsOccupiedFirst(list);
	}

	/** Participants of the current call, the local user last-but-visible, speakers stable by join order. */
	callParticipants(): VoiceState[] {
		return [...this.callMembers.values()];
	}

	guildVoiceCount(guildId: string): number {
		return (this.voiceChannels.get(guildId) ?? []).reduce((n, c) => n + c.members.length, 0);
	}

	private mutateChannel(channelId: string, fn: (members: VoiceState[]) => void): void {
		for (const list of this.voiceChannels.values()) {
			const ch = list.find((c) => c.id === channelId);
			if (ch) {
				fn(ch.members);
				return;
			}
		}
	}

	private patchChannelMembers(guildId: string, channelId: string, members: VoiceState[]): void {
		const ch = this.voiceChannels.get(guildId)?.find((c) => c.id === channelId);
		if (ch) ch.members = [...members];
	}

	private changed(reason: string): void {
		this.emit("change", reason);
	}
}

export function sortChannelsOccupiedFirst(list: VoiceChannelInfo[]): VoiceChannelInfo[] {
	return [...list].sort((a, b) => {
		const occ = Number(b.members.length > 0) - Number(a.members.length > 0);
		return occ || a.position - b.position;
	});
}

const toInfo =
	(guildId: string) =>
	(c: Channel): VoiceChannelInfo => ({
		id: c.id,
		guildId,
		name: c.name,
		type: c.type,
		position: c.position ?? 0,
		userLimit: c.user_limit ?? 0,
		members: [...(c.voice_states ?? [])],
	});

export function displayName(vs: VoiceState): string {
	return vs.nick || vs.user.global_name || vs.user.username;
}
