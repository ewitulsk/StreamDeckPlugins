import { EventEmitter } from "node:events";
import net from "node:net";

/** Discord IPC opcodes. */
export enum OpCode {
	Handshake = 0,
	Frame = 1,
	Close = 2,
	Ping = 3,
	Pong = 4,
}

export type Packet = { op: OpCode; data: unknown };

/** Encodes a packet: int32 LE opcode, int32 LE length, UTF-8 JSON body. */
export function encodePacket(op: OpCode, data: unknown): Buffer {
	const body = Buffer.from(JSON.stringify(data), "utf8");
	const header = Buffer.alloc(8);
	header.writeInt32LE(op, 0);
	header.writeInt32LE(body.length, 4);
	return Buffer.concat([header, body]);
}

/** Incrementally decodes packets from a byte stream; tolerates partial and coalesced chunks. */
export class PacketDecoder {
	private buffer: Buffer = Buffer.alloc(0);

	push(chunk: Buffer): Packet[] {
		this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
		const packets: Packet[] = [];
		while (this.buffer.length >= 8) {
			const op = this.buffer.readInt32LE(0);
			const len = this.buffer.readInt32LE(4);
			if (this.buffer.length < 8 + len) break;
			const json = this.buffer.subarray(8, 8 + len).toString("utf8");
			this.buffer = this.buffer.subarray(8 + len);
			packets.push({ op, data: JSON.parse(json) });
		}
		return packets;
	}
}

export function ipcPath(id: number): string {
	if (process.platform === "win32") return `\\\\?\\pipe\\discord-ipc-${id}`;
	const base = process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || process.env.TMP || process.env.TEMP || "/tmp";
	return `${base.replace(/\/$/, "")}/discord-ipc-${id}`;
}

function tryConnect(path: string): Promise<net.Socket> {
	return new Promise((resolve, reject) => {
		const socket = net.createConnection(path);
		const onError = (err: Error) => {
			socket.destroy();
			reject(err);
		};
		socket.once("connect", () => {
			socket.off("error", onError);
			resolve(socket);
		});
		socket.once("error", onError);
	});
}

/**
 * Raw IPC transport. Emits "packet" (Packet) and "close" (reason).
 */
export class IpcTransport extends EventEmitter {
	private socket?: net.Socket;
	private decoder = new PacketDecoder();

	async connect(): Promise<void> {
		let lastError: unknown;
		for (let i = 0; i < 10; i++) {
			try {
				this.socket = await tryConnect(ipcPath(i));
				break;
			} catch (err) {
				lastError = err;
			}
		}
		if (!this.socket) throw new Error(`Discord is not running (no IPC pipe found): ${String(lastError)}`);

		this.decoder = new PacketDecoder();
		this.socket.on("data", (chunk: Buffer) => {
			let packets: Packet[];
			try {
				packets = this.decoder.push(chunk);
			} catch (err) {
				this.close(`decode error: ${String(err)}`);
				return;
			}
			for (const packet of packets) {
				if (packet.op === OpCode.Ping) this.send(OpCode.Pong, packet.data);
				else if (packet.op === OpCode.Close) this.close(JSON.stringify(packet.data));
				else this.emit("packet", packet);
			}
		});
		this.socket.on("close", () => this.close("socket closed"));
		this.socket.on("error", (err) => this.close(String(err)));
	}

	send(op: OpCode, data: unknown): void {
		this.socket?.write(encodePacket(op, data));
	}

	close(reason = "closed"): void {
		if (!this.socket) return;
		const socket = this.socket;
		this.socket = undefined;
		socket.removeAllListeners();
		socket.on("error", () => undefined);
		socket.destroy();
		this.emit("close", reason);
	}

	get connected(): boolean {
		return !!this.socket;
	}
}
