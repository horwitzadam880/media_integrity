import { IdleState } from "./idle-state.js";
import { InitializingPageState } from "./initializing-state.js";
import { PageInitializedState } from "./page-initialized-state.js";
import { ProcessingMediaState } from "./processing-media-state.js";

export type State =
  | IdleState
  | InitializingPageState
  | PageInitializedState
  | ProcessingMediaState;
