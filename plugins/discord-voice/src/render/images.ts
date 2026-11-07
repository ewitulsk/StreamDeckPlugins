import type { User } from "../discord/types.js";

/**
 * Fetches remote images (avatars, guild icons) once and keeps them as data URIs that can be
 * embedded in SVG. Requests always ask Discord's CDN for PNG so the rasterizer can decode them.
 */
export class ImageCache {
	private cache = new Map<string, string | null>();
	private inflight = new Map<string, Promise<string | null>>();

	constructor(
		private readonly onLoaded: () => void = () => undefined,
		private readonly fetcher: typeof fetch = fetch,
	) {}

	/** Returns the data URI if cached, otherwise kicks off a load and returns undefined. */
	peek(url: string | null | undefined): string | undefined {
		if (!url) return undefined;
		const hit = this.cache.get(url);
		if (hit !== undefined) return hit ?? undefined;
		void this.load(url).then(() => this.onLoaded());
		return undefined;
	}

	load(url: string): Promise<string | null> {
		if (this.cache.has(url)) return Promise.resolve(this.cache.get(url)!);
		let p = this.inflight.get(url);
		if (!p) {
			p = this.fetchDataUri(url)
				.catch(() => null)
				.then((v) => {
					this.cache.set(url, v);
					this.inflight.delete(url);
					return v;
				});
			this.inflight.set(url, p);
		}
		return p;
	}

	private async fetchDataUri(url: string): Promise<string | null> {
		const res = await this.fetcher(url, { signal: AbortSignal.timeout(8000) });
		if (!res.ok) return null;
		const type = (res.headers.get("content-type") ?? "image/png").split(";")[0];
		if (!/^image\/(png|jpe?g|gif)$/.test(type)) return null;
		const buf = Buffer.from(await res.arrayBuffer());
		return `data:${type};base64,${buf.toString("base64")}`;
	}
}

export function avatarUrl(user: Pick<User, "id" | "avatar">, size = 128): string {
	if (user.avatar) return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=${size}`;
	return defaultAvatarUrl(user.id);
}

export function defaultAvatarUrl(userId: string): string {
	let index = 0;
	try {
		index = Number((BigInt(userId) >> 22n) % 6n);
	} catch {
		index = 0;
	}
	return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

/** Normalises a guild icon URL from RPC to a PNG of the given size. */
export function guildIconUrl(iconUrl: string | null | undefined, size = 128): string | undefined {
	if (!iconUrl) return undefined;
	try {
		const u = new URL(iconUrl);
		u.pathname = u.pathname.replace(/\.(webp|jpg|jpeg|gif|png)$/i, ".png");
		u.searchParams.set("size", String(size));
		return u.toString();
	} catch {
		return undefined;
	}
}
