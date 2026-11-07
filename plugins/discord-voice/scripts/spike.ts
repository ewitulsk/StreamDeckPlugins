/**
 * Go/no-go check against the local Discord client. Read-only except for a no-op
 * SET_USER_VOICE_SETTINGS (re-applies a participant's current volume).
 *
 *   npx tsx scripts/spike.ts
 */
import { readFile, writeFile, rm } from "node:fs/promises";
import { login, type StoredToken, type TokenStore } from "../src/discord/auth.js";
import { RpcClient } from "../src/discord/rpc.js";
import { ChannelType } from "../src/discord/types.js";

process.loadEnvFile(".env");
const creds = {
	clientId: process.env.DISCORD_CLIENT_ID!,
	clientSecret: process.env.DISCORD_CLIENT_SECRET!,
	redirectUri: process.env.DISCORD_REDIRECT_URI,
};

const TOKEN_FILE = ".token.json";
const store: TokenStore = {
	async load() {
		try {
			return JSON.parse(await readFile(TOKEN_FILE, "utf8")) as StoredToken;
		} catch {
			return undefined;
		}
	},
	async save(token) {
		if (token) await writeFile(TOKEN_FILE, JSON.stringify(token, null, 2));
		else await rm(TOKEN_FILE, { force: true });
	},
};

const results: Record<string, string> = {};
const check = async (name: string, fn: () => Promise<string>) => {
	try {
		results[name] = `PASS  ${await fn()}`;
	} catch (err) {
		results[name] = `FAIL  ${err instanceof Error ? err.message : String(err)}`;
	}
	console.log(`[${name}] ${results[name]}`);
};

const rpc = new RpcClient(creds.clientId);
const user = await rpc.connect();
console.log(`Connected. READY user: ${user?.username}`);

await login(rpc, creds, store, () => console.log(">>> Click AUTHORIZE in the Discord popup <<<"));
console.log("Authenticated.");

const guilds = await rpc.getGuilds();
await check("GET_GUILDS", async () => `${guilds.length} guilds, ${guilds.filter((g) => g.icon_url).length} with icons. e.g. ${JSON.stringify(guilds[0])}`);

// Scan guilds for voice channels; find one with people in it that we're not in.
const selected = await rpc.getSelectedVoiceChannel();
await check("GET_SELECTED_VOICE_CHANNEL", async () => (selected ? `in "${selected.name}" (${selected.voice_states?.length} people)` : "not in voice"));

let occupied: { guild: string; channel: string; id: string; count: number } | undefined;
let sampleState: unknown;
let scanned = 0;
for (const guild of guilds) {
	const channels = await rpc.getChannels(guild.id);
	for (const ch of channels.filter((c) => c.type === ChannelType.GuildVoice || c.type === ChannelType.GuildStageVoice)) {
		const full = await rpc.getChannel(ch.id);
		scanned++;
		const n = full.voice_states?.length ?? 0;
		if (n > 0 && full.id !== selected?.id && !occupied) {
			occupied = { guild: guild.name, channel: full.name, id: full.id, count: n };
			sampleState = full.voice_states![0];
		}
	}
	if (occupied && scanned > 20) break;
}
await check("GET_CHANNEL voice_states (not joined)", async () => {
	if (!occupied) throw new Error(`no occupied channel found among ${scanned} voice channels (inconclusive)`);
	return `"${occupied.channel}" in "${occupied.guild}" has ${occupied.count}. sample=${JSON.stringify(sampleState)}`;
});

const watchId = occupied?.id ?? selected?.id;
const seen: string[] = [];
rpc.on("dispatch", (evt: string, data: any) => seen.push(`${evt}:${data?.user?.username ?? data?.user_id ?? ""}`));
if (watchId) {
	for (const evt of ["VOICE_STATE_CREATE", "VOICE_STATE_UPDATE", "VOICE_STATE_DELETE", "SPEAKING_START", "SPEAKING_STOP"]) {
		await check(`SUBSCRIBE ${evt}`, async () => (await rpc.subscribe(evt, { channel_id: watchId }), "ok"));
	}
}
for (const evt of ["VOICE_CHANNEL_SELECT", "VOICE_SETTINGS_UPDATE", "VOICE_CONNECTION_STATUS"]) {
	await check(`SUBSCRIBE ${evt}`, async () => (await rpc.subscribe(evt), "ok"));
}

await check("GET_VOICE_SETTINGS", async () => {
	const s = await rpc.getVoiceSettings();
	return `mute=${s.mute} deaf=${s.deaf}`;
});

const target = (sampleState ?? selected?.voice_states?.find((v) => v.user.id !== user.id)) as any;
await check("SET_USER_VOICE_SETTINGS (no-op)", async () => {
	if (!target) throw new Error("no participant to test against (inconclusive)");
	await rpc.setUserVoiceSettings(target.user.id, { volume: target.volume, mute: target.mute });
	return `re-applied volume=${target.volume} mute=${target.mute} for ${target.user.username}`;
});

console.log("Listening for events for 8s...");
await new Promise((r) => setTimeout(r, 8000));
console.log(`Events seen: ${seen.length ? seen.join(", ") : "(none)"}`);

console.log("\n==== SUMMARY ====");
for (const [k, v] of Object.entries(results)) console.log(`${v.startsWith("PASS") ? "✔" : "✘"} ${k}: ${v.slice(6, 160)}`);
rpc.disconnect();
process.exit(0);
