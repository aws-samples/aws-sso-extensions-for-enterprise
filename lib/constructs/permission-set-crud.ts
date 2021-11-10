/*
composite construct that sets up all resources
for permission set CRUD operations and handles both API
and S3 interfaces
*/

import { LambdaRestApi } from "@aws-cdk/aws-apigateway";
import {
  AttributeType,
  BillingMode,
  StreamViewType,
  Table,
  TableEncryption,
} from "@aws-cdk/aws-dynamodb";
import { Role } from "@aws-cdk/aws-iam";
import { Key } from "@aws-cdk/aws-kms";
import { LayerVersion, Runtime } from "@aws-cdk/aws-lambda";
import { NodejsFunction } from "@aws-cdk/aws-lambda-nodejs";
import { Bucket, EventType } from "@aws-cdk/aws-s3";
import { LambdaDestination } from "@aws-cdk/aws-s3-notifications";
import { CfnOutput, Construct, RemovalPolicy } from "@aws-cdk/core";
import { join } from "path";
import { BuildConfig } from "../build/buildConfig";
import { LambdaProxyAPI } from "./lambda-proxy-api";

function name(buildConfig: BuildConfig, resourcename: string): string {
  return buildConfig.Environment + "-" + resourcename;
}

export interface PermissionSetCRUDProps {
  readonly nodeJsLayer: LayerVersion;
  readonly linksTableName: string;
  readonly errorNotificationsTopicArn: string;
  readonly ssoArtefactsBucket: Bucket;
  readonly ddbTablesKey: Key;
  readonly logsKey: Key;
}

export class PermissionSetCRUD extends Construct {
  public readonly permissionSetTable: Table;
  public readonly permissionSetArnTable: Table;
  public readonly permissionSetAPIHandler: NodejsFunction;
  public readonly permissionSetAPI: LambdaRestApi;
  public readonly permissionSetCuHandler: NodejsFunction;
  public readonly permissionSetDelHandler: NodejsFunction;

  constructor(
    scope: Construct,
    id: string,
    buildConfig: BuildConfig,
    PermissionSetCRUDProps: PermissionSetCRUDProps
  ) {
    super(scope, id);

    this.permissionSetTable = new Table(
      this,
      name(buildConfig, "permissionSetTable"),
      {
        partitionKey: {
          name: "permissionSetName",
          type: AttributeType.STRING,
        },
        tableName: name(buildConfig, "permissionSetTable"),
        billingMode: BillingMode.PAY_PER_REQUEST,
        encryption: TableEncryption.CUSTOMER_MANAGED,
        encryptionKey: PermissionSetCRUDProps.ddbTablesKey,
        stream: StreamViewType.NEW_AND_OLD_IMAGES,
        pointInTimeRecovery: true,
        removalPolicy: RemovalPolicy.DESTROY,
      }
    );

    this.permissionSetArnTable = new Table(
      this,
      name(buildConfig, "permissionSetArnTable"),
      {
        partitionKey: {
          name: "permissionSetName",
          type: AttributeType.STRING,
        },
        tableName: name(buildConfig, "permissionSetArnTable"),
        billingMode: BillingMode.PAY_PER_REQUEST,
        encryption: TableEncryption.CUSTOMER_MANAGED,
        encryptionKey: PermissionSetCRUDProps.ddbTablesKey,
        pointInTimeRecovery: true,
        removalPolicy: RemovalPolicy.DESTROY,
      }
    );

    if (
      buildConfig.Parameters.PermissionSetProvisioningMode.toLowerCase() ===
      "api"
    ) {
      this.permissionSetAPIHandler = new NodejsFunction(
        this,
        name(buildConfig, "psApiHandler"),
        {
          functionName: name(buildConfig, "psApiHandler"),
          runtime: Runtime.NODEJS_14_X,
          entry: join(
            __dirname,
            "../",
            "lambda-functions",
            "ddb-import-handlers",
            "src",
            "permissionSetApi.ts"
          ),
          bundling: {
            minify: true,
            externalModules: [
              "@aws-sdk/client-dynamodb",
              "@aws-sdk/client-s3",
              "@aws-sdk/lib-dynamodb",
              "ajv",
            ],
          },
          layers: [PermissionSetCRUDProps.nodeJsLayer],
          environment: {
            DdbTable: this.permissionSetTable.tableName,
            AWS_NODEJS_CONNECTION_REUSE_ENABLED: "1",
            corsOrigin: "'*'",
            linksTable: PermissionSetCRUDProps.linksTableName,
            artefactsBucketName:
              PermissionSetCRUDProps.ssoArtefactsBucket.bucketName,
          },
        }
      );

      this.permissionSetAPI = new LambdaProxyAPI(
        this,
        name(buildConfig, "permissionSetAPI"),
        buildConfig,
        {
          apiCallerRoleArn: buildConfig.Parameters.PermissionSetCallerRoleArn,
          apiNameKey: "permissionSetApi",
          apiResourceName: "postPermissionSetData",
          methodtype: "POST",
          proxyfunction: this.permissionSetAPIHandler,
          apiEndPointReaderAccountID:
            buildConfig.PipelineSettings.DeploymentAccountId,
        }
      ).lambdaProxyAPI;
    } else {
      this.permissionSetCuHandler = new NodejsFunction(
        this,
        name(buildConfig, "psCuHandler"),
        {
          functionName: name(buildConfig, "psCuHandler"),
          runtime: Runtime.NODEJS_14_X,
          entry: join(
            __dirname,
            "../",
            "lambda-functions",
            "ddb-import-handlers",
            "src",
            "permissionSetCu.ts"
          ),
          bundling: {
            minify: true,
            externalModules: [
              "@aws-sdk/client-dynamodb",
              "@aws-sdk/client-s3",
              "@aws-sdk/client-sns",
              "@aws-sdk/lib-dynamodb",
              "ajv",
            ],
          },
          layers: [PermissionSetCRUDProps.nodeJsLayer],
          environment: {
            DdbTable: this.permissionSetTable.tableName,
            AWS_NODEJS_CONNECTION_REUSE_ENABLED: "1",
            errorNotificationsTopicArn:
              PermissionSetCRUDProps.errorNotificationsTopicArn,
          },
        }
      );

      PermissionSetCRUDProps.ssoArtefactsBucket.addEventNotification(
        EventType.OBJECT_CREATED,
        new LambdaDestination(this.permissionSetCuHandler),
        {
          prefix: "permission_sets/",
          suffix: ".json",
        }
      );

      const permissionSetCallerRole = Role.fromRoleArn(
        this,
        name(buildConfig, "importedLinkCallerRole"),
        buildConfig.Parameters.PermissionSetCallerRoleArn
      );

      PermissionSetCRUDProps.ssoArtefactsBucket.grantReadWrite(
        permissionSetCallerRole
      );

      PermissionSetCRUDProps.ssoArtefactsBucket.encryptionKey?.grantEncryptDecrypt(
        permissionSetCallerRole
      );

      this.permissionSetDelHandler = new NodejsFunction(
        this,
        name(buildConfig, "psDelHandler"),
        {
          functionName: name(buildConfig, "psDelHandler"),
          runtime: Runtime.NODEJS_14_X,
          entry: join(
            __dirname,
            "../",
            "lambda-functions",
            "ddb-import-handlers",
            "src",
            "permissionSetDel.ts"
          ),
          bundling: {
            minify: true,
            externalModules: [
              "@aws-sdk/client-dynamodb",
              "@aws-sdk/client-sns",
              "@aws-sdk/lib-dynamodb",
              "ajv",
            ],
          },
          layers: [PermissionSetCRUDProps.nodeJsLayer],
          environment: {
            DdbTable: this.permissionSetTable.tableName,
            AWS_NODEJS_CONNECTION_REUSE_ENABLED: "1",
            errorNotificationsTopicArn:
              PermissionSetCRUDProps.errorNotificationsTopicArn,
            linksTable: PermissionSetCRUDProps.linksTableName,
          },
        }
      );

      PermissionSetCRUDProps.ssoArtefactsBucket.addEventNotification(
        EventType.OBJECT_REMOVED,
        new LambdaDestination(this.permissionSetDelHandler),
        {
          prefix: "permission_sets/",
          suffix: ".json",
        }
      );

      new CfnOutput(this, name(buildConfig, "permission-sets-location"), {
        exportName: "permission-sets-location",
        value: `s3://${PermissionSetCRUDProps.ssoArtefactsBucket.bucketName}/permission_sets/`,
      });
    }
  }
}
