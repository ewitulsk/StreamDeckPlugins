import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import streamDeck, {
	action,
	DeviceType,
	SingletonAction,
	type DialDownEvent,
	type DialRotateEvent,
	type KeyAction,
	type KeyDownEvent,
	type KeyUpEvent,
	type SendToPluginEvent,
	type TouchTapEvent,
	type WillAppearEvent,
	type WillDisappearEvent,
} from "@elgato/streamdeck";
import type { JsonObject, JsonValue } from "@elgato/utils";
import { DiscordController, type Settings } from "./app.js";
import { avatarUrl, guildIconUrl, ImageCache } from "./render/images.js";
import * as K from "./render/keys.js";
import { initRaster, svgToPngDataUri } from "./render/raster.js";
import { displayName } from "./state/store.js";
import { currentPhase, Navigator, RenderCache } from "./ui/navigator.js";

const UUID = "com.evanw.discordvoice";
const binDir = path.dirname(fileURLToPath(import.meta.url));
const log = streamDeck.logger;

/** Bundled dynamic profiles per device family (see scripts/gen-profiles.mjs). */
export const PROFILES: Partial<Record<DeviceType, string>> = {
	[DeviceType.StreamDeck]: "profiles/Discord Voice",
	[DeviceType.StreamDeckMini]: "profiles/Discord Voice Mini",
	[DeviceType.StreamDeckXL]: "profiles/Discord Voice XL",
	[DeviceType.StreamDeckPlus]: "profiles/Discord Voice Plus",
	[DeviceType.StreamDeckNeo]: "profiles/Discord Voice Neo",
};

function loadDevCredentials(): Pick<Settings, "clientId" | "clientSecret" | "redirectUri"> | undefined {
	const file = path.join(binDir, "dev-credentials.json");
	if (!existsSync(file)) return undefined;
	try {
		return JSON.parse(readFileSync(file, "utf8"));
	} catch {
		return undefined;
	}
}

const fmt = (a: unknown[]) => a.map((x) => (x instanceof Error ? (x.stack ?? x.message) : typeof x === "string" ? x : JSON.stringify(x))).join(" ");
const appLog = {
	info: (...a: unknown[]) => log.info(fmt(a)),
	warn: (...a: unknown[]) => log.warn(fmt(a)),
	error: (...a: unknown[]) => log.error(fmt(a)),
};

const app = new DiscordController(
	{
		load: async () => (await streamDeck.settings.getGlobalSettings<Settings & JsonObject>()) ?? {},
		save: (s) => streamDeck.settings.setGlobalSettings(s as JsonObject),
	},
	appLog,
	loadDevCredentials(),
);

const images = new ImageCache(() => renderAll());
const cache = new RenderCache((svg) => svgToPngDataUri(svg));
const navigators = new Map<string, Navigator>();

function navigatorFor(device: { id: string; size: { columns: number; rows: number } }): Navigator {
	let nav = navigators.get(device.id);
	if (!nav) {
		nav = new Navigator(
			device.id,
			{ columns: device.size.columns, rows: device.size.rows },
			app,
			images,
			cache,
			() => streamDeck.profiles.switchToProfile(device.id),
			appLog,
		);
		navigators.set(device.id, nav);
	}
	return nav;
}

let renderQueued = false;
function renderAll(): void {
	if (renderQueued) return;
	renderQueued = true;
	setTimeout(() => {
		renderQueued = false;
		for (const nav of navigators.values()) nav.scheduleRender(0);
		launcher.renderAll();
		void pushInspectorState();
	}, 25);
}

// ───────────────────────── Long-press helper ─────────────────────────

const LONG_PRESS_MS = 500;
const held = new Map<string, { timer: NodeJS.Timeout; fired: boolean }>();

function keyDown(id: string, onLong: () => void): void {
	const state = { fired: false, timer: setTimeout(() => ((state.fired = true), onLong()), LONG_PRESS_MS) };
	held.set(id, state);
}

/** Returns true when this keyUp should trigger a short press. */
function keyUp(id: string): boolean {
	const state = held.get(id);
	held.delete(id);
	if (!state) return true;
	clearTimeout(state.timer);
	return !state.fired;
}

// ───────────────────────── Actions ─────────────────────────

/** The user-placed Discord key: shows live status and opens the dynamic profile. */
@action({ UUID: `${UUID}.launcher` })
class LauncherAction extends SingletonAction {
	private last = new Map<string, string>();
	private animTimer?: NodeJS.Timeout;

	override onWillAppear(ev: WillAppearEvent): void {
		this.last.delete(ev.action.id);
		this.renderAll();
	}

	override onWillDisappear(ev: WillDisappearEvent): void {
		this.last.delete(ev.action.id);
	}

	override async onKeyUp(ev: KeyUpEvent): Promise<void> {
		const device = ev.action.device;
		const profile = PROFILES[device.type];
		if (!profile) {
			log.warn(`No bundled profile for device type ${device.type}`);
			await ev.action.showAlert();
			return;
		}
		if (app.store.status !== "ready") app.reconnectNow();
		await streamDeck.profiles.switchToProfile(device.id, profile);
	}

	override async onPropertyInspectorDidAppear(): Promise<void> {
		await pushInspectorState();
	}

	override async onSendToPlugin(ev: SendToPluginEvent<JsonValue, JsonObject>): Promise<void> {
		await handleInspectorMessage(ev.payload);
	}

	renderAll(): void {
		const store = app.store;
		const ready = store.status === "ready";
		const call = ready ? store.selectedChannel : undefined;
		const speakers = call
			? store
					.callParticipants()
					.filter((vs) => store.speaking.has(vs.user.id) && !vs.mute)
					.map((vs) => ({ id: vs.user.id, name: displayName(vs), img: images.peek(avatarUrl(vs.user)) }))
			: [];
		const svg = K.launcherKey({
			status: store.status,
			muted: ready && store.voiceSettings.mute,
			deaf: ready && store.voiceSettings.deaf,
			channel: call?.name,
			speakers,
			phase: currentPhase(),
		});
		const png = cache.get(svg);
		for (const action of this.actions) {
			if (!action.isKey() || this.last.get(action.id) === png) continue;
			this.last.set(action.id, png);
			void action.setImage(png);
		}
		clearTimeout(this.animTimer);
		if (speakers.length) this.animTimer = setTimeout(() => this.renderAll(), 150);
	}
}

/** A generic key inside the dynamic profile; the navigator decides what it shows. */
@action({ UUID: `${UUID}.slot` })
class SlotAction extends SingletonAction {
	override onWillAppear(ev: WillAppearEvent): void {
		const action = ev.action;
		if (!action.isKey() || !action.coordinates) return;
		const { column, row } = action.coordinates;
		const key = action as KeyAction<JsonObject>;
		if (!navigators.get(action.device.id)?.isActive) log.info(`Deck opened on ${action.device.name}`);
		navigatorFor(action.device).attachKey(column, row, {
			setImage: (img) => key.setImage(img),
			showAlert: () => key.showAlert(),
		});
	}

	override onWillDisappear(ev: WillDisappearEvent): void {
		const c = "coordinates" in ev.payload ? ev.payload.coordinates : undefined;
		if (c) navigators.get(ev.action.device.id)?.detachKey(c.column, c.row);
	}

	override onKeyDown(ev: KeyDownEvent): void {
		const c = ev.action.coordinates;
		if (!c) return;
		const nav = navigatorFor(ev.action.device);
		keyDown(ev.action.id, () => void nav.press(c.column, c.row, true));
	}

	override onKeyUp(ev: KeyUpEvent): void {
		const c = ev.action.coordinates;
		if (!c || !keyUp(ev.action.id)) return;
		void navigatorFor(ev.action.device).press(c.column, c.row, false);
	}
}

/** Stream Deck + dial inside the dynamic profile: adjusts the person shown above it. */
@action({ UUID: `${UUID}.dial` })
class DialSlotAction extends SingletonAction {
	override onWillAppear(ev: WillAppearEvent): void {
		const action = ev.action;
		if (!action.isDial()) return;
		const dial = action;
		void dial.setFeedbackLayout("$B1");
		navigatorFor(action.device).attachDial(action.coordinates.column, {
			setFeedback: (f) => dial.setFeedback(f as Parameters<typeof dial.setFeedback>[0]),
		});
	}

	override onWillDisappear(ev: WillDisappearEvent): void {
		const c = "coordinates" in ev.payload ? ev.payload.coordinates : undefined;
		if (c) navigators.get(ev.action.device.id)?.detachDial(c.column);
	}

	override onDialRotate(ev: DialRotateEvent): void {
		void navigatorFor(ev.action.device).dialRotate(ev.action.coordinates.column, ev.payload.ticks);
	}

	override onDialDown(ev: DialDownEvent): void {
		void navigatorFor(ev.action.device).dialPress(ev.action.coordinates.column);
	}

	override onTouchTap(ev: TouchTapEvent): void {
		void navigatorFor(ev.action.device).dialPress(ev.action.coordinates.column);
	}
}

// ───────────────────────── Property inspector bridge ─────────────────────────

async function pushInspectorState(): Promise<void> {
	if (!streamDeck.ui.action) return;
	const s = app.settings;
	await streamDeck.ui
		.sendToPropertyInspector({
			type: "state",
			status: app.store.status,
			statusDetail: app.store.statusDetail,
			user: app.store.me ? app.store.me.global_name || app.store.me.username : null,
			settings: {
				clientId: s.clientId ?? "",
				hasSecret: !!s.clientSecret,
				usingDevCredentials: !s.clientId && !!loadDevCredentials()?.clientId,
				favorites: s.favorites ?? [],
				volumeStep: app.volumeStep,
			},
			guilds: [...app.store.guilds.values()].map((g) => ({ id: g.id, name: g.name, icon: guildIconUrl(g.icon_url, 64) ?? null })),
		})
		.catch(() => undefined);
}

async function handleInspectorMessage(payload: JsonValue): Promise<void> {
	const msg = (payload ?? {}) as Record<string, any>;
	switch (msg.type) {
		case "getState":
			break;
		case "saveCredentials": {
			const patch: Partial<Settings> = { clientId: String(msg.clientId ?? "").trim() };
			if (msg.clientSecret) patch.clientSecret = String(msg.clientSecret).trim();
			await app.updateSettings(patch);
			break;
		}
		case "saveFavorites":
			await app.updateSettings({ favorites: (msg.favorites as string[]).filter((x) => typeof x === "string") });
			break;
		case "saveVolumeStep":
			await app.updateSettings({ volumeStep: Math.min(50, Math.max(1, Number(msg.volumeStep) || 10)) });
			break;
		case "reauthorize":
			await app.updateSettings({ token: null });
			app.reconnectNow();
			break;
		case "reconnect":
			app.reconnectNow();
			break;
	}
	await pushInspectorState();
}

// ───────────────────────── Boot ─────────────────────────

const launcher = new LauncherAction();
streamDeck.actions.registerAction(launcher);
streamDeck.actions.registerAction(new SlotAction());
streamDeck.actions.registerAction(new DialSlotAction());

let lastStatus = "";
app.store.on("change", () => {
	if (app.store.status !== lastStatus) {
		lastStatus = app.store.status;
		log.info(`Discord status: ${lastStatus} ${app.store.statusDetail}`);
	}
	renderAll();
});

/** Opens the Discord deck on every connected device that has a bundled profile. */
async function openOnAllDevices(): Promise<void> {
	for (const device of streamDeck.devices) {
		const profile = PROFILES[device.type];
		if (device.isConnected && profile) await streamDeck.profiles.switchToProfile(device.id, profile);
	}
}

/** Writes logs/deck-<n>.png with what every key currently shows. */
function writeSnapshots(): void {
	let n = 0;
	for (const nav of navigators.values()) {
		const { columns, rows } = nav.size;
		const cell = 152;
		let sheet = `<svg xmlns="http://www.w3.org/2000/svg" width="${columns * cell}" height="${rows * cell}"><rect width="100%" height="100%" fill="#111"/>`;
		nav.snapshot().forEach((img, i) => {
			if (img) sheet += `<image x="${(i % columns) * cell + 4}" y="${Math.floor(i / columns) * cell + 4}" width="144" height="144" href="${img}"/>`;
		});
		sheet += "</svg>";
		const png = svgToPngDataUri(sheet, columns * cell).split(",")[1];
		writeFileSync(path.join(binDir, "..", "logs", `deck-${n++}.png`), Buffer.from(png, "base64"));
	}
}

// streamdeck://plugins/message/com.evanw.discordvoice/open  (handy for hotkeys / testing)
// Dev-only: /snapshot writes logs/deck-N.png; /press?c=0&r=1[&long=1] simulates a key press.
streamDeck.system.onDidReceiveDeepLink((ev) => {
	const cmd = ev.url.path.replace(/^\//, "");
	const q = ev.url.queryParameters;
	log.info(`Deep link: ${cmd} ${ev.url.query}`);
	if (cmd === "open") void openOnAllDevices();
	if (!loadDevCredentials()) return;
	if (cmd === "snapshot") writeSnapshots();
	if (cmd === "favorites") void app.updateSettings({ favorites: (q.get("ids") ?? "").split(",").filter(Boolean) });
	if (cmd === "press") {
		const nav = [...navigators.values()][0];
		void nav?.press(Number(q.get("c")), Number(q.get("r")), q.get("long") === "1").then(() => setTimeout(writeSnapshots, 1500));
	}
});

streamDeck.logger.setLevel("info");
await initRaster(binDir);
await streamDeck.connect();
log.info(`Plugin started; devices: ${[...streamDeck.devices].map((d) => `${d.name} type=${d.type} ${d.size.columns}x${d.size.rows}`).join(", ")}`);
await app.start();
