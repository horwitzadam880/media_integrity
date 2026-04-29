import { describe, expect, it } from "vitest";

import { AppEvent } from "#events/event-types.js";
import { State } from "#states/state-types.js";

import { idleTransducer } from "../states/idle-state.js";

describe("idle transducer", () => {
  it("should transition to initializing_page on START", () => {
    const state: State = {
      context: { user: "bob" },
      effects: [],
      status: "idle",
    };
    const event: AppEvent = { type: "START" };

    const result = idleTransducer(state, event);

    expect(result.status).toBe("initializing_page");
    expect(result.effects).toContain("setupBrowser");
    // Ensure context is preserved
    expect(result.context).toEqual({ user: "bob" });
  });

  it("should return the same state for unhandled events", () => {
    const state: State = { context: {}, effects: [], status: "idle" };

    const event: AppEvent = {
      playlists: [],
      type: "PLAYLISTS_LOADED",
    };
    // This event shouldn't do anything in idle
    const result = idleTransducer(state, event);

    expect(result).toBe(state); // Reference equality: no change
  });
});
