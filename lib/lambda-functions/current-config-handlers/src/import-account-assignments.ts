/*
Objective: Import existing account assignments into the solution
*/

// Environment configuration read
const {
  linksTableName,
  provisionedLinksTableName,
  artefactsBucketName,
  configEnv,
  AWS_REGION,
} = process.env;
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import {
  DynamoDBDocumentClient,
  GetCommand,
  GetCommandOutput,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
// SDK and third party client imports
import { SNSEvent } from "aws-lambda";
import { v4 as uuidv4 } from "uuid";
import {
  LinkData,
  NightlyRunDeviationTypes,
  requestStatus,
} from "../../helpers/src/interfaces";
import { logger } from "../../helpers/src/utilities";

// SDK and third party client object initialistaion
const ddbClientObject = new DynamoDBClient({
  region: AWS_REGION,
  maxAttempts: 2,
});
const ddbDocClientObject = DynamoDBDocumentClient.from(ddbClientObject);
const s3clientObject = new S3Client({ region: AWS_REGION, maxAttempts: 2 });
const ssmClientObject = new SSMClient({ region: AWS_REGION, maxAttempts: 2 });
const sqsClientObject = new SQSClient({ region: AWS_REGION, maxAttempts: 2 });

export const handler = async (event: SNSEvent) => {
  /** Request ID for traceability */
  const requestId = uuidv4().toString();
  try {
    const message = JSON.parse(event.Records[0].Sns.Message);
    const provisionedLinksKey = `${
      message.provisionedLinksPayload.principalId
    }@${message.provisionedLinksPayload.targetId}@${
      message.linkPayload.PermissionSetArn.split("/")[1]
    }@${message.linkPayload.PermissionSetArn.split("/")[2]}`;
    logger({
      handler: "accountAssignmentImporter",
      logMode: "info",
      requestId: requestId,
      relatedData: provisionedLinksKey,
      status: requestStatus.InProgress,
      sourceRequestId: message.requestId,
      statusMessage: `Account assignment import operation in progress`,
    });

    /** Common code blocks for both import current config and nightly run use cases */
    const provisionedLinks: GetCommandOutput = await ddbDocClientObject.send(
      new GetCommand({
        TableName: provisionedLinksTableName,
        Key: {
          parentLink: provisionedLinksKey,
        },
      })
    );
    const linkParams: LinkData = {
      awsEntityId: `account%${message.linkPayload.awsEntityData}%${message.linkPayload.permissionSetName}%${message.entityName}%${message.entityType}%ssofile`,
      awsEntityType: "account",
      awsEntityData: message.linkPayload.awsEntityData,
      permissionSetName: message.linkPayload.permissionSetName,
      principalName: message.entityName,
      principalType: message.entityType,
    };
    if (message.triggerSource === "CloudFormation") {
      /**
       * If the account assignment link exists, then we complete the operation
       * as nothing needs to be done If the account assignment link does not
       * exist in the solution, then we persist this new link in the solution
       */
      if (provisionedLinks.Item) {
        logger({
          handler: "accountAssignmentImporter",
          logMode: "info",
          requestId: requestId,
          relatedData: provisionedLinksKey,
          status: requestStatus.Completed,
          sourceRequestId: message.requestId,
          statusMessage: `Account assignment import operation complete - link already exists`,
        });
      } else {
        /** Since the link is unknown to the solution, we persist this in the solution */
        await s3clientObject.send(
          new PutObjectCommand({
            Bucket: artefactsBucketName,
            Key: `links_data/${linkParams.awsEntityId}`,
            ServerSideEncryption: "AES256",
          })
        );
        await ddbDocClientObject.send(
          new PutCommand({
            TableName: linksTableName,
            Item: {
              ...linkParams,
            },
          })
        );
        await ddbClientObject.send(
          new PutCommand({
            TableName: provisionedLinksTableName,
            Item: {
              parentLink: provisionedLinksKey,
              tagKeyLookUp: "none",
              principalType: message.entityType,
            },
          })
        );
        logger({
          handler: "accountAssignmentImporter",
          logMode: "info",
          requestId: requestId,
          relatedData: provisionedLinksKey,
          status: requestStatus.Completed,
          sourceRequestId: message.requestId,
          statusMessage: `Account assignment import operation complete - link does not exist, so updated solution repository`,
        });
      }
    } else if (message.triggerSource === "EventBridge") {
      /**
       * If the link is already known to the solution, then there's nothing to
       * be done and we complete the operation If the link is unknown to the
       * solution, then this needs to be remediated as this is an unknown link
       */

      /** Read permissionSetDeviationQueueURL from SSM */
      const getParameterCommandOtpt = await ssmClientObject.send(
        new GetParameterCommand({
          Name: `${configEnv}-nightlyRunDeviationQURL`,
        })
      );

      const accountAssignmentDeviationQURL =
        getParameterCommandOtpt.Parameter?.Value || "";

      if (provisionedLinks.Item) {
        logger({
          handler: "accountAssignmentImporter",
          logMode: "info",
          requestId: requestId,
          relatedData: provisionedLinksKey,
          status: requestStatus.InProgress,
          sourceRequestId: message.requestId,
          statusMessage: `EventBridge mode - link already present.`,
        });
      } else {
        /** Nightly run remediation logic based on config option */
        logger({
          handler: "accountAssignmentImporter",
          logMode: "info",
          requestId: requestId,
          relatedData: provisionedLinksKey,
          status: requestStatus.Completed,
          sourceRequestId: message.requestId,
          statusMessage: `EventBridge mode - link not found in provisionedLinks table, therefore posting the payload to remediation topic`,
        });
        await sqsClientObject.send(
          new SendMessageCommand({
            QueueUrl: accountAssignmentDeviationQURL,
            MessageBody: JSON.stringify({
              deviationType: NightlyRunDeviationTypes.Unknown,
              sourceRequestId: message.requestId,
              objectType: "accountAssignment",
              permissionSetArn: message.linkPayload.PermissionSetArn,
              targetId: message.provisionedLinksPayload.targetId,
              principalId: message.provisionedLinksPayload.principalId,
              principalType: message.entityType,
            }),
            MessageDeduplicationId: `${NightlyRunDeviationTypes.Unknown}-${provisionedLinksKey}`,
            MessageGroupId: message.linkPayload.permissionSetName,
          })
        );
      }
    } else {
      logger({
        handler: "accountAssignmentImporter",
        logMode: "info",
        requestId: requestId,
        relatedData: provisionedLinksKey,
        status: requestStatus.Completed,
        sourceRequestId: message.requestId,
        statusMessage: `Account assignment import operation completed as the source trigger does not match`,
      });
    }
  } catch (err) {
    logger({
      handler: "accountAssignmentImporter",
      logMode: "error",
      status: requestStatus.FailedWithException,
      statusMessage: `Account assignment import operation failed with exception: ${JSON.stringify(
        err
      )} for eventDetail: ${JSON.stringify(event)}`,
    });
  }
};
