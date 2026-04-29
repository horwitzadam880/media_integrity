import { AppEvent } from "#events/event-types.js";

import { State } from "./state-types.js";

export interface PageInitializedState {
  context: object;
  effects: ["listenForPlaylistEvents"];
  status: "page_initialized";
}

export const pageInitializedTransducer = (
  state: PageInitializedState,
  event: AppEvent,
): State => {
  switch (event.type) {
    case "PLAYLISTS_LOADED":
      return {
        ...state,
        context: {
          ...state.context,
          playlists: event.playlists,
        },
        effects: ["processMedia"],
        status: "processing_media",
      };
    default:
      return state;
  }
};
