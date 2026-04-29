export type AppEvent =
  | PageSetupCompleteEvent
  | PlaylistsLoadedEvent
  | StartEvent;

export interface PageSetupCompleteEvent {
  type: "PAGE_SETUP_COMPLETE";
}

export interface PlaylistsLoadedEvent {
  playlists: object[];
  type: "PLAYLISTS_LOADED";
}

export interface StartEvent {
  type: "START";
}
