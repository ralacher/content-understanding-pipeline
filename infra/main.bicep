param location string = resourceGroup().location
param environmentName string = 'content-understanding-env'
param storageAccountName string
param cosmosAccountName string
param containerAppName string = 'ffmpeg-worker'
param logAnalyticsName string = 'content-understanding-logs'
param uploadContainerName string = 'incoming-avi'
param processedContainerName string = 'processed-mp4'
param queueName string = 'video-processing'
param cosmosDatabaseName string = 'content-understanding'
param cosmosContainerName string = 'media-records'
param containerImage string
param contentUnderstandingEndpoint string = ''
param contentUnderstandingAnalyzerId string = 'prebuilt-video'
param appBaseUrl string = 'https://example.contoso.com'

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
            cpu: 1.0
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
            { name: 'CONTENT_UNDERSTANDING_ANALYZER_ID', value: contentUnderstandingAnalyzerId }
            { name: 'APP_BASE_URL', value: appBaseUrl }
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
