import { EventEmitter } from "node:events";
import { login, type StoredToken } from "./discord/auth.js";
import { RpcClient, RpcRequestError } from "./discord/rpc.js";
import { ChannelType, type Channel, type Guild, type SpeakingEvent, type VoiceSettings, type VoiceState } from "./discord/types.js";
import { Store } from "./state/store.js";

export type Settings = {
	clientId?: string;
	clientSecret?: string;
	redirectUri?: string;
	/** Ordered guild ids to show on the home screen; empty/undefined = all guilds. */
	favorites?: string[];
	/** Volume change per press, in percent. */
	volumeStep?: number;
	token?: StoredToken | null;
};

export interface SettingsIO {
	load(): Promise<Settings>;
	save(settings: Settings): Promise<void>;
}

export type Logger = { info(...a: unknown[]): void; warn(...a: unknown[]): void; error(...a: unknown[]): void };

const VOICE_TYPES: number[] = [ChannelType.GuildVoice, ChannelType.GuildStageVoice];
const CHANNEL_EVENTS = ["VOICE_STATE_CREATE", "VOICE_STATE_UPDATE", "VOICE_STATE_DELETE"];
const SPEAKING_EVENTS = ["SPEAKING_START", "SPEAKING_STOP"];

/**
 * Owns the Discord connection and keeps the Store up to date. Screens call the action
 * methods (join, mute, volume…) and re-render from the store.
 */
export class DiscordController extends EventEmitter {
	readonly store = new Store();
	settings: Settings = {};
	private rpc?: RpcClient;
	private reconnectTimer?: NodeJS.Timeout;
	private backoffMs = 2000;
	private stopped = false;
	private generation = 0;

	/** Active SUBSCRIBE registrations, keyed "EVT|channelId". */
	private subs = new Set<string>();
	private trackedChannelId?: string;
	private guildWatchers = new Map<string, number>();
	private overviewWatchers = 0;
	private pollTimer?: NodeJS.Timeout;
	private lastOverviewPoll = 0;
	private refreshing = new Map<string, Promise<void>>();

	constructor(
		private readonly io: SettingsIO,
		private readonly log: Logger,
		private readonly devCredentials?: Pick<Settings, "clientId" | "clientSecret" | "redirectUri">,
	) {
		super();
	}

	async start(): Promise<void> {
		this.settings = await this.io.load();
		void this.connect();
	}

	stop(): void {
		this.stopped = true;
		clearTimeout(this.reconnectTimer);
		clearInterval(this.pollTimer);
		this.rpc?.disconnect();
	}

	get volumeStep(): number {
		return this.settings.volumeStep && this.settings.volumeStep > 0 ? this.settings.volumeStep : 10;
	}

	private credentials() {
		const clientId = this.settings.clientId || this.devCredentials?.clientId;
		const clientSecret = this.settings.clientSecret || this.devCredentials?.clientSecret;
		const redirectUri = this.settings.redirectUri || this.devCredentials?.redirectUri || "http://localhost";
		return clientId && clientSecret ? { clientId, clientSecret, redirectUri } : undefined;
	}

	async updateSettings(patch: Partial<Settings>): Promise<void> {
		const before = this.credentials();
		this.settings = { ...this.settings, ...patch };
		await this.io.save(this.settings);
		const after = this.credentials();
		if (before?.clientId !== after?.clientId || before?.clientSecret !== after?.clientSecret) {
			this.settings.token = null;
			await this.io.save(this.settings);
			this.reconnectNow();
		} else {
			this.store.emit("change", "settings");
		}
	}

	reconnectNow(): void {
		clearTimeout(this.reconnectTimer);
		this.backoffMs = 2000;
		void this.connect();
	}

	// ───────────── Connection lifecycle ─────────────

	private async connect(): Promise<void> {
		if (this.stopped) return;
		const gen = ++this.generation;
		clearTimeout(this.reconnectTimer);
		this.rpc?.removeAllListeners();
		this.rpc?.disconnect();
		this.subs.clear();
		this.trackedChannelId = undefined;

		const creds = this.credentials();
		if (!creds) {
			this.store.setStatus("unconfigured", "Add your Discord app's Client ID & Secret in the plugin settings");
			return;
		}

		const rpc = new RpcClient(creds.clientId);
		this.rpc = rpc;
		this.store.setStatus("connecting", "Connecting to Discord…");
		try {
			await rpc.connect();
			if (gen !== this.generation) return;
			rpc.on("close", (reason: string) => {
				if (gen !== this.generation) return;
				this.log.warn(`Discord connection closed: ${reason}`);
				this.store.setStatus("disconnected", "Discord closed");
				this.scheduleReconnect();
			});
			rpc.on("dispatch", (evt: string, data: any) => this.onDispatch(evt, data));

			await login(
				rpc,
				creds,
				{
					load: async () => this.settings.token ?? undefined,
					save: async (token) => {
						this.settings.token = token ?? null;
						await this.io.save(this.settings);
					},
				},
				() => this.store.setStatus("authorizing", "Click Authorize in Discord"),
			);
			if (gen !== this.generation) return;
			this.store.me = rpc.user;
			await this.bootstrap();
			this.backoffMs = 2000;
			this.store.setStatus("ready");
			const selected = await rpc.getSelectedVoiceChannel();
			await this.trackChannel(selected);
			this.ensurePolling();
			this.lastOverviewPoll = Date.now();
			void this.refreshGuilds(this.homeGuilds().map((g) => g.id));
		} catch (err) {
			if (gen !== this.generation) return;
			const msg = err instanceof Error ? err.message : String(err);
			this.log.warn(`Discord connect failed: ${msg}`);
			const notRunning = /not running|ENOENT|no IPC/i.test(msg);
			this.store.setStatus(notRunning ? "disconnected" : "error", notRunning ? "Discord isn't running" : msg);
			if (/invalid_client|401/.test(msg)) {
				this.settings.token = null;
				await this.io.save(this.settings);
			}
			rpc.disconnect();
			this.scheduleReconnect();
		}
	}

	private scheduleReconnect(): void {
		if (this.stopped) return;
		clearTimeout(this.reconnectTimer);
		this.reconnectTimer = setTimeout(() => void this.connect(), this.backoffMs);
		this.backoffMs = Math.min(this.backoffMs * 2, 30_000);
	}

	private async bootstrap(): Promise<void> {
		const rpc = this.rpc!;
		this.store.setGuilds(await rpc.getGuilds());
		const vs = await rpc.getVoiceSettings();
		this.store.setVoiceSettings({ mute: vs.mute, deaf: vs.deaf });
		for (const evt of ["VOICE_CHANNEL_SELECT", "VOICE_SETTINGS_UPDATE", "GUILD_CREATE"]) {
			await rpc.subscribe(evt).catch((e) => this.log.warn(`subscribe ${evt} failed`, e));
		}
	}

	private onDispatch(evt: string, data: any): void {
		switch (evt) {
			case "VOICE_CHANNEL_SELECT":
				void this.onChannelSelected(data?.channel_id ?? null);
				break;
			case "VOICE_SETTINGS_UPDATE": {
				const s = data as VoiceSettings;
				this.store.setVoiceSettings({ mute: s.mute, deaf: s.deaf });
				break;
			}
			case "VOICE_STATE_CREATE":
			case "VOICE_STATE_UPDATE":
				if (this.trackedChannelId) this.store.upsertMember(this.trackedChannelId, data as VoiceState);
				break;
			case "VOICE_STATE_DELETE":
				if (this.trackedChannelId) this.store.removeMember(this.trackedChannelId, (data as VoiceState).user.id);
				break;
			case "SPEAKING_START":
			case "SPEAKING_STOP":
				this.store.setSpeaking((data as SpeakingEvent).user_id, evt === "SPEAKING_START");
				break;
			case "GUILD_CREATE":
				void this.rpc
					?.getGuilds()
					.then((g) => this.store.setGuilds(g))
					.catch(() => undefined);
				break;
		}
	}

	private async onChannelSelected(channelId: string | null): Promise<void> {
		if (!this.rpc) return;
		const channel = channelId ? await this.rpc.getChannel(channelId).catch(() => null) : null;
		await this.trackChannel(channel);
	}

	/** Points the per-channel VOICE_STATE / SPEAKING subscriptions at the current call. */
	private async trackChannel(channel: Channel | null): Promise<void> {
		const rpc = this.rpc;
		if (!rpc) return;
		const prev = this.trackedChannelId;
		this.trackedChannelId = channel?.id;
		if (prev && prev !== channel?.id) {
			for (const evt of CHANNEL_EVENTS) await this.unsub(evt, prev);
			if (!this.isWatchedSpeakingChannel(prev)) for (const evt of SPEAKING_EVENTS) await this.unsub(evt, prev);
		}
		this.store.setSelectedChannel(channel);
		if (channel) {
			for (const evt of [...CHANNEL_EVENTS, ...SPEAKING_EVENTS]) await this.sub(evt, channel.id);
			// Re-read after subscribing so nobody who joined in between is missed.
			const fresh = await rpc.getChannel(channel.id).catch(() => null);
			if (fresh && this.trackedChannelId === fresh.id) {
				for (const vs of fresh.voice_states ?? []) this.store.upsertMember(fresh.id, vs);
			}
		}
	}

	private async sub(evt: string, channelId: string): Promise<void> {
		const key = `${evt}|${channelId}`;
		if (this.subs.has(key) || !this.rpc) return;
		this.subs.add(key);
		await this.rpc.subscribe(evt, { channel_id: channelId }).catch((e) => {
			this.subs.delete(key);
			this.log.warn(`subscribe ${key} failed`, e);
		});
	}

	private async unsub(evt: string, channelId: string): Promise<void> {
		const key = `${evt}|${channelId}`;
		if (!this.subs.delete(key) || !this.rpc) return;
		await this.rpc.unsubscribe(evt, { channel_id: channelId }).catch(() => undefined);
	}

	// ───────────── Guild data ─────────────

	/** Guilds for the home screen, in the user's favorite order (or Discord's order). */
	homeGuilds(): Guild[] {
		const all = [...this.store.guilds.values()];
		const fav = this.settings.favorites?.filter((id) => this.store.guilds.has(id)) ?? [];
		return fav.length ? fav.map((id) => this.store.guilds.get(id)!) : all;
	}

	refreshGuild(guildId: string): Promise<void> {
		const existing = this.refreshing.get(guildId);
		if (existing) return existing;
		const p = (async () => {
			const rpc = this.rpc;
			if (!rpc || this.store.status !== "ready") return;
			const channels = (await rpc.getChannels(guildId)).filter((c) => VOICE_TYPES.includes(c.type));
			const full = await Promise.all(channels.map((c) => rpc.getChannel(c.id).catch(() => null)));
			const list = full.filter((c): c is Channel => !!c);
			// Keep the live (event-driven) member list for the channel we're in.
			const tracked = this.trackedChannelId;
			if (tracked) {
				const ch = list.find((c) => c.id === tracked);
				if (ch) ch.voice_states = [...this.store.callMembers.values()];
			}
			this.store.setVoiceChannels(guildId, list);
			await this.syncSpeakingSubs();
		})()
			.catch((e) => this.log.warn(`refreshGuild ${guildId} failed`, e))
			.finally(() => this.refreshing.delete(guildId));
		this.refreshing.set(guildId, p);
		return p;
	}

	async refreshGuilds(ids: string[]): Promise<void> {
		// Small concurrency limit to stay well inside RPC rate limits.
		const queue = [...ids];
		await Promise.all(
			Array.from({ length: 3 }, async () => {
				while (queue.length) await this.refreshGuild(queue.shift()!);
			}),
		);
	}

	/** Screens showing a guild's channels call this so occupancy stays live. Returns an unwatch fn. */
	watchGuild(guildId: string): () => void {
		this.guildWatchers.set(guildId, (this.guildWatchers.get(guildId) ?? 0) + 1);
		void this.refreshGuild(guildId);
		this.ensurePolling();
		return () => {
			const n = (this.guildWatchers.get(guildId) ?? 1) - 1;
			if (n <= 0) this.guildWatchers.delete(guildId);
			else this.guildWatchers.set(guildId, n);
			void this.syncSpeakingSubs();
		};
	}

	/** The home screen calls this so per-guild voice counts stay fresh. */
	watchOverview(): () => void {
		this.overviewWatchers++;
		if (Date.now() - this.lastOverviewPoll > 5000) {
			this.lastOverviewPoll = Date.now();
			void this.refreshGuilds(this.homeGuilds().map((g) => g.id));
		}
		this.ensurePolling();
		return () => {
			this.overviewWatchers = Math.max(0, this.overviewWatchers - 1);
		};
	}

	private ensurePolling(): void {
		if (this.pollTimer) return;
		this.pollTimer = setInterval(() => {
			if (this.store.status !== "ready") return;
			for (const id of this.guildWatchers.keys()) void this.refreshGuild(id);
			if (this.overviewWatchers > 0 && Date.now() - this.lastOverviewPoll > 20_000) {
				this.lastOverviewPoll = Date.now();
				void this.refreshGuilds(this.homeGuilds().map((g) => g.id));
			}
		}, 4000);
	}

	private isWatchedSpeakingChannel(channelId: string): boolean {
		for (const gid of this.guildWatchers.keys()) {
			if (this.store.voiceChannels.get(gid)?.some((c) => c.id === channelId && c.members.length > 0)) return true;
		}
		return false;
	}

	/** Subscribe to speaking events for occupied channels of watched guilds (for glow on channel keys). */
	private async syncSpeakingSubs(): Promise<void> {
		const want = new Set<string>();
		for (const gid of this.guildWatchers.keys()) {
			for (const c of this.store.voiceChannels.get(gid) ?? []) if (c.members.length) want.add(c.id);
		}
		if (this.trackedChannelId) want.add(this.trackedChannelId);
		const have = new Set([...this.subs].filter((k) => k.startsWith("SPEAKING_START|")).map((k) => k.split("|")[1]));
		for (const id of have) if (!want.has(id)) for (const evt of SPEAKING_EVENTS) await this.unsub(evt, id);
		for (const id of want) if (!have.has(id)) for (const evt of SPEAKING_EVENTS) await this.sub(evt, id);
	}

	// ───────────── Actions ─────────────

	async join(channelId: string): Promise<void> {
		if (!this.rpc) throw new Error("Not connected");
		const channel = await this.rpc.selectVoiceChannel(channelId, true);
		if (channel) await this.trackChannel(channel);
	}

	async leave(): Promise<void> {
		if (!this.rpc) throw new Error("Not connected");
		await this.rpc.selectVoiceChannel(null, true);
		await this.trackChannel(null);
	}

	async toggleMute(): Promise<void> {
		if (!this.rpc) throw new Error("Not connected");
		const { mute, deaf } = this.store.voiceSettings;
		// Unmuting while deafened undeafens too (matches Discord's own behaviour).
		const next = deaf ? { mute: false, deaf: false } : { mute: !mute };
		this.store.setVoiceSettings(next);
		const s = await this.rpc.setVoiceSettings(next);
		this.store.setVoiceSettings({ mute: s.mute, deaf: s.deaf });
	}

	async toggleDeaf(): Promise<void> {
		if (!this.rpc) throw new Error("Not connected");
		const next = { deaf: !this.store.voiceSettings.deaf };
		this.store.setVoiceSettings(next);
		const s = await this.rpc.setVoiceSettings(next);
		this.store.setVoiceSettings({ mute: s.mute, deaf: s.deaf });
	}

	async setUserVolume(userId: string, volume: number): Promise<void> {
		if (!this.rpc) throw new Error("Not connected");
		const v = Math.round(Math.min(200, Math.max(0, volume)));
		this.store.patchMember(userId, { volume: v });
		await this.rpc.setUserVoiceSettings(userId, { volume: v });
	}

	async toggleUserMute(userId: string): Promise<void> {
		if (!this.rpc) throw new Error("Not connected");
		const vs = this.store.callMembers.get(userId);
		const mute = !(vs?.mute ?? false);
		this.store.patchMember(userId, { mute });
		await this.rpc.setUserVoiceSettings(userId, { mute });
	}

	async allGuilds(): Promise<Guild[]> {
		return [...this.store.guilds.values()];
	}
}

export const isRpcError = (e: unknown): e is RpcRequestError => e instanceof RpcRequestError;
