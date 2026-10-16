# Liveboard

An interactive system simulator built with Next.js and React.

## Development

Requires Node.js 22.12+.

```sh
npm ci
npm run dev
```

Open http://localhost:5173.

## Checks

```sh
npm run check
```

## Preview a release build

```sh
npm run build
npm run preview
```

The production server starts on port 3000. Set `PORT` to use another port.

The build creates a standalone release in `.next/standalone/`, including browser assets and public files. Run `node server.js` from that directory to start it.

GitHub Actions runs tests and builds the app. Each successful run saves a `liveboard-next-build` artifact. The workflow does not deploy.
