/**
 * Renders a contact sheet of every key design to preview.png (uses real Discord CDN avatars).
 *   npx tsx scripts/preview.ts
 */
import { writeFileSync } from "node:fs";
import { ImageCache, defaultAvatarUrl } from "../src/render/images.js";
import * as K from "../src/render/keys.js";
import { initRaster, svgToPngDataUri } from "../src/render/raster.js";

await initRaster("com.evanw.discordvoice.sdPlugin/bin");
const images = new ImageCache();
const av = async (i: number) => (await images.load(defaultAvatarUrl(String(BigInt(i) << 22n)))) ?? undefined;
const real = (await images.load("https://cdn.discordapp.com/avatars/1548625445921234968/38ae00605a418b1a580ddafa9a2ef49d.png?size=128")) ?? undefined;
const imgs = [real, await av(0), await av(1), await av(2), await av(3), await av(4), await av(5), undefined, real, await av(1)];
const m = (i: number, speaking = false): K.MemberArt => ({ id: `u${i}`, name: ["crampedsoul", "Alex", "Bea", "Chris Doe", "Dana", "Eli", "Fox", "Gus Jr", "Hana", "Ivy"][i], img: imgs[i], speaking });

const keys: [string, string][] = [
	["guild", K.guildKey({ id: "1", name: "IW8-Mod", icon: real, voiceCount: 3, inCall: false })],
	["guild-noicon", K.guildKey({ id: "2", name: "Crypto Thing", voiceCount: 0, inCall: false })],
	["guild-incall", K.guildKey({ id: "3", name: "Friends Server", icon: imgs[2], voiceCount: 12, inCall: true, anySpeaking: true, phase: 0.25 })],
	["chan-empty", K.channelKey({ name: "Gaming", members: [], connected: false, userLimit: 0 })],
	["chan-1", K.channelKey({ name: "General", members: [m(0, true)], connected: false, userLimit: 0, phase: 0.25 })],
	["chan-2", K.channelKey({ name: "Duo", members: [m(1), m(2)], connected: false, userLimit: 2 })],
	["chan-3", K.channelKey({ name: "Trio queue", members: [m(1), m(2, true), m(3)], connected: true, userLimit: 0, phase: 0.25 })],
	["chan-4", K.channelKey({ name: "Squad", members: [0, 1, 2, 3].map((i) => m(i)), connected: false, userLimit: 5 })],
	["chan-6", K.channelKey({ name: "Hangout", members: [0, 1, 2, 3, 4, 5].map((i) => m(i, i === 2)), connected: false, userLimit: 0, phase: 0.25 })],
	["chan-12", K.channelKey({ name: "Big Lobby Channel Name", members: Array.from({ length: 12 }, (_, i) => m(i % 10)), connected: false, userLimit: 0 })],
	["person", K.participantKey({ id: "u0", name: "crampedsoul", img: real, speaking: true, phase: 0.25, selfMute: false, selfDeaf: false, serverMute: false, serverDeaf: false, localMute: false, volume: 100 })],
	["person-muted", K.participantKey({ id: "u1", name: "Alex", img: imgs[1], speaking: false, selfMute: true, selfDeaf: true, serverMute: false, serverDeaf: false, localMute: false, volume: 65 })],
	["person-local", K.participantKey({ id: "u7", name: "Gus Jr", speaking: false, selfMute: false, selfDeaf: false, serverMute: true, serverDeaf: false, localMute: true, volume: 100 })],
	["person-me", K.participantKey({ id: "u3", name: "greenpeppers100", img: imgs[3], speaking: false, selfMute: false, selfDeaf: false, serverMute: false, serverDeaf: false, localMute: false, volume: 150, isMe: true })],
	["back", K.iconKey("back", { label: "Back" })],
	["prev", K.pagerKey("prev", 0, 3)],
	["next", K.pagerKey("next", 0, 3)],
	["mute-on", K.selfMuteKey({ me: m(3), muted: false, deaf: false, speaking: true, phase: 0.25 })],
	["mute-off", K.selfMuteKey({ me: m(3), muted: true, deaf: false, speaking: false })],
	["deafen", K.deafenKey(false)],
	["deafened", K.deafenKey(true)],
	["leave", K.leaveKey()],
	["exit", K.iconKey("close", { label: "Exit" })],
	["vol", K.volumeKey({ member: m(0, true), volume: 135, localMute: false, speaking: true, phase: 0.25 })],
	["vol-down", K.volumeStepKey("down", 125, true)],
	["vol-up", K.volumeStepKey("up", 145, true)],
	["local-mute", K.localMuteKey(false)],
	["local-muted", K.localMuteKey(true)],
	["reset", K.resetVolumeKey(135)],
	["msg", K.messageKey({ icon: "warning", title: "Discord offline", sub: "Retrying…", color: K.C.yellow })],
	["launch", K.launcherKey({ status: "ready", muted: false, deaf: false, speakers: [] })],
	["launch-call", K.launcherKey({ status: "ready", muted: true, deaf: false, channel: "General", speakers: [m(0), m(1)], phase: 0.25 })],
	["launch-off", K.launcherKey({ status: "disconnected", muted: false, deaf: false, speakers: [] })],
];

const cols = 8;
const cell = 160;
const rows = Math.ceil(keys.length / cols);
let sheet = `<svg xmlns="http://www.w3.org/2000/svg" width="${cols * cell}" height="${rows * (cell + 20)}"><rect width="100%" height="100%" fill="#000"/>`;
keys.forEach(([name, svg], i) => {
	const x = (i % cols) * cell + 8;
	const y = Math.floor(i / cols) * (cell + 20) + 8;
	sheet += `<image x="${x}" y="${y}" width="144" height="144" href="${svgToPngDataUri(svg)}"/>`;
	sheet += `<text x="${x + 72}" y="${y + 162}" fill="#aaa" font-size="13" text-anchor="middle">${name}</text>`;
});
sheet += "</svg>";
const out = svgToPngDataUri(sheet, cols * cell);
writeFileSync("preview.png", Buffer.from(out.split(",")[1], "base64"));
console.log("wrote preview.png");
