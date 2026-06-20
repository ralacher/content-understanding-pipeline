# Content Understanding Pipeline

A modern Next.js interface and Azure processing pipeline for Microsoft Foundry Content Understanding.

## What is included

- **Overview dashboard** with KPIs, recent uploads, status breakdown, and failure summaries.
- **Upload screen** for manual AVI ingestion and status validation.
- **Detailed view** with readable analysis sections, lifecycle timeline, and secure MP4 playback when Azure resources are configured.
- **Azure-backed API layer** for dashboard data, uploads, and detail lookup.
- **FFmpeg worker** for Azure Container Apps that converts AVI files to MP4, invokes Content Understanding, and persists normalized results to Cosmos DB.
- **Infrastructure starter** in Bicep for Blob Storage, Queue Storage, Cosmos DB, Event Grid, and Container Apps.

## Local development

```bash
npm install
npm run dev
```

The app runs in **demo mode** when Azure environment variables are missing. Demo mode persists records to `/tmp/content-understanding-pipeline/demo-records.json` so the dashboard and detail pages stay interactive during local review.

## Environment variables

### Frontend / API

- `NEXT_PUBLIC_APP_BASE_URL` or `APP_BASE_URL`
- `NEXT_PUBLIC_APP_TITLE`
- `ENTRA_ID_CLIENT_ID`
- `ENTRA_ID_CLIENT_SECRET`
- `ENTRA_ID_TENANT_ID`
- `AUTH_SESSION_SECRET`
- `AZURE_STORAGE_ACCOUNT_URL`
- `AZURE_STORAGE_UPLOAD_CONTAINER`
- `AZURE_STORAGE_PROCESSED_CONTAINER`
- `AZURE_STORAGE_QUEUE_NAME`
- `AZURE_COSMOS_ENDPOINT`
- `AZURE_COSMOS_DATABASE`
- `AZURE_COSMOS_CONTAINER`
- `CONTENT_UNDERSTANDING_ENDPOINT`
- `CONTENT_UNDERSTANDING_API_VERSION`
- `CONTENT_UNDERSTANDING_ANALYZER_ID`
- `CONTENT_UNDERSTANDING_MAX_POLLS` (optional)
- `CONTENT_UNDERSTANDING_POLL_INTERVAL_MS` (optional)
- `UPLOAD_WRITE_QUEUE_MESSAGE` (optional, default `false`)
- `PLAYBACK_SAS_START_OFFSET_MINUTES` (optional)
- `PLAYBACK_SAS_TTL_MINUTES` (optional)

### Worker

Use the same storage, Cosmos DB, and Content Understanding settings, plus:

- `WORKER_POLL_INTERVAL_MS`
- `WORKER_QUEUE_VISIBILITY_TIMEOUT`
- `WORKER_TMP_DIR`

## Commands

- `npm run dev` — start the web app
- `npm run lint` — run ESLint
- `npm run build` — build the Next.js app
- `npm run build:worker` — compile the FFmpeg worker
- `npm run worker` — run the queue worker continuously
- `npm run worker:once` — process at most one queue message and exit

## Azure deployment notes

1. Deploy the Bicep template in `/infra/main.bicep`.
2. The template now provisions:
   - Blob Storage, Queue Storage, Cosmos DB, Event Grid, and the worker Container App
   - a Linux App Service plan and Web App for the Next.js frontend
   - managed identity role assignments for Storage and Cosmos DB for both the web app and worker
3. If you want Microsoft Entra sign-in in the deployed test app, register an Entra application for `https://<your-host>/api/auth/callback` and provide the corresponding secrets during deployment. If you skip those settings, the deployed app runs in demo sign-in mode.
4. If you supply a `CONTENT_UNDERSTANDING_ENDPOINT`, grant the worker managed identity access to that Foundry Content Understanding resource.
5. Set the environment variables for the web host and worker container.

## GitHub Actions test deployment

This repository includes manual GitHub Actions workflows to deploy and tear down a disposable Azure test environment:

- `/home/runner/work/content-understanding-pipeline/content-understanding-pipeline/.github/workflows/deploy-test-environment.yml`
- `/home/runner/work/content-understanding-pipeline/content-understanding-pipeline/.github/workflows/destroy-test-environment.yml`

Configure these GitHub repository secrets before running the deployment workflow:

- `AZURE_CLIENT_ID`
- `AZURE_TENANT_ID`
- `AZURE_SUBSCRIPTION_ID`

Optional application secrets:

- `APP_ENTRA_ID_CLIENT_ID`
- `APP_ENTRA_ID_CLIENT_SECRET`
- `APP_ENTRA_ID_TENANT_ID`
- `APP_AUTH_SESSION_SECRET`

The deployment workflow:

1. validates the app with `npm run lint`, `npm run build`, and `npm run build:worker`
2. builds and pushes the worker image to a temporary Azure Container Registry
3. deploys the Azure infrastructure from `/infra/main.bicep`
4. publishes the Next.js standalone output to the provisioned Azure Web App
5. writes the deployed URL into the workflow summary

## Architecture

- Incoming AVI files are written to the **incoming blob container**.
- A **BlobCreated** event is forwarded to **Azure Queue Storage** via Event Grid.
- The **Azure Container App** scales on queue depth, converts AVI to MP4 with FFmpeg, then submits the MP4 to **Microsoft Foundry Content Understanding**.
- The worker stores the MP4 in a separate container and writes normalized analysis documents to **Cosmos DB**.
- The frontend reads Cosmos DB to power the dashboard and detail view.
