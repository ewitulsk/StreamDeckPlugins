import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { IpcTransport, OpCode, type Packet } from "./ipc.js";
import type { Channel, Guild, PartialChannel, User, VoiceSettings } from "./types.js";

type Frame = {
	cmd: string;
	evt?: string | null;
	nonce?: string | null;
	data?: any;
	args?: unknown;
};

type Pending = {
	resolve: (data: any) => void;
	reject: (err: Error) => void;
	timer: NodeJS.Timeout;
};

export class RpcRequestError extends Error {
	constructor(
		readonly cmd: string,
		readonly code: number,
		message: string,
	) {
		super(`${cmd} failed (${code}): ${message}`);
	}
}

/**
 * Minimal Discord RPC client over the local IPC pipe.
 *
 * Events:
 *  - "ready" (user)            handshake completed
 *  - "dispatch" (evt, data)    subscribed event fired
 *  - "close" (reason)          connection lost
 */
export class RpcClient extends EventEmitter {
	private transport?: IpcTransport;
	private pending = new Map<string, Pending>();
	user?: User;

	constructor(
		readonly clientId: string,
		private readonly timeoutMs = 10_000,
	) {
		super();
	}

	get connected(): boolean {
		return !!this.transport?.connected && !!this.user;
	}

	async connect(): Promise<User> {
		this.disconnect();
		const transport = new IpcTransport();
		this.transport = transport;

		const ready = new Promise<User>((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error("Timed out waiting for Discord READY")), this.timeoutMs);
			transport.once("close", (reason: string) => {
				clearTimeout(timer);
				reject(new Error(`Discord closed the connection: ${reason}`));
			});
			this.once("ready", (user: User) => {
				clearTimeout(timer);
				resolve(user);
			});
		});

		transport.on("packet", (packet: Packet) => this.onPacket(packet));
		transport.on("close", (reason: string) => {
			if (this.transport !== transport) return;
			this.transport = undefined;
			this.user = undefined;
			for (const [, p] of this.pending) {
				clearTimeout(p.timer);
				p.reject(new Error(`Connection closed: ${reason}`));
			}
			this.pending.clear();
			this.emit("close", reason);
		});

		await transport.connect();
		transport.send(OpCode.Handshake, { v: 1, client_id: this.clientId });
		return ready;
	}

	disconnect(): void {
		this.transport?.close("client disconnect");
	}

	private onPacket(packet: Packet): void {
		if (packet.op !== OpCode.Frame) return;
		const frame = packet.data as Frame;

		if (frame.cmd === "DISPATCH" && frame.evt === "READY") {
			this.user = frame.data?.user;
			this.emit("ready", this.user);
			return;
		}

		if (frame.nonce && this.pending.has(frame.nonce)) {
			const p = this.pending.get(frame.nonce)!;
			this.pending.delete(frame.nonce);
			clearTimeout(p.timer);
			if (frame.evt === "ERROR") p.reject(new RpcRequestError(frame.cmd, frame.data?.code ?? -1, frame.data?.message ?? "unknown"));
			else p.resolve(frame.data);
			return;
		}

		if (frame.cmd === "DISPATCH" && frame.evt) this.emit("dispatch", frame.evt, frame.data);
	}

	request<T = any>(cmd: string, args: Record<string, unknown> = {}, evt?: string, timeoutMs = this.timeoutMs): Promise<T> {
		const transport = this.transport;
		if (!transport?.connected) return Promise.reject(new Error("Not connected to Discord"));
		const nonce = randomUUID();
		return new Promise<T>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(nonce);
				reject(new Error(`${cmd} timed out`));
			}, timeoutMs);
			this.pending.set(nonce, { resolve, reject, timer });
			transport.send(OpCode.Frame, { cmd, args, evt, nonce });
		});
	}

	subscribe(evt: string, args: Record<string, unknown> = {}): Promise<unknown> {
		return this.request("SUBSCRIBE", args, evt);
	}

	unsubscribe(evt: string, args: Record<string, unknown> = {}): Promise<unknown> {
		return this.request("UNSUBSCRIBE", args, evt);
	}

	// ---- Typed command helpers ----

	authorize(scopes: string[]): Promise<{ code: string }> {
		// The user has to click "Authorize" in Discord, so allow plenty of time.
		return this.request("AUTHORIZE", { client_id: this.clientId, scopes }, undefined, 5 * 60_000);
	}

	authenticate(accessToken: string): Promise<{ user: User; scopes: string[]; expires: string }> {
		return this.request("AUTHENTICATE", { access_token: accessToken });
	}

	async getGuilds(): Promise<Guild[]> {
		return (await this.request<{ guilds: Guild[] }>("GET_GUILDS")).guilds;
	}

	getGuild(guildId: string): Promise<Guild & { members?: unknown[] }> {
		return this.request("GET_GUILD", { guild_id: guildId });
	}

	async getChannels(guildId: string): Promise<PartialChannel[]> {
		return (await this.request<{ channels: PartialChannel[] }>("GET_CHANNELS", { guild_id: guildId })).channels;
	}

	getChannel(channelId: string): Promise<Channel> {
		return this.request("GET_CHANNEL", { channel_id: channelId });
	}

	getSelectedVoiceChannel(): Promise<Channel | null> {
		return this.request("GET_SELECTED_VOICE_CHANNEL");
	}

	selectVoiceChannel(channelId: string | null, force = true): Promise<Channel | null> {
		return this.request("SELECT_VOICE_CHANNEL", { channel_id: channelId, force, timeout: 10 }, undefined, 15_000);
	}

	getVoiceSettings(): Promise<VoiceSettings> {
		return this.request("GET_VOICE_SETTINGS");
	}

	setVoiceSettings(settings: Partial<Pick<VoiceSettings, "mute" | "deaf">>): Promise<VoiceSettings> {
		return this.request("SET_VOICE_SETTINGS", settings);
	}

	setUserVoiceSettings(userId: string, settings: { volume?: number; mute?: boolean }): Promise<unknown> {
		return this.request("SET_USER_VOICE_SETTINGS", { user_id: userId, ...settings });
	}
}
