/**
 * Construct used for discovering SSO objects, i.e. permission sets and account
 * assignments. This construct is to be run in target account + region. It will
 * deploy a collection of lambda functions.
 */
import { Duration } from "aws-cdk-lib";
import { ITable, Table } from "aws-cdk-lib/aws-dynamodb";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import { IKey, Key } from "aws-cdk-lib/aws-kms";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { ILayerVersion } from "aws-cdk-lib/aws-lambda";
import {
  SnsEventSource,
  SqsEventSource,
} from "aws-cdk-lib/aws-lambda-event-sources";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Bucket, IBucket } from "aws-cdk-lib/aws-s3";
import { ITopic, Topic } from "aws-cdk-lib/aws-sns";
import { EmailSubscription } from "aws-cdk-lib/aws-sns-subscriptions";
import { Queue, QueueEncryption } from "aws-cdk-lib/aws-sqs";
import { StringParameter } from "aws-cdk-lib/aws-ssm";
import { Construct } from "constructs";
import { join } from "path";
import { BuildConfig } from "../build/buildConfig";
import { SSMParamReader } from "./ssm-param-reader";

function name(buildConfig: BuildConfig, resourcename: string): string {
  return buildConfig.Environment + "-" + resourcename;
}

export class SSOObjectsDiscoveryPart2 extends Construct {
  public readonly nodeJsLayer: ILayerVersion;
  public readonly accountAssignmentImportTopic: ITopic;
  public readonly permissionSetImportTopic: ITopic;
  public readonly currentConfigSMInvokeRoleArn: string;
  public readonly currentConfigSMDescribeRoleArn: string;
  public readonly importedPermissionSetHandlerSSOAPIRoleArn: string;
  public readonly importedSsoArtefactsBucket: IBucket;
  public readonly importedPsTable: ITable;
  public readonly importedPsArnTable: ITable;
  public readonly importedLinksTable: ITable;
  public readonly importedProvisionedLinksTable: ITable;
  public readonly importedddbTablesKey: IKey;
  public readonly importAccountAssignmentHandler: NodejsFunction;
  public readonly importPermissionSetHandler: NodejsFunction;

  constructor(scope: Construct, id: string, buildConfig: BuildConfig) {
    super(scope, id);

    /**
     * Import resources created in part 1 (SSO account + region) as local
     * resources so that they could be used in part 2 (target account + region)
     * We use either native SSM CDK construct / custom SSM reader construct
     * depending on if the paraemter is local to target account/not
     */

    this.nodeJsLayer = lambda.LayerVersion.fromLayerVersionArn(
      this,
      name(buildConfig, "importedNodeJsLayerVersion"),
      StringParameter.valueForStringParameter(
        this,
        name(buildConfig, "nodeJsLayerVersionArn")
      ).toString()
    );

    this.importedddbTablesKey = Key.fromKeyArn(
      this,
      name(buildConfig, "importedDdbTablesKey"),
      StringParameter.valueForStringParameter(
        this,
        name(buildConfig, "ddbTablesKeyArn")
      )
    );

    this.currentConfigSMInvokeRoleArn = new SSMParamReader(
      this,
      name(buildConfig, "ssoListRoleArnpr"),
      buildConfig,
      {
        ParamAccountId: buildConfig.PipelineSettings.SSOServiceAccountId,
        ParamRegion: buildConfig.PipelineSettings.SSOServiceAccountRegion,
        ParamNameKey: "smStartExecution-smapi-roleArn",
      }
    ).paramValue;

    this.currentConfigSMDescribeRoleArn = new SSMParamReader(
      this,
      name(buildConfig, "currentConfigSMDescribeRoleArnpr"),
      buildConfig,
      {
        ParamAccountId: buildConfig.PipelineSettings.SSOServiceAccountId,
        ParamRegion: buildConfig.PipelineSettings.SSOServiceAccountRegion,
        ParamNameKey: "smDescribeSsoApi-roleArn",
      }
    ).paramValue;

    this.importedPermissionSetHandlerSSOAPIRoleArn = new SSMParamReader(
      this,
      name(buildConfig, "importedPermissionSetHandlerSSOAPIRoleArn"),
      buildConfig,
      {
        ParamAccountId: buildConfig.PipelineSettings.SSOServiceAccountId,
        ParamRegion: buildConfig.PipelineSettings.SSOServiceAccountRegion,
        ParamNameKey: "permissionSetHandler-ssoapi-roleArn",
      }
    ).paramValue;

    this.accountAssignmentImportTopic = Topic.fromTopicArn(
      this,
      name(buildConfig, "accountAssignmentImportTopic"),
      new SSMParamReader(
        this,
        name(buildConfig, "accountAssignmentImportTopicArnReader"),
        buildConfig,
        {
          ParamAccountId: buildConfig.PipelineSettings.SSOServiceAccountId,
          ParamRegion: buildConfig.PipelineSettings.SSOServiceAccountRegion,
          ParamNameKey: "importAccountAssignmentTopicArn", 
        } 
      ).paramValue
    );

    this.permissionSetImportTopic = Topic.fromTopicArn(
      this,
      name(buildConfig, "permissionSetImportTopic"),
      new SSMParamReader(
        this,
        name(buildConfig, "permissionSetImportTopicArnReader"),
        buildConfig,
        {
          ParamAccountId: buildConfig.PipelineSettings.SSOServiceAccountId,
          ParamRegion: buildConfig.PipelineSettings.SSOServiceAccountRegion,
          ParamNameKey: "importPermissionSetTopicArn", 
        }
      ).paramValue
    );

    this.importedSsoArtefactsBucket = Bucket.fromBucketName(
      this,
      name(buildConfig, "importedSsoArtefactsBucket"),
      StringParameter.valueForStringParameter(
        this,
        name(buildConfig, "ssoArtefactsBucketName")
      )
    );

    this.importedPsTable = Table.fromTableAttributes(
      this,
      name(buildConfig, "importedPsTable"),
      {
        tableArn: StringParameter.valueForStringParameter(
          this,
          name(buildConfig, "permissionSetTableArn")
        ),
      }
    );

    this.importedPsArnTable = Table.fromTableArn(
      this,
      name(buildConfig, "importedPsArnTable"),
      StringParameter.valueForStringParameter(
        this,
        name(buildConfig, "permissionSetArnTableArn")
      )
    );

    this.importedLinksTable = Table.fromTableAttributes(
      this,
      name(buildConfig, "importedLinksTable"),
      {
        tableArn: StringParameter.valueForStringParameter(
          this,
          name(buildConfig, "linksTableArn")
        ),
        globalIndexes: [
          "awsEntityData",
          "principalName",
          "permissionSetName",
          "principalType",
        ],
      }
    );

    this.importedProvisionedLinksTable = Table.fromTableAttributes(
      this,
      name(buildConfig, "importedProvisionedLinksTable"),
      {
        tableArn: StringParameter.valueForStringParameter(
          this,
          name(buildConfig, "provisionedLinksTableArn")
        ),
        globalIndexes: ["tagKeyLookUp"],
      }
    );

    /**
     * Define the lambda handlers that would subscribe to cross account topics
     * used in part 1 and consume the SSO object payload sent by the discovery
     * state machines
     */
    this.importAccountAssignmentHandler = new NodejsFunction(
      this,
      name(buildConfig, `importAccountAssignmentsHandler`),
      {
        runtime: lambda.Runtime.NODEJS_16_X,
        functionName: name(buildConfig, `importAccountAssignmentsHandler`),
        layers: [this.nodeJsLayer],
        entry: join(
          __dirname,
          "../",
          "lambda-functions",
          "current-config-handlers",
          "src",
          "import-account-assignments.ts"
        ),
        bundling: {
          externalModules: [
            "uuid",
            "@aws-sdk/client-dynamodb",
            "@aws-sdk/lib-dynamodb",
            "@aws-sdk/client-s3",
            "@aws-sdk/client-ssm",
            "@aws-sdk/client-sqs",
          ],
          minify: true,
        },
        environment: {
          linksTableName: this.importedLinksTable.tableName,
          provisionedLinksTableName:
            this.importedProvisionedLinksTable.tableName,
          artefactsBucketName: this.importedSsoArtefactsBucket.bucketName,
          configEnv: buildConfig.Environment,
        },
      }
    );

    /**
     * Grant the lambda handler permissions on the tables and keys for importing
     * data and managing the required SSO state
     */

    this.importedddbTablesKey.grantEncryptDecrypt(
      this.importAccountAssignmentHandler
    );

    this.importedLinksTable.grantReadWriteData(
      this.importAccountAssignmentHandler
    );
    this.importedProvisionedLinksTable.grantReadWriteData(
      this.importAccountAssignmentHandler
    );

    this.importedSsoArtefactsBucket.grantReadWrite(
      this.importAccountAssignmentHandler
    );

    /** Subscribe the lambda to the cross account SNS topic */
    this.importAccountAssignmentHandler.addEventSource(
      new SnsEventSource(this.accountAssignmentImportTopic)
    );

    /**
     * Define the lambda handlers that would subscribe to cross account topics
     * used in part 1 and consume the SSO object payload sent by the discovery
     * state machines
     */

    this.importPermissionSetHandler = new NodejsFunction(
      this,
      name(buildConfig, `importPermissionSetHandler`),
      {
        runtime: lambda.Runtime.NODEJS_16_X,
        functionName: name(buildConfig, `importPermissionSetsHandler`),
        layers: [this.nodeJsLayer],
        entry: join(
          __dirname,
          "../",
          "lambda-functions",
          "current-config-handlers",
          "src",
          "import-permission-sets.ts"
        ),
        bundling: {
          externalModules: [
            "uuid",
            "json-diff",
            "@aws-sdk/client-dynamodb",
            "@aws-sdk/client-sso-admin",
            "@aws-sdk/credential-providers",
            "@aws-sdk/lib-dynamodb",
            "@aws-sdk/client-s3",
            "@aws-sdk/client-ssm",
            "@aws-sdk/client-sqs",
          ],
          minify: true,
        },
        environment: {
          permissionSetTableName: this.importedPsTable.tableName,
          permissionSetArnTableName: this.importedPsArnTable.tableName,
          SSOAPIRoleArn: this.importedPermissionSetHandlerSSOAPIRoleArn,
          ssoRegion: buildConfig.PipelineSettings.SSOServiceAccountRegion,
          artefactsBucketName: this.importedSsoArtefactsBucket.bucketName,
          configEnv: buildConfig.Environment,
        },
      }
    );
    /**
     * Grant the lambda handler permissions on the tables and keys for importing
     * data and managing the required SSO state
     */
    this.importedddbTablesKey.grantEncryptDecrypt(
      this.importPermissionSetHandler
    );

    this.importedPsTable.grantReadWriteData(this.importPermissionSetHandler);
    this.importedPsArnTable.grantReadWriteData(this.importPermissionSetHandler);

    this.importedSsoArtefactsBucket.grantReadWrite(
      this.importPermissionSetHandler
    );

    if (this.importPermissionSetHandler.role) {
      this.importPermissionSetHandler.addToRolePolicy(
        new PolicyStatement({
          resources: [this.importedPermissionSetHandlerSSOAPIRoleArn],
          actions: ["sts:AssumeRole"],
        })
      );
    }

    /** Subscribe the lambda to the cross account SNS topic */
    this.importPermissionSetHandler.addEventSource(
      new SnsEventSource(this.permissionSetImportTopic)
    );

    /**
     * As part of nightlyRun use case, we create 2 SQS FIFO queues for managing
     * deviations as well as the subscriber lambda functions for these queues to
     * process message payloads. We also import references to other resources
     * created in prior stacks for processing the remediation
     */
    /** Import the existing SQS key created in the preSolutionArtefacts stage */
    const sqsKey = Key.fromKeyArn(
      this,
      name(buildConfig, "importedSQSKeyArn"),
      StringParameter.valueForStringParameter(
        this,
        name(buildConfig, `queuesKeyArn`)
      )
    );

    /** Import the nightlyRun role arn to use in the processing lambda */
    const nightlyRunRoleArn = new SSMParamReader(
      this,
      name(buildConfig, "nightlyRunRoleArnpr"),
      buildConfig,
      {
        ParamAccountId: buildConfig.PipelineSettings.SSOServiceAccountId,
        ParamRegion: buildConfig.PipelineSettings.SSOServiceAccountRegion,
        ParamNameKey: "nightlyRun-ssoapi-roleArn",
      }
    ).paramValue;
    /** Create common DLQ for both nightly run queues */
    const nightlyRunDLQ = new Queue(this, name(buildConfig, `nightlyRunDLQ`), {
      fifo: true,
      encryption: QueueEncryption.KMS,
      encryptionMasterKey: sqsKey,
      visibilityTimeout: Duration.hours(10),
      queueName: name(buildConfig, "nightlyRunDLQ.fifo"),
    });
    /**
     * Create one queue - as strict ordering would be required such that account
     * assignments are remediated first and only then permission sets, as
     * otherwise the API call would fail due to related links being present
     */
    const nightlyRunDeviationQ = new Queue(
      this,
      name(buildConfig, "nightlyRunDeviationQ"),
      {
        fifo: true,
        encryption: QueueEncryption.KMS,
        encryptionMasterKey: sqsKey,
        visibilityTimeout: Duration.hours(2),
        contentBasedDeduplication: true,
        queueName: name(buildConfig, "nightlyRunDeviationQ.fifo"),
        deadLetterQueue: {
          queue: nightlyRunDLQ,
          maxReceiveCount: 4,
        },
      }
    );

    /** Grant the permissionsetHandler to post paylaods to the deviation queue */
    nightlyRunDeviationQ.grantSendMessages(this.importPermissionSetHandler);

    /** Grant the account assignmet handler to post paylaods to the deviation queue */
    nightlyRunDeviationQ.grantSendMessages(this.importAccountAssignmentHandler);

    /**
     * Export the queue link URL's as SSM parameters for import lambda's to read
     * from Also, grant the relevant handlers permission to read the parameter
     * values from
     */
    const nightlyRunDeviationQParam = new StringParameter(
      this,
      name(buildConfig, "nightlyRunDeviationQURL"),
      {
        parameterName: name(buildConfig, "nightlyRunDeviationQURL"),
        stringValue: nightlyRunDeviationQ.queueUrl,
      }
    );
    nightlyRunDeviationQParam.grantRead(this.importPermissionSetHandler);
    nightlyRunDeviationQParam.grantRead(this.importAccountAssignmentHandler);

    /** Create nightlyRunProcessing lambda */
    const nightlyRunProcessor = new NodejsFunction(
      this,
      name(buildConfig, `nightlyRunProcessor`),
      {
        runtime: lambda.Runtime.NODEJS_16_X,
        functionName: name(buildConfig, `nightlyRunProcessor`),
        layers: [this.nodeJsLayer],
        entry: join(
          __dirname,
          "../",
          "lambda-functions",
          "current-config-handlers",
          "src",
          "nightlyRun.ts"
        ),
        bundling: {
          externalModules: [
            "@aws-sdk/client-sns",
            "@aws-sdk/client-ssm",
            "@aws-sdk/client-sso-admin",
            "@aws-sdk/credential-providers",
          ],
          minify: true,
        },
        environment: {
          remediationMode: buildConfig.Parameters.NightlyRunRemediationMode,
          ssoRegion: buildConfig.PipelineSettings.SSOServiceAccountRegion,
          SSOAPIRoleArn: nightlyRunRoleArn,
          env: buildConfig.Environment,
        },
      }
    );

    nightlyRunProcessor.addEventSource(
      new SqsEventSource(nightlyRunDeviationQ, {
        batchSize: 5,
      })
    );

    if (nightlyRunProcessor.role) {
      nightlyRunProcessor.addToRolePolicy(
        new PolicyStatement({
          resources: [nightlyRunRoleArn],
          actions: ["sts:AssumeRole"],
        })
      );
    }

    if (
      buildConfig.Parameters.NightlyRunRemediationMode.toUpperCase() ===
      "NOTIFY"
    ) {
      /** Import the existing SNS key created in the preSolutionArtefacts stage */
      const snsKey = Key.fromKeyArn(
        this,
        name(buildConfig, "importedSNSKeyArn"),
        StringParameter.valueForStringParameter(
          this,
          name(buildConfig, "snsTopicsKeyArn")
        )
      );
      /** Create SNS topic for notifying nightly Run deviations */
      const nightlyRunNotificationTopic = new Topic(
        this,
        name(buildConfig, "nightlyRunNotificationTopic"),
        {
          displayName: name(buildConfig, "nightlyRunNotificationTopic"),
          masterKey: snsKey,
          topicName: name(buildConfig, "nightlyRunNotificationTopic"),
        }
      );
      /** Export the topic arn for the nightlyRun processor to read */
      const nightlyRunTopicArn = new StringParameter(
        this,
        name(buildConfig, "nightlyRunTopicArn"),
        {
          parameterName: name(buildConfig, "nightlyRunTopicArn"),
          stringValue: nightlyRunNotificationTopic.topicArn,
        }
      );
      /** Add notification email as a subscriber to the remediation topic */
      nightlyRunNotificationTopic.addSubscription(
        new EmailSubscription(buildConfig.Parameters.NotificationEmail)
      );
      /**
       * Grant nightlyRun processor permissions to post to the topic, topic arn
       * param read along with the KMS permissions
       */
      nightlyRunNotificationTopic.grantPublish(nightlyRunProcessor);
      snsKey.grantEncryptDecrypt(nightlyRunProcessor);
      nightlyRunTopicArn.grantRead(nightlyRunProcessor);
    }
  }
}
