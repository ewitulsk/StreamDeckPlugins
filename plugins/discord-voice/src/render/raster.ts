import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { initWasm, Resvg } from "@resvg/resvg-wasm";

let fonts: Uint8Array[] = [];
let ready: Promise<void> | undefined;

/** Windows/macOS fonts used only as glyph fallback (emoji, symbols, CJK) when present locally. */
const SYSTEM_FALLBACK_FONTS = [
	"C:\\Windows\\Fonts\\segoeui.ttf",
	"C:\\Windows\\Fonts\\seguisym.ttf",
	"C:\\Windows\\Fonts\\seguiemj.ttf",
	"C:\\Windows\\Fonts\\YuGothR.ttc",
	"C:\\Windows\\Fonts\\malgun.ttf",
	"/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
	"/System/Library/Fonts/Apple Color Emoji.ttc",
];

/**
 * Loads the resvg WASM module and fonts. `assetDir` must contain resvg.wasm and fonts/*.ttf.
 */
export function initRaster(assetDir: string): Promise<void> {
	ready ??= (async () => {
		await initWasm(readFileSync(path.join(assetDir, "resvg.wasm")));
		const bundled = ["Inter-SemiBold.ttf", "Inter-Bold.ttf"].map((f) => path.join(assetDir, "fonts", f));
		fonts = [...bundled, ...SYSTEM_FALLBACK_FONTS]
			.filter((f) => existsSync(f))
			.map((f) => new Uint8Array(readFileSync(f)));
	})();
	return ready;
}

/** Rasterises an SVG string to a PNG data URI. */
export function svgToPngDataUri(svg: string, width = 144): string {
	const resvg = new Resvg(svg, {
		fitTo: { mode: "width", value: width },
		font: {
			fontBuffers: fonts,
			defaultFontFamily: "Inter",
			sansSerifFamily: "Inter",
			loadSystemFonts: false,
		},
	});
	const png = resvg.render().asPng();
	resvg.free();
	return `data:image/png;base64,${Buffer.from(png).toString("base64")}`;
}

export function svgToPng(svg: string, width = 144): Buffer {
	return Buffer.from(svgToPngDataUri(svg, width).split(",")[1], "base64");
}
