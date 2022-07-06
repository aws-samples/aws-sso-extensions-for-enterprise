/*
Objective: Import existing permission sets into the solution
*/

// Environment configuration read
const {
  ssoRegion,
  SSOAPIRoleArn,
  permissionSetTableName,
  permissionSetArnTableName,
  artefactsBucketName,
  configEnv,
  AWS_REGION,
} = process.env;

import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import {
  ListAccountsForProvisionedPermissionSetCommand,
  ListInstancesCommand,
  ListInstancesCommandOutput,
  ProvisionPermissionSetCommand,
  SSOAdminClient,
} from "@aws-sdk/client-sso-admin";
import { fromTemporaryCredentials } from "@aws-sdk/credential-providers";
import {
  DynamoDBDocumentClient,
  GetCommand,
  GetCommandOutput,
  PutCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
// SDK and third party client imports
import { SNSEvent } from "aws-lambda";
import { diff } from "json-diff";
import { v4 as uuidv4 } from "uuid";
import {
  NightlyRunDeviationTypes,
  requestStatus,
} from "../../helpers/src/interfaces";
import { getMinutesFromISODurationString } from "../../helpers/src/isoDurationUtility";
import { logger } from "../../helpers/src/utilities";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";

// SDK and third party client object initialistaion
const ddbClientObject = new DynamoDBClient({
  region: AWS_REGION,
  maxAttempts: 2,
});
const ddbDocClientObject = DynamoDBDocumentClient.from(ddbClientObject);
const ssoAdminClientObject = new SSOAdminClient({
  region: ssoRegion,
  credentials: fromTemporaryCredentials({
    params: {
      RoleArn: SSOAPIRoleArn,
    },
  }),
  maxAttempts: 2,
});
const s3clientObject = new S3Client({ region: AWS_REGION, maxAttempts: 2 });
const ssmClientObject = new SSMClient({ region: AWS_REGION, maxAttempts: 2 });
const sqsClientObject = new SQSClient({ region: AWS_REGION, maxAttempts: 2 });

export const handler = async (event: SNSEvent) => {
  /** UUID for traceability */
  const requestId = uuidv4().toString();
  try {
    const message = JSON.parse(event.Records[0].Sns.Message);
    const permissionSetName = message.describePermissionSet.PermissionSet.Name;
    const permissionSetArn =
      message.describePermissionSet.PermissionSet.PermissionSetArn;
    logger({
      handler: "permissionSetImporter",
      logMode: "info",
      requestId: requestId,
      relatedData: permissionSetName,
      status: requestStatus.InProgress,
      sourceRequestId: message.requestId,
      statusMessage: `Permission set import operation in progress`,
    });

    /** Construct permission set object from the SNS message payload */
    const permissionSetObject = {};
    let computedRelayState = "";
    let computedInlinePolicy = {};
    let computedSessionDurationInMinutes = "";
    const computedManagedPoliciesArnList: Array<string> = [];

    /** Relay state is an optional attribute */
    if (
      Object.prototype.hasOwnProperty.call(
        message.describePermissionSet.PermissionSet,
        "RelayState"
      )
    ) {
      computedRelayState =
        message.describePermissionSet.PermissionSet.RelayState;
    }
    /** Session Duration is an optional attribute */
    if (
      Object.prototype.hasOwnProperty.call(
        message.describePermissionSet.PermissionSet,
        "SessionDuration"
      )
    ) {
      computedSessionDurationInMinutes = getMinutesFromISODurationString(
        message.describePermissionSet.PermissionSet.SessionDuration
      );
    }
    /** Managed policies is an optional attribute */
    if (
      message.listManagedPoliciesInPermissionSet.AttachedManagedPolicies
        .length > 0
    ) {
      await Promise.all(
        message.listManagedPoliciesInPermissionSet.AttachedManagedPolicies.map(
          async (managedPolicy: Record<string, string>) => {
            computedManagedPoliciesArnList.push(managedPolicy.Arn);
          }
        )
      );
    }
    /** Inline policy is an optional attribute */
    if (message.getInlinePolicyForPermissionSet.InlinePolicy.length > 0) {
      computedInlinePolicy = JSON.parse(
        message.getInlinePolicyForPermissionSet.InlinePolicy
      );
    }

    Object.assign(permissionSetObject, {
      permissionSetName: permissionSetName,
      sessionDurationInMinutes: computedSessionDurationInMinutes,
      relayState: computedRelayState,
      tags: message.listTagsForResource.Tags,
      managedPoliciesArnList: [...computedManagedPoliciesArnList].sort(),
      inlinePolicyDocument: computedInlinePolicy,
    });

    /**
     * The first block i.e. triggerSource matching CloudFormation is used in an
     * importCurrentConfig use case scenario. The second block i.e.
     * triggerSource matching EventBridge is used in a nightlyRun use case scenario.
     */
    /** Externalise commonalities that apply for both use cases */
    /**
     * Validate if the permission set object is already known to the solution.
     * Known here refers to the solution having both the permission set object
     * as well as an arn reference
     */
    let permissionSetObjectisPresent = false;
    let permissionSetHasDelta = true;
    const fetchPermissionSet: GetCommandOutput = await ddbDocClientObject.send(
      new GetCommand({
        TableName: permissionSetTableName,
        Key: {
          permissionSetName: permissionSetName,
        },
      })
    );
    const fetchArn: GetCommandOutput = await ddbDocClientObject.send(
      new GetCommand({
        TableName: permissionSetArnTableName,
        Key: {
          permissionSetName,
        },
      })
    );
    /** Validate if the permission set has delta */
    if (fetchPermissionSet.Item && fetchArn.Item) {
      permissionSetObjectisPresent = true;
      const sortedFetchItemManagedPolicies =
        fetchPermissionSet.Item.managedPoliciesArnList.sort();
      fetchPermissionSet.Item.managedPoliciesArnList =
        sortedFetchItemManagedPolicies;

      const diffCalculated = diff(fetchPermissionSet.Item, permissionSetObject);
      if (diffCalculated === undefined) {
        permissionSetHasDelta = false;
      }
    }
    if (message.triggerSource === "CloudFormation") {
      /**
       * Permission set already exists. So, we validate if there's a delta
       * between what SSO holds for the permission set object versus what the
       * solution's persistence holds. If there's no delta found, we complete
       * the operation as there's nothing to be done. If a delta is found, we
       * take the permission object provided by SSO as the source of truth and
       * overwrite solution persistence with this source of truth We also
       * trigger a forceful re-provision of accounts using this permisison set
       * in case there's a delta between the provisioned permission set and the
       * source of truth
       */

      if (permissionSetObjectisPresent) {
        if (permissionSetHasDelta) {
          /**
           * Preparing data so that we could overwrite solution persistence with
           * SSO object
           */
          const resolvedInstances: ListInstancesCommandOutput =
            await ssoAdminClientObject.send(new ListInstancesCommand({}));
          const instanceArn = resolvedInstances.Instances?.[0].InstanceArn + "";
          /** Update solution persistence */
          await ddbDocClientObject.send(
            new PutCommand({
              TableName: permissionSetTableName,
              Item: {
                ...permissionSetObject,
              },
            })
          );
          await s3clientObject.send(
            new PutObjectCommand({
              Bucket: artefactsBucketName,
              Key: `permission_sets/${permissionSetName}.json`,
              Body: JSON.stringify(permissionSetObject),
              ServerSideEncryption: "AES256",
            })
          );
          logger({
            handler: "permissionSetImporter",
            logMode: "info",
            requestId: requestId,
            relatedData: permissionSetName,
            status: requestStatus.InProgress,
            sourceRequestId: message.requestId,
            statusMessage: `CloudFormation mode - delta found, updated solution persistence with new permission set object value`,
          });
          /**
           * In case there are accounts already provisioned with this permission
           * set, we trigger a reprovisioning operation to sync the target
           * permission set with SSO's image
           */
          const fetchAccountsList = await ssoAdminClientObject.send(
            new ListAccountsForProvisionedPermissionSetCommand({
              InstanceArn: instanceArn,
              PermissionSetArn: permissionSetArn,
            })
          );
          if (fetchAccountsList.AccountIds?.length !== 0) {
            await ssoAdminClientObject.send(
              new ProvisionPermissionSetCommand({
                InstanceArn: instanceArn,
                PermissionSetArn: permissionSetArn,
                TargetType: "ALL_PROVISIONED_ACCOUNTS",
              })
            );
            logger({
              handler: "permissionSetImporter",
              logMode: "info",
              requestId: requestId,
              relatedData: permissionSetName,
              status: requestStatus.InProgress,
              sourceRequestId: message.requestId,
              statusMessage: `CloudFormation mode - delta found, triggered re-provisioning operation on all provisioned accounts`,
            });
          }
          logger({
            handler: "permissionSetImporter",
            logMode: "info",
            requestId: requestId,
            relatedData: permissionSetName,
            status: requestStatus.Completed,
            sourceRequestId: message.requestId,
            statusMessage: `CloudFormation mode - delta found, import operation completed`,
          });
        } else {
          /** No delta found, so completing the operation */
          logger({
            handler: "permissionSetImporter",
            logMode: "info",
            requestId: requestId,
            relatedData: permissionSetName,
            status: requestStatus.Completed,
            sourceRequestId: message.requestId,
            statusMessage: `CloudFormation mode - no delta found, completing import operation`,
          });
        }
      } else {
        /**
         * Permission set is unknown to the solution. So, we update solution
         * persistence such that it's aware of this permission set and the
         * related arn object
         */
        await s3clientObject.send(
          new PutObjectCommand({
            Bucket: artefactsBucketName,
            Key: `permission_sets/${permissionSetName}.json`,
            Body: JSON.stringify(permissionSetObject),
            ServerSideEncryption: "AES256",
          })
        );
        await ddbDocClientObject.send(
          new PutCommand({
            TableName: permissionSetTableName,
            Item: {
              ...permissionSetObject,
            },
          })
        );
        await ddbDocClientObject.send(
          new UpdateCommand({
            TableName: permissionSetArnTableName,
            Key: {
              permissionSetName,
            },
            UpdateExpression: "set permissionSetArn=:arnvalue",
            ExpressionAttributeValues: {
              ":arnvalue": permissionSetArn,
            },
          })
        );
        logger({
          handler: "permissionSetImporter",
          logMode: "info",
          requestId: requestId,
          relatedData: permissionSetName,
          status: requestStatus.InProgress,
          sourceRequestId: message.requestId,
          statusMessage: `CloudFormation mode - permission set object not present, import completed`,
        });
      }
    } else if (message.triggerSource === "EventBridge") {
      /**
       * Nightly run block. If the permission set exists in the solution and is
       * the same, we complete the operation If the permission set exists in the
       * solution and is different to what SSO holds i.e. there's a delta, we
       * enforce a remediation action based on user's choice in config If the
       * permission set does not exist in the solution i.e. this is a permission
       * set created through external interfaces, we enforce a remediation
       * action based on user's choice in config
       */
      /** Read permissionSetDeviationQueueURL from SSM */
      const getParameterCommandOtpt = await ssmClientObject.send(
        new GetParameterCommand({
          Name: `${configEnv}-nightlyRunDeviationQURL`,
        })
      );

      const permissionSetDeviationQURL =
        getParameterCommandOtpt.Parameter?.Value || "";

      if (permissionSetObjectisPresent) {
        if (permissionSetHasDelta) {
          /** Delta found , so we remediate i.e. post the payload to the queue */
          logger({
            handler: "permissionSetImporter",
            logMode: "info",
            requestId: requestId,
            relatedData: permissionSetName,
            status: requestStatus.Completed,
            sourceRequestId: message.requestId,
            statusMessage: `EventBridge mode - delta found, posting the payload to remediation queue`,
          });
          await sqsClientObject.send(
            new SendMessageCommand({
              QueueUrl: permissionSetDeviationQURL,
              MessageBody: JSON.stringify({
                permissionSetName: permissionSetName,
                permissionSetArn: permissionSetArn,
                sourceRequestId: message.requestId,
                deviationType: NightlyRunDeviationTypes.Changed,
                changedPermissionSetObject: { ...permissionSetObject },
                oldPermissionSetObject: { ...fetchPermissionSet.Item },
                objectType: "permissionSet",
              }),
              MessageDeduplicationId: `${NightlyRunDeviationTypes.Changed}-${permissionSetName}`,
              MessageGroupId: `${permissionSetName}`,
            })
          );
        } else {
          /** No delta found, so completing the operation */
          logger({
            handler: "permissionSetImporter",
            logMode: "info",
            requestId: requestId,
            relatedData: permissionSetName,
            status: requestStatus.Completed,
            sourceRequestId: message.requestId,
            statusMessage: `EventBridge mode - no delta found and permission set exists in the solution, completing import operation`,
          });
        }
      } else {
        /**
         * This is a case where the permission set has been created through
         * external interfaces, so we remediate i.e. post the payload to the queue
         */
        logger({
          handler: "permissionSetImporter",
          logMode: "info",
          requestId: requestId,
          relatedData: permissionSetName,
          status: requestStatus.Completed,
          sourceRequestId: message.requestId,
          statusMessage: `EventBridge mode - unknown permission set found, posting the payload to remediation queue`,
        });
        await sqsClientObject.send(
          new SendMessageCommand({
            QueueUrl: permissionSetDeviationQURL,
            MessageBody: JSON.stringify({
              permissionSetName: permissionSetName,
              permissionSetArn: permissionSetArn,
              deviationType: NightlyRunDeviationTypes.Unknown,
              sourceRequestId: message.requestId,
              objectType: "permissionSet",
            }),
            MessageDeduplicationId: `${NightlyRunDeviationTypes.Unknown}-${permissionSetName}`,
            MessageGroupId: `${permissionSetName}`,
          })
        );
      }
    } else {
      logger({
        handler: "permissionSetImporter",
        logMode: "info",
        requestId: requestId,
        relatedData: permissionSetName,
        status: requestStatus.Completed,
        sourceRequestId: message.requestId,
        statusMessage: `Permission set import operation completed as the source trigger does not match`,
      });
    }
  } catch (err) {
    logger({
      handler: "permissionSetImporter",
      logMode: "error",
      status: requestStatus.FailedWithException,
      statusMessage: `Permission set import operation failed with exception: ${JSON.stringify(
        err
      )} for eventDetail: ${JSON.stringify(event)}`,
    });
  }
};
