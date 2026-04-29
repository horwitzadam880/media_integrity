import { AppEvent } from "#events/event-types.js";
import { idleTransducer } from "#states/idle-state.js";
import { initializingPageTransducer } from "#states/initializing-state.js";
import { pageInitializedTransducer } from "#states/page-initialized-state.js";
import { State } from "#states/state-types.js";

export const transducer = (state: State, event: AppEvent): State => {
  switch (state.status) {
    case "idle":
      return idleTransducer(state, event);
    case "initializing_page":
      return initializingPageTransducer(state, event);
    case "page_initialized":
      return pageInitializedTransducer(state, event);
    default:
      return state;
  }
};
