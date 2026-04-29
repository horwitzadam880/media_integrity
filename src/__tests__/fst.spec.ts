import { describe, expect, it } from "vitest";

import { State } from "#states/state-types.js";
import { transducer } from "#transducer.js";
import { createApp } from "#utils/fst.js";

describe("createApp", () => {
  const initialState: State = {
    context: {},
    effects: [],
    status: "idle",
  };

  const effectHandlers = {
    listenForPlaylistEvents: () => {
      console.log("Effect: listenForPlaylistEvents");
    },
    setupBrowser: () => {
      console.log("Effect: setupBrowser");
    },
  };

  it("should initialize the app with the correct initial state", () => {
    const initialState: State = {
      context: {},
      effects: [],
      status: "idle",
    };

    const { state } = createApp(initialState, transducer, effectHandlers);

    expect(state).toEqual(initialState);
  });

  it("should transition to initializing_page on START event", () => {
    const initialState: State = {
      context: {},
      effects: [],
      status: "idle",
    };

    const program = createApp(initialState, transducer, effectHandlers);

    const newState = program.dispatch({ type: "START" });

    expect(newState.status).toBe("initializing_page");
    expect(newState.effects).toContain("setupBrowser");
    expect(newState.effects.length).toEqual(1);
  });

  it("should not transition on event types that are not handled in the current state", () => {
    const initialState: State = {
      context: {},
      effects: [],
      status: "idle",
    };

    const program = createApp(initialState, transducer, effectHandlers);

    const newState = program.dispatch({
      playlists: [],
      type: "PLAYLISTS_LOADED",
    });

    expect(newState).toEqual(initialState);

    const newState2 = program.dispatch({ type: "START" });

    expect(newState2.status).toBe("initializing_page");

    const newState3 = program.dispatch({
      type: "START",
    });

    expect(newState3).toEqual(newState2);
  });

  it("should not transition on unknown event types", () => {
    const initialState: State = {
      context: {},
      effects: [],
      status: "idle",
    };

    const program = createApp(initialState, transducer, effectHandlers);

    // @ts-expect-error - event type is not defined in AppEvent, but we want to test that it doesn't cause a state change
    const newState = program.dispatch({ type: "UNKNOWN_EVENT" });

    expect(newState).toEqual(initialState);
  });

  it("RxJS: late subscribers should catch the last event", () => {
    const initialState: State = {
      context: {},
      effects: [],
      status: "idle",
    };
    const program = createApp(initialState, transducer, effectHandlers);
    program.dispatch({ type: "START" });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let captured: any;
    program.event$.subscribe((e) => (captured = e));

    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect(captured.type).toBe("START"); // It "remembered" the event
  });

  it("RxJS: state$ should always provide the latest state", () => {
    const initialState: State = {
      context: {},
      effects: [],
      status: "idle",
    };
    const program = createApp(initialState, transducer, effectHandlers);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let currentState: any;
    program.state$.subscribe((s) => (currentState = s));

    expect(currentState).toEqual(initialState); // It emitted immediately
  });

  it("RxJS: event$ should be read-only", () => {
    createApp(initialState, transducer, {
      testEffect: ({ event$ }) => {
        // @ts-expect-error - testing that .next does not exist
        expect(event$.next).toBeUndefined();
      },
    });
  });
});
