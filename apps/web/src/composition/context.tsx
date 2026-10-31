import { createContext, useContext } from 'react';
import type { CompositionRuntime } from './runtime.js';

const RuntimeContext = createContext<CompositionRuntime | null>(null);

export const CompositionRuntimeProvider = RuntimeContext.Provider;

export function useCompositionRuntime(): CompositionRuntime {
  const runtime = useContext(RuntimeContext);
  if (!runtime) throw new Error('CompositionRuntimeProvider is missing');
  return runtime;
}

export { RuntimeContext };
