# Echelon Dashboard UI

React-based web dashboard for real-time Echelon orchestrator visualization.

## Architecture

The dashboard is a single-page application (SPA) built with:

- **React 18** - UI framework
- **Recharts** - Charts and visualizations
- **Tailwind CSS** - Utility-first styling
- **WebSocket** - Real-time event streaming from dashboard server
- **Vite** - Build tool and dev server

## Components

### `App.tsx`

Root component managing WebSocket connection and state synchronization:

- Connects to `ws://localhost:3030?token=<token>` on mount
- Implements exponential backoff reconnection (1s, 2s, 4s, ..., max 30s)
- Fetches initial state from `/api/state` on connect
- Applies event deltas to local state on WebSocket messages
- Renders layout with CascadeFlow, MetricsPanel, ActivityFeed

### `CascadeFlow.tsx`

Visual representation of the agent hierarchy (CEO → 2IC → Eng Lead → Team Lead → Engineer):

- Displays agent status icons (○ idle, ◆ thinking, ▶ executing, etc.)
- Shows cost per agent and turns completed
- Color-coded background by status
- Connection lines between layers

### `ActivityFeed.tsx`

Live event stream showing recent messages:

- Displays last 50 messages (configurable)
- Auto-scrolls to bottom on new messages
- Shows relative timestamps (3s, 5m, 2h, etc.)
- Strips action blocks for cleaner display
- Color-coded by agent role

### `MetricsPanel.tsx`

Dashboard metrics with recharts visualizations:

- **Budget Gauge** - Cost vs. $50 budget with percentage bar
- **Cost Timeline** - Line chart of last 20 cost events
- **Issues by Domain** - Pie chart of backend/frontend/database breakdown
- **Issue Status** - Open vs. closed issue counts

### `SessionSelector.tsx`

Dropdown to switch between available sessions:

- Fetches list from `/api/sessions`
- Shows repo, status, directive, cost per session
- Reload page with `?session=<id>` query param to switch

## Setup

### Install Dependencies

```bash
npm install
```

This installs:
- `react`, `react-dom` - React runtime
- `recharts` - Chart library
- `tailwindcss`, `autoprefixer`, `postcss` - CSS utilities
- `vite`, `@vitejs/plugin-react` - Build tooling

### Development

Start the dev server with hot reload:

```bash
npm run dev:dashboard
```

This runs Vite on port 5173 with proxies:
- `/api/*` → `http://localhost:3030` (REST endpoints)
- `/ws` → `ws://localhost:3030` (WebSocket)

### Production Build

Build static files to `dist/dashboard/`:

```bash
npm run build:dashboard
```

Output is a standard SPA:
- `index.html` - Entry point
- `assets/*.js` - Bundled React app
- `assets/*.css` - Compiled Tailwind styles

## Configuration

### Tailwind CSS

See `tailwind.config.js`:

```js
content: ['./src/dashboard/ui/**/*.{js,ts,jsx,tsx}']
```

Custom colors:
- `text-magenta-400` - Team Lead role color (#e879f9)

### Vite

See `vite.config.dashboard.ts`:

- **Input**: `src/dashboard/ui/index.html`
- **Output**: `dist/dashboard/`
- **Dev Server**: Port 5173 with API proxy to 3030

## State Sync Protocol

### Initial Hydration

On WebSocket `onopen`:

1. Fetch `/api/state` via REST
2. Set initial `EchelonState` from response
3. Render UI

### Real-Time Updates

On WebSocket `onmessage`:

1. Parse `EchelonEvent` from JSON
2. Apply event delta to state (see `applyEventDelta()`)
3. React re-renders affected components

### Event Deltas

Supported event types:

| Event Type | State Update |
|------------|--------------|
| `agent_status` | Update `agents[role].status` |
| `message` | Append to `messages[]` |
| `issue_created` | Append to `issues[]` |
| `cost_update` | Update `totalCost` and `agents[role].totalCost` |
| `cascade_complete` | Set `status: 'completed'`, `cascadePhase: 'complete'` |
| `shutdown` | Set `status: 'paused'` |

### Reconnection

If WebSocket closes:

1. Clear `wsRef.current`
2. Set `connected: false`
3. Schedule reconnect with exponential backoff:
   - 1st retry: 1s
   - 2nd retry: 2s
   - 3rd retry: 4s
   - ...
   - Max: 30s
4. On reconnect success, re-fetch `/api/state` to sync missed events

## Authentication

Dashboard requires an auth token via:

1. URL query param: `?token=<token>`
2. LocalStorage: `echelon_token`

Token is validated by dashboard server on WebSocket upgrade.

## File Structure

```
src/dashboard/ui/
├── index.html          # Entry point
├── index.tsx           # React root render
├── index.css           # Tailwind imports + custom scrollbar
├── App.tsx             # Root component with WebSocket
├── CascadeFlow.tsx     # Org chart visualization
├── ActivityFeed.tsx    # Live event stream
├── MetricsPanel.tsx    # Charts and gauges
└── SessionSelector.tsx # Session switcher dropdown
```

## Browser Support

Tested on:
- Chrome 120+
- Firefox 120+
- Safari 17+

Requires:
- WebSocket API
- ES2020 features (optional chaining, nullish coalescing)

## Performance

- Initial state load: < 100ms (REST fetch)
- Event processing: < 10ms per event (React re-render)
- WebSocket reconnect: 1-30s exponential backoff
- Max feed entries: 50 (configurable via `maxLines` prop)

## Future Enhancements

- [ ] Session history timeline scrubber
- [ ] Action approval UI (currently CLI-only)
- [ ] Real-time cost alerts (>80% budget)
- [ ] Export session transcript as PDF
- [ ] Dark/light theme toggle
- [ ] Mobile-responsive layout
