# Content Understanding Pipeline

A Next.js web experience plus Azure worker pipeline for Microsoft Foundry Content Understanding.

## What is included

- Overview dashboard with KPIs, status breakdowns, and failure summaries
- Upload flow for AVI files
- Detail page with normalized analysis sections and MP4 playback
- Search page with keyword plus vector search
- Azure-backed API for uploads, dashboard, details, and search
- Worker for AVI to MP4 conversion, Content Understanding analysis, Cosmos persistence, and Azure AI Search indexing
- Bicep infrastructure starter for Storage, Queue, Cosmos DB, Azure AI Search, Content Understanding, Event Grid, Container Apps, Log Analytics, and Application Insights

## Prerequisites

- Node.js 20+
- npm 10+
- Docker 24+
- Azure CLI 2.60+
- Azure subscription with permission to create resource groups and role assignments

## Local development

```bash
npm install
npm run dev
```

When cloud settings are missing, the app runs in demo mode. Demo records are stored at `/tmp/content-understanding-pipeline/demo-records.json`.

## Security notes

- For production Entra sign-in, set all auth values: `ENTRA_ID_CLIENT_ID`, `ENTRA_ID_CLIENT_SECRET`, `ENTRA_ID_TENANT_ID`, and `AUTH_SESSION_SECRET`.
- Do not commit secrets. Use GitHub Secrets, Azure Key Vault, or Container App secret references.
- `AUTH_SESSION_SECRET` is required whenever Entra auth is configured.

## Set up Entra ID authentication

Use this section when you want real Microsoft Entra sign-in instead of demo mode.

### 1) Create an app registration

Portal path:

1. Microsoft Entra ID
2. App registrations
3. New registration
4. Supported account type: single tenant (recommended)
5. Redirect URI (Web): `https://<your-web-fqdn>/api/auth/callback`

CLI alternative:

```powershell
$appName = "content-understanding-pipeline"
$app = az ad app create --display-name $appName --sign-in-audience AzureADMyOrg -o json | ConvertFrom-Json
$appId = $app.appId
```

### 2) Add redirect URIs

You must add at least the deployed URL callback:

- `https://<your-web-fqdn>/api/auth/callback`

Optional for local testing:

- `http://localhost:3000/api/auth/callback`

```powershell
az ad app update --id $appId --web-redirect-uris "https://<your-web-fqdn>/api/auth/callback" "http://localhost:3000/api/auth/callback"
```

### 3) Create a client secret

```powershell
$secret = az ad app credential reset --id $appId --append --display-name "content-understanding-secret" --years 1 -o json | ConvertFrom-Json
$clientSecret = $secret.password
```

Store this secret securely. Do not commit it.

### 4) Collect tenant id and set app auth values

```powershell
$tenantId = az account show --query tenantId -o tsv
$clientId = $appId

# Use a strong random value for session signing.
$authSessionSecret = [Convert]::ToBase64String((1..48 | ForEach-Object { Get-Random -Minimum 0 -Maximum 256 }))
```

### 5) Provide auth values during deployment

For Bicep bootstrap deployments, set:

- `authClientId`
- `authClientSecret`
- `authTenantId`
- `authSessionSecret`

For app runtime, these map to:

- `ENTRA_ID_CLIENT_ID`
- `ENTRA_ID_CLIENT_SECRET`
- `ENTRA_ID_TENANT_ID`
- `AUTH_SESSION_SECRET`

## Environment variables

### Frontend and API

Required for cloud mode:

- `APP_BASE_URL` or `NEXT_PUBLIC_APP_BASE_URL`
- `NEXT_PUBLIC_APP_TITLE` (optional, defaults to `Content Understanding Hub`)
- `AZURE_STORAGE_ACCOUNT_URL`
- `AZURE_STORAGE_UPLOAD_CONTAINER` (optional, default `incoming-avi`)
- `AZURE_STORAGE_PROCESSED_CONTAINER` (optional, default `processed-mp4`)
- `AZURE_STORAGE_QUEUE_NAME` (optional, default `video-processing`)
- `AZURE_COSMOS_ENDPOINT`
- `AZURE_COSMOS_DATABASE` (optional, default `content-understanding`)
- `AZURE_COSMOS_CONTAINER` (optional, default `media-records`)
- `CONTENT_UNDERSTANDING_ENDPOINT`
- `CONTENT_UNDERSTANDING_API_VERSION` (optional, default `2026-05-01`)
- `CONTENT_UNDERSTANDING_ANALYZER_ID` (optional, default `project-analyzer`)
- `CONTENT_UNDERSTANDING_SCOPE` (optional, default `https://cognitiveservices.azure.com/.default`)
- `AZURE_AI_SEARCH_ENDPOINT`
- `AZURE_AI_SEARCH_INDEX_NAME` (optional, default `content-understanding-assets`)
- `AZURE_AI_SEARCH_API_VERSION` (optional, default `2024-07-01`)
- `AZURE_FOUNDRY_ENDPOINT`
- `AZURE_FOUNDRY_EMBEDDING_DEPLOYMENT` (optional, default `text-embedding-3-small`)
- `AZURE_FOUNDRY_EMBEDDING_API_VERSION` (optional, default `2024-05-01-preview`)
- `AZURE_FOUNDRY_EMBEDDING_DIMENSIONS` (optional, default `1536`)
- `AZURE_FOUNDRY_EMBEDDING_SCOPE` (optional, default `https://cognitiveservices.azure.com/.default`)

Optional:

- `ENTRA_ID_CLIENT_ID`
- `ENTRA_ID_CLIENT_SECRET`
- `ENTRA_ID_TENANT_ID`
- `AUTH_SESSION_SECRET`
- `APPLICATIONINSIGHTS_CONNECTION_STRING`
- `APPLICATIONINSIGHTS_ROLE_NAME`
- `CONTENT_UNDERSTANDING_MAX_POLLS` (optional, default `40`)
- `CONTENT_UNDERSTANDING_POLL_INTERVAL_MS` (optional, default `5000`)
- `UPLOAD_WRITE_QUEUE_MESSAGE` (optional, default `false`)
- `PLAYBACK_SAS_START_OFFSET_MINUTES` (optional)
- `PLAYBACK_SAS_TTL_MINUTES` (optional)

### Worker

The worker uses the same storage, Cosmos, Content Understanding, Search, and embedding settings. Additional worker settings:

- `WORKER_POLL_INTERVAL_MS` (optional, default `10000`)
- `WORKER_QUEUE_VISIBILITY_TIMEOUT` (optional, default `300`)
- `WORKER_TMP_DIR` (optional)
- `CONTENT_UNDERSTANDING_ANALYZER_DEFINITION` (optional JSON override for analyzer creation)
- `CONTENT_UNDERSTANDING_BASE_ANALYZER_ID` (optional, default `prebuilt-video`)
- `CONTENT_UNDERSTANDING_TEMPLATE_ID` (optional, default `prebuilt-videoSegment`)
- `CONTENT_UNDERSTANDING_PROCESSING_LOCATION` (optional, default `geography`)
- `CONTENT_UNDERSTANDING_COMPLETION_MODEL` (optional, default `gpt-4.1`)
- `CONTENT_UNDERSTANDING_SCHEMA_ANALYZER_ID` (optional fallback analyzer id)

## Commands

- `npm run dev` start the web app
- `npm run lint` run ESLint
- `npm run build` build the Next.js app
- `npm run build:worker` compile the FFmpeg worker
- `npm run worker` run the queue worker continuously
- `npm run worker:once` process at most one queue message and exit
- `./scripts/build-and-deploy-images-from-outputs.ps1 -ResourceGroup <rg>` build real images in ACR and update both container apps using deployment outputs

## Deploy to Azure (script-driven full flow)

This is the recommended end-to-end deployment path:

1. create a new resource group and ACR
2. run Bicep bootstrap with placeholder images
3. run the post-bootstrap script to build real images in ACR and update both Container Apps
4. verify web endpoint and container app health

### 1) Sign in and choose your subscription

```bash
az login
az account set --subscription "<subscription-id-or-name>"
```

### 2) Set deployment variables

Use a unique suffix to avoid global naming collisions.

```powershell
$location = "centralus"
$suffix = Get-Date -Format "yyMMddHHmmss"

$resourceGroup = "content-understanding-$location-$suffix"
$acrName = "cu${suffix}acr"
$deploymentName = "content-understanding-bootstrap-$suffix"

$storageAccountName = "cu${suffix}st"
$cosmosAccountName = "cu-$suffix-cosmos"
$contentUnderstandingAccountName = "cu-$suffix-content"
$searchServiceName = "cu-$suffix-search"
$webAppName = "cu-$suffix-web"
$workerAppName = "cu-$suffix-worker"
$environmentName = "cu-$suffix-env"

# Leave empty for demo mode, or set these from the Entra setup section above.
$authClientId = ""
$authClientSecret = ""
$authTenantId = ""
$authSessionSecret = ""
```

### 3) Create resource group and ACR

```powershell
az group create --name $resourceGroup --location $location

az acr create `
   --name $acrName `
   --resource-group $resourceGroup `
   --location $location `
   --sku Basic `
   --admin-enabled false

$acrLoginServer = az acr show --name $acrName --resource-group $resourceGroup --query loginServer -o tsv
```

### 4) Bootstrap infrastructure with placeholder images

This creates all cloud resources first, then image replacement is handled by the script in the next step.

```powershell
az deployment group create `
   --name $deploymentName `
   --resource-group $resourceGroup `
   --template-file infra/main.bicep `
   --parameters `
      location=$location `
      environmentName=$environmentName `
      storageAccountName=$storageAccountName `
      cosmosAccountName=$cosmosAccountName `
      contentUnderstandingAccountName=$contentUnderstandingAccountName `
      aiSearchServiceName=$searchServiceName `
      webAppName=$webAppName `
      containerAppName=$workerAppName `
      webContainerImage='mcr.microsoft.com/azuredocs/containerapps-helloworld:latest' `
      workerContainerImage='mcr.microsoft.com/azuredocs/containerapps-helloworld:latest' `
      containerRegistryName=$acrName `
      containerRegistryLoginServer=$acrLoginServer `
      authClientId=$authClientId `
      authClientSecret=$authClientSecret `
      authTenantId=$authTenantId `
      authSessionSecret=$authSessionSecret
```

### 5) Build images and update Container Apps via script

```powershell
./scripts/build-and-deploy-images-from-outputs.ps1 `
   -ResourceGroup $resourceGroup `
   -DeploymentName $deploymentName
```

What the script does:

1. reads deployment outputs to resolve ACR login server and Container App names
2. builds web and worker images with `az acr build`
3. updates both Container Apps to new tags
4. prints endpoint and deployed image references

### 6) Verify deployment

```powershell
az containerapp list -g $resourceGroup --query "[].{name:name,image:properties.template.containers[0].image,latestRevision:properties.latestRevisionName}" -o table

$webFqdn = az containerapp show -g $resourceGroup -n $webAppName --query properties.configuration.ingress.fqdn -o tsv
Write-Output "https://$webFqdn"
```

Optional system logs:

```powershell
az containerapp logs show -g $resourceGroup -n $webAppName --type system --tail 50
az containerapp logs show -g $resourceGroup -n $workerAppName --type system --tail 50
```

### 7) Recreate AI Search index (first deployment or schema reset)

```powershell
./scripts/recreate-search-index.ps1 -ResourceGroup $resourceGroup -SearchServiceName $searchServiceName
```

### 8) Validate app behavior

1. open the web URL
2. upload a test AVI file
3. verify worker processing logs
4. verify dashboard and search results

### 9) Cleanup

```powershell
az group delete --name $resourceGroup --yes --no-wait
```

## Deploy to Azure (manual-first)

### 1) Sign in and choose your subscription

```bash
az login
az account set --subscription "<subscription-id-or-name>"
```

### 2) Create resource group and container registry

```bash
az group create --name <resource-group> --location <location>
az acr create --name <acr-name> --resource-group <resource-group> --location <location> --sku Basic --admin-enabled false
az acr show --name <acr-name> --resource-group <resource-group> --query loginServer -o tsv
```

### 3) Build and push container images

```bash
az acr login --name <acr-name>
docker build -f Dockerfile.web -t <acr-login-server>/content-understanding-web:<tag> .
docker push <acr-login-server>/content-understanding-web:<tag>

docker build -f Dockerfile.worker -t <acr-login-server>/content-understanding-worker:<tag> .
docker push <acr-login-server>/content-understanding-worker:<tag>
```

### 4) Create deployment parameters

Copy and edit the example file:

```bash
cp infra/main.parameters.example.json infra/main.parameters.json
```

Set required values in `infra/main.parameters.json`:

- `storageAccountName`
- `cosmosAccountName`
- `contentUnderstandingAccountName`
- `webAppName`
- `webContainerImage`
- `workerContainerImage`
- `containerRegistryName`
- `containerRegistryLoginServer`

Optional auth values (recommended for production):

- `authClientId`
- `authClientSecret`
- `authTenantId`
- `authSessionSecret`

If auth values are empty, the app runs in demo sign-in mode.

### 5) Deploy infrastructure

```bash
az deployment group create \
   --name content-understanding-deploy \
   --resource-group <resource-group> \
   --template-file infra/main.bicep \
   --parameters @infra/main.parameters.json
```

Get the deployed app URL:

```bash
az deployment group show \
   --name content-understanding-deploy \
   --resource-group <resource-group> \
   --query properties.outputs.webAppUrl.value -o tsv
```

### 6) Create or refresh the Azure AI Search index

Run the included script after first deployment (and anytime you need to rebuild schema):

```powershell
./scripts/recreate-search-index.ps1 -ResourceGroup <resource-group> -SearchServiceName <ai-search-service-name>
```

### 7) Validate end-to-end

1. Open the deployed URL.
2. Upload a test AVI file.
3. Confirm worker activity in Container App logs.
4. Confirm processed records appear on dashboard and search page.

## Post-bootstrap image deployment script

If infrastructure was deployed with placeholder images, use this script to build and deploy real images without manually looking up ACR URL or container app names.

```powershell
./scripts/build-and-deploy-images-from-outputs.ps1 -ResourceGroup <resource-group>
```

Options:

- `-DeploymentName <name>` use a specific succeeded deployment (otherwise latest succeeded deployment in the resource group is used)
- `-ImageTag <tag>` set a custom tag (otherwise current UTC timestamp is used)
- `-WebImageName <name>` and `-WorkerImageName <name>` override repository names
- `-UseTrackedGitContext $false` disable the default tracked-files-only context mode
- `-NoWaitContainerAppUpdate $false` make `az containerapp update` synchronous (default is non-blocking)

Common usage examples:

```powershell
# Use latest succeeded deployment in the resource group
./scripts/build-and-deploy-images-from-outputs.ps1 -ResourceGroup <resource-group>

# Use a specific deployment and fixed image tag
./scripts/build-and-deploy-images-from-outputs.ps1 `
   -ResourceGroup <resource-group> `
   -DeploymentName <deployment-name> `
   -ImageTag 20260630120000

# Force synchronous container app updates
./scripts/build-and-deploy-images-from-outputs.ps1 `
   -ResourceGroup <resource-group> `
   -NoWaitContainerAppUpdate $false
```

By default, the script builds from a temporary Git-tracked-only context to avoid `az acr build` hanging on local tar packaging of large untracked files.

The script reads deployment outputs (`containerRegistryLoginServer`, `webContainerAppName`, `workerContainerAppName`) and then:

1. runs `az acr build` for web and worker images
2. updates both Container Apps to the new image tags
3. prints the final web endpoint

## Optional GitHub Actions deployment

Manual workflows are provided:

- `.github/workflows/deploy-test-environment.yml`
- `.github/workflows/destroy-test-environment.yml`

Required repository secrets:

- `AZURE_CLIENT_ID`
- `AZURE_TENANT_ID`
- `AZURE_SUBSCRIPTION_ID`

Optional app auth secrets:

- `APP_ENTRA_ID_CLIENT_ID`
- `APP_ENTRA_ID_CLIENT_SECRET`
- `APP_ENTRA_ID_TENANT_ID`
- `APP_AUTH_SESSION_SECRET`

If optional app auth secrets are omitted, workflow deployment uses demo sign-in mode.

## Troubleshooting

- Sign-in issues: verify Entra app redirect URI is `https://<your-host>/api/auth/callback` and all four auth env vars are set.
- Search returns no results: run `scripts/recreate-search-index.ps1`, then upload and process at least one file.
- Worker appears idle: verify queue name, storage URL, and worker logs.
- 403 errors to Azure resources: confirm managed identity role assignments completed successfully.

## Architecture

- Incoming AVI files are written to the upload blob container.
- Blob-created events are forwarded to Azure Queue Storage via Event Grid.
- The worker Container App scales on queue depth, converts AVI to MP4, and calls Content Understanding.
- The worker stores MP4 files and normalized analysis in Cosmos DB and Azure AI Search.
- The web app reads Cosmos DB and Search for dashboard, detail, and search experiences.
