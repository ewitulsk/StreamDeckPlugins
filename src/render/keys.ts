import { icon, slashedIcon, type IconName } from "./icons.js";

/** All key art is authored on a 144×144 canvas (the @2x key size) and rasterised. */
export const SIZE = 144;

export const C = {
	bg: "#1e1f22",
	card: "#2b2d31",
	cardHi: "#35373c",
	blurple: "#5865f2",
	green: "#23a55a",
	red: "#f23f43",
	yellow: "#f0b232",
	text: "#f2f3f5",
	sub: "#b5bac1",
	muted: "#80848e",
} as const;

const FONT = `font-family="Inter, Segoe UI, Segoe UI Symbol, Segoe UI Emoji, Yu Gothic, Malgun Gothic, sans-serif"`;

export function esc(s: string): string {
	return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Rough Inter width estimate, good enough to decide where to ellipsize. */
export function textWidth(s: string, fontSize: number): number {
	let w = 0;
	for (const ch of s) {
		if (/\p{M}/u.test(ch)) continue;
		if (/[ilj.,'|!:;]/.test(ch)) w += 0.3;
		else if (/[mwMW@]/.test(ch)) w += 0.85;
		else if (/[A-Z0-9]/.test(ch)) w += 0.66;
		else if (ch.codePointAt(0)! > 0x2e80) w += 1.0;
		else w += 0.56;
	}
	return w * fontSize;
}

export function ellipsize(s: string, maxWidth: number, fontSize: number): string {
	if (textWidth(s, fontSize) <= maxWidth) return s;
	const chars = [...s];
	while (chars.length > 1 && textWidth(chars.join("") + "…", fontSize) > maxWidth) chars.pop();
	return chars.join("").trimEnd() + "…";
}

/** Picks the largest font size (down to `min`) that fits; ellipsizes if it still doesn't. */
export function fitText(s: string, maxWidth: number, max: number, min: number): { text: string; size: number } {
	for (let size = max; size >= min; size -= 1) {
		if (textWidth(s, size) <= maxWidth) return { text: s, size };
	}
	return { text: ellipsize(s, maxWidth, min), size: min };
}

export function label(s: string, y: number, opts: { max?: number; min?: number; color?: string; weight?: number; maxWidth?: number } = {}): string {
	const { text, size } = fitText(s.normalize("NFC"), opts.maxWidth ?? 134, opts.max ?? 20, opts.min ?? 14);
	return `<text x="72" y="${y}" text-anchor="middle" font-size="${size}" font-weight="${opts.weight ?? 600}" fill="${opts.color ?? C.text}" ${FONT}>${esc(text)}</text>`;
}

function text(s: string, x: number, y: number, size: number, color: string, anchor = "middle", weight = 700): string {
	return `<text x="${x}" y="${y}" text-anchor="${anchor}" font-size="${size}" font-weight="${weight}" fill="${color}" ${FONT}>${esc(s)}</text>`;
}

export function svg(body: string, opts: { bg?: string; border?: string; borderWidth?: number } = {}): string {
	const border = opts.border
		? `<rect x="${(opts.borderWidth ?? 6) / 2}" y="${(opts.borderWidth ?? 6) / 2}" width="${SIZE - (opts.borderWidth ?? 6)}" height="${SIZE - (opts.borderWidth ?? 6)}" rx="14" fill="none" stroke="${opts.border}" stroke-width="${opts.borderWidth ?? 6}"/>`
		: "";
	return (
		`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">` +
		`<defs><filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="5"/></filter>` +
		`<filter id="gray"><feColorMatrix type="saturate" values="0.15"/></filter></defs>` +
		`<rect width="${SIZE}" height="${SIZE}" fill="${opts.bg ?? C.bg}"/>${body}${border}</svg>`
	);
}

let clipSeq = 0;

/** Stable color for placeholder avatars / initials. */
export function colorFor(id: string): string {
	const palette = ["#5865f2", "#3ba55c", "#faa61a", "#ed4245", "#eb459e", "#9b59b6", "#1abc9c", "#e67e22"];
	let h = 0;
	for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
	return palette[h % palette.length];
}

export function initials(name: string): string {
	const words = name.normalize("NFC").replace(/\p{M}+/gu, "").replace(/[^\p{L}\p{N}\s]/gu, " ").trim().split(/\s+/).filter(Boolean);
	if (!words.length) return [...name][0] ?? "?";
	return words
		.slice(0, 3)
		.map((w) => [...w][0])
		.join("")
		.toUpperCase();
}

export type AvatarOpts = {
	img?: string;
	id: string;
	name: string;
	speaking?: boolean;
	/** Animation phase 0..1 for the speaking pulse. */
	phase?: number;
	dim?: boolean;
	ringColor?: string;
};

/** Pulse intensity 0..1 for a given phase. */
export const pulse = (phase = 0) => 0.5 + 0.5 * Math.sin(phase * Math.PI * 2);

/** Circular avatar with optional speaking glow. */
export function avatar(cx: number, cy: number, r: number, o: AvatarOpts): string {
	const id = `c${++clipSeq}`;
	let out = "";
	if (o.speaking) {
		const p = pulse(o.phase);
		const glowR = r + 3 + p * Math.max(3, r * 0.12);
		out += `<circle cx="${cx}" cy="${cy}" r="${glowR}" fill="${C.green}" opacity="${0.55 + 0.4 * p}" filter="url(#glow)"/>`;
	}
	out += `<clipPath id="${id}"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath>`;
	const filter = o.dim ? ` filter="url(#gray)" opacity="0.55"` : "";
	if (o.img) {
		out += `<image x="${cx - r}" y="${cy - r}" width="${r * 2}" height="${r * 2}" clip-path="url(#${id})" preserveAspectRatio="xMidYMid slice" href="${o.img}" xlink:href="${o.img}"${filter}/>`;
	} else {
		out += `<g${filter}><circle cx="${cx}" cy="${cy}" r="${r}" fill="${colorFor(o.id)}"/>${text(initials(o.name).slice(0, 2), cx, cy + r * 0.36, r * 0.95, "#fff")}</g>`;
	}
	if (o.speaking) out += `<circle cx="${cx}" cy="${cy}" r="${r + 1.5}" fill="none" stroke="${C.green}" stroke-width="${Math.max(2.5, r * 0.09)}"/>`;
	else if (o.ringColor) out += `<circle cx="${cx}" cy="${cy}" r="${r + 1.5}" fill="none" stroke="${o.ringColor}" stroke-width="${Math.max(2, r * 0.07)}"/>`;
	return out;
}

/** Small round status badge with an icon. */
function badge(cx: number, cy: number, r: number, bg: string, name: IconName, opts: { slashed?: boolean } = {}): string {
	const s = r * 1.3;
	const glyph = opts.slashed ? slashedIcon(name, cx - s / 2, cy - s / 2, s, "#fff", "#fff", bg) : icon(name, cx - s / 2, cy - s / 2, s, "#fff");
	return `<circle cx="${cx}" cy="${cy}" r="${r + 2.5}" fill="${C.bg}"/><circle cx="${cx}" cy="${cy}" r="${r}" fill="${bg}"/>${glyph}`;
}

function pill(x: number, y: number, s: string, bg: string, color = "#fff", size = 18): string {
	const w = textWidth(s, size) + 14;
	return `<rect x="${x - w}" y="${y}" width="${w}" height="${size + 8}" rx="${(size + 8) / 2}" fill="${bg}" stroke="${C.bg}" stroke-width="3"/>${text(s, x - w / 2, y + size + 1, size, color)}`;
}

// ───────────────────────── Keys ─────────────────────────

export function blankKey(): string {
	return svg("", { bg: "#000" });
}

export function guildKey(o: { id: string; name: string; icon?: string; voiceCount: number; inCall: boolean; anySpeaking?: boolean; phase?: number }): string {
	const r = 22;
	const clip = `g${++clipSeq}`;
	let body = "";
	if (o.anySpeaking) {
		body += `<rect x="20" y="8" width="104" height="96" rx="${r + 4}" fill="${C.green}" opacity="${0.35 + 0.35 * pulse(o.phase)}" filter="url(#glow)"/>`;
	}
	body += `<clipPath id="${clip}"><rect x="24" y="10" width="96" height="92" rx="${r}"/></clipPath>`;
	if (o.icon) body += `<image x="24" y="10" width="96" height="92" clip-path="url(#${clip})" preserveAspectRatio="xMidYMid slice" href="${o.icon}" xlink:href="${o.icon}"/>`;
	else body += `<rect x="24" y="10" width="96" height="92" rx="${r}" fill="${C.card}"/>${text(initials(o.name).slice(0, 3), 72, 70, initials(o.name).length > 2 ? 30 : 38, C.text)}`;
	body += label(o.name, 130, { max: 19, min: 14 });
	if (o.voiceCount > 0) {
		const s = `${o.voiceCount}`;
		const w = textWidth(s, 18) + 34;
		body += `<rect x="${136 - w}" y="4" width="${w}" height="28" rx="14" fill="${C.green}" stroke="${C.bg}" stroke-width="3"/>`;
		body += icon("speaker", 140 - w, 8, 20, "#fff");
		body += text(s, 136 - (w - 22) / 2 - 4, 24, 18, "#fff");
	}
	return svg(body, o.inCall ? { border: C.green } : {});
}

export type MemberArt = { id: string; name: string; img?: string; speaking?: boolean };

/** Positions for an avatar cluster of n (≤ 8) inside the box centered at (cx, cy). */
export function clusterLayout(n: number, cx: number, cy: number): { x: number; y: number; r: number }[] {
	if (n <= 0) return [];
	if (n === 1) return [{ x: cx, y: cy, r: 34 }];
	if (n === 2) return [{ x: cx - 25, y: cy, r: 23 }, { x: cx + 25, y: cy, r: 23 }];
	if (n === 3)
		return [
			{ x: cx, y: cy - 20, r: 19 },
			{ x: cx - 23, y: cy + 18, r: 19 },
			{ x: cx + 23, y: cy + 18, r: 19 },
		];
	if (n === 4)
		return [
			{ x: cx - 22, y: cy - 20, r: 19 },
			{ x: cx + 22, y: cy - 20, r: 19 },
			{ x: cx - 22, y: cy + 21, r: 19 },
			{ x: cx + 22, y: cy + 21, r: 19 },
		];
	// 5–8: ring around the channel icon.
	const R = 38;
	const r = n <= 6 ? 16 : 14;
	return Array.from({ length: n }, (_, i) => {
		const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
		return { x: cx + R * Math.cos(a), y: cy + R * 0.95 * Math.sin(a), r };
	});
}

export function channelKey(o: {
	name: string;
	members: MemberArt[];
	connected: boolean;
	userLimit: number;
	stage?: boolean;
	phase?: number;
}): string {
	const n = o.members.length;
	const cx = 72;
	const cy = 56;
	let body = "";
	if (n === 0) {
		body += `<circle cx="${cx}" cy="${cy}" r="36" fill="${C.card}"/>` + icon("speaker", cx - 22, cy - 22, 44, C.muted);
	} else {
		const shown = n > 8 ? o.members.slice(0, 7) : o.members;
		const slots = clusterLayout(n > 8 ? 8 : n, cx, cy);
		if (n >= 5) body += icon("speaker", cx - 13, cy - 13, 26, C.sub);
		shown.forEach((m, i) => {
			const s = slots[i];
			body += avatar(s.x, s.y, s.r, { ...m, phase: o.phase });
		});
		if (n > 8) {
			const s = slots[7];
			body += `<circle cx="${s.x}" cy="${s.y}" r="${s.r}" fill="${C.cardHi}"/>` + text(`+${n - 7}`, s.x, s.y + 6, 15, C.text);
		}
	}
	body += label(o.name, 130, { max: 19, min: 13, color: n ? C.text : C.sub });
	if (o.userLimit > 0 && n > 0) {
		const full = n >= o.userLimit;
		body += pill(140, 4, `${n}/${o.userLimit}`, full ? C.red : C.cardHi, "#fff", 15);
	}
	return svg(body, o.connected ? { border: C.green } : {});
}

export function participantKey(o: {
	id: string;
	name: string;
	img?: string;
	speaking: boolean;
	phase?: number;
	selfMute: boolean;
	selfDeaf: boolean;
	serverMute: boolean;
	serverDeaf: boolean;
	localMute: boolean;
	volume: number;
	isMe?: boolean;
}): string {
	let body = avatar(72, 58, 44, { id: o.id, name: o.name, img: o.img, speaking: o.speaking && !o.localMute, phase: o.phase, dim: o.localMute });
	// Status badges along the bottom-right of the avatar.
	let bx = 112;
	const by = 92;
	if (o.serverDeaf || o.selfDeaf) {
		body += badge(bx, by, 13, o.serverDeaf ? C.red : C.cardHi, "headset", { slashed: true });
		bx -= 30;
	}
	if (o.serverMute || o.selfMute) {
		body += badge(bx, by, 13, o.serverMute ? C.red : C.cardHi, "mic", { slashed: true });
	}
	if (o.localMute) body += badge(32, 22, 14, C.yellow, "speaker", { slashed: true });
	if (!o.localMute && o.volume !== 100) {
		body += pill(140, 4, `${o.volume}%`, o.volume > 100 ? C.blurple : C.cardHi, "#fff", 15);
	}
	body += label(o.isMe ? `${o.name} (you)` : o.name, 132, { max: 19, min: 13 });
	return svg(body);
}

export function iconKey(name: IconName, o: { label?: string; color?: string; bg?: string; slashed?: boolean; border?: string; size?: number } = {}): string {
	const size = o.size ?? (o.label ? 64 : 76);
	const y = o.label ? 18 : (SIZE - size) / 2;
	const color = o.color ?? C.text;
	const glyph = o.slashed ? slashedIcon(name, (SIZE - size) / 2, y, size, color, C.red, o.bg ?? C.bg) : icon(name, (SIZE - size) / 2, y, size, color);
	return svg(glyph + (o.label ? label(o.label, 122, { max: 20, min: 13, color: C.sub }) : ""), { bg: o.bg, border: o.border });
}

export function pagerKey(dir: "prev" | "next" | "cycle", page: number, pages: number): string {
	const name: IconName = dir === "prev" ? "chevronLeft" : "chevronRight";
	const enabled = dir === "cycle" ? pages > 1 : dir === "prev" ? page > 0 : page < pages - 1;
	const color = enabled ? C.text : "#4e5058";
	return svg(icon(name, 32, 14, 80, color) + `<text x="72" y="124" text-anchor="middle" font-size="22" font-weight="700" fill="${enabled ? C.sub : "#4e5058"}" ${FONT}>${page + 1}/${pages}</text>`);
}

export function selfMuteKey(o: { me?: MemberArt; muted: boolean; deaf: boolean; speaking: boolean; phase?: number }): string {
	let body = "";
	if (o.me) body += avatar(72, 60, 40, { ...o.me, speaking: o.speaking && !o.muted, phase: o.phase, dim: o.muted });
	else body += `<circle cx="72" cy="60" r="40" fill="${C.card}"/>`;
	const muted = o.muted || o.deaf;
	body += badge(108, 96, 18, muted ? C.red : C.cardHi, "mic", { slashed: muted });
	body += label(muted ? "Muted" : "Mic on", 134, { max: 18, min: 14, color: muted ? C.red : C.sub });
	return svg(body, muted ? { border: C.red, borderWidth: 4 } : {});
}

export function deafenKey(deaf: boolean): string {
	return iconKey("headset", { label: deaf ? "Deafened" : "Deafen", slashed: deaf, color: deaf ? C.red : C.text, border: deaf ? C.red : undefined });
}

export function leaveKey(): string {
	return svg(`<circle cx="72" cy="56" r="42" fill="${C.red}"/>` + icon("hangup", 44, 28, 56, "#fff") + label("Leave", 130, { max: 19, color: C.sub }));
}

export function volumeKey(o: { member: MemberArt; volume: number; localMute: boolean; speaking: boolean; phase?: number }): string {
	// Arc meter around the avatar, 0..200%.
	const cx = 72;
	const cy = 62;
	const R = 52;
	const start = Math.PI * 0.75;
	const sweep = Math.PI * 1.5;
	const arc = (frac: number) => {
		const a0 = start;
		const a1 = start + sweep * Math.max(0.0001, Math.min(1, frac));
		const large = a1 - a0 > Math.PI ? 1 : 0;
		return `M ${cx + R * Math.cos(a0)} ${cy + R * Math.sin(a0)} A ${R} ${R} 0 ${large} 1 ${cx + R * Math.cos(a1)} ${cy + R * Math.sin(a1)}`;
	};
	const frac = o.volume / 200;
	const color = o.localMute ? C.muted : o.volume > 100 ? C.blurple : C.green;
	let body = `<path d="${arc(1)}" fill="none" stroke="${C.cardHi}" stroke-width="9" stroke-linecap="round"/>`;
	body += `<path d="${arc(frac)}" fill="none" stroke="${color}" stroke-width="9" stroke-linecap="round"/>`;
	// 100% tick
	const ta = start + sweep / 2;
	body += `<line x1="${cx + (R - 8) * Math.cos(ta)}" y1="${cy + (R - 8) * Math.sin(ta)}" x2="${cx + (R + 8) * Math.cos(ta)}" y2="${cy + (R + 8) * Math.sin(ta)}" stroke="${C.sub}" stroke-width="2"/>`;
	body += avatar(cx, cy, 36, { ...o.member, speaking: o.speaking && !o.localMute, phase: o.phase, dim: o.localMute });
	body += text(o.localMute ? "Muted" : `${o.volume}%`, 72, 134, 24, o.localMute ? C.yellow : C.text);
	return svg(body);
}

export function volumeStepKey(dir: "down" | "up", target: number, enabled: boolean): string {
	const color = enabled ? C.text : "#4e5058";
	const body =
		`<circle cx="72" cy="58" r="40" fill="${C.card}"/>` +
		icon(dir === "down" ? "minus" : "plus", 40, 26, 64, color) +
		label(enabled ? `${target}%` : dir === "down" ? "Min" : "Max", 130, { max: 20, color: C.sub });
	return svg(body);
}

export function localMuteKey(muted: boolean): string {
	return iconKey("speaker", { label: muted ? "Unmute" : "Mute for me", slashed: muted, color: muted ? C.yellow : C.text, border: muted ? C.yellow : undefined });
}

export function resetVolumeKey(volume: number): string {
	return iconKey("reset", { label: "100%", color: volume === 100 ? "#4e5058" : C.text });
}

export function messageKey(o: { icon: IconName; title: string; sub?: string; color?: string; bg?: string }): string {
	let body = icon(o.icon, 44, 14, 56, o.color ?? C.text);
	body += label(o.title, 96, { max: 18, min: 12, weight: 700 });
	if (o.sub) body += label(o.sub, 124, { max: 15, min: 11, color: C.sub });
	return svg(body, { bg: o.bg });
}

export function launcherKey(o: {
	status: "ready" | "connecting" | "authorizing" | "disconnected" | "error" | "unconfigured";
	muted: boolean;
	deaf: boolean;
	channel?: string;
	speakers: MemberArt[];
	phase?: number;
}): string {
	const ok = o.status === "ready";
	const logoColor = ok ? "#fff" : "#b5bac1";
	const bg = ok ? C.blurple : "#4e5058";
	let body = `<rect width="144" height="144" fill="${bg}"/>`;
	if (o.channel && o.speakers.length) {
		body += icon("discord", 16, 10, 40, logoColor);
		const shown = o.speakers.slice(0, 3);
		shown.forEach((m, i) => (body += avatar(80 + i * 22 - (shown.length - 1) * 11, 70, 24, { ...m, speaking: true, phase: o.phase })));
	} else {
		body += icon("discord", 30, o.channel ? 14 : 30, 84, logoColor);
	}
	if (o.channel) body += label(o.channel, 132, { max: 18, min: 12, color: "#fff" });
	else if (!ok) body += label(o.status === "unconfigured" ? "Setup" : o.status === "authorizing" ? "Authorize" : "Offline", 132, { max: 18, color: "#fff" });
	if (o.muted || o.deaf) body += badge(118, 26, 16, C.red, o.deaf ? "headset" : "mic", { slashed: true });
	return svg(body, { bg });
}
