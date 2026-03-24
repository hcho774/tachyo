// Types are always imported (no impact on bundle size)
import { SimpleEventEmitter } from './utils/EventEmitter';
import type {
  TachyoOptions,
  TachyoStateEvent,
  HistoryEntry,
  SnapshotMetadata,
  TachyoSubscription,
  PropertyChangeCallback,
  ActionContext,
  Middleware,
  AsyncAction,
  TachyoUpdateMetadata,
} from './types';

// Type imports (not included in bundle)
import type { AsyncActionState } from './utils/asyncTracker';
import type { ChangePath } from './utils/changeTracker';
import { devTools } from './utils/devtools';

// Type definitions for conditional imports
type DeepEqualFn = <T>(a: T, b: T) => boolean;
type CalculateChangePathFn = <T extends object>(
  previous: T,
  current: T,
  path?: string[]
) => ChangePath[];
type FormatChangePathFn = (changes: ChangePath[]) => string[];
type GetStackTraceFn = () => string | undefined;
type GetCallerNameFn = () => string | undefined;

// Type-safe module loader interfaces
interface UtilsModule {
  deepEqual: DeepEqualFn;
}

interface ChangeTrackerModule {
  calculateChangePath: CalculateChangePathFn;
  formatChangePath: FormatChangePathFn;
  getStackTrace: GetStackTraceFn;
  getCallerName: GetCallerNameFn;
}

interface AsyncTrackerModule {
  AsyncActionTracker: new () => {
    start(actionContext: ActionContext, initialState: unknown): string;
    success(asyncId: string, result: unknown, finalState: unknown): void;
    error(asyncId: string, error: Error, finalState: unknown): void;
    getActiveActions(): ReadonlyArray<AsyncActionState>;
    getCompletedActions(): ReadonlyArray<AsyncActionState>;
    clear(): void;
  };
}

// Type-safe runtime cache
let deepEqualImpl: DeepEqualFn | null = null;
let changeTrackerImpl: ChangeTrackerModule | null = null;
let asyncTrackerImpl: AsyncTrackerModule | null = null;

/**
 * Fast-path bitmask flags (Bitwise Operations)
 * Used to avoid multi-property evaluation in hot paths.
 */
const FLAG_SUBSCRIBERS       = 1 << 0;  // 1
const FLAG_PROP_SUBSCRIBERS  = 1 << 1;  // 2
const FLAG_DEVTOOLS          = 1 << 2;  // 4
const FLAG_CHANGE_TRACKING   = 1 << 3;  // 8
const FLAG_HISTORY           = 1 << 4;  // 16
const FLAG_DEEP_EQUALITY     = 1 << 5;  // 32
const FLAG_MIDDLEWARE        = 1 << 6;  // 64
const FLAG_ASYNC_TRACKING    = 1 << 7;  // 128

/**
 * Tachyo - Type-safe state management with undo/redo and event tracking
 */
export class TachyoManager<T extends object> extends SimpleEventEmitter {
  private _state: T;
  private _history: HistoryEntry<T>[] = [];
  private _historyIndex: number = -1;
  private _options: Required<TachyoOptions<T>>;
  private _subscriptions: TachyoSubscription<T>[] = [];
  private _propertySubscriptions: Record<string, PropertyChangeCallback<unknown>[]> = {};
  private _propertySubscriberCount: number = 0;
  private _middleware: Middleware<T>[] = [];
  private _asyncActions: Map<string, AsyncAction<T>> = new Map();
  private _asyncTracker: InstanceType<NonNullable<AsyncTrackerModule['AsyncActionTracker']>> | null = null;
  private _actionChain: ActionContext[] = [];
  private _actionCounter: number = 0;
  private _devToolsEnabled: boolean = true; // Enable by default
  private _devToolsAvailable: boolean = false; // Cached DevTools availability
  private _fastPathFlags: number = 0; // Bitmask for zero-overhead hot paths

  /**
   * Create a new TachyoManager instance
   * @param initialState - Initial state object
   * @param options - Configuration options for TachyoManager
   * @example
   * typescript
   * const manager = new TachyoManager({ count: 0 }, {
   *   maxHistorySize: 100,
   *   enableChangePathTracking: true
   * });
   *    */
  constructor(initialState: T, options: TachyoOptions<T> = {}) {
    super();

    // Type-safe conditional loading
    if (options.enableDeepEquality !== false) {
      if (!deepEqualImpl) {
        const utils = require('./utils/deepEqual') as UtilsModule;
        deepEqualImpl = utils.deepEqual;
      }
    }

    if (options.enableChangePathTracking !== false) {
      if (!changeTrackerImpl) {
        changeTrackerImpl = require('./utils/changeTracker') as ChangeTrackerModule;
      }
    }

    if (options.enableAsyncTracking !== false) {
      if (!asyncTrackerImpl) {
        asyncTrackerImpl = require('./utils/asyncTracker') as AsyncTrackerModule;
      }
    }

    // Type-safe default function
    const defaultEqualityFn: DeepEqualFn = deepEqualImpl || ((a, b) => a === b);

    this._options = {
      maxHistorySize: options.maxHistorySize ?? 50,
      enableDeepEquality: options.enableDeepEquality ?? false, // Changed: false by default for performance
      autoSnapshot: options.autoSnapshot ?? false, // Changed: false by default for performance
      equalityFn: options.equalityFn ?? defaultEqualityFn,
      enableChangePathTracking: options.enableChangePathTracking ?? false, // Changed: false by default
      enableAsyncTracking: options.enableAsyncTracking ?? true,
      enableStackTrace: options.enableStackTrace ?? false,
      middleware: options.middleware ?? [],
      enableDevTools: options.enableDevTools ?? false,
      enableTachyoExtension: options.enableTachyoExtension ?? false,
    };

    let flags = 0;
    if (this._options.enableChangePathTracking) flags |= FLAG_CHANGE_TRACKING;
    if (this._options.autoSnapshot) flags |= FLAG_HISTORY;
    if (this._options.enableDeepEquality) flags |= FLAG_DEEP_EQUALITY;
    if (this._options.middleware && this._options.middleware.length > 0) flags |= FLAG_MIDDLEWARE;
    this._fastPathFlags = flags;

    this._middleware = [...this._options.middleware] as Middleware<T>[];
    
    // Type-safe initialization
    if (this._options.enableAsyncTracking && asyncTrackerImpl) {
      this._asyncTracker = new asyncTrackerImpl.AsyncActionTracker();
    }
    
    this._state = { ...initialState } as T;
    
    if (this._options.autoSnapshot) {
      this.createHistoryEntry('initial');
    }

    // Initialize DevTools if available (browser only) - cache availability
    if (this._devToolsEnabled && typeof globalThis !== 'undefined' && (globalThis as Record<string, unknown>)['window']) {
      this._devToolsAvailable = devTools.isAvailable();
      if (this._devToolsAvailable) {
        this._fastPathFlags |= FLAG_DEVTOOLS;
        devTools.send('@@INIT', { ...this._state });
      }
    }

    // Initialize custom Tachyo Chrome Extension bridge (Zero-overhead native window.postMessage)
    if (this._options.enableTachyoExtension && typeof window !== 'undefined') {
      // 1. Send Initial Connection Payload
      window.postMessage({
        source: 'tachyo-extension-bridge',
        type: 'TACHYO_INIT',
        payload: { state: this._state, timestamp: Date.now() }
      }, '*');

      // 2. Automatically listen to every engine tick and broadcast diffs
      this.subscribe((state, event) => {
        window.postMessage({
          source: 'tachyo-extension-bridge',
          type: 'TACHYO_STATE_UPDATE',
          payload: {
            action: event.actionContext?.name || event.changeType,
            description: event.actionContext?.metadata?.description,
            currentState: event.currentState,
            previousState: event.previousState,
            changeType: event.changeType,
            changePaths: event.changePath || [], // The exact JSON Diff Payload!
            timestamp: Date.now()
          }
        }, '*');
      });
    }
  }

  /**
   * Get current state
   */
  public get state(): T {
    return this._state;
  }

  /**
   * Get current state
   * Returns a direct reference to state (matching Zustand / Redux pattern).
   * Vital for React useSyncExternalStore reference equality requirements.
   */
  public getState(): T {
    return this._state;
  }

  /**
   * Set state (partial update supported)
   * @param newState - New state or partial state update
   * @param metadata - Optional metadata for this change
   * @example
   * ```typescript
   * // Simple update
   * store.setState({ count: 1 });
   * 
   * // With action name
   * store.setState({ step: 1 }, { action: 'loadData' });
   * 
   * // With action and description
   * store.setState({ step: 2 }, { action: 'validateForm', description: 'Validating user input' });
   * ```
   */
  public setState(
    newState: Partial<T> | T,
    metadata?: TachyoUpdateMetadata
  ): void {
    const flags = this._fastPathFlags;

    // Ultra-fast bitmask path: Single integer check instead of 8 property queries
    if (flags === 0 && !metadata) {
      this._state = Object.assign({}, this._state, newState) as T;
      return;
    }

    // Apply middleware
    if ((flags & FLAG_MIDDLEWARE) !== 0) {
      const actionContext = this.createActionContext(
        metadata?.action || 'setState',
        metadata?.description
      );
      this.applyMiddleware(newState, actionContext);
      return; // Middleware handles the update
    }

    // Standard path
    const actionContext = this.createActionContext(
      metadata?.action || 'setState',
      metadata?.description
    );

    this._applyStateUpdate(newState, actionContext);
  }

  /**
   * Internal method to apply state update
   * Optimized: Fast path for common cases, minimal overhead
   */
  private _applyStateUpdate(
    newState: Partial<T> | T,
    actionContext: ActionContext
  ): void {
    const flags = this._fastPathFlags;

    // Ultra-fast path bypass (when metadata forced us here but no active listeners/features)
    if (flags === 0) {
      this._state = Object.assign({}, this._state, newState) as T;
      return;
    }

    // Pre-compute all flags once from bitmask for fast evaluation
    const subscriberCount = this._subscriptions.length;
    const hasSubscribers = (flags & FLAG_SUBSCRIBERS) !== 0;
    const hasPropertySubscribers = (flags & FLAG_PROP_SUBSCRIBERS) !== 0;
    const needsDevTools = (flags & FLAG_DEVTOOLS) !== 0;
    const needsChangeTracking = (flags & FLAG_CHANGE_TRACKING) !== 0 && changeTrackerImpl;
    const needsHistory = (flags & FLAG_HISTORY) !== 0;
    const needsDeepEquality = (flags & FLAG_DEEP_EQUALITY) !== 0;
    
    // Standard path: Check equality if enabled
    // Object.assign provides slightly better ops/sec than spread in modern V8
    const updatedState = Object.assign({}, this._state, newState) as T;
    
    if (needsDeepEquality) {
      // Quick reference check first
      if (this._state === updatedState) {
        return;
      }
      // Deep equality check
      if (this._options.equalityFn(this._state, updatedState)) {
        return;
      }
    }

    // Only create previousState snapshot if actually needed
    // Use direct reference internally — getState() is the public defensive copy
    const previousState: T = (needsChangeTracking || hasSubscribers || needsDevTools)
      ? Object.assign({}, this._state) as T
      : this._state;

    this._state = updatedState;

    // Calculate change paths only if enabled
    let changePaths: ChangePath[] = [];
    let formattedPaths: string[] = [];
    if (needsChangeTracking) {
      changePaths = changeTrackerImpl!.calculateChangePath(previousState, this._state);
      formattedPaths = changeTrackerImpl!.formatChangePath(changePaths);
    }

    // Create history entry only if enabled
    if (needsHistory) {
      this.createHistoryEntry(actionContext.name, actionContext.metadata?.['description'] as string | undefined);
    }

    // Only create snapshots and events if there are subscribers or devtools
    if (hasSubscribers || needsDevTools) {
      // Create snapshot only once, reuse for all purposes
      const currentStateSnapshot = Object.assign({}, this._state) as T;
      
      // Send to DevTools only if enabled and available
      if (needsDevTools) {
        devTools.send(
          actionContext.name || 'setState',
          currentStateSnapshot,
          {
            previousState,
            changePath: formattedPaths,
            actionContext,
          }
        );
      }

      if (hasSubscribers) {
        // Ultra-optimized: Single subscriber path (most common case in benchmarks)
        if (subscriberCount === 1) {
          const callback = this._subscriptions[0];
          if (callback) {
            // Create event object inline (faster than separate variable)
            callback(currentStateSnapshot, {
              previousState,
              currentState: currentStateSnapshot,
              changeType: 'update',
              actionContext,
              changePath: formattedPaths,
            } as TachyoStateEvent<T>);
            // Skip emitStateChange for single subscriber (most don't use EventEmitter)
          }
        } else {
          // Multiple subscribers: create event once, reuse
          const event: TachyoStateEvent<T> = {
            previousState,
            currentState: currentStateSnapshot,
            changeType: 'update',
            actionContext,
            changePath: formattedPaths,
          };
          
          // Direct loop iteration (fastest cache-friendly path)
          for (let i = 0; i < subscriberCount; i++) {
            this._subscriptions[i](currentStateSnapshot, event);
          }
          
          // Emit EventEmitter events only if needed
          this.emitTachyoStateChange(event);
        }
      }
    }
    
    // Notify property subscribers if any
    if (hasPropertySubscribers) {
      // Avoid Object.entries() to prevent tuple allocations
      const hasOwn = Object.prototype.hasOwnProperty;
      for (const key in newState) {
        if (!hasOwn.call(newState, key)) continue;
        
        const callbacks = this._propertySubscriptions[key];
        if (callbacks && callbacks.length > 0) {
          const value = newState[key as keyof typeof newState];
          const previousValue = (previousState as Record<string, unknown>)[key];
          if (previousValue !== value) {
            for (let i = 0; i < callbacks.length; i++) {
              callbacks[i](value, previousValue, key);
            }
          }
        }
      }
    }
  }

  /**
   * Update a specific property
   * @param property - Property name
   * @param value - New value
   * @param metadata - Optional metadata
   */
  public setProperty<K extends keyof T>(
    property: K,
    value: T[K],
    metadata?: Omit<SnapshotMetadata, 'timestamp'>
  ): void {
    // Delegate to the optimized _applyStateUpdate path
    // This avoids the double snapshot + double notification of the old code
    this.setState(
      { [property]: value } as unknown as Partial<T>,
      {
        action: metadata?.action,
        description: metadata?.description,
      }
    );
  }

  /**
   * Reset state to initial state or first history entry
   * @param initialState - Optional new initial state. If not provided, resets to first history entry
   */
  public reset(initialState?: T): void {
    const previousState = { ...this._state } as T;
    
    if (initialState) {
      this._state = { ...initialState } as T;
    } else {
      // Reset to first history entry if available
      if (this._history.length > 0) {
        this._state = { ...this._history[0].state } as T;
      }
    }

    this._history = [];
    this._historyIndex = -1;

    if (this._options.autoSnapshot) {
      this.createHistoryEntry('reset');
    }

    const event: TachyoStateEvent<T> = {
      previousState,
      currentState: { ...this._state } as T,
      changeType: 'reset',
    };

    this.emitTachyoStateChange(event);
    this.notifySubscribers(event);
  }

  /**
   * Undo last state change
   * @returns true if undo was successful, false if no history
   */
  public undo(): boolean {
    if (this._historyIndex <= 0) {
      return false;
    }

    this._historyIndex--;
    const previousState = this._state;
    this._state = { ...this._history[this._historyIndex].state } as T;

    const currentSnapshot = { ...this._state } as T;
    const event: TachyoStateEvent<T> = {
      previousState,
      currentState: currentSnapshot,
      changeType: 'undo',
    };

    // Send to DevTools — use cached availability flag
    if (this._devToolsAvailable) {
      devTools.send('UNDO', currentSnapshot);
    }

    this.emitTachyoStateChange(event);
    this.notifySubscribers(event);
    return true;
  }

  /**
   * Redo last undone state change
   * @returns true if redo was successful, false if no future history
   */
  public redo(): boolean {
    if (this._historyIndex >= this._history.length - 1) {
      return false;
    }

    this._historyIndex++;
    const previousState = this._state;
    this._state = { ...this._history[this._historyIndex].state } as T;

    const currentSnapshot = { ...this._state } as T;
    const event: TachyoStateEvent<T> = {
      previousState,
      currentState: currentSnapshot,
      changeType: 'redo',
    };

    // Send to DevTools — use cached availability flag
    if (this._devToolsAvailable) {
      devTools.send('REDO', currentSnapshot);
    }

    this.emitTachyoStateChange(event);
    this.notifySubscribers(event);
    return true;
  }

  /**
   * Check if undo is available
   */
  public canUndo(): boolean {
    return this._historyIndex > 0;
  }

  /**
   * Check if redo is available
   */
  public canRedo(): boolean {
    return this._historyIndex < this._history.length - 1;
  }

  /**
   * Get history entries
   */
  public getHistory(): ReadonlyArray<HistoryEntry<T>> {
    return this._history.slice();
  }

  /**
   * Get current history index
   */
  public getHistoryIndex(): number {
    return this._historyIndex;
  }

  /**
   * Subscribe to state changes
   * @param callback - Callback function
   * @returns Unsubscribe function
   */
  public subscribe(callback: TachyoSubscription<T>): () => void {
    if (this._subscriptions.indexOf(callback) === -1) {
      this._subscriptions.push(callback);
      if (this._subscriptions.length === 1) {
        this._fastPathFlags |= FLAG_SUBSCRIBERS;
      }
    }
    return () => {
      const idx = this._subscriptions.indexOf(callback);
      if (idx !== -1) {
        this._subscriptions.splice(idx, 1);
        if (this._subscriptions.length === 0) {
          this._fastPathFlags &= ~FLAG_SUBSCRIBERS;
        }
      }
    };
  }

  /**
   * Subscribe to specific property changes
   * @param property - Property name
   * @param callback - Callback function
   * @returns Unsubscribe function
   */
  public subscribeToProperty<K extends keyof T>(
    property: K,
    callback: PropertyChangeCallback<T[K]>
  ): () => void {
    const propKey = property as string;
    if (!this._propertySubscriptions[propKey]) {
      this._propertySubscriptions[propKey] = [];
    }
    const bucket = this._propertySubscriptions[propKey];
    if (bucket.indexOf(callback as unknown as PropertyChangeCallback<unknown>) === -1) {
      bucket.push(callback as unknown as PropertyChangeCallback<unknown>);
      if (this._propertySubscriberCount === 0) {
        this._fastPathFlags |= FLAG_PROP_SUBSCRIBERS;
      }
      this._propertySubscriberCount++;
    }
    
    return () => {
      const callbacks = this._propertySubscriptions[propKey];
      if (callbacks) {
        const idx = callbacks.indexOf(callback as unknown as PropertyChangeCallback<unknown>);
        if (idx !== -1) {
          callbacks.splice(idx, 1);
          this._propertySubscriberCount--;
          if (this._propertySubscriberCount === 0) {
            this._fastPathFlags &= ~FLAG_PROP_SUBSCRIBERS;
          }
          if (callbacks.length === 0) {
            delete this._propertySubscriptions[propKey];
          }
        }
      }
    };
  }

  /**
   * Deep copy (only for history entries)
   * Uses native structuredClone when available (20x faster than JSON round-trip).
   */
  private createDeepSnapshot(state: T): T {
    if (typeof structuredClone !== 'undefined') {
      return structuredClone(state);
    }
    // Only use JSON for deep copy when absolutely necessary
    try {
      return JSON.parse(JSON.stringify(state)) as T;
    } catch (e) {
      // Fallback to shallow copy if JSON fails
      return { ...state } as T;
    }
  }

  /**
   * Create a history entry
   * Optimized: Use deep snapshot only for history
   */
  private createHistoryEntry(action?: string, description?: string): void {
    const entry: HistoryEntry<T> = {
      state: this.createDeepSnapshot(this._state), // Deep copy for history
      metadata: {
        timestamp: Date.now(),
        action,
        description,
      },
    };

    // Remove future history if we're not at the end
    if (this._historyIndex < this._history.length - 1) {
      this._history.length = this._historyIndex + 1;
    }

    // Add new entry
    this._history.push(entry);
    this._historyIndex = this._history.length - 1;

    // Limit history size while always preserving history[0] as the initial-state anchor.
    // splice(1, excess) skips index 0 so the original snapshot is never deleted,
    // guaranteeing that undo() can always reach the very first state.
    if (this._history.length > this._options.maxHistorySize) {
      const excess = this._history.length - this._options.maxHistorySize;
      this._history.splice(1, excess);
      this._historyIndex = Math.max(0, this._historyIndex - excess);
    }
  }

  /**
   * Emit state change event
   * Optimized: Only emit if there are listeners (checked by SimpleEventEmitter.emit)
   */
  private emitTachyoStateChange(event: TachyoStateEvent<T>): void {
    this.emit('state:changed', event);
    this.emit('state:update', event.currentState, event);
  }

  /**
   * Notify subscribers
   * Optimized: Reuse snapshot from event instead of creating new ones
   */
  private notifySubscribers(event: TachyoStateEvent<T>): void {
    const len = this._subscriptions.length;
    if (len === 0) return;
    // Reuse the snapshot from event to avoid creating multiple copies
    const stateSnapshot = event.currentState;
    for (let i = 0; i < len; i++) {
      this._subscriptions[i](stateSnapshot, event);
    }
  }

  /**
   * Notify property-specific subscribers
   */
  private notifyPropertySubscribers<K extends keyof T>(
    property: string,
    value: T[K],
    previousValue: T[K]
  ): void {
    const callbacks = this._propertySubscriptions[property];
    if (callbacks) {
      for (let i = 0; i < callbacks.length; i++) {
        callbacks[i](value as unknown, previousValue as unknown, property);
      }
    }
  }

  /**
   * Register async action (Problem #2: Difficult Async Flow Debugging)
   * @param action - Async action definition
   */
  public registerAsyncAction<R = unknown, Args extends unknown[] = unknown[]>(action: AsyncAction<T, R, Args>): void {
    this._asyncActions.set(action.name, action as AsyncAction<T>);
  }

  /**
   * Execute async action with full tracking (Problem #2: Difficult Async Flow Debugging)
   * @param actionName - Name of registered async action
   * @param args - Arguments to pass to handler
   */
  public async dispatchAsync<R = unknown, Args extends unknown[] = unknown[]>(
    actionName: string,
    ...args: Args
  ): Promise<R> {
    const action = this._asyncActions.get(actionName);
    if (!action) {
      throw new Error(`Async action "${actionName}" not found`);
    }

    // Execute without tracking if asyncTracker is not available
    if (!this._options.enableAsyncTracking || !this._asyncTracker) {
      return await action.handler(this.getState(), ...args) as R;
    }

    // Create action context
    const actionContext = this.createActionContext(actionName);
    const asyncId = this._asyncTracker.start(actionContext, this._state);

    // Execute without tracking if asyncId is not available (defensive programming)
    if (!asyncId) {
      console.warn('Async tracking failed, executing without tracking');
      return await action.handler(this.getState(), ...args) as R;
    }

    try {
      // Apply onStart state if provided
      if (action.onStart) {
        const startState = action.onStart(this.getState(), ...args);
        this._applyStateUpdate(startState, {
          ...actionContext,
          asyncId,
          name: `${actionName}_start`,
        });
      }

      // Execute async handler
      const result = await action.handler(this.getState(), ...args);

      // Apply onSuccess state if provided
      if (action.onSuccess) {
        const successState = action.onSuccess(this.getState(), result, ...args);
        this._applyStateUpdate(successState, {
          ...actionContext,
          asyncId,
          name: `${actionName}_success`,
        });
      }

      // Track success - asyncId is now guaranteed to be string
      if (asyncId) {
        this._asyncTracker.success(asyncId, result, this._state);
      }
      return result as R;
    } catch (error) {
      // Apply onError state if provided
      if (action.onError) {
        const errorState = action.onError(this.getState(), error as Error, ...args);
        this._applyStateUpdate(errorState, {
          ...actionContext,
          asyncId,
          name: `${actionName}_error`,
        });
      }

      // Track error - asyncId is now guaranteed to be string
      if (asyncId) {
        this._asyncTracker.error(asyncId, error as Error, this._state);
      }
      throw error;
    }
  }

  /**
   * Add middleware (Problem #3: Different Patterns Per Team)
   * @param middleware - Middleware function
   */
  public use(middleware: Middleware<T>): void {
    this._middleware.push(middleware);
    this._fastPathFlags |= FLAG_MIDDLEWARE;
  }

  /**
   * Remove middleware
   * @param middleware - Middleware function to remove
   */
  public removeMiddleware(middleware: Middleware<T>): void {
    const index = this._middleware.indexOf(middleware);
    if (index > -1) {
      this._middleware.splice(index, 1);
      if (this._middleware.length === 0) {
        this._fastPathFlags &= ~FLAG_MIDDLEWARE;
      }
    }
  }

  /**
   * Apply middleware chain
   */
  private applyMiddleware(
    newState: Partial<T> | T,
    actionContext: ActionContext
  ): void {
    let index = 0;
    const next = (updatedState: Partial<T> | T) => {
      if (index < this._middleware.length) {
        const middleware = this._middleware[index++];
        const result = middleware(updatedState as T, next, actionContext);
        if (result instanceof Promise) {
          result.catch(error => {
            this.emit('middleware:error', { error, actionContext });
          });
        }
      } else {
        // All middleware processed, apply final update
        this._applyStateUpdate(updatedState, actionContext);
      }
    };

    next(newState);
  }

  /**
   * Create action context for tracking (Problem #1: No State Change Path Tracking)
   * Optimized: Minimal overhead, lazy evaluation of expensive operations
   */
  private createActionContext(
    name: string,
    description?: string
  ): ActionContext {
    // Ultra-fast: Increment counter and create minimal context
    this._actionCounter++;
    const actionId = String(this._actionCounter);
    
    // Fast path: Minimal context (most common case)
    if (!this._options.enableStackTrace && 
        !this._options.enableAsyncTracking &&
        !this._devToolsEnabled &&
        !description &&
        this._actionChain.length === 0) {
      return {
        id: actionId,
        name,
        timestamp: 0,
        caller: undefined,
        stackTrace: undefined,
        parentActionId: undefined,
        metadata: undefined,
      };
    }

    // Full context only when needed
    const needsActionChain = this._actionChain.length > 0;
    const parentAction = needsActionChain ? this._actionChain[this._actionChain.length - 1] : undefined;
    const needsStackTrace = this._options.enableStackTrace && changeTrackerImpl;
    const caller = needsStackTrace ? changeTrackerImpl!.getCallerName() : undefined;
    const stackTrace = needsStackTrace ? changeTrackerImpl!.getStackTrace() : undefined;
    const needsTimestamp = this._options.enableAsyncTracking || this._devToolsEnabled;
    const timestamp = needsTimestamp ? Date.now() : 0;

    const context: ActionContext = {
      id: actionId,
      name,
      timestamp,
      caller,
      stackTrace,
      parentActionId: parentAction?.id,
      metadata: description ? { description } : undefined,
    };

    if (needsActionChain || this._options.enableStackTrace) {
      this._actionChain.push(context);
      if (this._actionChain.length > 50) {
        this._actionChain.shift();
      }
    }

    return context;
  }

  /**
   * Get action chain (Problem #1: No State Change Path Tracking)
   */
  public getActionChain(): ReadonlyArray<ActionContext> {
    return this._actionChain.slice();
  }

  /**
   * Get async action tracker
   */
  public getAsyncTracker(): InstanceType<NonNullable<AsyncTrackerModule['AsyncActionTracker']>> | null {
    return this._asyncTracker;
  }

  /**
   * Get active async actions
   */
  public getActiveAsyncActions(): ReadonlyArray<AsyncActionState> {
    return this._asyncTracker?.getActiveActions() ?? [];
  }

  /**
   * Get completed async actions
   */
  public getCompletedAsyncActions(): ReadonlyArray<AsyncActionState> {
    return this._asyncTracker?.getCompletedActions() ?? [];
  }

  /**
   * Convert state to JSON
   */
  public toJSON(): T {
    return { ...this._state } as T;
  }

  /**
   * Get state as plain object (for serialization)
   */
  public toPlainObject(): T {
    return { ...this._state } as T;
  }

  /**
   * Destroy this TachyoManager instance and release all resources.
   * Call this when the TachyoManager is no longer needed to prevent memory leaks.
   * @example
   * ```typescript
   * // React usage
   * useEffect(() => {
   *   const store = new TachyoManager({ ... });
   *   return () => store.destroy();
   * }, []);
   * ```
   */
  public destroy(): void {
    // 0. Reset fast path
    this._fastPathFlags = 0;

    // 1. Remove all state subscribers
    this._subscriptions.length = 0;

    // 2. Remove all property subscribers
    this._propertySubscriptions = {};
    this._propertySubscriberCount = 0;

    // 3. Remove all EventEmitter listeners
    this.removeAllListeners();

    // 4. Clear async action tracking records
    this._asyncTracker?.clear();

    // 5. Unregister all async actions
    this._asyncActions.clear();

    // 6. Remove all middleware
    this._middleware = [];

    // 7. Disconnect from DevTools
    devTools.disconnect();

    // 8. Release history memory
    this._history = [];
    this._historyIndex = -1;
  }
}

