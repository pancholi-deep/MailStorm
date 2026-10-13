# MailStorm frontend

React Scripts builds the existing React/Tailwind interface. See the [repository README](../README.md) for Google OAuth, environment variables, limits, retries, and deployment.

```sh
npm ci
npm start
CI=true npm test -- --watchAll=false --runInBand
CI=true npm run build
```

Copy `.env.example` to `.env` and configure the Google client ID and backend URL. Client secrets belong only on the backend. Restart or rebuild after changing environment variables. Browser routes and API paths are configured separately.
