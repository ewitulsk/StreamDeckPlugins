import { describe, expect, it } from "vitest";
import { encodePacket, OpCode, PacketDecoder } from "../src/discord/ipc.js";

describe("IPC framing", () => {
	it("round-trips a packet", () => {
		const buf = encodePacket(OpCode.Frame, { cmd: "GET_GUILDS", nonce: "1" });
		expect(buf.readInt32LE(0)).toBe(OpCode.Frame);
		expect(buf.readInt32LE(4)).toBe(buf.length - 8);
		expect(new PacketDecoder().push(buf)).toEqual([{ op: OpCode.Frame, data: { cmd: "GET_GUILDS", nonce: "1" } }]);
	});

	it("handles packets split across chunks and coalesced chunks", () => {
		const a = encodePacket(OpCode.Frame, { n: 1, s: "héllo ✓" });
		const b = encodePacket(OpCode.Ping, { n: 2 });
		const all = Buffer.concat([a, b]);
		const d = new PacketDecoder();
		const out = [...d.push(all.subarray(0, 5)), ...d.push(all.subarray(5, a.length + 3)), ...d.push(all.subarray(a.length + 3))];
		expect(out).toEqual([
			{ op: OpCode.Frame, data: { n: 1, s: "héllo ✓" } },
			{ op: OpCode.Ping, data: { n: 2 } },
		]);
	});
});
