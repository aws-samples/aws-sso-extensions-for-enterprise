/*
Construct that sets up all artefacts required for observability
*/

import { CfnQueryDefinition } from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";
import { BuildConfig } from "../build/buildConfig";

function name(buildConfig: BuildConfig, resourcename: string): string {
  return buildConfig.Environment + "-" + resourcename;
}

export class ObservabilityArtefacts extends Construct {
  constructor(scope: Construct, id: string, buildConfig: BuildConfig) {
    super(scope, id);

    // All Cloud watch insights query

    // All lambda log group names
    const accountAssignmentAPILogGroupNames: Array<string> = [
      `/aws/lambda/${buildConfig.Environment}-linkApiHandler`,
      `/aws/lambda/${buildConfig.Environment}-linkManagerHandler`,
      `/aws/lambda/${buildConfig.Environment}-linkTopicProcessor`,
      `/aws/lambda/${buildConfig.Environment}-processTargetAccountSMListenerHandler`,
    ];

    const permissionSetAPILogGroupNames: Array<string> = [
      `/aws/lambda/${buildConfig.Environment}-psApiHandler`,
      `/aws/lambda/${buildConfig.Environment}-permissionSetTopicProcessor`,
      `/aws/lambda/${buildConfig.Environment}-permissionSetSyncHandler`,
    ];

    const ssoGroupLogGroupNames: Array<string> = [
      `/aws/lambda/${buildConfig.Environment}-linkManagerHandler`,
      `/aws/lambda/${buildConfig.Environment}-processTargetAccountSMListenerHandler`,
      `/aws/lambda/${buildConfig.Environment}-ssoGroupHandler`,
    ];

    const ssoUserLogGroupNames: Array<string> = [
      `/aws/lambda/${buildConfig.Environment}-linkManagerHandler`,
      `/aws/lambda/${buildConfig.Environment}-processTargetAccountSMListenerHandler`,
      `/aws/lambda/${buildConfig.Environment}-ssoUserHandler`,
    ];

    const permissionSetSyncLogGroupNames: Array<string> = [
      `/aws/lambda/${buildConfig.Environment}-linkManagerHandler`,
      `/aws/lambda/${buildConfig.Environment}-processTargetAccountSMListenerHandler`,
      `/aws/lambda/${buildConfig.Environment}-permissionSetSyncHandler`,
    ];

    const orgEventsLogGroupNames: Array<string> = [
      `/aws/lambda/${buildConfig.Environment}-linkManagerHandler`,
      `/aws/lambda/${buildConfig.Environment}-processTargetAccountSMListenerHandler`,
      `/aws/lambda/${buildConfig.Environment}-orgEventsHandler`,
    ];

    //Get RequestDetails for accountAssignmentAPI flows
    new CfnQueryDefinition(
      this,
      name(buildConfig, "accountAssignmentAPIFlows-getRequestDetails"),
      {
        name: name(buildConfig, "accountAssignmentAPIFlows-getRequestDetails"),
        queryString:
          "filter requestId like '' | fields requestId, handler, relatedData, status, statusMessage, relatedData, hasRelatedRequests, sourceRequestId | sort @timestamp asc",
        logGroupNames: accountAssignmentAPILogGroupNames,
      }
    );

    //Get Related RequestDetails for accountAssignmentAPI flows
    new CfnQueryDefinition(
      this,
      name(buildConfig, "accountAssignmentAPIFlows-getRelatedRequestDetails"),
      {
        name: name(
          buildConfig,
          "accountAssignmentAPIFlows-getRelatedRequestDetails"
        ),
        queryString:
          "filter sourceRequestId like '' | fields requestId, handler, relatedData, status, statusMessage, relatedData, hasRelatedRequests, sourceRequestId | sort @timestamp asc",
        logGroupNames: accountAssignmentAPILogGroupNames,
      }
    );

    //Get RequestDetails for permissionSetAPI flows
    new CfnQueryDefinition(
      this,
      name(buildConfig, "permissionSetAPIFlows-getRequestDetails"),
      {
        name: name(buildConfig, "permissionSetAPIFlows-getRequestDetails"),
        queryString:
          "filter requestId like '' | fields requestId, handler, relatedData, status, statusMessage, relatedData, hasRelatedRequests, sourceRequestId | sort @timestamp asc",
        logGroupNames: permissionSetAPILogGroupNames,
      }
    );

    //Get Related RequestDetails for permissionSetAPI flows
    new CfnQueryDefinition(
      this,
      name(buildConfig, "permissionSetAPIFlows-getRelatedRequestDetails"),
      {
        name: name(
          buildConfig,
          "permissionSetAPIFlows-getRelatedRequestDetails"
        ),
        queryString:
          "filter sourceRequestId like '' | fields requestId, handler, relatedData, status, statusMessage, relatedData, hasRelatedRequests, sourceRequestId | sort @timestamp asc",
        logGroupNames: permissionSetAPILogGroupNames,
      }
    );

    //Get RequestDetails for SSO group trigger flows
    new CfnQueryDefinition(
      this,
      name(buildConfig, "ssoGroupTriggerFlows-getRequestDetails"),
      {
        name: name(buildConfig, "ssoGroupTriggerFlows-getRequestDetails"),
        queryString:
          "fields requestId, handler, relatedData, status, statusMessage, relatedData, hasRelatedRequests, sourceRequestId | sort @timestamp desc | limit 100 | filter ispresent(requestId)",
        logGroupNames: ssoGroupLogGroupNames,
      }
    );

    //Get Related RequestDetails for SSO group trigger flows
    new CfnQueryDefinition(
      this,
      name(buildConfig, "ssoGroupTriggerFlows-getRelatedRequestDetails"),
      {
        name: name(
          buildConfig,
          "ssoGroupTriggerFlows-getRelatedRequestDetails"
        ),
        queryString:
          "filter sourceRequestId like '' | fields requestId, handler, relatedData, status, statusMessage, relatedData, hasRelatedRequests, sourceRequestId | sort @timestamp asc",
        logGroupNames: ssoGroupLogGroupNames,
      }
    );

    //Get RequestDetails for SSO user trigger flows
    new CfnQueryDefinition(
      this,
      name(buildConfig, "ssoUserTriggerFlows-getRequestDetails"),
      {
        name: name(buildConfig, "ssoUserTriggerFlows-getRequestDetails"),
        queryString:
          "fields requestId, handler, relatedData, status, statusMessage, relatedData, hasRelatedRequests, sourceRequestId | sort @timestamp desc | limit 100 | filter ispresent(requestId)",
        logGroupNames: ssoUserLogGroupNames,
      }
    );

    //Get Related RequestDetails for SSO user trigger flows
    new CfnQueryDefinition(
      this,
      name(buildConfig, "ssoUserTriggerFlows-getRelatedRequestDetails"),
      {
        name: name(buildConfig, "ssoUserTriggerFlows-getRelatedRequestDetails"),
        queryString:
          "filter sourceRequestId like '' | fields requestId, handler, relatedData, status, statusMessage, relatedData, hasRelatedRequests, sourceRequestId | sort @timestamp asc",
        logGroupNames: ssoUserLogGroupNames,
      }
    );

    //Get RequestDetails for permission set sync trigger flow
    new CfnQueryDefinition(
      this,
      name(buildConfig, "permissionSetSyncTriggerFlows-getRequestDetails"),
      {
        name: name(
          buildConfig,
          "permissionSetSyncTriggerFlows-getRequestDetails"
        ),
        queryString:
          "fields requestId, handler, relatedData, status, statusMessage, relatedData, hasRelatedRequests, sourceRequestId | sort @timestamp desc | limit 100  | filter ispresent(requestId)",
        logGroupNames: permissionSetSyncLogGroupNames,
      }
    );

    //Get Related RequestDetails for permission set sync trigger flows
    new CfnQueryDefinition(
      this,
      name(
        buildConfig,
        "permissionSetSyncTriggerFlows-getRelatedRequestDetails"
      ),
      {
        name: name(
          buildConfig,
          "permissionSetSyncTriggerFlows-getRelatedRequestDetails"
        ),
        queryString:
          "filter sourceRequestId like '' | fields requestId, handler, relatedData, status, statusMessage, relatedData, hasRelatedRequests, sourceRequestId | sort @timestamp asc",
        logGroupNames: permissionSetSyncLogGroupNames,
      }
    );

    //Get RequestDetails for org events trigger flow
    new CfnQueryDefinition(
      this,
      name(buildConfig, "orgEventsTriggerFlows-getRequestDetails"),
      {
        name: name(buildConfig, "orgEventsTriggerFlows-getRequestDetails"),
        queryString:
          "fields requestId, handler, relatedData, status, statusMessage, relatedData, hasRelatedRequests, sourceRequestId | sort @timestamp desc | limit 100 | filter ispresent(requestId)",
        logGroupNames: orgEventsLogGroupNames,
      }
    );

    //Get Related RequestDetails for org events trigger flows
    new CfnQueryDefinition(
      this,
      name(buildConfig, "orgEventsTriggerFlows-getRelatedRequestDetails"),
      {
        name: name(
          buildConfig,
          "orgEventsTriggerFlows-getRelatedRequestDetails"
        ),
        queryString:
          "filter sourceRequestId like '' | fields requestId, handler, relatedData, status, statusMessage, relatedData, hasRelatedRequests, sourceRequestId | sort @timestamp asc",
        logGroupNames: orgEventsLogGroupNames,
      }
    );
  }
}
