/**
 * Device-agnostic layout: the top row holds controls (fitted by priority to however many
 * columns the device has), every other key shows paged content.
 */

export type GridSize = { columns: number; rows: number };

export type Control = "back" | "prev" | "next" | "page" | "mute" | "deafen" | "leave" | "exit" | "blank";

/** Number of content keys per page. Devices with a single row share it with Back. */
export function contentCapacity(size: GridSize): number {
	if (size.rows >= 2) return size.columns * (size.rows - 1);
	return Math.max(1, size.columns - 1);
}

export type ControlOptions = {
	columns: number;
	needsPaging: boolean;
	inCall: boolean;
	/** Whether the device is single-row (controls are squeezed to Back + content). */
	singleRow?: boolean;
	/** On the root screen Back already exits, so a separate Exit key is redundant. */
	atRoot?: boolean;
};

/**
 * Picks controls by priority, then lays them out left→right in a canonical order:
 * Back, ◀, Mute, Deafen, Leave, Exit, …, ▶ (next page is always the far-right key).
 */
export function planControls(o: ControlOptions): Control[] {
	if (o.singleRow) return ["back"];
	const n = o.columns;
	const wanted: Control[] = ["back"];
	if (o.needsPaging) wanted.push(...(n >= 4 ? (["prev", "next"] as Control[]) : (["page"] as Control[])));
	wanted.push("mute", "deafen");
	if (o.inCall) wanted.push("leave");
	if (!o.atRoot) wanted.push("exit");

	const chosen = new Set(wanted.slice(0, n));
	// Keep prev/next as a pair: if only one of them fits, use the cycling pager instead.
	if (chosen.has("prev") !== chosen.has("next")) {
		chosen.delete("prev");
		chosen.delete("next");
		chosen.add("page");
	}

	const order: Control[] = ["back", "prev", "page", "mute", "deafen", "leave", "exit"];
	const row: Control[] = order.filter((c) => chosen.has(c));
	while (row.length < n - (chosen.has("next") ? 1 : 0)) row.push("blank");
	if (chosen.has("next")) row.push("next");
	return row.slice(0, n);
}

export type Page<T> = { items: T[]; page: number; pages: number };

export function paginate<T>(items: T[], capacity: number, page: number): Page<T> {
	const pages = Math.max(1, Math.ceil(items.length / capacity));
	const p = Math.min(Math.max(0, page), pages - 1);
	return { items: items.slice(p * capacity, p * capacity + capacity), page: p, pages };
}

/** Maps a key coordinate to a linear slot index. */
export const slotIndex = (size: GridSize, column: number, row: number) => row * size.columns + column;

/**
 * Assigns controls + content to every slot of the grid.
 * Returns an array of length columns*rows; content entries reference items by index into `pageItems`.
 */
export type SlotAssignment = { kind: "control"; control: Control } | { kind: "content"; index: number } | { kind: "empty" };

export function assignSlots(size: GridSize, controls: Control[], contentCount: number): SlotAssignment[] {
	const total = size.columns * size.rows;
	const out: SlotAssignment[] = [];
	if (size.rows >= 2) {
		for (let c = 0; c < size.columns; c++) out.push({ kind: "control", control: controls[c] ?? "blank" });
		for (let i = 0; i < total - size.columns; i++) out.push(i < contentCount ? { kind: "content", index: i } : { kind: "empty" });
	} else {
		out.push({ kind: "control", control: controls[0] ?? "back" });
		for (let i = 0; i < total - 1; i++) out.push(i < contentCount ? { kind: "content", index: i } : { kind: "empty" });
	}
	return out;
}
