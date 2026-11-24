# Ambient Player relay

A Cloudflare Worker with two Durable Objects that pairs devices for remote
control (see `../docs/remote-control-plan.md`):

- **Room:** one per set of paired devices. It holds their WebSocket
  connections and the device list.
- **Pairing:** holds the short-lived pairing codes.

It runs on the Workers Free plan.

## Deploy

1. **Install the tools:** from this folder, run

   ```bash
   npm install
   ```

2. **Log in:** this opens the browser to log in to Cloudflare. A free
   account is enough.

   ```bash
   npx wrangler login
   ```

3. **Deploy:**

   ```bash
   npx wrangler deploy
   ```

   The output ends with the relay's address, for example
   `https://ambient-relay.<your-subdomain>.workers.dev`.

4. **Point the app at it:** put that address in `../index.html`:

   ```html
   <meta name="ambient-relay" content="https://ambient-relay.<your-subdomain>.workers.dev">
   ```

   Then run `npm run build` in the repository root, and commit and push.

5. **Check the allowed pages:** only the pages in `ALLOWED_ORIGINS` in
   `wrangler.toml` can use the relay. If the site moves to another address,
   add it there and deploy again.

## Develop locally

1. **Start the relay:** run `npx wrangler dev --port 8787` in this folder.
2. **Start the site:** run `npm run serve` in the repository root.
3. **Point a browser at the local relay:** open
   `http://localhost:8000/?relay=http://127.0.0.1:8787`. The browser
   remembers it; `?relay=off` forgets it. Only `localhost` and `127.0.0.1`
   addresses are accepted this way.
4. **Test two devices on one machine:** use `http://localhost:8000` and
   `http://127.0.0.1:8000`, which keep separate storage. Both are allowed
   origins.

## Routes

| Route | What it does |
| --- | --- |
| `POST /rooms` | Create a room: `{ roomId, secret }`. |
| `POST /rooms/:id/codes` | With `{ secret }`, issue a pairing code (6 characters, 10 minutes, single use). |
| `POST /pair/:code` | Swap a pairing code for `{ roomId, secret }`. Limited to 10 tries per minute per IP. |
| `POST /rooms/:id/rotate` | With `{ secret }`, give the room a new secret and disconnect every device (**Forget all devices**). |
| `GET /rooms/:id/ws` | WebSocket into the room. The first message must be `hello` with the secret. |

## WebSocket messages (protocol 1)

| Direction | `type` | Fields |
| --- | --- | --- |
| device → room | `hello` | `protocol`, `deviceId`, `name`, `secret` |
| room → device | `welcome` | `protocol`, `deviceId`, `devices`, `serverTime` |
| room → devices | `devices` | `devices`: `{ id, name, lastSeen, online }[]` |
| device → room | `rename` | `name` |
| device → room | `leave` | none (unpairs this device) |
| device → room | `ping` (plain text) | Answered with `pong` without waking the room. |

**Close codes:**
- **4000:** replaced by a newer connection from the same device.
- **4001:** not paired (wrong secret, or the room was reset).
- **4003:** the first message wasn't a valid `hello`.
- **4004:** the room is full (12 devices).

**Coming in phase 3:** roles, state and commands, added to the same
connection.
