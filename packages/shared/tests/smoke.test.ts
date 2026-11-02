import { test } from "node:test";
import assert from "node:assert/strict";
import { ChatBlockSchema } from "../src/schemas/chat-block.ts";
test("smoke", () => { assert.ok(ChatBlockSchema.safeParse({type:"text",markdown:"hi"}).success); });
