# LoRa — Railway Deployment

1. Push repo to GitHub (ensure branch is up to date).
2. Go to [Railway](https://railway.app) and sign in.
3. Click **New Project**.
4. Choose **Deploy from GitHub repo**.
5. Select the LoRa repository and connect (authorize if prompted).
6. Add environment variables in the project **Variables** tab (see `.env.example` for a list). At minimum set:
   - `NODE_ENV=production`
   - `ANTHROPIC_API_KEY` (your key)
   - `FALKOR_HOST`, `FALKOR_PORT` (or Railway service URL for Redis/Falkor)
   - `CHROMA_HOST`, `CHROMA_PORT` (or Railway service URL for Chroma)
   - `LORA_DEBUG=false` (recommended for production)
7. Deploy: Railway will run `npm run build` (if configured) then `npm start`. The server listens on `process.env.PORT` (set automatically by Railway).
