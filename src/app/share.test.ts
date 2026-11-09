import { describe, expect, it } from "vitest";
import { serializeBoard, scenario } from "../board/board";
import { decodeBoardLink, encodeBoardLink } from "./share";
import { parseBoard } from "../board/board";

describe("board share links", () => {
  it("round-trips a board through gzip when CompressionStream exists", async () => {
    const text = serializeBoard(scenario("cache"));
    const token = await encodeBoardLink(text);
    expect(token.startsWith(typeof CompressionStream === "undefined" ? "v1." : "v1z.")).toBe(
      true,
    );
    expect(token.length).toBeLessThan(text.length);
    expect(parseBoard(await decodeBoardLink(token)).title).toBe("User profile API");
  });

  it("rejects a tampered or unknown token", async () => {
    await expect(decodeBoardLink("v1z.!!!!")).rejects.toThrow(/could not be opened/);
    await expect(decodeBoardLink("nope")).rejects.toThrow(/could not be opened/);
    await expect(decodeBoardLink("v1.")).rejects.toThrow(/could not be opened/);
  });

  it("accepts an uncompressed fallback token", async () => {
    const text = serializeBoard(scenario("empty"));
    const bytes = new TextEncoder().encode(text);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    const token = `v1.${btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "")}`;
    expect(parseBoard(await decodeBoardLink(`#${token}`)).nodes).toEqual([]);
  });
});
