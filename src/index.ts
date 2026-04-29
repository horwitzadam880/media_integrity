import { State } from "#states/state-types.js";
import { transducer } from "#transducer.js";
import { createApp } from "#utils/fst.js";

function main() {
  const initialState: State = {
    context: {},
    effects: [],
    status: "idle",
  };

  const program = createApp(initialState, transducer, {
    listenForPlaylistEvents: () => {
      console.log("Effect: listenForPlaylistEvents");
    },
    processMedia: () => {
      console.log("Effect: processMedia");
    },
    setupBrowser: () => {
      console.log("Effect: setupBrowser");
    },
  });

  program.dispatch({ type: "START" });
}

main();
