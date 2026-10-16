# Liveboard

An interactive system simulator.

## Development

Requires Node.js 20.19+ or 22.12+.

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite.

## Checks

```sh
npm test
npm run build
```

## Preview a release build

```sh
npm run check
npm run preview
```

The build output is `dist/`. Serve the entire directory, including the worker and lazy-loaded assets under `assets/`.

GitHub Actions runs tests and builds the app. Each successful run saves a `liveboard-static-build` artifact. The workflow does not deploy.
