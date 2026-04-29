import { AppEvent } from "#events/event-types.js";

import { PageInitializedState } from "./page-initialized-state.js";

export interface InitializingPageState {
  context: object;
  effects: ["setupBrowser"];
  status: "initializing_page";
}

export const initializingPageTransducer = (
  state: InitializingPageState,
  event: AppEvent,
): InitializingPageState | PageInitializedState => {
  switch (event.type) {
    case "PAGE_SETUP_COMPLETE":
      return {
        ...state,
        effects: ["listenForPlaylistEvents"],
        status: "page_initialized",
      };
    default:
      return state;
  }
};
