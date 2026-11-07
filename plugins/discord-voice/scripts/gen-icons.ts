/** Generates the static manifest icons (plugin, category, actions) into the .sdPlugin/imgs folder. */
import { mkdirSync, writeFileSync } from "node:fs";
import { ICON } from "../src/render/icons.js";
import { launcherKey } from "../src/render/keys.js";
import { initRaster, svgToPng } from "../src/render/raster.js";

const PLUGIN = "com.evanw.discordvoice.sdPlugin";
await initRaster(`${PLUGIN}/bin`);
mkdirSync(`${PLUGIN}/imgs`, { recursive: true });

const glyph = (path: string, fill: string, bg?: string) =>
	`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">${bg ? `<rect width="24" height="24" rx="5" fill="${bg}"/>` : ""}<path d="${path}" fill="${fill}" ${bg ? 'transform="translate(3.6 3.6) scale(0.7)"' : ""}/></svg>`;

const out = (name: string, svg: string, size: number) => writeFileSync(`${PLUGIN}/imgs/${name}.png`, svgToPng(svg, size));

// Plugin icon (256 + @2x)
const pluginSvg = glyph(ICON.discord, "#ffffff", "#5865f2");
out("plugin", pluginSvg, 256);
out("plugin@2x", pluginSvg, 512);
// Category icon (28, monochrome white per Elgato guidelines)
out("category", glyph(ICON.discord, "#ffffff"), 28);
out("category@2x", glyph(ICON.discord, "#ffffff"), 56);
// Action list icons (20, monochrome)
for (const [name, path] of [
	["action-launcher", ICON.discord],
	["action-slot", ICON.speaker],
	["action-dial", ICON.speaker],
] as const) {
	out(name, glyph(path, "#ffffff"), 20);
	out(`${name}@2x`, glyph(path, "#ffffff"), 40);
}
// Default key image for the launcher and slots.
const launcher = launcherKey({ status: "ready", muted: false, deaf: false, speakers: [] });
out("key-launcher", launcher, 72);
out("key-launcher@2x", launcher, 144);
const blank = `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144"><rect width="144" height="144" fill="#000"/></svg>`;
out("key-blank", blank, 72);
out("key-blank@2x", blank, 144);
console.log("icons written");
