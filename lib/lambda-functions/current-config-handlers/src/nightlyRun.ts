/**
 * This lambda is subscribed to the nightlyRun remediation queue. It will check
 * the remediation type and validate the remediation type. It processes both
 * account assignment deviations and permission set deviations. For account
 * assignments, the only deviation type that needs processing is an `Unknown`
 * type, and in that instance, the account assignment needs to be
 * de-provisioned. For permission sets, there are 2 deviation types that needs
 * processing i.e. `Unknown` and `Changed`. In case of a `Unknown` type
 * deviation, the related account assignments would have been removed already
 * due to FIFO, so we go ahead and delete the permission set. `Changed` type
 * deviation, the permission set from solution persistence is read (from DDB)
 * and then re-applied to the permission set.
 */

// Environment configuration read
const { remediationMode, ssoRegion, SSOAPIRoleArn, env, AWS_REGION } =
  process.env;

import { PublishCommand, SNSClient } from "@aws-sdk/client-sns";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import {
  AttachManagedPolicyToPermissionSetCommand,
  DeleteAccountAssignmentCommand,
  DeleteAccountAssignmentCommandOutput,
  DeleteInlinePolicyFromPermissionSetCommand,
  DeletePermissionSetCommand,
  DetachManagedPolicyFromPermissionSetCommand,
  ListInstancesCommand,
  ListInstancesCommandOutput,
  paginateListTagsForResource,
  ProvisionPermissionSetCommand,
  PutInlinePolicyToPermissionSetCommand,
  SSOAdminClient,
  TagResourceCommand,
  UntagResourceCommand,
  UpdatePermissionSetCommand,
} from "@aws-sdk/client-sso-admin";
import { fromTemporaryCredentials } from "@aws-sdk/credential-providers";
import { SQSEvent } from "aws-lambda";
import { v4 as uuidv4 } from "uuid";
import { waitUntilAccountAssignmentDeletion } from "../../custom-waiters/src/waitUntilAccountAssignmentDeletion";
import {
  NightlyRunDeviationTypes,
  requestStatus,
} from "../../helpers/src/interfaces";
import { logger } from "../../helpers/src/utilities";
import { serializeDurationToISOFormat } from "../../helpers/src/isoDurationUtility";

const ssoAdminClientObject = new SSOAdminClient({
  region: ssoRegion,
  credentials: fromTemporaryCredentials({
    params: {
      RoleArn: SSOAPIRoleArn,
    },
  }),
  maxAttempts: 2,
});
const ssoAdminPaginatorConfig = {
  client: ssoAdminClientObject,
  pageSize: 10,
};
const snsClientObject = new SNSClient({
  region: AWS_REGION,
  maxAttempts: 2,
});
const ssmClientObject = new SSMClient({
  region: AWS_REGION,
  maxAttempts: 2,
});

export const handler = async (event: SQSEvent) => {
  await Promise.all(
    event.Records.map(async (record) => {
      const requestId = uuidv4().toString();
      try {
        const message = JSON.parse(record.body);
        const deviationType = message.deviationType;
        const objectType = message.objectType;
        const permissionSetArn = message.permissionSetArn;
        /**
         * If remediation mode is set to AUTOREMEDIATE, account assignments and
         * permission set items that have been changed or that are not found in
         * the solution will be updated/deleted.
         */
        if (
          remediationMode &&
          remediationMode.toString().toUpperCase() === "AUTOREMEDIATE"
        ) {
          const resolvedInstances: ListInstancesCommandOutput =
            await ssoAdminClientObject.send(new ListInstancesCommand({}));
          const instanceArn = resolvedInstances.Instances?.[0].InstanceArn + "";
          /**
           * Account assignments must first be deleted, as permission sets
           * cannot be deleted whilst account assignments are attached. The FIFO
           * queue is ordered so that account assignments are deleted first.
           */
          if (
            deviationType === NightlyRunDeviationTypes.Unknown &&
            objectType === "accountAssignment"
          ) {
            logger({
              handler: "nightlyRunProcessor",
              logMode: "info",
              relatedData: `${message.targetId}-${message.principalId}-${permissionSetArn}`,
              requestId: requestId,
              sourceRequestId: message.sourceRequestId,
              status: requestStatus.InProgress,
              statusMessage: `NightlyRun unknown account assignment: ${permissionSetArn} assigned to account ID ${message.targetId}, autoremediation (delete) account assignment operation started.`,
            });
            const ssoAssignmentOp: DeleteAccountAssignmentCommandOutput =
              await ssoAdminClientObject.send(
                new DeleteAccountAssignmentCommand({
                  InstanceArn: instanceArn,
                  PermissionSetArn: permissionSetArn,
                  PrincipalId: message.principalId,
                  TargetId: message.targetId,
                  TargetType: "AWS_ACCOUNT",
                  PrincipalType: message.principalType,
                })
              );
            await waitUntilAccountAssignmentDeletion(
              {
                client: ssoAdminClientObject,
                maxWaitTime: 600, //aggressive timeout to accommodate SSO Admin API's workflow based logic
              },
              {
                InstanceArn: instanceArn,
                AccountAssignmentDeletionRequestId:
                  ssoAssignmentOp.AccountAssignmentDeletionStatus?.RequestId,
              },
              requestId
            );
            logger({
              handler: "nightlyRunProcessor",
              logMode: "info",
              relatedData: `${message.targetId}-${message.principalId}-${permissionSetArn}`,
              requestId: requestId,
              sourceRequestId: message.sourceRequestId,
              status: requestStatus.Completed,
              statusMessage: `NightlyRun unknown account assignment: ${permissionSetArn} removed from account ID ${message.targetId}, autoremediation (delete) operation completed successfully.`,
            });
          } else if (
            deviationType === NightlyRunDeviationTypes.Unknown &&
            objectType === "permissionSet"
          ) {
            /**
             * Once account assignments are deleted, permission sets which are
             * not found in AWS SSO DDB tables will be deleted.
             */
            logger({
              handler: "nightlyRunProcessor",
              logMode: "info",
              relatedData: `${message.permissionSetName}`,
              requestId: requestId,
              sourceRequestId: message.sourceRequestId,
              status: requestStatus.InProgress,
              statusMessage: `NightlyRun unknown permission set: ${message.permissionSetName}, autoremediation (delete) permission set operation started.`,
            });
            await ssoAdminClientObject.send(
              new DeletePermissionSetCommand({
                InstanceArn: instanceArn,
                PermissionSetArn: permissionSetArn,
              })
            );
            logger({
              handler: "nightlyRunProcessor",
              logMode: "info",
              relatedData: `${message.permissionSetName}`,
              requestId: requestId,
              sourceRequestId: message.sourceRequestId,
              status: requestStatus.Completed,
              statusMessage: `NightlyRun unknown permission set: ${message.permissionSetName}, autoremediation (delete) operation completed successfully.`,
            });
          } else if (
            deviationType === NightlyRunDeviationTypes.Changed &&
            objectType === "permissionSet"
          ) {
            /**
             * Permission sets that have been updated manually (outside of the
             * solution will be updated to match the information found in the
             * DDB tables i.e. solution persistence
             */
            logger({
              handler: "nightlyRunProcessor",
              logMode: "info",
              relatedData: `${message.permissionSetName}`,
              requestId: requestId,
              sourceRequestId: message.sourceRequestId,
              status: requestStatus.InProgress,
              statusMessage: `NightlyRun changed permission set: ${message.permissionSetName} autoremediation (update) operation starting.`,
            });
            await ssoAdminClientObject.send(
              new UpdatePermissionSetCommand({
                InstanceArn: instanceArn,
                Description: message.oldPermissionSetObject.description
                  ? message.oldPermissionSetObject.description
                  : message.oldPermissionSetObject.oldPermissionSetName,
                PermissionSetArn: permissionSetArn,
                RelayState: message.oldPermissionSetObject.relayState
                  ? message.oldPermissionSetObject.relayState
                  : "",
                SessionDuration: serializeDurationToISOFormat({
                  minutes: parseInt(
                    message.oldPermissionSetObject.sessionDurationInMinutes
                      ? message.oldPermissionSetObject.sessionDurationInMinutes
                      : "60"
                  ),
                }),
              })
            );
            logger({
              handler: "nightlyRunProcessor",
              logMode: "info",
              relatedData: `${message.permissionSetName}`,
              requestId: requestId,
              sourceRequestId: message.sourceRequestId,
              status: requestStatus.InProgress,
              statusMessage: `NightlyRun changed permission set: ${message.permissionSetName} description, relay state and session duration updated`,
            });
            /**
             * Permission set managed policies: If in SSO but not in DDB
             * (solution) we delete the attached managed policy. We set the
             * current/changed managed policy arn list and the (old) managed
             * policy arn list (from DDB) as Array<string> types. We can then
             * loop through each list and determine if an arn is either missing
             * (should be attached to the permission set) or should be detached.
             */
            let currentManagedPolicyArnListToCheck: Array<string> =
              message.changedPermissionSetObject.managedPoliciesArnList;
            currentManagedPolicyArnListToCheck =
              currentManagedPolicyArnListToCheck.sort();
            let oldManagedPolicyArnListToCheck: Array<string> =
              message.oldPermissionSetObject.managedPoliciesArnList;
            oldManagedPolicyArnListToCheck =
              oldManagedPolicyArnListToCheck.sort();
            /**
             * If permission set managed policies are in SSO but not in DDB we
             * detach the managed policy.
             */
            for (const arn of currentManagedPolicyArnListToCheck) {
              if (oldManagedPolicyArnListToCheck.includes(arn)) {
                /** Managed policy in DDB and SSO */
                logger({
                  handler: "nightlyRunProcessor",
                  logMode: "info",
                  relatedData: `${message.permissionSetName}`,
                  requestId: requestId,
                  sourceRequestId: message.sourceRequestId,
                  status: requestStatus.InProgress,
                  statusMessage: `NightlyRun changed permission set: ${message.permissionSetName} managed policy (${arn}) in both DDB table and SSO - no action required.`,
                });
              } else {
                await ssoAdminClientObject.send(
                  new DetachManagedPolicyFromPermissionSetCommand({
                    InstanceArn: instanceArn,
                    ManagedPolicyArn: arn,
                    PermissionSetArn: permissionSetArn,
                  })
                );
                logger({
                  handler: "nightlyRunProcessor",
                  logMode: "info",
                  relatedData: `${message.permissionSetName}`,
                  requestId: requestId,
                  sourceRequestId: message.sourceRequestId,
                  status: requestStatus.InProgress,
                  statusMessage: `NightlyRun changed permission set: ${message.permissionSetName} additional managed policy (${arn}) deleted sucessfully.`,
                });
              }
            }
            /**
             * If permission set managed policies are in DDB but not in SSO we
             * add the managed policy.
             */
            for (const arn of oldManagedPolicyArnListToCheck) {
              if (currentManagedPolicyArnListToCheck.includes(arn)) {
                /** Managed policy in DDB and SSO */
                logger({
                  handler: "nightlyRunProcessor",
                  logMode: "info",
                  relatedData: `${message.permissionSetName}`,
                  requestId: requestId,
                  sourceRequestId: message.sourceRequestId,
                  status: requestStatus.InProgress,
                  statusMessage: `NightlyRun changed permission set: ${message.permissionSetName} managed policy (${arn}) in both DDB table and SSO - no action required.`,
                });
              } else {
                await ssoAdminClientObject.send(
                  new AttachManagedPolicyToPermissionSetCommand({
                    InstanceArn: instanceArn,
                    ManagedPolicyArn: arn,
                    PermissionSetArn: permissionSetArn,
                  })
                );
                logger({
                  handler: "nightlyRunProcessor",
                  logMode: "info",
                  relatedData: `${message.permissionSetName}`,
                  requestId: requestId,
                  sourceRequestId: message.sourceRequestId,
                  status: requestStatus.InProgress,
                  statusMessage: `NightlyRun changed permission set: ${message.permissionSetName} missing managed policy (${arn}) added sucessfully.`,
                });
              }
            }
            /**
             * Permissions set inline policies are replaced with inline policy
             * found in DDB.
             */
            if (
              Object.keys(message.oldPermissionSetObject.inlinePolicyDocument)
                .length !== 0
            ) {
              await ssoAdminClientObject.send(
                new PutInlinePolicyToPermissionSetCommand({
                  InstanceArn: instanceArn,
                  InlinePolicy: JSON.stringify(
                    message.oldPermissionSetObject.inlinePolicyDocument
                  ),
                  PermissionSetArn: permissionSetArn,
                })
              );
            } else {
              /**
               * If there is no inline policy found in DDB and an inline policy
               * has been added to the permission set, the policy will be deleted.
               */
              if (
                Object.keys(
                  message.changedPermissionSetObject.inlinePolicyDocument
                ).length !== 0
              ) {
                await ssoAdminClientObject.send(
                  new DeleteInlinePolicyFromPermissionSetCommand({
                    InstanceArn: instanceArn,
                    PermissionSetArn: permissionSetArn,
                  })
                );
              }
            }
            logger({
              handler: "nightlyRunProcessor",
              logMode: "info",
              relatedData: `${message.permissionSetName}`,
              requestId: requestId,
              sourceRequestId: message.sourceRequestId,
              status: requestStatus.InProgress,
              statusMessage: `NightlyRun changed permission set: ${message.permissionSetName} inline policy replaced sucessfully.`,
            });
            /**
             * To optimise tag delta management, for every permission set
             * determined to have a delta, we proactively remove all the current
             * tags and add the tags using solution persistence
             */
            const listTagsPaginator = paginateListTagsForResource(
              ssoAdminPaginatorConfig,
              { InstanceArn: instanceArn, ResourceArn: permissionSetArn }
            );
            /** Instantiate the tag keys to be removed as an empty array */
            const tagKeysToRemove: Array<string> = [];
            /**
             * Loop through the pages, and for every page loop through the tags
             * list and compute the tag keys list
             */
            for await (const page of listTagsPaginator) {
              if (page.Tags) {
                for (const tag of page.Tags) {
                  tagKeysToRemove.push(tag.Key ? tag.Key : "");
                }
              }
            }
            /** Remove all tag keys from the permission set */
            await ssoAdminClientObject.send(
              new UntagResourceCommand({
                InstanceArn: instanceArn,
                ResourceArn: permissionSetArn,
                TagKeys: tagKeysToRemove,
              })
            );
            /**
             * Now add back the tag keys from the solution persistence, only if
             * there are tags
             */
            if (message.oldPermissionSetObject.tags.length > 0) {
              await ssoAdminClientObject.send(
                new TagResourceCommand({
                  InstanceArn: instanceArn,
                  ResourceArn: permissionSetArn,
                  Tags: message.oldPermissionSetObject.tags,
                })
              );
            }
            logger({
              handler: "nightlyRunProcessor",
              logMode: "info",
              relatedData: `${message.permissionSetName}`,
              requestId: requestId,
              sourceRequestId: message.sourceRequestId,
              status: requestStatus.InProgress,
              statusMessage: `NightlyRun changed permission set: ${message.permissionSetName} tags updated sucessfully`,
            });
            /**
             * Once attributes have been updated ProvisionPermissionSetCommand
             * must be called.
             */
            await ssoAdminClientObject.send(
              new ProvisionPermissionSetCommand({
                InstanceArn: instanceArn,
                PermissionSetArn: permissionSetArn,
                TargetType: "ALL_PROVISIONED_ACCOUNTS",
              })
            );
            logger({
              handler: "nightlyRunProcessor",
              logMode: "info",
              relatedData: `${message.permissionSetName}`,
              requestId: requestId,
              sourceRequestId: message.sourceRequestId,
              status: requestStatus.Completed,
              statusMessage: `NightlyRun changed permission set: ${message.permissionSetName} has been re-provisioned successfully. Autoremediation complete.`,
            });
          }
        } else if (
          remediationMode &&
          remediationMode.toString().toUpperCase() === "NOTIFY"
        ) {
          /*
           * When remediation mode is set to NOTIFY, information is posted to an SNS topic.
           */
          /** First read the notification topic arn from SSM parameters */
          const notificationTopicArnOutput = await ssmClientObject.send(
            new GetParameterCommand({
              Name: `${env}-nightlyRunTopicArn`,
            })
          );

          if (
            deviationType === NightlyRunDeviationTypes.Unknown &&
            objectType === "accountAssignment"
          ) {
            logger({
              handler: "nightlyRunProcessor",
              logMode: "info",
              relatedData: `${message.targetId}-${message.principalId}-${permissionSetArn}`,
              requestId: requestId,
              sourceRequestId: message.sourceRequestId,
              status: requestStatus.InProgress,
              statusMessage: `NightlyRun unknown account assignment: ${permissionSetArn} assigned to account ID ${message.targetId}, notify operation started.`,
            });
            if (notificationTopicArnOutput.Parameter?.Value) {
              await snsClientObject.send(
                new PublishCommand({
                  TopicArn: notificationTopicArnOutput.Parameter.Value,
                  Message: JSON.stringify({
                    DeviationFound: "Unknown account assignment found",
                    PermissionSetArn: permissionSetArn,
                    PrincipalId: message.principalId,
                    Account: message.targetId,
                    PrincipalType: message.principalType,
                  }),
                })
              );
              logger({
                handler: "nightlyRunProcessor",
                logMode: "info",
                relatedData: `${message.targetId}-${message.principalId}-${permissionSetArn}`,
                requestId: requestId,
                sourceRequestId: message.sourceRequestId,
                status: requestStatus.Completed,
                statusMessage: `NightlyRun unknown account assignment: ${permissionSetArn} assigned to account ID ${message.targetId}, notify operation completed. Sent to SNS topic ${notificationTopicArnOutput.Parameter.Value}.`,
              });
            }
          }

          if (
            deviationType === NightlyRunDeviationTypes.Unknown &&
            objectType === "permissionSet"
          ) {
            if (notificationTopicArnOutput.Parameter?.Value) {
              logger({
                handler: "nightlyRunProcessor",
                logMode: "info",
                relatedData: `${message.permissionSetName}`,
                requestId: requestId,
                sourceRequestId: message.sourceRequestId,
                status: requestStatus.InProgress,
                statusMessage: `NightlyRun unknown permission set: ${message.permissionSetName}, notify operation started.`,
              });
              await snsClientObject.send(
                new PublishCommand({
                  TopicArn: notificationTopicArnOutput.Parameter.Value,
                  Message: JSON.stringify({
                    DeviationFound: "Unknown permission set found",
                    PermissionSetArn: permissionSetArn,
                  }),
                })
              );
              logger({
                handler: "nightlyRunProcessor",
                logMode: "info",
                relatedData: `${message.permissionSetName}`,
                requestId: requestId,
                sourceRequestId: message.sourceRequestId,
                status: requestStatus.Completed,
                statusMessage: `NightlyRun unknown permission set: ${message.permissionSetName}, notify operation complete. Sent to SNS topic ${notificationTopicArnOutput.Parameter.Value}.`,
              });
            }
          }

          if (
            deviationType === NightlyRunDeviationTypes.Changed &&
            objectType === "permissionSet"
          ) {
            if (notificationTopicArnOutput.Parameter?.Value) {
              logger({
                handler: "nightlyRunProcessor",
                logMode: "info",
                relatedData: `${message.permissionSetName}`,
                requestId: requestId,
                sourceRequestId: message.sourceRequestId,
                status: requestStatus.InProgress,
                statusMessage: `NightlyRun changed permission set: ${message.permissionSetName}, notify operation started.`,
              });
              await snsClientObject.send(
                new PublishCommand({
                  TopicArn: notificationTopicArnOutput.Parameter.Value,
                  Message: JSON.stringify({
                    DeviationFound:
                      "Permission set definition has been updated",
                    PermissionSetArn: permissionSetArn,
                  }),
                })
              );
              logger({
                handler: "nightlyRunProcessor",
                logMode: "info",
                relatedData: `${message.permissionSetName}`,
                requestId: requestId,
                sourceRequestId: message.sourceRequestId,
                status: requestStatus.Completed,
                statusMessage: `NightlyRun changed permission set: ${message.permissionSetName}, notify operation complete. Sent to SNS topic ${notificationTopicArnOutput.Parameter.Value}.`,
              });
            }
          }
        } else {
          /**
           * If the remediation mode is not NOTIFY or AUTOREMEDIATE an error
           * will be logged.
           */
          logger({
            handler: "nightlyRunProcessor",
            logMode: "error",
            status: requestStatus.FailedWithException,
            statusMessage: `NightlyRun remediation mode ${remediationMode} is not recognised.`,
          });
        }
      } catch (err) {
        logger({
          handler: "nightlyRunProcessor",
          logMode: "error",
          status: requestStatus.FailedWithException,
          statusMessage: `NightlyRun operation failed with exception: ${JSON.stringify(
            err
          )} for eventDetail: ${JSON.stringify(event)}`,
        });
      }
    })
  );
};
