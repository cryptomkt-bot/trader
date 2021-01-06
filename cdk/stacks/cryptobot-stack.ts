import * as path from "path";

import {
  Aws,
  Construct,
  Stack,
  StackProps,
  Duration,
  CfnParameter,
} from "@aws-cdk/core";
import {
  RestApi,
  AwsIntegration,
  Model,
  JsonSchemaType,
  LambdaIntegration,
  AuthorizationType,
  TokenAuthorizer,
  Cors,
  RequestValidator,
} from "@aws-cdk/aws-apigateway";
import { Function, Runtime, Code } from "@aws-cdk/aws-lambda";
import { Table, AttributeType } from "@aws-cdk/aws-dynamodb";
import { Queue } from "@aws-cdk/aws-sqs";
import { Topic } from "@aws-cdk/aws-sns";
import {
  SnsEventSource,
  SqsEventSource,
} from "@aws-cdk/aws-lambda-event-sources";
import {
  PolicyStatementProps,
  Role,
  Policy,
  PolicyStatement,
  ServicePrincipal,
} from "@aws-cdk/aws-iam";

const { PWD = "" } = process.env;
const DEFAULT_SPREAD = "3";

export class CryptoBotStack extends Stack {
  private _usersTable: Table;
  private _tradersTable: Table;
  private _tradersQueue: Queue;
  private _tradersDeadLetterQueue: Queue;
  private _fcmTopic: Topic;
  private _fcmKey: CfnParameter;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    this.createTraderLambda();
    this.createTraderDlqLambda();
    this.createFcmLambda();
    this.createAPI();
  }

  get fcmKey(): CfnParameter {
    if (!this._fcmKey) {
      this._fcmKey = new CfnParameter(this, "fcmKey", {
        description: "The FCM key",
      });
    }

    return this._fcmKey;
  }

  get usersTable(): Table {
    if (!this._usersTable) {
      this._usersTable = new Table(this, "users-table", {
        partitionKey: {
          name: "UserName",
          type: AttributeType.STRING,
        },
        readCapacity: 1,
        writeCapacity: 1,
      });
    }

    return this._usersTable;
  }

  get tradersTable(): Table {
    if (!this._tradersTable) {
      this._tradersTable = new Table(this, "traders-table", {
        partitionKey: {
          name: "UserName",
          type: AttributeType.STRING,
        },
        sortKey: {
          name: "Code",
          type: AttributeType.STRING,
        },
      });
    }

    return this._tradersTable;
  }

  get tradersDeadLetterQueue(): Queue {
    if (!this._tradersDeadLetterQueue) {
      this._tradersDeadLetterQueue = new Queue(this, "traders-dlq", {
        fifo: true,
      });
    }

    return this._tradersDeadLetterQueue;
  }

  get tradersQueue(): Queue {
    if (!this._tradersQueue) {
      this._tradersQueue = new Queue(this, "traders-queue", {
        fifo: true,
        deliveryDelay: Duration.seconds(5),
        visibilityTimeout: Duration.minutes(1),
        deadLetterQueue: {
          queue: this.tradersDeadLetterQueue,
          maxReceiveCount: 3,
        },
      });
    }

    return this._tradersQueue;
  }

  get fcmTopic(): Topic {
    if (!this._fcmTopic) {
      this._fcmTopic = new Topic(this, "fcm-topic", {
        displayName: "FCM topic",
      });
    }

    return this._fcmTopic;
  }

  createCryptoMktLambda(): Function {
    const codePath = path.join(PWD, "src", "cryptomkt", "build");

    return new Function(this, "cryptomkt-lambda", {
      code: Code.fromAsset(codePath),
      handler: "cryptomkt/src/index.handler",
      runtime: Runtime.NODEJS_12_X,
      timeout: Duration.seconds(10),
      environment: {
        REGION: this.region,
        USERS_TABLE_NAME: this.usersTable.tableName,
      },
    });
  }

  createTokenLambda(): Function {
    const codePath = path.join(PWD, "src", "auth", "build");

    return new Function(this, "token-lambda", {
      code: Code.fromAsset(codePath),
      handler: "auth/src/index.tokenHandler",
      runtime: Runtime.NODEJS_12_X,
      environment: {
        REGION: this.region,
        USERS_TABLE_NAME: this.usersTable.tableName,
      },
    });
  }

  createLambdaAuthorizer(): TokenAuthorizer {
    const codePath = path.join(PWD, "src", "auth", "build");

    const handler = new Function(this, "auth-lambda", {
      code: Code.fromAsset(codePath),
      handler: "auth/src/index.authorizerHandler",
      runtime: Runtime.NODEJS_12_X,
      environment: {
        REGION: this.region,
        USERS_TABLE_NAME: this.usersTable.tableName,
      },
    });

    this.usersTable.grant(handler, "dynamodb:Scan");

    return new TokenAuthorizer(this, "lambda-authorizer", {
      handler,
      resultsCacheTtl: Duration.hours(1),
    });
  }

  createTraderLambda(): Function {
    const codePath = path.join(PWD, "src", "trader", "build");
    const lambda = new Function(this, "trader-lambda", {
      code: Code.fromAsset(codePath),
      handler: "trader/src/index.traderHandler",
      runtime: Runtime.NODEJS_12_X,
      timeout: Duration.seconds(30),
      environment: {
        REGION: this.region,
        TABLE_NAME: this.tradersTable.tableName,
        USERS_TABLE_NAME: this.usersTable.tableName,
        QUEUE_URL: this.tradersQueue.queueUrl,
        FCM_TOPIC: this.fcmTopic.topicArn,
        CRYPTOMKT_LIMIT: "100",
        DEFAULT_SPREAD,
      },
    });

    // Grant permissions to DynamoDB
    this.usersTable.grant(lambda, "dynamodb:Scan");
    this.tradersTable.grant(lambda, "dynamodb:Query", "dynamodb:UpdateItem");

    // Grant permissions to send SQS messages
    this.tradersQueue.grant(lambda, "sqs:SendMessage");
    this.fcmTopic.grantPublish(lambda);

    // Trigger Lambda with queue
    lambda.addEventSource(
      new SqsEventSource(this.tradersQueue, { batchSize: 1 })
    );

    return lambda;
  }

  createTraderDlqLambda(): Function {
    const codePath = path.join(PWD, "src", "trader", "build");
    const lambda = new Function(this, "trader-dlq-lambda", {
      code: Code.fromAsset(codePath),
      handler: "trader/src/index.dlqHandler",
      runtime: Runtime.NODEJS_12_X,
      timeout: Duration.seconds(10),
      environment: {
        REGION: this.region,
        TABLE_NAME: this.tradersTable.tableName,
        USERS_TABLE_NAME: this.usersTable.tableName,
        FCM_TOPIC: this.fcmTopic.topicArn,
      },
    });

    // Grant permissions to DynamoDB
    this.usersTable.grant(lambda, "dynamodb:Scan");
    this.tradersTable.grant(lambda, "dynamodb:Query", "dynamodb:DeleteItem");
    this.fcmTopic.grantPublish(lambda);

    // Trigger Lambda with DLQ
    lambda.addEventSource(
      new SqsEventSource(this.tradersDeadLetterQueue, { batchSize: 1 })
    );

    return lambda;
  }

  createFcmLambda(): Function {
    const codePath = path.join(PWD, "src", "fcm", "build");
    const lambda = new Function(this, "fcm-lambda", {
      code: Code.fromAsset(codePath),
      handler: "index.handler",
      runtime: Runtime.NODEJS_12_X,
      timeout: Duration.seconds(10),
      environment: {
        FCM_KEY: this.fcmKey.valueAsString,
        FCM_TOPIC: this.fcmTopic.topicArn,
      },
    });

    // Trigger Lambda with queue
    lambda.addEventSource(new SnsEventSource(this.fcmTopic));

    return lambda;
  }

  createAPI(): RestApi {
    // API
    const apiName = "trader-api";
    const api = new RestApi(this, apiName, {
      defaultCorsPreflightOptions: {
        allowOrigins: Cors.ALL_ORIGINS,
      },
      deployOptions: {
        stageName: "api",
      },
    });

    // Authorizer
    const lambdaAuthorizer = this.createLambdaAuthorizer();

    // Resources
    const cryptoMktResource = api.root.addResource("cryptomkt");
    const authResource = api.root.addResource("auth");
    const marketResource = api.root.addResource("{market}");
    const sideResource = marketResource.addResource("{side}");
    const fcmTokensListResource = api.root.addResource("fcm-tokens");
    const fcmTokenDetailResource = fcmTokensListResource.addResource("{token}");

    // Models
    const authModel = this.createAuthModel(api);
    const traderModel = this.createTraderModel(api);
    const fcmTokenModel = this.createFcmTokenModel(api);

    // Validators
    const requestValidator = new RequestValidator(this, "body-validator", {
      restApi: api,
      validateRequestBody: true,
    });

    // Methods
    const proxyResource = cryptoMktResource.addProxy({
      anyMethod: false,
    });
    proxyResource.addMethod("ANY", this.createCryptoMktIntegration(), {
      authorizationType: AuthorizationType.CUSTOM,
      authorizer: lambdaAuthorizer,
    });
    authResource.addMethod("POST", this.createTokenIntegration(), {
      requestModels: {
        "application/json": authModel,
      },
      methodResponses: [{ statusCode: "200" }, { statusCode: "401" }],
    });

    sideResource.addMethod("GET", this.createTraderGetIntegration(), {
      authorizationType: AuthorizationType.CUSTOM,
      authorizer: lambdaAuthorizer,
      methodResponses: [
        {
          statusCode: "200",
          responseModels: {
            "application/json": traderModel,
          },
          responseParameters: {
            "method.response.header.Access-Control-Allow-Origin": true,
          },
        },
      ],
    });

    sideResource.addMethod("PUT", this.createTraderPutIntegration(), {
      authorizationType: AuthorizationType.CUSTOM,
      authorizer: lambdaAuthorizer,
      requestModels: {
        "application/json": traderModel,
      },
      requestValidator,
      methodResponses: [
        {
          statusCode: "200",
          responseParameters: {
            "method.response.header.Access-Control-Allow-Origin": true,
          },
        },
      ],
    });

    const fcmTokenResourceRole = this.createRole(
      "fcm-token-resource",
      "apigateway.amazonaws.com",
      [
        {
          actions: ["dynamodb:UpdateItem"],
          resources: [this.usersTable.tableArn],
        },
      ]
    );

    fcmTokensListResource.addMethod(
      "POST",
      this.createFcmTokenPostIntegration(fcmTokenResourceRole),
      {
        authorizationType: AuthorizationType.CUSTOM,
        authorizer: lambdaAuthorizer,
        requestModels: {
          "application/json": fcmTokenModel,
        },
        requestValidator,
        methodResponses: [
          {
            statusCode: "201",
            responseParameters: {
              "method.response.header.Access-Control-Allow-Origin": true,
            },
          },
        ],
      }
    );

    fcmTokenDetailResource.addMethod(
      "DELETE",
      this.createFcmTokenDeleteIntegration(fcmTokenResourceRole),
      {
        authorizationType: AuthorizationType.CUSTOM,
        authorizer: lambdaAuthorizer,
        methodResponses: [
          {
            statusCode: "204",
            responseParameters: {
              "method.response.header.Access-Control-Allow-Origin": true,
            },
          },
        ],
      }
    );

    return api;
  }

  createAuthModel(restApi: RestApi): Model {
    return new Model(this, "auth-model", {
      restApi,
      modelName: "Auth",
      schema: {
        type: JsonSchemaType.OBJECT,
        properties: {
          username: {
            type: JsonSchemaType.STRING,
          },
          password: {
            type: JsonSchemaType.STRING,
          },
        },
        required: ["username", "password"],
      },
    });
  }

  createTraderModel(restApi: RestApi): Model {
    return new Model(this, "trader-model", {
      restApi,
      modelName: "Trader",
      schema: {
        type: JsonSchemaType.OBJECT,
        properties: {
          amount: {
            type: JsonSchemaType.STRING,
          },
          spread: {
            type: JsonSchemaType.STRING,
          },
          fiat: {
            type: JsonSchemaType.STRING,
          },
        },
        required: ["amount"],
        oneOf: [{ required: ["spread"] }, { required: ["fiat"] }],
      },
    });
  }

  createFcmTokenModel(restApi: RestApi): Model {
    return new Model(this, "fcm-token-model", {
      restApi,
      modelName: "FcmToken",
      schema: {
        type: JsonSchemaType.OBJECT,
        properties: {
          token: {
            type: JsonSchemaType.STRING,
          },
        },
        required: ["token"],
      },
    });
  }

  createCryptoMktIntegration(): LambdaIntegration {
    const cryptoMktLambda = this.createCryptoMktLambda();

    // Grant permission to fetch the users
    this.usersTable.grant(cryptoMktLambda, "dynamodb:Scan");

    return new LambdaIntegration(cryptoMktLambda);
  }

  createTokenIntegration(): LambdaIntegration {
    const tokenLambda = this.createTokenLambda();

    // Grant permission to fetch the users
    this.usersTable.grant(tokenLambda, "dynamodb:Scan");

    return new LambdaIntegration(tokenLambda);
  }

  createTraderGetIntegration(): AwsIntegration {
    const credentialsRole = this.createRole(
      "trader-api-get",
      "apigateway.amazonaws.com",
      [
        {
          actions: ["dynamodb:Query"],
          resources: [this.tradersTable.tableArn],
        },
      ]
    );

    return new AwsIntegration({
      service: "dynamodb",
      action: "Query",
      options: {
        credentialsRole,
        requestTemplates: {
          "application/json": `{
            "TableName": "${this.tradersTable.tableName}",
            "KeyConditionExpression": "UserName = :username AND Code = :code",
            "ExpressionAttributeValues": {
              ":username": {
                "S": "$context.authorizer.username"
              },
              ":code": {
                "S": "$input.params('market')-$input.params('side')"
              }
            },
            "ConsistentRead": true
          }`,
        },
        integrationResponses: [
          {
            statusCode: "200",
            selectionPattern: "200",
            responseParameters: {
              "method.response.header.Access-Control-Allow-Origin": "'*'",
            },
            responseTemplates: {
              "application/json": `
                #set($orders = $input.path("$.Items"))
                #foreach($order in $orders)
                    #if($order.Side.S == $input.params('side'))
                        #set($item = $order)
                    #end
                #end

                {
                #if($item != "")
                  "amount": "$item.Amount.S",
                  "price": "$item.Price.S",
                  #if($input.params('side') == 'sell')
                  "spread": "$item.Spread.S"
                  #else
                  "fiat": "$item.Fiat.S"
                  #end
                #else
                  "amount": "0",
                  "price": "0",
                  #if($input.params('side') == 'sell')
                  "spread": "${DEFAULT_SPREAD}"
                  #else
                  "fiat": "0"
                  #end
                #end
                }
              `,
            },
          },
        ],
      },
    });
  }

  createTraderPutIntegration(): AwsIntegration {
    const credentialsRole = this.createRole(
      "trader-api-put",
      "apigateway.amazonaws.com",
      [
        {
          actions: ["sqs:SendMessage"],
          resources: [this.tradersQueue.queueArn],
        },
      ]
    );

    const template = `
      #set($market = $input.params('market'))
      #set($side = $input.params('side'))
      #set($username = $context.authorizer.username)
      Action=SendMessage&QueueName=${this.tradersQueue.queueName}&MessageGroupId=\${username}&MessageDeduplicationId=$context.requestTimeEpoch&MessageBody={
        "username": "$username",
        "market": "$market",
        "side": "$side",
        "amount": $input.json('$.amount'),
        #if($side == 'sell')
        "spread": $input.json('$.spread')
        #else
        "fiat": $input.json('$.fiat')
        #end
      }`;

    return new AwsIntegration({
      service: "sqs",
      path: `${Aws.ACCOUNT_ID}/${this.tradersQueue.queueName}`,
      options: {
        credentialsRole,
        requestParameters: {
          "integration.request.header.Content-Type":
            "'application/x-www-form-urlencoded'",
        },
        requestTemplates: {
          "application/json": template.trim().replace(/ /g, ""),
        },
        integrationResponses: [
          {
            statusCode: "200",
            selectionPattern: "200",
            responseTemplates: {
              "application/json": "{}",
            },
            responseParameters: {
              "method.response.header.Access-Control-Allow-Origin": "'*'",
            },
          },
        ],
      },
    });
  }

  createFcmTokenDeleteIntegration(credentialsRole: Role): AwsIntegration {
    return new AwsIntegration({
      service: "dynamodb",
      action: "UpdateItem",
      options: {
        credentialsRole,
        requestTemplates: {
          "application/json": `{
            "TableName": "${this.usersTable.tableName}",
            "Key": {
              "UserName": {
                "S": "$context.authorizer.username"
              }
            },
            "UpdateExpression": "DELETE DeviceTokens :token",
            "ExpressionAttributeValues": {
              ":token": {
                "SS": ["$input.params('token')"]
              }
            }
          }`,
        },
        integrationResponses: [
          {
            statusCode: "204",
            selectionPattern: "200",
            responseParameters: {
              "method.response.header.Access-Control-Allow-Origin": "'*'",
            },
            responseTemplates: {
              "application/json": "{}",
            },
          },
        ],
      },
    });
  }

  createFcmTokenPostIntegration(credentialsRole: Role): AwsIntegration {
    return new AwsIntegration({
      service: "dynamodb",
      action: "UpdateItem",
      options: {
        credentialsRole,
        requestTemplates: {
          "application/json": `{
            "TableName": "${this.usersTable.tableName}",
            "Key": {
              "UserName": {
                "S": "$context.authorizer.username"
              }
            },
            "UpdateExpression": "ADD DeviceTokens :token",
            "ExpressionAttributeValues": {
              ":token": {
                "SS": ["$input.path('$.token')"]
              }
            }
          }`,
        },
        integrationResponses: [
          {
            statusCode: "201",
            selectionPattern: "200",
            responseParameters: {
              "method.response.header.Access-Control-Allow-Origin": "'*'",
            },
            responseTemplates: {
              "application/json": "{}",
            },
          },
        ],
      },
    });
  }

  createRole(
    name: string,
    assumedBy: string,
    statements: PolicyStatementProps[]
  ): Role {
    const policy = new Policy(this, `${name}-policy`, {
      statements: statements.map((s) => new PolicyStatement(s)),
    });
    const role = new Role(this, `${name}-role`, {
      assumedBy: new ServicePrincipal(assumedBy),
    });
    role.attachInlinePolicy(policy);

    return role;
  }
}
