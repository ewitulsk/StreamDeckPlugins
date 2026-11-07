import { describe, expect, it } from "vitest";
import { assignSlots, contentCapacity, paginate, planControls } from "../src/ui/layout.js";

describe("planControls", () => {
	it("5-wide, no paging, not in call", () => {
		expect(planControls({ columns: 5, needsPaging: false, inCall: false })).toEqual(["back", "mute", "deafen", "exit", "blank"]);
	});

	it("5-wide, paging, in call: next page is far right", () => {
		expect(planControls({ columns: 5, needsPaging: true, inCall: true })).toEqual(["back", "prev", "mute", "deafen", "next"]);
	});

	it("5-wide, in call without paging shows leave", () => {
		expect(planControls({ columns: 5, needsPaging: false, inCall: true })).toEqual(["back", "mute", "deafen", "leave", "exit"]);
	});

	it("3-wide (Mini) uses a single cycling pager", () => {
		expect(planControls({ columns: 3, needsPaging: true, inCall: true })).toEqual(["back", "page", "mute"]);
		expect(planControls({ columns: 3, needsPaging: false, inCall: true })).toEqual(["back", "mute", "deafen"]);
	});

	it("8-wide (XL) fits everything", () => {
		expect(planControls({ columns: 8, needsPaging: true, inCall: true })).toEqual(["back", "prev", "mute", "deafen", "leave", "exit", "blank", "next"]);
	});

	it("4-wide keeps prev/next paired", () => {
		expect(planControls({ columns: 4, needsPaging: true, inCall: true })).toEqual(["back", "prev", "mute", "next"]);
	});

	it("omits Exit on the root screen (Back exits there)", () => {
		expect(planControls({ columns: 5, needsPaging: false, inCall: false, atRoot: true })).toEqual(["back", "mute", "deafen", "blank", "blank"]);
	});

	it("single-row devices only get back", () => {
		expect(planControls({ columns: 4, needsPaging: true, inCall: true, singleRow: true })).toEqual(["back"]);
	});
});

describe("paginate / capacity", () => {
	it("computes capacity from grid", () => {
		expect(contentCapacity({ columns: 5, rows: 3 })).toBe(10);
		expect(contentCapacity({ columns: 8, rows: 4 })).toBe(24);
		expect(contentCapacity({ columns: 3, rows: 2 })).toBe(3);
	});

	it("clamps pages", () => {
		const items = Array.from({ length: 23 }, (_, i) => i);
		expect(paginate(items, 10, 0)).toEqual({ items: items.slice(0, 10), page: 0, pages: 3 });
		expect(paginate(items, 10, 9).page).toBe(2);
		expect(paginate(items, 10, 2).items).toEqual([20, 21, 22]);
		expect(paginate([], 10, 0)).toEqual({ items: [], page: 0, pages: 1 });
	});

	it("assigns controls to the top row and content below", () => {
		const slots = assignSlots({ columns: 5, rows: 3 }, ["back", "mute", "deafen", "exit", "blank"], 3);
		expect(slots).toHaveLength(15);
		expect(slots[0]).toEqual({ kind: "control", control: "back" });
		expect(slots[5]).toEqual({ kind: "content", index: 0 });
		expect(slots[7]).toEqual({ kind: "content", index: 2 });
		expect(slots[8]).toEqual({ kind: "empty" });
	});
});

import { initials, textWidth } from "../src/render/keys.js";

describe("text cleanup", () => {
	it("builds initials from stylised names", () => {
		expect(initials("Ṫ̸̓F̴̔̌O̸͂͗Ẇ̴̅Ȁ̷͒")).toBe("Ṫ");
		expect(initials("Crypto Thing")).toBe("CT");
	});
	it("gives combining marks zero width", () => {
		expect(textWidth("é", 10)).toBe(textWidth("e", 10));
	});
});
