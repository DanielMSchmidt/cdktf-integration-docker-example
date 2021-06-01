# Fully integrated example for the CDK for Terraform

This is a full example that deploys a simple message board on a cloud provider.
It uses a dockerized application backend and a static react site as a frontend, you can find these at `./application`.

You can use the infrastructure definitions at `./infrastructure` for different cloud providers.

## Local Development

To prepare copy the local .env.sample

- `cp .env.sample .env`
- `vim .env`
- `npm install -g dotenv-cli`

Open three tabs and run `npx dotenv` in each

- `cd application/frontend && dotenv -e ../../.env -- npm start`
- `cd application/backend && dotenv -e ../../.env -- npm start`
- `dotenv -- docker run --name postgres --rm -e POSTGRES_PASSWORD -e POSTGRES_USER -e POSTGRES_DB -p "$POSTGRES_HOST:$POSTGRES_PORT":0.0.0.0/5432 postgres`
