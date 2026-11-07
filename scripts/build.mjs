// Bundles the plugin into <plugin>.sdPlugin/bin and copies runtime assets (resvg wasm, fonts).
import { context, build } from "esbuild";
import { copyFileSync, mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";

const PLUGIN = "com.evanw.discordvoice.sdPlugin";
const bin = `${PLUGIN}/bin`;
mkdirSync(`${bin}/fonts`, { recursive: true });

copyFileSync("node_modules/@resvg/resvg-wasm/index_bg.wasm", `${bin}/resvg.wasm`);
copyFileSync("node_modules/@expo-google-fonts/inter/600SemiBold/Inter_600SemiBold.ttf", `${bin}/fonts/Inter-SemiBold.ttf`);
copyFileSync("node_modules/@expo-google-fonts/inter/700Bold/Inter_700Bold.ttf", `${bin}/fonts/Inter-Bold.ttf`);

// Dev convenience: seed credentials from .env (bin/ is gitignored). The settings UI overrides these.
if (existsSync(".env")) {
	const env = Object.fromEntries(
		readFileSync(".env", "utf8")
			.split(/\r?\n/)
			.filter((l) => l.includes("=") && !l.startsWith("#"))
			.map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
	);
	writeFileSync(
		`${bin}/dev-credentials.json`,
		JSON.stringify({ clientId: env.DISCORD_CLIENT_ID, clientSecret: env.DISCORD_CLIENT_SECRET, redirectUri: env.DISCORD_REDIRECT_URI }),
	);
}

const options = {
	entryPoints: ["src/plugin.ts"],
	bundle: true,
	platform: "node",
	target: "node24",
	format: "esm",
	outfile: `${bin}/plugin.js`,
	sourcemap: "linked",
	banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
	logLevel: "info",
};

if (process.argv.includes("--watch")) {
	const ctx = await context(options);
	await ctx.watch();
} else {
	await build(options);
}
