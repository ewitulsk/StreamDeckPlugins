// Bundles the plugin into <plugin>.sdPlugin/bin and copies runtime assets (resvg wasm, fonts).
import { context, build } from "esbuild";
import { copyFileSync, mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
/** Resolves a file inside an installed package (works with npm workspaces hoisting). */
function pkgFile(pkg, file) {
	let dir = path.dirname(require.resolve(pkg));
	while (!existsSync(path.join(dir, "package.json")) || JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")).name !== pkg) {
		const up = path.dirname(dir);
		if (up === dir) throw new Error(`Cannot locate package ${pkg}`);
		dir = up;
	}
	return path.join(dir, file);
}

const PLUGIN = "com.evanw.discordvoice.sdPlugin";
const bin = `${PLUGIN}/bin`;
mkdirSync(`${bin}/fonts`, { recursive: true });

copyFileSync(pkgFile("@resvg/resvg-wasm", "index_bg.wasm"), `${bin}/resvg.wasm`);
copyFileSync(pkgFile("@expo-google-fonts/inter", "600SemiBold/Inter_600SemiBold.ttf"), `${bin}/fonts/Inter-SemiBold.ttf`);
copyFileSync(pkgFile("@expo-google-fonts/inter", "700Bold/Inter_700Bold.ttf"), `${bin}/fonts/Inter-Bold.ttf`);

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
