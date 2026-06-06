import { describe, expect, it } from "vitest";
import { Engine } from "../src/engine/engine.js";
import { defaultRegistry } from "../src/engine/bots/registry.js";
import { tinyScenario } from "./helpers.js";

function digest(seed: number): string {
  const config = { ...tinyScenario(4, 6), turns: 10 };
  const metrics = new Engine(config, seed, defaultRegistry()).run();
  return JSON.stringify(metrics);
}

describe("determinism", () => {
  it("replays identically for the same seed", () => {
    expect(digest(42)).toBe(digest(42));
  });

  it("diverges across different seeds", () => {
    expect(digest(1)).not.toBe(digest(2));
  });
});
