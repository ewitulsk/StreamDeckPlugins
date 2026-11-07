import { describe, expect, it, vi } from "vitest";
import { DiscordController } from "../src/app.js";
import type { VoiceState } from "../src/discord/types.js";
import { ImageCache } from "../src/render/images.js";
import { sortChannelsOccupiedFirst } from "../src/state/store.js";
import { Navigator, RenderCache } from "../src/ui/navigator.js";

const log = { info() {}, warn() {}, error() {} };
const vs = (id: string, name: string, extra: Partial<VoiceState> = {}): VoiceState => ({
	mute: false,
	volume: 100,
	voice_state: { mute: false, deaf: false, self_mute: false, self_deaf: false, suppress: false },
	user: { id, username: name, avatar: null },
	...extra,
});

function setup(size = { columns: 5, rows: 3 }) {
	const app = new DiscordController({ load: async () => ({}), save: async () => undefined }, log);
	const store = app.store;
	store.status = "ready";
	store.me = { id: "me", username: "me" };
	store.setGuilds([
		{ id: "g1", name: "One" },
		{ id: "g2", name: "Two" },
	]);
	store.setVoiceChannels("g1", [
		{ id: "c1", name: "General", type: 2, position: 0, voice_states: [] },
		{ id: "c2", name: "Gaming", type: 2, position: 1, voice_states: [vs("u1", "alice")] },
	]);
	// Don't touch the network/RPC in tests.
	vi.spyOn(app, "watchGuild").mockReturnValue(() => undefined);
	vi.spyOn(app, "watchOverview").mockReturnValue(() => undefined);
	const images = new ImageCache(() => undefined, (async () => new Response(null, { status: 404 })) as typeof fetch);
	// Rasterizer stub: identity, so "images" are the SVG strings themselves.
	const cache = new RenderCache((svg) => svg);
	const exit = vi.fn(async () => undefined);
	const nav = new Navigator("dev", size, app, images, cache, exit, log);
	store.on("change", () => nav.scheduleRender(0));
	const keys = new Map<number, string>();
	for (let r = 0; r < size.rows; r++)
		for (let c = 0; c < size.columns; c++)
			nav.attachKey(c, r, {
				setImage: async (img) => void keys.set(r * size.columns + c, img),
				showAlert: async () => undefined,
			});
	return { app, store, nav, keys, exit };
}

const flush = () => new Promise((r) => setTimeout(r, 40));

describe("store", () => {
	it("sorts occupied channels first, keeping position order", () => {
		const list = sortChannelsOccupiedFirst([
			{ id: "a", guildId: "g", name: "a", type: 2, position: 0, userLimit: 0, members: [] },
			{ id: "b", guildId: "g", name: "b", type: 2, position: 1, userLimit: 0, members: [vs("x", "x")] },
			{ id: "c", guildId: "g", name: "c", type: 2, position: 2, userLimit: 0, members: [] },
			{ id: "d", guildId: "g", name: "d", type: 2, position: 3, userLimit: 0, members: [vs("y", "y")] },
		]);
		expect(list.map((c) => c.id)).toEqual(["b", "d", "a", "c"]);
	});
});

describe("navigator", () => {
	it("renders guilds on the home screen and drills into channels", async () => {
		const { nav, keys } = setup();
		await flush();
		expect(keys.size).toBe(15);
		expect(keys.get(5)).toContain(">One<");
		expect(keys.get(6)).toContain(">Two<");
		expect(keys.get(0)).toContain(">Exit<"); // root back = exit

		await nav.press(0, 1, false); // open guild One
		await flush();
		expect(keys.get(0)).toContain(">Back<");
		// Occupied "Gaming" is listed before empty "General".
		expect(keys.get(5)).toContain(">Gaming<");
		expect(keys.get(6)).toContain(">General<");
	});

	it("joins a channel and shows participants, popping when the call ends", async () => {
		const { app, store, nav, keys } = setup();
		vi.spyOn(app, "join").mockImplementation(async (id) => {
			store.setSelectedChannel({ id, guild_id: "g1", name: "Gaming", type: 2, voice_states: [vs("u1", "alice"), vs("me", "me")] });
		});
		await flush();
		await nav.press(0, 1, false); // guild
		await flush();
		await nav.press(0, 1, false); // join Gaming
		await flush();
		expect(app.join).toHaveBeenCalledWith("c2");
		expect(keys.get(5)).toContain(">alice<");
		expect(keys.get(6)).toContain("me (you)");
		expect(keys.get(3)).toContain(">Leave<");

		store.setSpeaking("u1", true);
		await flush();
		expect(keys.get(5)).toContain('filter="url(#glow)"');

		store.setSelectedChannel(null);
		await flush();
		expect(keys.get(5)).toContain(">Gaming<"); // back on the guild screen
	});

	it("opens person controls and adjusts volume", async () => {
		const { app, store, nav, keys } = setup();
		store.setSelectedChannel({ id: "c2", guild_id: "g1", name: "Gaming", type: 2, voice_states: [vs("u1", "alice", { volume: 80 })] });
		const setVol = vi.spyOn(app, "setUserVolume").mockImplementation(async (id, v) => store.patchMember(id, { volume: v }));
		const nav2 = nav;
		// Re-open so it jumps straight into the call.
		for (let r = 0; r < 3; r++) for (let c = 0; c < 5; c++) nav2.detachKey(c, r);
		for (let r = 0; r < 3; r++)
			for (let c = 0; c < 5; c++) nav2.attachKey(c, r, { setImage: async (img) => void keys.set(r * 5 + c, img), showAlert: async () => undefined });
		await flush();
		expect(keys.get(5)).toContain(">alice<");
		await nav2.press(0, 1, false);
		await flush();
		expect(keys.get(7)).toContain(">80%<");
		await nav2.press(3, 1, false); // volume up
		await flush();
		expect(setVol).toHaveBeenCalledWith("u1", 90);
		expect(keys.get(7)).toContain(">90%<");
	});

	it("paginates and fits a Mini layout", async () => {
		const { store, nav, keys } = setup({ columns: 3, rows: 2 });
		store.setGuilds(Array.from({ length: 7 }, (_, i) => ({ id: `g${i}`, name: `G${i}` })));
		await flush();
		expect(keys.get(1)).toContain("1/3");
		expect(keys.get(3)).toContain(">G0<");
		await nav.press(1, 0, false);
		await flush();
		expect(keys.get(1)).toContain("2/3");
		expect(keys.get(3)).toContain(">G3<");
	});

	it("shows status screen when disconnected", async () => {
		const { store, keys } = setup();
		store.setStatus("disconnected", "Discord isn't running");
		await flush();
		expect(keys.get(5)).toContain("Discord offline");
		expect(keys.get(6)).toContain(">Retry<");
	});
});
