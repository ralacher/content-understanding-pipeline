param(
  [Parameter(Mandatory = $true)]
  [string]$ResourceGroup,

  [string]$DeploymentName,
  [string]$WebImageName = "content-understanding-web",
  [string]$WorkerImageName = "content-understanding-worker",
  [string]$ImageTag = "",
  [string]$WebDockerfile = "Dockerfile.web",
  [string]$WorkerDockerfile = "Dockerfile.worker",
  [string]$SourceContext = ".",
  [bool]$UseTrackedGitContext = $true,
  [bool]$NoWaitContainerAppUpdate = $true
)

$ErrorActionPreference = "Stop"

function Require-Command([string]$name) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    throw "Required command '$name' is not available in PATH."
  }
}

function Get-LatestSucceededDeploymentName([string]$rg) {
  $name = az deployment group list `
    --resource-group $rg `
    --query "sort_by([?properties.provisioningState=='Succeeded' && starts_with(name, 'content-understanding-')].{name:name,timestamp:properties.timestamp}, &timestamp)[-1].name" `
    -o tsv

  if (-not $name) {
    throw "No succeeded 'content-understanding-*' deployments were found in resource group '$rg'. Use -DeploymentName to target a specific deployment."
  }

  return $name.Trim()
}

function Get-OutputValue($outputs, [string]$key) {
  if ($null -eq $outputs) {
    return $null
  }

  $node = $outputs.$key
  if ($null -eq $node) {
    return $null
  }

  return $node.value
}

function Resolve-ContainerAppNameFromRg([string]$rg, [string]$containsText) {
  $query = "[?contains(name, '$containsText')].name | [0]"
  $name = az containerapp list --resource-group $rg --query $query -o tsv
  if ($name) {
    return $name.Trim()
  }

  return $null
}

function New-TrackedGitContext([string]$sourceRoot) {
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw "git is required for -UseTrackedGitContext."
  }

  $resolvedRoot = (Resolve-Path $sourceRoot).Path
  $trackedFiles = git -C $resolvedRoot ls-files
  if (-not $trackedFiles) {
    throw "No tracked files found in '$resolvedRoot'."
  }

  $tempContext = Join-Path ([System.IO.Path]::GetTempPath()) ("cu-build-context-" + [System.Guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Path $tempContext -Force | Out-Null

  foreach ($file in $trackedFiles) {
    $sourcePath = Join-Path $resolvedRoot $file
    if (-not (Test-Path $sourcePath -PathType Leaf)) {
      continue
    }

    $destPath = Join-Path $tempContext $file
    $destDir = Split-Path $destPath -Parent
    if ($destDir -and -not (Test-Path $destDir)) {
      New-Item -ItemType Directory -Path $destDir -Force | Out-Null
    }

    Copy-Item -Path $sourcePath -Destination $destPath -Force
  }

  return $tempContext
}

Require-Command "az"

$account = az account show -o json | ConvertFrom-Json
if (-not $account) {
  throw "Azure CLI is not authenticated. Run 'az login' first."
}

if (-not $ImageTag) {
  $ImageTag = Get-Date -Format "yyyyMMddHHmmss"
}

if (-not $DeploymentName) {
  $DeploymentName = Get-LatestSucceededDeploymentName -rg $ResourceGroup
}

Write-Host "Using deployment: $DeploymentName"

$deployment = az deployment group show --resource-group $ResourceGroup --name $DeploymentName -o json | ConvertFrom-Json
$outputs = $deployment.properties.outputs

$acrLoginServer = Get-OutputValue -outputs $outputs -key "containerRegistryLoginServer"
$webContainerAppName = Get-OutputValue -outputs $outputs -key "webContainerAppName"
$workerContainerAppName = Get-OutputValue -outputs $outputs -key "workerContainerAppName"
$webUrl = Get-OutputValue -outputs $outputs -key "webAppUrl"

if (-not $webContainerAppName) {
  $webContainerAppName = Resolve-ContainerAppNameFromRg -rg $ResourceGroup -containsText "-web"
}

if (-not $workerContainerAppName) {
  $workerContainerAppName = Resolve-ContainerAppNameFromRg -rg $ResourceGroup -containsText "-worker"
}

if (-not $acrLoginServer) {
  $acrLoginServer = az acr list --resource-group $ResourceGroup --query "[0].loginServer" -o tsv
  if ($acrLoginServer) {
    $acrLoginServer = $acrLoginServer.Trim()
  }
}

if (-not $acrLoginServer) {
  throw "Could not resolve ACR login server from deployment outputs or resource group."
}

if (-not $webContainerAppName -or -not $workerContainerAppName) {
  throw "Could not resolve both container app names from deployment outputs or resource group."
}

$acrName = $acrLoginServer.Split(".")[0]
$webImageRef = "$acrLoginServer/${WebImageName}:$ImageTag"
$workerImageRef = "$acrLoginServer/${WorkerImageName}:$ImageTag"

$effectiveContext = $SourceContext
$temporaryContext = $null

if ($UseTrackedGitContext) {
  Write-Host "Preparing tracked-files-only build context..."
  $temporaryContext = New-TrackedGitContext -sourceRoot $SourceContext
  $effectiveContext = $temporaryContext
}

try {
  Write-Host "Building image in ACR for web: $webImageRef"
  az acr build --registry $acrName --resource-group $ResourceGroup --image "${WebImageName}:$ImageTag" --file $WebDockerfile $effectiveContext --output none

  Write-Host "Building image in ACR for worker: $workerImageRef"
  az acr build --registry $acrName --resource-group $ResourceGroup --image "${WorkerImageName}:$ImageTag" --file $WorkerDockerfile $effectiveContext --output none

  Write-Host "Updating container app '$webContainerAppName'"
  if ($NoWaitContainerAppUpdate) {
    az containerapp update --resource-group $ResourceGroup --name $webContainerAppName --image $webImageRef --no-wait --output none
  }
  else {
    az containerapp update --resource-group $ResourceGroup --name $webContainerAppName --image $webImageRef --output none
  }

  Write-Host "Updating container app '$workerContainerAppName'"
  if ($NoWaitContainerAppUpdate) {
    az containerapp update --resource-group $ResourceGroup --name $workerContainerAppName --image $workerImageRef --no-wait --output none
  }
  else {
    az containerapp update --resource-group $ResourceGroup --name $workerContainerAppName --image $workerImageRef --output none
  }

  $webFqdn = az containerapp show --resource-group $ResourceGroup --name $webContainerAppName --query "properties.configuration.ingress.fqdn" -o tsv
  $webLatestRevision = az containerapp show --resource-group $ResourceGroup --name $webContainerAppName --query "properties.latestRevisionName" -o tsv
  $workerLatestRevision = az containerapp show --resource-group $ResourceGroup --name $workerContainerAppName --query "properties.latestRevisionName" -o tsv

  Write-Host ""
  Write-Host "Deployment update complete."
  Write-Host "Resource group: $ResourceGroup"
  Write-Host "Deployment: $DeploymentName"
  Write-Host "ACR: $acrName"
  Write-Host "Web app: $webContainerAppName"
  Write-Host "Worker app: $workerContainerAppName"
  Write-Host "Web latest revision: $webLatestRevision"
  Write-Host "Worker latest revision: $workerLatestRevision"
  Write-Host "Web image: $webImageRef"
  Write-Host "Worker image: $workerImageRef"
  if ($webFqdn) {
    Write-Host "Web endpoint: https://$webFqdn"
  } elseif ($webUrl) {
    Write-Host "Web endpoint: $webUrl"
  }
}
finally {
  if ($temporaryContext -and (Test-Path $temporaryContext)) {
    Remove-Item -Path $temporaryContext -Recurse -Force
  }
}
