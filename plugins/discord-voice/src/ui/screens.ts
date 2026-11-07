import type { DiscordController } from "../app.js";
import { ChannelType, type VoiceState } from "../discord/types.js";
import { avatarUrl, guildIconUrl, type ImageCache } from "../render/images.js";
import * as K from "../render/keys.js";
import { displayName } from "../state/store.js";

export type DialFeedback = { title: string; value: string; indicator: number };

export type DialModel = {
	rotate(ticks: number): Promise<void> | void;
	press?(): Promise<void> | void;
	feedback(): DialFeedback;
};

/** One rendered key: its art plus what pressing it does. */
export type KeyModel = {
	svg: string;
	/** True when the art is time-dependent (speaking pulse) and must be re-rendered. */
	animated?: boolean;
	press?(): Promise<void> | void;
	longPress?(): Promise<void> | void;
	dial?: DialModel;
};

export type ScreenContext = {
	app: DiscordController;
	images: ImageCache;
	phase: number;
	push(screen: Screen): void;
	pop(): void;
};

export interface Screen {
	readonly id: string;
	items(ctx: ScreenContext): KeyModel[];
	/** Called when the screen becomes the top of the stack. Return a cleanup fn. */
	enter?(ctx: ScreenContext): (() => void) | void;
	/** When false the navigator pops the screen (e.g. the call ended). */
	valid?(ctx: ScreenContext): boolean;
}

const memberArt = (ctx: ScreenContext, vs: VoiceState): K.MemberArt => ({
	id: vs.user.id,
	name: displayName(vs),
	img: ctx.images.peek(avatarUrl(vs.user)),
	speaking: ctx.app.store.speaking.has(vs.user.id) && !vs.mute,
});

const byName = (a: VoiceState, b: VoiceState) => displayName(a).localeCompare(displayName(b), undefined, { sensitivity: "base" });

// ───────────────────────── Home (servers) ─────────────────────────

export class HomeScreen implements Screen {
	readonly id = "home";

	enter(ctx: ScreenContext) {
		return ctx.app.watchOverview();
	}

	items(ctx: ScreenContext): KeyModel[] {
		const { app } = ctx;
		const store = app.store;
		const items: KeyModel[] = [];
		const call = store.selectedChannel;
		if (call) items.push(currentCallItem(ctx));
		for (const g of app.homeGuilds()) {
			const inCall = call?.guildId === g.id;
			const anySpeaking = inCall && [...store.callMembers.keys()].some((id) => store.speaking.has(id));
			items.push({
				svg: K.guildKey({
					id: g.id,
					name: g.name,
					icon: ctx.images.peek(guildIconUrl(g.icon_url)),
					voiceCount: store.guildVoiceCount(g.id),
					inCall,
					anySpeaking,
					phase: ctx.phase,
				}),
				animated: anySpeaking,
				press: () => ctx.push(new GuildScreen(g.id)),
			});
		}
		return items;
	}
}

function currentCallItem(ctx: ScreenContext): KeyModel {
	const store = ctx.app.store;
	const call = store.selectedChannel!;
	const members = store.callParticipants().sort(byName).map((vs) => memberArt(ctx, vs));
	return {
		svg: K.channelKey({ name: call.name, members, connected: true, userLimit: 0, phase: ctx.phase }),
		animated: members.some((m) => m.speaking),
		press: () => {
			if (call.guildId) ctx.push(new GuildScreen(call.guildId));
			ctx.push(new CallScreen());
		},
	};
}

// ───────────────────────── Guild (voice channels) ─────────────────────────

export class GuildScreen implements Screen {
	readonly id: string;

	constructor(readonly guildId: string) {
		this.id = `guild:${guildId}`;
	}

	valid(ctx: ScreenContext) {
		return ctx.app.store.guilds.has(this.guildId);
	}

	enter(ctx: ScreenContext) {
		return ctx.app.watchGuild(this.guildId);
	}

	items(ctx: ScreenContext): KeyModel[] {
		const store = ctx.app.store;
		const channels = store.sortedVoiceChannels(this.guildId);
		if (!store.voiceChannels.has(this.guildId)) {
			return [{ svg: K.messageKey({ icon: "refresh", title: "Loading…", color: K.C.sub }) }];
		}
		if (!channels.length) return [{ svg: K.messageKey({ icon: "speakerOff", title: "No voice channels", color: K.C.sub }) }];
		return channels.map((ch) => {
			const connected = store.selectedChannel?.id === ch.id;
			const source = connected ? store.callParticipants() : ch.members;
			const members = [...source].sort(byName).map((vs) => memberArt(ctx, vs));
			return {
				svg: K.channelKey({
					name: ch.name,
					members,
					connected,
					userLimit: ch.userLimit,
					stage: ch.type === ChannelType.GuildStageVoice,
					phase: ctx.phase,
				}),
				animated: members.some((m) => m.speaking),
				press: async () => {
					if (!connected) await ctx.app.join(ch.id);
					ctx.push(new CallScreen());
				},
			};
		});
	}
}

// ───────────────────────── Call (participants) ─────────────────────────

export class CallScreen implements Screen {
	readonly id = "call";

	valid(ctx: ScreenContext) {
		return !!ctx.app.store.selectedChannel;
	}

	items(ctx: ScreenContext): KeyModel[] {
		const { app } = ctx;
		const store = app.store;
		const me = store.me?.id;
		const members = store.callParticipants().sort(byName);
		if (!members.length) return [{ svg: K.messageKey({ icon: "refresh", title: "Joining…", color: K.C.sub }) }];
		return members.map((vs) => {
			const isMe = vs.user.id === me;
			const speaking = store.speaking.has(vs.user.id);
			const selfMute = isMe ? store.voiceSettings.mute || store.voiceSettings.deaf : vs.voice_state.self_mute;
			const selfDeaf = isMe ? store.voiceSettings.deaf : vs.voice_state.self_deaf;
			return {
				svg: K.participantKey({
					id: vs.user.id,
					name: displayName(vs),
					img: ctx.images.peek(avatarUrl(vs.user)),
					speaking,
					phase: ctx.phase,
					selfMute,
					selfDeaf,
					serverMute: vs.voice_state.mute,
					serverDeaf: vs.voice_state.deaf,
					localMute: !isMe && vs.mute,
					volume: isMe ? 100 : vs.volume,
					isMe,
				}),
				animated: speaking,
				press: () => (isMe ? app.toggleMute() : ctx.push(new PersonScreen(vs.user.id))),
				longPress: isMe ? undefined : () => app.toggleUserMute(vs.user.id),
				dial: isMe ? undefined : volumeDial(ctx, vs.user.id),
			};
		});
	}
}

function volumeDial(ctx: ScreenContext, userId: string): DialModel {
	const { app } = ctx;
	const vs = app.store.callMembers.get(userId);
	return {
		rotate: (ticks) => {
			const cur = app.store.callMembers.get(userId)?.volume ?? 100;
			return app.setUserVolume(userId, cur + ticks * Math.max(1, Math.round(app.volumeStep / 2)));
		},
		press: () => app.toggleUserMute(userId),
		feedback: () => ({
			title: vs ? displayName(vs) : "",
			value: vs?.mute ? "Muted" : `${vs?.volume ?? 100}%`,
			indicator: Math.round(((vs?.volume ?? 100) / 200) * 100),
		}),
	};
}

// ───────────────────────── Person (per-user controls) ─────────────────────────

export class PersonScreen implements Screen {
	readonly id: string;

	constructor(readonly userId: string) {
		this.id = `person:${userId}`;
	}

	valid(ctx: ScreenContext) {
		return ctx.app.store.callMembers.has(this.userId);
	}

	items(ctx: ScreenContext): KeyModel[] {
		const { app } = ctx;
		const vs = app.store.callMembers.get(this.userId);
		if (!vs) return [];
		const step = app.volumeStep;
		const speaking = app.store.speaking.has(this.userId);
		const down = Math.max(0, vs.volume - step);
		const up = Math.min(200, vs.volume + step);
		const dial = volumeDial(ctx, this.userId);
		return [
			{ svg: K.localMuteKey(vs.mute), press: () => app.toggleUserMute(this.userId), dial },
			{ svg: K.volumeStepKey("down", down, vs.volume > 0), press: () => app.setUserVolume(this.userId, down), dial },
			{
				svg: K.volumeKey({ member: memberArt(ctx, vs), volume: vs.volume, localMute: vs.mute, speaking, phase: ctx.phase }),
				animated: speaking,
				press: () => app.toggleUserMute(this.userId),
				dial,
			},
			{ svg: K.volumeStepKey("up", up, vs.volume < 200), press: () => app.setUserVolume(this.userId, up), dial },
			{ svg: K.resetVolumeKey(vs.volume), press: () => app.setUserVolume(this.userId, 100), dial },
		];
	}
}

// ───────────────────────── Status (not connected) ─────────────────────────

export function statusItems(ctx: ScreenContext): KeyModel[] {
	const store = ctx.app.store;
	const s = store.status;
	const msg =
		s === "connecting"
			? K.messageKey({ icon: "refresh", title: "Connecting…", sub: "Discord", color: K.C.sub })
			: s === "authorizing"
				? K.messageKey({ icon: "warning", title: "Check Discord", sub: "Click Authorize", color: K.C.yellow })
				: s === "unconfigured"
					? K.messageKey({ icon: "settings", title: "Setup needed", sub: "Open key settings", color: K.C.yellow })
					: s === "disconnected"
						? K.messageKey({ icon: "warning", title: "Discord offline", sub: "Retrying…", color: K.C.yellow })
						: K.messageKey({ icon: "warning", title: "Error", sub: store.statusDetail.slice(0, 40), color: K.C.red });
	return [{ svg: msg }, { svg: K.iconKey("refresh", { label: "Retry" }), press: () => ctx.app.reconnectNow() }];
}
