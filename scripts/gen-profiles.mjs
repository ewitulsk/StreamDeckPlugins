// Generates the bundled dynamic profiles: every key is a Slot action the plugin draws at runtime.
// Uses the legacy (v1) .streamDeckProfile layout that Stream Deck accepts for plugin-bundled profiles.
import { mkdirSync, writeFileSync } from "node:fs";
import { crc32 } from "node:zlib";
import { createHash } from "node:crypto";

const PLUGIN_UUID = "com.evanw.discordvoice";
const OUT = "com.evanw.discordvoice.sdPlugin/profiles";

/** name, device model, columns, rows */
const DEVICES = [
	["Discord Voice", "20GBA9901", 5, 3],
	["Discord Voice Mini", "20GAI9901", 3, 2],
	["Discord Voice XL", "20GAT9901", 8, 4],
	["Discord Voice Plus", "20GBD9901", 4, 2],
	["Discord Voice Neo", "20GBJ9901", 4, 2],
];

const state = () => ({
	FFamily: "",
	FSize: "",
	FStyle: "",
	FUnderline: "",
	Image: "",
	Title: "",
	TitleAlignment: "",
	TitleColor: "",
	TitleShow: "",
});

/** Minimal ZIP writer (stored, no compression). */
function zip(files) {
	const locals = [];
	const centrals = [];
	let offset = 0;
	for (const { name, data } of files) {
		const nameBuf = Buffer.from(name, "utf8");
		const crc = crc32(data);
		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(20, 4);
		local.writeUInt16LE(0x0800, 6); // UTF-8 names
		local.writeUInt16LE(0, 8);
		local.writeUInt32LE(0, 10);
		local.writeUInt32LE(crc, 14);
		local.writeUInt32LE(data.length, 18);
		local.writeUInt32LE(data.length, 22);
		local.writeUInt16LE(nameBuf.length, 26);
		local.writeUInt16LE(0, 28);
		locals.push(local, nameBuf, data);

		const central = Buffer.alloc(46);
		central.writeUInt32LE(0x02014b50, 0);
		central.writeUInt16LE(20, 4);
		central.writeUInt16LE(20, 6);
		central.writeUInt16LE(0x0800, 8);
		central.writeUInt16LE(0, 10);
		central.writeUInt32LE(0, 12);
		central.writeUInt32LE(crc, 16);
		central.writeUInt32LE(data.length, 20);
		central.writeUInt32LE(data.length, 24);
		central.writeUInt16LE(nameBuf.length, 28);
		central.writeUInt32LE(name.endsWith("/") ? 0x10 : 0, 38);
		central.writeUInt32LE(offset, 42);
		centrals.push(central, nameBuf);
		offset += 30 + nameBuf.length + data.length;
	}
	const cdSize = centrals.reduce((n, b) => n + b.length, 0);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(files.length, 8);
	end.writeUInt16LE(files.length, 10);
	end.writeUInt32LE(cdSize, 12);
	end.writeUInt32LE(offset, 16);
	return Buffer.concat([...locals, ...centrals, end]);
}

mkdirSync(OUT, { recursive: true });
for (const [name, model, columns, rows] of DEVICES) {
	const actions = {};
	for (let c = 0; c < columns; c++) {
		for (let r = 0; r < rows; r++) {
			actions[`${c},${r}`] = { Name: "Discord Voice Slot", Settings: {}, State: 0, States: [state()], UUID: `${PLUGIN_UUID}.slot` };
		}
	}
	const manifest = {
		Actions: actions,
		DeviceModel: model,
		DeviceUUID: "",
		Name: name,
		Version: "1.0",
	};
	if (name.endsWith("Plus")) {
		// Dials below the keys (encoder positions are "column,0" in the Encoder controller).
		manifest.Encoders = Object.fromEntries(
			Array.from({ length: 4 }, (_, i) => [`${i},0`, { Name: "Discord Voice Dial", Settings: {}, State: 0, States: [state()], UUID: `${PLUGIN_UUID}.dial` }]),
		);
	}
	// Deterministic folder id so regenerating doesn't churn the files.
	const h = createHash("md5").update(`${PLUGIN_UUID}/${name}`).digest("hex").toUpperCase();
	const dir = `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}.sdProfile`;
	const data = zip([
		{ name: `${dir}/`, data: Buffer.alloc(0) },
		{ name: `${dir}/manifest.json`, data: Buffer.from(JSON.stringify(manifest)) },
	]);
	writeFileSync(`${OUT}/${name}.streamDeckProfile`, data);
	console.log(`wrote ${OUT}/${name}.streamDeckProfile (${columns}x${rows})`);
}
