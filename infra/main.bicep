param location string = resourceGroup().location
param environmentName string = 'content-understanding-env'
param storageAccountName string
param cosmosAccountName string
param webAppName string
param appServicePlanName string = 'content-understanding-plan'
param containerAppName string = 'ffmpeg-worker'
param logAnalyticsName string = 'content-understanding-logs'
param uploadContainerName string = 'incoming-avi'
param processedContainerName string = 'processed-mp4'
param queueName string = 'video-processing'
param cosmosDatabaseName string = 'content-understanding'
param cosmosContainerName string = 'media-records'
param containerImage string
param appTitle string = 'Content Understanding Hub'
param authClientId string = ''
@secure()
param authClientSecret string = ''
param authTenantId string = ''
@secure()
param authSessionSecret string = ''
param contentUnderstandingEndpoint string = ''
param contentUnderstandingApiVersion string = '2026-05-01'
param contentUnderstandingAnalyzerId string = 'prebuilt-video'
param uploadWriteQueueMessage bool = false

var storageBlobDataContributorRoleDefinitionId = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  'ba92f5b4-2d11-453d-a403-e96b0029c9fe'
)
var storageQueueDataContributorRoleDefinitionId = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  '974c5e8b-45b9-4653-ba55-5f855dd0fb88'
)
var cosmosBuiltInDataContributorRoleDefinitionId = '${cosmos.id}/sqlRoleDefinitions/00000000-0000-0000-0000-000000000002'
var webAppBaseUrl = 'https://${webAppName}.azurewebsites.net'

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: logAnalyticsName
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
  }
}

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageAccountName
  location: location
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    allowBlobPublicAccess: false
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
}

resource queueService 'Microsoft.Storage/storageAccounts/queueServices@2023-05-01' = {
  parent: storage
  name: 'default'
}

resource uploadContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: uploadContainerName
  properties: {
    publicAccess: 'None'
  }
}

resource processedContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: processedContainerName
  properties: {
    publicAccess: 'None'
  }
}

resource processingQueue 'Microsoft.Storage/storageAccounts/queueServices/queues@2023-05-01' = {
  parent: queueService
  name: queueName
}

resource cosmos 'Microsoft.DocumentDB/databaseAccounts@2024-05-15' = {
  name: cosmosAccountName
  location: location
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    publicNetworkAccess: 'Enabled'
    locations: [
      {
        locationName: location
        failoverPriority: 0
      }
    ]
    capabilities: []
  }
}

resource cosmosDatabase 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-05-15' = {
  parent: cosmos
  name: cosmosDatabaseName
  properties: {
    resource: {
      id: cosmosDatabaseName
    }
  }
}

resource cosmosContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  parent: cosmosDatabase
  name: cosmosContainerName
  properties: {
    resource: {
      id: cosmosContainerName
      partitionKey: {
        paths: ['/id']
        kind: 'Hash'
      }
      indexingPolicy: {
        indexingMode: 'consistent'
        automatic: true
        includedPaths: [
          {
            path: '/*'
          }
        ]
      }
    }
  }
}

resource managedEnvironment 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: environmentName
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalytics.properties.customerId
        sharedKey: listKeys(logAnalytics.id, logAnalytics.apiVersion).primarySharedKey
      }
    }
  }
}

resource appServicePlan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: appServicePlanName
  location: location
  kind: 'linux'
  sku: {
    name: 'B1'
    tier: 'Basic'
  }
  properties: {
    reserved: true
  }
}

resource webApp 'Microsoft.Web/sites@2023-12-01' = {
  name: webAppName
  location: location
  kind: 'app,linux'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: appServicePlan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'NODE|20-lts'
      appCommandLine: 'node server.js'
      alwaysOn: true
      minTlsVersion: '1.2'
      appSettings: [
        { name: 'APP_BASE_URL', value: webAppBaseUrl }
        { name: 'NEXT_PUBLIC_APP_BASE_URL', value: webAppBaseUrl }
        { name: 'NEXT_PUBLIC_APP_TITLE', value: appTitle }
        { name: 'NODE_ENV', value: 'production' }
        { name: 'PORT', value: '8080' }
        { name: 'WEBSITE_RUN_FROM_PACKAGE', value: '1' }
        { name: 'SCM_DO_BUILD_DURING_DEPLOYMENT', value: 'false' }
        { name: 'ENTRA_ID_CLIENT_ID', value: authClientId }
        { name: 'ENTRA_ID_CLIENT_SECRET', value: authClientSecret }
        { name: 'ENTRA_ID_TENANT_ID', value: authTenantId }
        { name: 'AUTH_SESSION_SECRET', value: authSessionSecret }
        { name: 'AZURE_STORAGE_ACCOUNT_URL', value: 'https://${storage.name}.blob.core.windows.net' }
        { name: 'AZURE_STORAGE_UPLOAD_CONTAINER', value: uploadContainerName }
        { name: 'AZURE_STORAGE_PROCESSED_CONTAINER', value: processedContainerName }
        { name: 'AZURE_STORAGE_QUEUE_NAME', value: queueName }
        { name: 'AZURE_COSMOS_ENDPOINT', value: cosmos.properties.documentEndpoint }
        { name: 'AZURE_COSMOS_DATABASE', value: cosmosDatabaseName }
        { name: 'AZURE_COSMOS_CONTAINER', value: cosmosContainerName }
        { name: 'CONTENT_UNDERSTANDING_ENDPOINT', value: contentUnderstandingEndpoint }
        { name: 'CONTENT_UNDERSTANDING_API_VERSION', value: contentUnderstandingApiVersion }
        { name: 'CONTENT_UNDERSTANDING_ANALYZER_ID', value: contentUnderstandingAnalyzerId }
        { name: 'UPLOAD_WRITE_QUEUE_MESSAGE', value: string(uploadWriteQueueMessage) }
      ]
    }
  }
}

resource containerApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: containerAppName
  location: location
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    managedEnvironmentId: managedEnvironment.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: false
        targetPort: 8080
      }
    }
    template: {
      containers: [
        {
          name: 'ffmpeg-worker'
          image: containerImage
          resources: {
            cpu: json('1.0')
            memory: '2Gi'
          }
          env: [
            { name: 'AZURE_STORAGE_ACCOUNT_URL', value: 'https://${storage.name}.blob.core.windows.net' }
            { name: 'AZURE_STORAGE_UPLOAD_CONTAINER', value: uploadContainerName }
            { name: 'AZURE_STORAGE_PROCESSED_CONTAINER', value: processedContainerName }
            { name: 'AZURE_STORAGE_QUEUE_NAME', value: queueName }
            { name: 'AZURE_COSMOS_ENDPOINT', value: cosmos.properties.documentEndpoint }
            { name: 'AZURE_COSMOS_DATABASE', value: cosmosDatabaseName }
            { name: 'AZURE_COSMOS_CONTAINER', value: cosmosContainerName }
            { name: 'CONTENT_UNDERSTANDING_ENDPOINT', value: contentUnderstandingEndpoint }
            { name: 'CONTENT_UNDERSTANDING_API_VERSION', value: contentUnderstandingApiVersion }
            { name: 'CONTENT_UNDERSTANDING_ANALYZER_ID', value: contentUnderstandingAnalyzerId }
            { name: 'APP_BASE_URL', value: webAppBaseUrl }
          ]
        }
      ]
      scale: {
        minReplicas: 0
        maxReplicas: 4
        rules: [
          {
            name: 'queue-scale'
            custom: {
              type: 'azure-queue'
              metadata: {
                accountName: storage.name
                queueName: queueName
                queueLength: '1'
              }
              identity: 'system'
            }
          }
        ]
      }
    }
  }
}

resource workerBlobDataContributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, containerApp.name, storageBlobDataContributorRoleDefinitionId, 'blob')
  scope: storage
  properties: {
    principalId: containerApp.identity.principalId
    roleDefinitionId: storageBlobDataContributorRoleDefinitionId
    principalType: 'ServicePrincipal'
  }
}

resource workerQueueDataContributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, containerApp.name, storageQueueDataContributorRoleDefinitionId, 'queue')
  scope: storage
  properties: {
    principalId: containerApp.identity.principalId
    roleDefinitionId: storageQueueDataContributorRoleDefinitionId
    principalType: 'ServicePrincipal'
  }
}

resource webBlobDataContributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, webApp.name, storageBlobDataContributorRoleDefinitionId, 'blob')
  scope: storage
  properties: {
    principalId: webApp.identity.principalId
    roleDefinitionId: storageBlobDataContributorRoleDefinitionId
    principalType: 'ServicePrincipal'
  }
}

resource webQueueDataContributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, webApp.name, storageQueueDataContributorRoleDefinitionId, 'queue')
  scope: storage
  properties: {
    principalId: webApp.identity.principalId
    roleDefinitionId: storageQueueDataContributorRoleDefinitionId
    principalType: 'ServicePrincipal'
  }
}

resource workerCosmosRoleAssignment 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2024-05-15' = {
  parent: cosmos
  name: guid(cosmos.id, containerApp.name, cosmosBuiltInDataContributorRoleDefinitionId)
  properties: {
    principalId: containerApp.identity.principalId
    roleDefinitionId: cosmosBuiltInDataContributorRoleDefinitionId
    scope: cosmos.id
  }
}

resource webCosmosRoleAssignment 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2024-05-15' = {
  parent: cosmos
  name: guid(cosmos.id, webApp.name, cosmosBuiltInDataContributorRoleDefinitionId)
  properties: {
    principalId: webApp.identity.principalId
    roleDefinitionId: cosmosBuiltInDataContributorRoleDefinitionId
    scope: cosmos.id
  }
}

resource systemTopic 'Microsoft.EventGrid/systemTopics@2022-06-15' = {
  name: '${storage.name}-blob-events'
  location: location
  properties: {
    source: storage.id
    topicType: 'Microsoft.Storage.StorageAccounts'
  }
}

resource blobCreatedSubscription 'Microsoft.EventGrid/systemTopics/eventSubscriptions@2022-06-15' = {
  parent: systemTopic
  name: 'blob-created-to-queue'
  properties: {
    destination: {
      endpointType: 'StorageQueue'
      properties: {
        resourceId: storage.id
        queueName: queueName
      }
    }
    filter: {
      includedEventTypes: [
        'Microsoft.Storage.BlobCreated'
      ]
      subjectBeginsWith: '/blobServices/default/containers/${uploadContainerName}/blobs/'
    }
    eventDeliverySchema: 'EventGridSchema'
    retryPolicy: {
      maxDeliveryAttempts: 5
      eventTimeToLiveInMinutes: 1440
    }
  }
}

output storageAccountUrl string = 'https://${storage.name}.blob.core.windows.net'
output cosmosEndpoint string = cosmos.properties.documentEndpoint
output containerAppIdentityPrincipalId string = containerApp.identity.principalId
output webAppUrl string = webAppBaseUrl
output webAppIdentityPrincipalId string = webApp.identity.principalId
