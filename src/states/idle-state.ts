import { AppEvent } from "#events/event-types.js";

import { InitializingPageState } from "./initializing-state.js";

export interface IdleState {
  context: object;
  effects: [];
  status: "idle";
}

export const idleTransducer = (
  state: IdleState,
  event: AppEvent,
): IdleState | InitializingPageState => {
  switch (event.type) {
    case "START":
      return {
        ...state,
        effects: ["setupBrowser"],
        status: "initializing_page",
      };
    default:
      return state;
  }
};
