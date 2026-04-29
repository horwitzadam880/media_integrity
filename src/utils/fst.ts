import { BehaviorSubject, Observable, ReplaySubject } from "rxjs";

// 3. The handler function type
export type EffectHandler<S, E> = (
  ctx: HandlerContext<S, E>,
) => Promise<void> | void;

// 4. The map of all handlers
// We use 'string' for the keys because State["effects"] is a string array
export type EffectHandlers<S, E> = Record<string, EffectHandler<S, E>>;

export type EFST<S, E> = (state: S, event: E) => S;

// 2. The context object (now generic so it knows your specific State/Events)
export interface HandlerContext<S, E> {
  dispatch: (event: E) => void;
  event: E;
  event$: Observable<E>;
  state: S;
  state$: Observable<S>;
}

// 1. Minimum shape for State
interface BaseState {
  effects: string[];
}

export const createApp = <TState extends BaseState, TEvent>(
  initialState: TState,
  transducer: EFST<TState, TEvent>,
  effectHandlers: EffectHandlers<TState, TEvent>, // Pass the generics down
) => {
  const state$ = new BehaviorSubject<TState>(initialState);
  const event$ = new ReplaySubject<TEvent>(1); // Added 1 to fix your race concern!

  const handleEffects = (
    effects: TState["effects"],
    event: TEvent,
    currentState: TState,
  ) => {
    for (const effectName of effects) {
      const handler = effectHandlers[effectName];

      try {
        const result = handler({
          dispatch,
          event,
          event$: event$.asObservable(),
          state: currentState,
          state$: state$.asObservable(),
        });

        if (result instanceof Promise) {
          result.catch((err: unknown) => {
            console.error(`Async error in ${effectName}:`, err);
          });
        }
      } catch (err) {
        console.error(`Sync error in ${effectName}:`, err);
      }
    }
  };

  function dispatch(event: TEvent): TState {
    event$.next(event);

    const previousState = state$.getValue();
    const nextState = transducer(previousState, event);

    state$.next(nextState);

    if (nextState.effects.length) {
      handleEffects(nextState.effects, event, nextState);
    }

    return nextState;
  }

  return {
    dispatch,
    event$: event$.asObservable(),
    get state() {
      return state$.getValue();
    },
    state$: state$.asObservable(),
  };
};
