import { AppEvent } from "#events/event-types.js";

import { State } from "./state-types.js";

export interface ProcessingMediaState {
  context: {
    playlists: object[];
  };
  effects: ["processMedia"];
  status: "processing_media";
}

export const processingMediaTransducer = (
  state: ProcessingMediaState,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  event: AppEvent,
): State => {
  return state;
};
