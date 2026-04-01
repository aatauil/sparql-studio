# SPARQL Studio

SPARQL Studio is a local-first web app for querying Virtuoso over SPARQL.  
It uses a minimal browser extension bridge so developers can query `localhost` without changing Virtuoso server settings.

## Workspace

- `apps/web`: React + Vite app
- `apps/bridge-extension`: Manifest V3 bridge extension
- `packages/contracts`: Shared message and SPARQL result contracts

## Run the app

1. Install dependencies:

   ```bash
   npm install
   ```

2. Start web app:

   ```bash
   npm run dev --workspace web
   ```

3. Load extension in Chrome:
   - open `chrome://extensions`
   - enable Developer mode
   - click **Load unpacked**
   - select `apps/bridge-extension`

4. In SPARQL Studio settings, paste the extension ID and set your endpoint (default `http://localhost:8890/sparql`).

## Current features

- SPARQL editor powered by `sparql-editor`
- Saved queries (IndexedDB)
- Query history (IndexedDB)
- Global prefix library and prefix injection
- Results table with URI click-through and alt-click drill-down query
- CSV export
- Bridge health check and query execution timeout support

## Tests and checks

```bash
npm run test --workspace web
npm run lint --workspace web
npm run build --workspace web
```
