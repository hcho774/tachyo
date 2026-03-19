# tachyo

🎯 State management with built-in undo/redo and change tracking

[![npm version](https://badge.fury.io/js/tachyo.svg)](https://www.npmjs.com/package/tachyo)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> Type-safe state management with automatic undo/redo, event tracking, and React integration

tachyo provides built-in undo/redo, change path tracking, and async flow debugging in a single package.

## Installation

```bash
npm install tachyo
```

## Quick Start

```typescript
import { TachyoManager } from 'tachyo';

const store = new TachyoManager({ count: 0 }, { autoSnapshot: true });

store.subscribe((state, event) => {
  console.log('Changed:', event.changePath);
});

store.setState({ count: 1 });
store.setState({ count: 2 });
store.undo(); // Back to count: 1
store.redo(); // Forward to count: 2
```

## React Integration

```tsx
import { useTachyo } from 'tachyo/react';

function Counter() {
  const { state, setState, undo, redo, canUndo, canRedo } = useTachyo(
    { count: 0 },
    { autoSnapshot: true }
  );

  return (
    <div>
      <h1>Count: {state.count}</h1>
      <button onClick={() => setState({ count: state.count + 1 })}>+</button>
      <button onClick={undo} disabled={!canUndo}>Undo</button>
      <button onClick={redo} disabled={!canRedo}>Redo</button>
    </div>
  );
}
```

## Key Features

### 🎯 Built-in Undo/Redo

Automatic history management — enable `autoSnapshot` and every `setState` call is tracked.

```typescript
const store = new TachyoManager({ count: 0 }, { autoSnapshot: true });

store.setState({ count: 1 });
store.setState({ count: 2 });
store.undo(); // Back to count: 1
store.redo(); // Forward to count: 2
```

**Use cases:**
- Form editors: Users can undo accidental changes
- Design tools: Essential for creative workflows
- Game development: Checkpoint/rollback functionality
- Data entry: Reduce user frustration from mistakes

### 🔍 Change Path Tracking

Track exactly which properties changed, where, and how. Enable `enableChangePathTracking` to activate.

```typescript
const store = new TachyoManager(initialState, {
  enableChangePathTracking: true,
  enableStackTrace: true, // also captures caller name
});

store.subscribe((state, event) => {
  console.log('Changed paths:', event.changePath);
  // ['user', 'profile', 'email'] - nested paths tracked!

  console.log('Who changed it:', event.actionContext?.caller);
  // 'handleFormSubmit' - which function triggered it

  console.log('When:', new Date(event.actionContext?.timestamp ?? 0));
});
```

**Benefits:**
- Faster debugging: Know exactly what changed
- Better onboarding: New developers understand state flow
- Improved bug reports: Users can provide exact change paths
- Easier code reviews: Reviewers see complete action history

### ⚡ Async Flow Debugging

Track all async operations automatically with full context.

```typescript
// Register async action once
store.registerAsyncAction({
  name: 'saveDocument',
  handler: async (state, documentId) => {
    return await api.saveDocument(documentId, state.content);
  },
  onStart: (state) => ({ ...state, saving: true }),
  onSuccess: (state, result) => ({ ...state, saving: false, lastSaved: result }),
  onError: (state, error) => ({ ...state, saving: false, error: error.message }),
});

// Execute - automatically tracked!
await store.dispatchAsync('saveDocument', 'doc-123');

// Debug anytime
const active = store.getActiveAsyncActions();
// [{ name: 'saveDocument', status: 'pending', startTime: ... }]

const completed = store.getCompletedAsyncActions();
// [{ name: 'saveDocument', status: 'success', duration: 234ms }]
```

**Benefits:**
- API debugging: Know exactly which request failed and why
- Performance monitoring: Identify slow async operations
- Error tracking: Full context for error reporting
- Better UX: Show accurate loading states

### 🛠️ Action Chain Tracking

Track complete action chains with parent-child relationships.

```typescript
const store = new TachyoManager({ step: 0 }, { enableStackTrace: true });

store.setState({ step: 1 }, { action: 'loadData' });
store.setState({ step: 2 }, { action: 'validateForm' });
store.setState({ step: 3 }, { action: 'submitForm' });

const chain = store.getActionChain();
// [
//   { name: 'loadData', id: '1', ... },
//   { name: 'validateForm', id: '2', ... },
//   { name: 'submitForm', id: '3', ... }
// ]
```

### 🎨 Framework Agnostic

Works with React and vanilla JavaScript.

```typescript
// React
import { useTachyo } from 'tachyo/react';

// Vanilla JS - no framework needed!
import { TachyoManager } from 'tachyo';
const store = new TachyoManager({ count: 0 });
```

**Benefits:**
- Multi-framework projects: Use the same state management
- Legacy code: Works in vanilla JS projects
- Easy migration: Same API across frameworks

### 🏎️ Blazing Fast Performance

**tachyo** is carefully designed and V8 micro-optimized directly at the physical JS engine allocation limits.

- **~8.5 Million ops/sec** for simple state modifications (highly conservative).
- **~19.0 Million ops/sec** for history navigation (Undo/Redo).

It's important to note that while **tachyo** ships with heavy-duty features like Action Tracking and Deep Object comparisons, these features are perfectly isolated and opt-in. This extreme architectural optimization allows tachyo's baseline state modifications to perform **completely on par with the world's most ultra-minimal libraries (like Zustand and Redux)**. You get a fully-featured, enterprise-grade engine without sacrificing a single drop of vanilla performance.

### 🚀 Zero Dependencies

Lightweight with no external dependencies.

```typescript
// tachyo: Zero dependencies
// - Custom EventEmitter (no 'events' package)
// - All utilities included
// - Tree-shaking friendly
// - ~5-8KB gzipped with ALL features
```

### 🔧 Middleware System

Flexible middleware system supports custom patterns.

```typescript
// Logging middleware
const loggingMiddleware = (state, next, action) => {
  console.log(`[${action.name}]`, state);
  next(state);
};

// Validation middleware
const validationMiddleware = (state, next, action) => {
  if (isValid(state)) {
    next(state);
  } else {
    throw new Error('Invalid state!');
  }
};

// Analytics middleware
const analyticsMiddleware = (state, next, action) => {
  analytics.track(action.name, state);
  next(state);
};

// Use all together
const store = new TachyoManager(initialState, {
  middleware: [loggingMiddleware, validationMiddleware, analyticsMiddleware],
});
```

## Complete example

```tsx
import { useTachyo } from 'tachyo/react';

interface TodoState {
  todos: { id: string; text: string; completed: boolean }[];
}

function TodoApp() {
  const { state, setState, undo, redo, canUndo, canRedo } = useTachyo<TodoState>(
    { todos: [] },
    { autoSnapshot: true }
  );

  const addTodo = (text: string) => {
    setState({ todos: [...state.todos, { id: Date.now().toString(), text, completed: false }] });
  };

  const toggleTodo = (id: string) => {
    setState({ todos: state.todos.map(t => t.id === id ? { ...t, completed: !t.completed } : t) });
  };

  const clearCompleted = () => {
    setState({ todos: state.todos.filter(t => !t.completed) });
  };

  return (
    <div>
      <h1>Todo List</h1>
      <ul>
        {state.todos.map(todo => (
          <li key={todo.id}>
            <input type="checkbox" checked={todo.completed} onChange={() => toggleTodo(todo.id)} />
            {todo.text}
          </li>
        ))}
      </ul>
      <button onClick={() => addTodo('New todo')}>Add Todo</button>
      <button onClick={clearCompleted}>Clear Completed</button>
      <button onClick={undo} disabled={!canUndo}>Undo</button>
      <button onClick={redo} disabled={!canRedo}>Redo</button>
    </div>
  );
}
```

## Vanilla usage (outside React)

```typescript
import { TachyoManager } from 'tachyo';

const gameStore = new TachyoManager(
  { score: 0, level: 1, lives: 3 },
  { autoSnapshot: true, enableChangePathTracking: true }
);

// Subscribe to changes
const unsubscribe = gameStore.subscribe((state, event) => {
  console.log('Game state changed:', state);
  console.log('What changed:', event.changePath); // ['score'] or ['level']
});

// Update state
gameStore.setState({ score: 100 });
gameStore.setState({ level: 2 });

// Undo/Redo
gameStore.undo(); // Back to level 1
gameStore.redo(); // Forward to level 2

// Cleanup
unsubscribe();
```

## Subscribe to specific properties

```typescript
// Subscribe to all changes
gameStore.subscribe((state, event) => {
  console.log('Any property changed');
});

// Subscribe to specific property
gameStore.subscribeToProperty('score', (newScore, oldScore) => {
  console.log(`Score changed: ${oldScore} -> ${newScore}`);
  if (newScore > 1000) {
    console.log('High score!');
  }
});
```

## Using with TypeScript

tachyo is written in TypeScript and works best with it. No special TypeScript types needed!

```typescript
import { TachyoManager } from 'tachyo';

interface ShoppingCartState {
  items: { id: string; name: string; price: number; quantity: number }[];
}

const cartStore = new TachyoManager<ShoppingCartState>({ items: [] });

const addItem = (item: { id: string; name: string; price: number }) => {
  cartStore.setState({
    items: [...cartStore.state.items, { ...item, quantity: 1 }],
  });
};

const removeItem = (id: string) => {
  cartStore.setState({
    items: cartStore.state.items.filter(item => item.id !== id),
  });
};

// Fully typed!
cartStore.setState({ items: [] }); // ✅
// cartStore.setState({ items: 'invalid' }); // ❌ Type error
```

## Redux DevTools

tachyo automatically integrates with Redux DevTools Extension when available. Just use tachyo normally!

```typescript
const editorStore = new TachyoManager({ content: '', fontSize: 16 });

editorStore.setState({ content: 'Hello World' });
editorStore.setState({ fontSize: 18 });
// Automatically appears in Redux DevTools! 🎉
```

## Middleware

You can add middleware to support any team's patterns:

```typescript
// Logging middleware
const loggingMiddleware = (state, next, action) => {
  console.log(`Action: ${action.name}`, state);
  next(state);
};

// Validation middleware
const validationMiddleware = (state, next, action) => {
  if (state.score >= 0 && state.lives >= 0) {
    next(state);
  } else {
    console.error('Invalid game state!');
  }
};

const gameStore = new TachyoManager(initialState, {
  middleware: [loggingMiddleware, validationMiddleware],
});

// Or add dynamically
gameStore.use(customMiddleware);
```

## Async actions

Track async operations with full debugging support:

```typescript
editorStore.registerAsyncAction({
  name: 'loadDocument',
  handler: async (state, documentId) => {
    const response = await fetch(`/api/documents/${documentId}`);
    return response.json();
  },
  onStart: (state) => ({ ...state, loading: true }),
  onSuccess: (state, result) => ({
    ...state,
    content: result.content,
    loading: false,
  }),
  onError: (state, error) => ({
    ...state,
    error: error.message,
    loading: false,
  }),
});

// Execute with tracking
await editorStore.dispatchAsync('loadDocument', 'doc-123');

// Get tracking info
const active = editorStore.getActiveAsyncActions();
const completed = editorStore.getCompletedAsyncActions();
```

## Options

```typescript
const store = new TachyoManager(initialState, {
  maxHistorySize: 100,            // Maximum undo/redo steps (default: 50)
  enableDeepEquality: false,      // Deep equality for change detection (default: false)
  autoSnapshot: false,            // Save history on every setState (default: false)
  enableChangePathTracking: false,// Track which properties changed (default: false)
  enableAsyncTracking: true,      // Track async operations (default: true)
  enableStackTrace: false,        // Stack traces — has performance impact (default: false)
  middleware: [],                 // Custom middleware
  equalityFn: customEqualFn,     // Custom equality function
});
```

## Comparison with other libraries

| Feature | tachyo | Zustand | Zundo | Redux |
|---------|-------|---------|-------|-------|
| **Automatic Undo/Redo** | ✅ Core | ❌ | ✅* | ❌** |
| **Change Path Tracking** | ✅ | ❌ | ❌ | ❌ |
| **Async Action Tracking** | ✅ | ❌ | ❌ | ❌ |
| **Redux DevTools** | ✅ | ⚠️ | ⚠️ | ✅ |
| **Performance (ops/sec)**| **~8.5M** | ~7.5M | N/A | ~8.0M |
| **Simple API** | ✅ | ✅ | ✅ | ❌ |
| **Type Safety** | ✅ | ✅ | ✅ | ✅ |
| **Zero Dependencies** | ✅ | ✅ | ✅ | ❌ |
| **Framework Agnostic** | ✅ | ✅ | ❌ | ✅ |
| **Bundle Size** | ✅ (~5-8KB) | ✅ (~1KB) | ✅ (~700B) | ❌ (~15KB+) |

*Zundo requires Zustand (separate library)  
**Redux requires Redux Undo (separate library)

## When to Use tachyo?

### ✅ Perfect For:

- **Form editors** - Undo/redo is essential
- **Design tools** - Figma, Sketch-like applications
- **Game development** - Checkpoint/rollback functionality
- **Data entry apps** - Reduce user frustration
- **Complex state flows** - Need to track what changed
- **Async-heavy apps** - Need to debug API calls
- **Multi-framework projects** - Same API everywhere
- **Debugging-focused teams** - Change tracking saves hours

### ⚠️ Consider Alternatives If:

- **Ultra-minimal bundle size** - Zustand is smaller (but lacks features)
- **Already using Redux** - Migration might not be worth it
- **Simple state only** - If you don't need undo/redo or debugging

## Best practices

- **Organize your stores**: Split stores into separate slices for better maintenance
- **Use TypeScript**: Full type safety out of the box
- **Enable tracking selectively**: `enableChangePathTracking` and `autoSnapshot` have a small perf cost — enable only when needed
- **Use middleware**: Add logging, validation, or analytics through middleware
- **Clean up**: Call `store.destroy()` when a store is no longer needed

## Examples

- [Basic Usage](./examples/basic.ts)
- [React Integration](./examples/react-example.tsx)
- [Solving Problems](./examples/solving-problems.ts)

## Documentation

- [How It Works](./docs/HOW_IT_WORKS.md)
- [Event-Driven Advantages](./docs/EVENT_DRIVEN_ADVANTAGES.md)
- [Solving Problems Guide](./docs/SOLVING_PROBLEMS.md)
- [Competitive Analysis](./COMPETITIVE_ANALYSIS.md)

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

---

**tachyo** - State management with built-in undo/redo, change tracking, and async debugging 🎯
