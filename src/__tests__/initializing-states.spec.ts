import { expect, it } from "vitest";
import { describe } from "vitest";

import { AppEvent } from "#events/event-types.js";
import { State } from "#states/state-types.js";

import { initializingPageTransducer } from "../states/initializing-state.js";

describe("initializing page transducer", () => {
  it("should transition to page_initialized on PAGE_SETUP_COMPLETE", () => {
    const state: State = {
      context: {},
      effects: ["setupBrowser"],
      status: "initializing_page",
    };

    const event: AppEvent = {
      type: "PAGE_SETUP_COMPLETE",
    };

    const result = initializingPageTransducer(state, event);

    expect(result.status).toBe("page_initialized");

    expect(result.effects).toContain("listenForPlaylistEvents");
    // Ensure context is preserved
    expect(result.context).toEqual({});
  });
});
