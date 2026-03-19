import { useState, useEffect, useCallback, useRef, useSyncExternalStore } from 'react';
import { TachyoManager } from '../TachyoManager';
import type { TachyoStateEvent } from '../types';

/**
 * React Hook for Tachyo
 * 
 * Handles:
 * - Zombie child problem (mounted ref check)
 * - React concurrency (useSyncExternalStore)
 * - Context loss (proper ref management)
 * 
 * @example
 * ```typescript
 * interface UserState {
 *   name: string;
 *   age: number;
 * }
 * 
 * function MyComponent() {
 *   const { state, setState, undo, redo, canUndo, canRedo } = useTachyo<UserState>({
 *     name: 'John',
 *     age: 30
 *   });
 * 
 *   return (
 *     <div>
 *       <input value={state.name} onChange={e => setState({ name: e.target.value })} />
 *       <button onClick={undo} disabled={!canUndo}>Undo</button>
 *       <button onClick={redo} disabled={!canRedo}>Redo</button>
 *     </div>
 *   );
 * }
 * ```
 */
export function useTachyo<T extends object>(
  storeOrInitialState: TachyoManager<T> | T,
  options?: import('../types').TachyoOptions<T>
) {
  const managerRef = useRef<TachyoManager<T> | null>(null);
  const isGlobalStore = useRef(false);
  const mountedRef = useRef(false);
  const renderRef = useRef(0);
  
  if (!managerRef.current) {
    if (storeOrInitialState instanceof TachyoManager) {
      managerRef.current = storeOrInitialState;
      isGlobalStore.current = true;
    } else {
      managerRef.current = new TachyoManager(storeOrInitialState as T, options);
      isGlobalStore.current = false;
    }
  }

  const manager = managerRef.current;

  const getState = useCallback(() => manager.getState(), [manager]);

  const state = useSyncExternalStore(
    useCallback(
      (onStoreChange: () => void) => {
        mountedRef.current = true;
        renderRef.current += 1;
        const currentRender = renderRef.current;
        
        const unsubscribe = manager.subscribe((newState: T, event: TachyoStateEvent<T>) => {
          // Triple check: mounted + same render
          if (mountedRef.current && renderRef.current === currentRender) {
            onStoreChange();
          }
        });

        return () => {
          mountedRef.current = false;
          unsubscribe();
        };
      },
      [manager]
    ),
    getState,
    getState
  );

  // Track canUndo/canRedo dynamically to avoid extra renders
  const canUndo = manager.canUndo();
  const canRedo = manager.canRedo();

  const updateState = useCallback((newState: Partial<T> | T) => {
    const currentManager = managerRef.current;
    if (currentManager) {
      currentManager.setState(newState);
    }
  }, []);

  const setProperty = useCallback(<K extends keyof T>(property: K, value: T[K]) => {
    const currentManager = managerRef.current;
    if (currentManager) {
      currentManager.setProperty(property, value);
    }
  }, []);

  const undo = useCallback(() => {
    const currentManager = managerRef.current;
    if (currentManager) {
      currentManager.undo();
    }
  }, []);

  const redo = useCallback(() => {
    const currentManager = managerRef.current;
    if (currentManager) {
      currentManager.redo();
    }
  }, []);

  const reset = useCallback((newInitialState?: T) => {
    const currentManager = managerRef.current;
    if (currentManager) {
      currentManager.reset(newInitialState);
    }
  }, []);

  // Cleanup on unmount — use destroy() ONLY for locally created stores
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (!isGlobalStore.current) {
        managerRef.current?.destroy();
      }
    };
  }, []);

  return {
    state,
    setState: updateState,
    setProperty,
    undo,
    redo,
    reset,
    canUndo,
    canRedo,
    getHistory: () => manager.getHistory(),
    getHistoryIndex: () => manager.getHistoryIndex(),
    manager,
  };
}

/**
 * React Hook for subscribing to specific property changes
 * 
 * Handles zombie child problem and React concurrency
 */
export function useTachyoProperty<T extends object, K extends keyof T>(
  manager: TachyoManager<T>,
  property: K
): T[K] {
  const mountedRef = useRef(false);

  const getSnapshot = useCallback(() => manager.state[property], [manager, property]);

  // Use useSyncExternalStore for React 18 concurrency support
  const value = useSyncExternalStore(
    useCallback(
      (onStoreChange: () => void) => {
        mountedRef.current = true;
        
        const unsubscribe = manager.subscribeToProperty(property, (newValue) => {
          // Zombie child protection
          if (mountedRef.current) {
            onStoreChange();
          }
        });

        return () => {
          mountedRef.current = false;
          unsubscribe();
        };
      },
      [manager, property]
    ),
    getSnapshot,
    getSnapshot
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  return value;
}
