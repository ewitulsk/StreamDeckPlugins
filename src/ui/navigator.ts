import type { DiscordController, Logger } from "../app.js";
import { avatarUrl } from "../render/images.js";
import type { ImageCache } from "../render/images.js";
import * as K from "../render/keys.js";
import { assignSlots, contentCapacity, paginate, planControls, type Control, type GridSize } from "./layout.js";
import { CallScreen, GuildScreen, HomeScreen, statusItems, type DialFeedback, type KeyModel, type Screen, type ScreenContext } from "./screens.js";

export interface KeySurface {
	setImage(image: string): Promise<void>;
	showAlert(): Promise<void>;
}

export interface DialSurface {
	setFeedback(feedback: DialFeedback | { title: string; value: string; indicator: { value: number; opacity?: number } }): Promise<void>;
}

/** Rasterizes SVG → PNG data URI, with an LRU cache so animation frames are reused. */
export class RenderCache {
	private map = new Map<string, string>();

	constructor(
		private readonly rasterize: (svg: string) => string,
		private readonly max = 600,
	) {}

	get(svg: string): string {
		const hit = this.map.get(svg);
		if (hit) {
			this.map.delete(svg);
			this.map.set(svg, hit);
			return hit;
		}
		const png = this.rasterize(svg);
		this.map.set(svg, png);
		if (this.map.size > this.max) this.map.delete(this.map.keys().next().value!);
		return png;
	}
}

/** Animation: 8 frames over 1.2 s, so rendered frames are cached and reused. */
const FRAME_MS = 150;
const FRAMES = 8;
export const currentPhase = (now = Date.now()) => (Math.floor(now / FRAME_MS) % FRAMES) / FRAMES;

type StackEntry = { screen: Screen; page: number; cleanup?: () => void };

/**
 * Drives one Stream Deck device while the plugin profile is shown.
 */
export class Navigator {
	private keys = new Map<number, KeySurface>();
	private dials = new Map<number, DialSurface>();
	private lastImage = new Map<number, string>();
	private lastFeedback = new Map<number, string>();
	private models: (KeyModel | undefined)[] = [];
	private stack: StackEntry[] = [];
	private renderTimer?: NodeJS.Timeout;
	private animTimer?: NodeJS.Timeout;
	private active = false;
	private busy = false;

	constructor(
		readonly deviceId: string,
		readonly size: GridSize,
		private readonly app: DiscordController,
		private readonly images: ImageCache,
		private readonly cache: RenderCache,
		private readonly exitProfile: () => Promise<void>,
		private readonly log: Logger,
	) {}

	// ───────────── Surface registration ─────────────

	attachKey(column: number, row: number, surface: KeySurface): void {
		const idx = row * this.size.columns + column;
		this.keys.set(idx, surface);
		this.lastImage.delete(idx);
		if (!this.active) this.open();
		this.scheduleRender();
	}

	detachKey(column: number, row: number): void {
		const idx = row * this.size.columns + column;
		this.keys.delete(idx);
		this.lastImage.delete(idx);
		if (this.keys.size === 0 && this.dials.size === 0) this.close();
	}

	attachDial(index: number, surface: DialSurface): void {
		this.dials.set(index, surface);
		this.lastFeedback.delete(index);
		if (!this.active) this.open();
		this.scheduleRender();
	}

	detachDial(index: number): void {
		this.dials.delete(index);
		this.lastFeedback.delete(index);
		if (this.keys.size === 0 && this.dials.size === 0) this.close();
	}

	get isActive(): boolean {
		return this.active;
	}

	/** The images currently shown on each key (for debugging snapshots). */
	snapshot(): (string | undefined)[] {
		return Array.from({ length: this.size.columns * this.size.rows }, (_, i) => this.lastImage.get(i));
	}

	// ───────────── Navigation ─────────────

	/** Called when the profile appears: start at home, or jump straight into the current call. */
	private open(): void {
		this.active = true;
		this.resetStack();
	}

	private resetStack(): void {
		for (const e of this.stack) e.cleanup?.();
		this.stack = [];
		const ctx = this.ctx();
		this.pushEntry(new HomeScreen(), ctx);
		const call = this.app.store.selectedChannel;
		if (call && this.app.store.status === "ready") {
			if (call.guildId) this.pushEntry(new GuildScreen(call.guildId), ctx, false);
			this.pushEntry(new CallScreen(), ctx);
		}
	}

	private close(): void {
		this.active = false;
		for (const e of this.stack) e.cleanup?.();
		this.stack = [];
		clearTimeout(this.renderTimer);
		clearTimeout(this.animTimer);
		this.renderTimer = undefined;
		this.animTimer = undefined;
		this.lastImage.clear();
		this.lastFeedback.clear();
	}

	private pushEntry(screen: Screen, ctx: ScreenContext, enter = true): void {
		const top = this.stack.at(-1);
		if (top) {
			top.cleanup?.();
			top.cleanup = undefined;
		}
		const entry: StackEntry = { screen, page: 0 };
		this.stack.push(entry);
		if (enter) entry.cleanup = screen.enter?.(ctx) ?? undefined;
	}

	push(screen: Screen): void {
		if (this.stack.at(-1)?.screen.id === screen.id) return;
		this.pushEntry(screen, this.ctx());
		this.lastFeedback.clear();
		this.scheduleRender();
	}

	pop(): void {
		if (this.stack.length <= 1) {
			void this.exit();
			return;
		}
		const e = this.stack.pop()!;
		e.cleanup?.();
		const top = this.stack.at(-1)!;
		top.cleanup = top.screen.enter?.(this.ctx()) ?? undefined;
		this.lastFeedback.clear();
		this.scheduleRender();
	}

	async exit(): Promise<void> {
		await this.exitProfile();
	}

	private ctx(): ScreenContext {
		return {
			app: this.app,
			images: this.images,
			phase: currentPhase(),
			push: (s) => this.push(s),
			pop: () => this.pop(),
		};
	}

	// ───────────── Rendering ─────────────

	scheduleRender(delay = 16): void {
		if (!this.active) return;
		if (this.renderTimer) return;
		this.renderTimer = setTimeout(() => {
			this.renderTimer = undefined;
			void this.render();
		}, delay);
	}

	private async render(): Promise<void> {
		if (!this.active) return;
		if (this.busy) {
			this.scheduleRender(30);
			return;
		}
		this.busy = true;
		try {
			await this.renderInner();
		} catch (err) {
			this.log.error("render failed", err);
		} finally {
			this.busy = false;
		}
	}

	private async renderInner(): Promise<void> {
		const ctx = this.ctx();
		const ready = this.app.store.status === "ready";

		// Pop screens that no longer make sense (call ended, user left, guild gone).
		if (ready) {
			let popped = false;
			while (this.stack.length > 1 && this.stack.at(-1)!.screen.valid?.(ctx) === false) {
				this.stack.pop()!.cleanup?.();
				popped = true;
			}
			if (popped) {
				const top = this.stack.at(-1)!;
				top.cleanup = top.screen.enter?.(ctx) ?? undefined;
			}
		}

		const entry = this.stack.at(-1)!;
		const all = ready ? entry.screen.items(ctx) : statusItems(ctx);
		const capacity = contentCapacity(this.size);
		const page = paginate(all, capacity, entry.page);
		entry.page = page.page;

		const controls = planControls({
			columns: this.size.columns,
			needsPaging: page.pages > 1,
			inCall: ready && !!this.app.store.selectedChannel,
			singleRow: this.size.rows < 2,
			atRoot: this.stack.length <= 1,
		});

		const slots = assignSlots(this.size, controls, page.items.length);
		const models: (KeyModel | undefined)[] = slots.map((s) => {
			if (s.kind === "content") return page.items[s.index];
			if (s.kind === "control") return this.controlModel(s.control, page.page, page.pages, ready, ctx);
			return { svg: K.blankKey() };
		});
		this.models = models;

		let animated = false;
		for (const [idx, surface] of this.keys) {
			const model = models[idx];
			if (!model) continue;
			if (model.animated) animated = true;
			const png = this.cache.get(model.svg);
			if (this.lastImage.get(idx) === png) continue;
			this.lastImage.set(idx, png);
			await surface.setImage(png).catch(() => undefined);
		}

		// Dials map to the bottom row of content keys (Stream Deck +).
		for (const [i, dial] of this.dials) {
			const model = models[(this.size.rows - 1) * this.size.columns + i];
			const fb = model?.dial?.feedback() ?? { title: "", value: "", indicator: 0 };
			const payload = { title: fb.title, value: fb.value, indicator: { value: fb.indicator, opacity: model?.dial ? 1 : 0 } };
			const sig = JSON.stringify(payload);
			if (this.lastFeedback.get(i) === sig) continue;
			this.lastFeedback.set(i, sig);
			await dial.setFeedback(payload).catch(() => undefined);
		}

		clearTimeout(this.animTimer);
		if (animated) this.animTimer = setTimeout(() => this.scheduleRender(0), FRAME_MS);
	}

	private controlModel(control: Control, page: number, pages: number, ready: boolean, ctx: ScreenContext): KeyModel {
		const store = this.app.store;
		const entry = this.stack.at(-1)!;
		const setPage = (p: number) => {
			entry.page = (p + pages) % pages;
			this.lastFeedback.clear();
			this.scheduleRender(0);
		};
		switch (control) {
			case "back":
				return {
					svg: K.iconKey(this.stack.length <= 1 ? "close" : "back", { label: this.stack.length <= 1 ? "Exit" : "Back" }),
					press: () => this.pop(),
					longPress: () => this.exit(),
				};
			case "exit":
				return { svg: K.iconKey("close", { label: "Exit" }), press: () => this.exit() };
			case "prev":
				return {
					svg: K.pagerKey("prev", page, pages),
					press: () => {
						if (page > 0) setPage(page - 1);
					},
				};
			case "next":
				return {
					svg: K.pagerKey("next", page, pages),
					press: () => {
						if (page < pages - 1) setPage(page + 1);
					},
				};
			case "page":
				return { svg: K.pagerKey("cycle", page, pages), press: () => setPage(page + 1), longPress: () => setPage(page - 1) };
			case "mute": {
				if (!ready) return { svg: K.blankKey() };
				const me = store.me;
				const speaking = !!me && store.speaking.has(me.id);
				return {
					svg: K.selfMuteKey({
						me: me ? { id: me.id, name: me.global_name || me.username, img: ctx.images.peek(avatarUrl(me)) } : undefined,
						muted: store.voiceSettings.mute,
						deaf: store.voiceSettings.deaf,
						speaking,
						phase: ctx.phase,
					}),
					animated: speaking && !store.voiceSettings.mute,
					press: () => this.app.toggleMute(),
				};
			}
			case "deafen":
				if (!ready) return { svg: K.blankKey() };
				return { svg: K.deafenKey(store.voiceSettings.deaf), press: () => this.app.toggleDeaf() };
			case "leave":
				return { svg: K.leaveKey(), press: () => this.app.leave() };
			default:
				return { svg: K.blankKey() };
		}
	}

	// ───────────── Input ─────────────

	async press(column: number, row: number, long: boolean): Promise<void> {
		const idx = row * this.size.columns + column;
		const model = this.models[idx];
		const fn = long ? (model?.longPress ?? model?.press) : model?.press;
		if (!fn) return;
		try {
			await fn();
		} catch (err) {
			this.log.warn("action failed", err);
			await this.keys.get(idx)?.showAlert().catch(() => undefined);
		}
		this.scheduleRender(0);
	}

	async dialRotate(index: number, ticks: number): Promise<void> {
		const model = this.models[(this.size.rows - 1) * this.size.columns + index];
		try {
			await model?.dial?.rotate(ticks);
		} catch (err) {
			this.log.warn("dial failed", err);
		}
		this.scheduleRender(0);
	}

	async dialPress(index: number): Promise<void> {
		const model = this.models[(this.size.rows - 1) * this.size.columns + index];
		try {
			await model?.dial?.press?.();
		} catch (err) {
			this.log.warn("dial press failed", err);
		}
		this.scheduleRender(0);
	}
}
