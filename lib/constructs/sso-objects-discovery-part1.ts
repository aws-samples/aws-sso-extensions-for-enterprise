/**
 * Construct used for discovering SSO objects, i.e. permission sets and account
 * assignments. This construct is to be run in SSO account + region. It would
 * deploy a collection of IAM policies, roles , state machines and cross account
 * SNS topics.
 */
import {
  AccountPrincipal,
  PolicyStatement,
  Role,
  ServicePrincipal,
} from "aws-cdk-lib/aws-iam";
import { Key } from "aws-cdk-lib/aws-kms";
import {
  CfnQueryDefinition,
  LogGroup,
  RetentionDays,
} from "aws-cdk-lib/aws-logs";
import { Topic } from "aws-cdk-lib/aws-sns";
import { CfnStateMachine } from "aws-cdk-lib/aws-stepfunctions";
import { Construct } from "constructs";
import { BuildConfig } from "../build/buildConfig";
import * as importAccountAssignmentsSMJSON from "../state-machines/import-account-assignments-asl.json";
import * as importCurrentConfigSMJSON from "../state-machines/import-current-config-asl.json";
import * as importPermissionSetsSMJSON from "../state-machines/import-permission-sets-asl.json";
import { CrossAccountRole } from "./cross-account-role";
import { SSMParamWriter } from "./ssm-param-writer";

function name(buildConfig: BuildConfig, resourcename: string): string {
  return buildConfig.Environment + "-" + resourcename;
}

export class SSOObjectsDiscoveryPart1 extends Construct {
  public readonly permissionSetImportTopic: Topic;
  public readonly accountAssignmentImportTopic: Topic;

  constructor(scope: Construct, id: string, buildConfig: BuildConfig) {
    super(scope, id);

    /**
     * Create KMS Key for cross account topics, and grant encryptDecrypt
     * permissions to state machine service
     */
    const ssoArtefactsKeyforImport = new Key(
      this,
      name(buildConfig, "ssoArtefactsKeyforImport"),
      {
        enableKeyRotation: true,
        alias: name(buildConfig, "ssoArtefactsKeyForImport"),
      }
    );
    ssoArtefactsKeyforImport.grantEncryptDecrypt(
      new ServicePrincipal("states.amazonaws.com")
    );

    /**
     * Create SNS topics that would have cross account lambda subscribers. This
     * would be used by the import config state machines to post the SSO object
     * payload discovered by the state machines from the SSO instance
     */
    /**
     * Topic for importing permission sets with resource policy allowing a
     * subscriber from target account
     */
    this.permissionSetImportTopic = new Topic(
      this,
      name(buildConfig, "permissionSetImportTopic"),
      {
        masterKey: ssoArtefactsKeyforImport,
        displayName: name(buildConfig, "permissionSetImportTopic"),
      }
    );
    this.permissionSetImportTopic.addToResourcePolicy(
      new PolicyStatement({
        principals: [
          new AccountPrincipal(buildConfig.PipelineSettings.TargetAccountId),
        ],
        actions: ["SNS:Subscribe", "SNS:Receive"],
        resources: [this.permissionSetImportTopic.topicArn],
      })
    );
    /**
     * Topic for importing account assignments with resource policy allowing a
     * subscriber from target account
     */
    this.accountAssignmentImportTopic = new Topic(
      this,
      name(buildConfig, "accountAssignmentImportTopic"),
      {
        masterKey: ssoArtefactsKeyforImport,
        displayName: name(buildConfig, "accountAssignmentImportTopic"),
      }
    );
    this.accountAssignmentImportTopic.addToResourcePolicy(
      new PolicyStatement({
        principals: [
          new AccountPrincipal(buildConfig.PipelineSettings.TargetAccountId),
        ],
        actions: ["SNS:Subscribe", "SNS:Receive"],
        resources: [this.accountAssignmentImportTopic.topicArn],
      })
    );
    /**
     * Export the topic ARN's through the cross-account-region enabled
     * constructs in SSM for consumption by artefacts in target accounts
     */
    new SSMParamWriter(
      this,
      name(buildConfig, "permissionSetImportTopicArn"),
      buildConfig,
      {
        ParamNameKey: "importPermissionSetTopicArn",
        ParamValue: this.permissionSetImportTopic.topicArn,
        ReaderAccountId: buildConfig.PipelineSettings.TargetAccountId,
      }
    );
    new SSMParamWriter(
      this,
      name(buildConfig, "accountAssignmentImportTopicArn"),
      buildConfig,
      {
        ParamNameKey: "importAccountAssignmentTopicArn",
        ParamValue: this.accountAssignmentImportTopic.topicArn,
        ReaderAccountId: buildConfig.PipelineSettings.TargetAccountId,
      }
    );
    /** Cloudwatch log group to attach to all state machines for capturing logs */
    const importArtefactsSMLogGroup = new LogGroup(
      this,
      name(buildConfig, "importArtefactsSMLogGroup"),
      {
        retention: RetentionDays.ONE_MONTH,
      }
    );

    /**
     * Create three state machines along with the roles.
     *
     * 1. Account assignment import - this state machine discovers all the existing
     *    account assignments for a given permission set and is triggered by
     *    permission set import state machine
     * 2. Permission set import - this state machine discovers all the permission
     *    sets in the SSO instance and is triggered by current config import
     *    state machine
     * 3. Current config import - this state machine orchestrates the flow and is
     *    the entry point for the discovery logic. So, any caller would call
     *    this, which would call state machine 2, and that would call state
     *    machine 1 for every permission set it discovered We create the scoped
     *    down roles as part of this to be used by the respective state machines
     */

    /** Create import account assignment state machine role and policy definitions */
    const importAccountAssignmentsSMRole = new Role(
      this,
      name(buildConfig, "importAccountAssignmentsSMRole"),
      {
        roleName: name(buildConfig, "accountAssignmentsImportRole"),
        assumedBy: new ServicePrincipal("states.amazonaws.com"),
      }
    );
    importAccountAssignmentsSMRole.addToPrincipalPolicy(
      new PolicyStatement({
        resources: ["*"],
        actions: ["sso:ListAccountAssignments"],
      })
    );
    this.accountAssignmentImportTopic.grantPublish(
      importAccountAssignmentsSMRole
    );
    ssoArtefactsKeyforImport.grantEncryptDecrypt(
      importAccountAssignmentsSMRole
    );
    importAccountAssignmentsSMRole.addToPrincipalPolicy(
      new PolicyStatement({
        actions: ["states:DescribeExecution", "states:StopExecution"],
        resources: ["*"],
      })
    );
    importAccountAssignmentsSMRole.addToPrincipalPolicy(
      new PolicyStatement({
        actions: ["events:PutTargets", "events:PutRule", "events:DescribeRule"],
        resources: [
          `arn:aws:events:${buildConfig.PipelineSettings.SSOServiceAccountRegion}:${buildConfig.PipelineSettings.SSOServiceAccountId}:rule/StepFunctionsGetEventsForStepFunctionsExecutionRule`,
        ],
      })
    );

    importAccountAssignmentsSMRole.addToPrincipalPolicy(
      new PolicyStatement({
        resources: ["*"],
        actions: [
          "identitystore:ListGroups",
          "identitystore:ListUsers",
          "identitystore:DescribeGroup",
          "identitystore:DescribeUser",
        ],
      })
    );
    importAccountAssignmentsSMRole.addToPrincipalPolicy(
      new PolicyStatement({
        actions: [
          "logs:CreateLogDelivery",
          "logs:GetLogDelivery",
          "logs:UpdateLogDelivery",
          "logs:DeleteLogDelivery",
          "logs:ListLogDeliveries",
          "logs:PutResourcePolicy",
          "logs:DescribeResourcePolicies",
          "logs:DescribeLogGroups",
        ],
        resources: ["*"],
      })
    );

    /** Create import account assignment state machine definition */
    const importAccountAssignmentSM = new CfnStateMachine(
      this,
      name(buildConfig, "importAccountAssignmentsSM"),
      {
        roleArn: importAccountAssignmentsSMRole.roleArn,
        definitionString: JSON.stringify(importAccountAssignmentsSMJSON),
        stateMachineName: name(buildConfig, "importAccountAssignmentsSM"),
        loggingConfiguration: {
          destinations: [
            {
              cloudWatchLogsLogGroup: {
                logGroupArn: importArtefactsSMLogGroup.logGroupArn,
              },
            },
          ],
          includeExecutionData: true,
          level: "ALL",
        },
      }
    );
    importAccountAssignmentSM.node.addDependency(
      importAccountAssignmentsSMRole
    );
    /** Create import permission set state machine role and policy definitions */
    const importPermissionSetSMRole = new Role(
      this,
      name(buildConfig, "importPermissionSetsSMRole"),
      {
        roleName: name(buildConfig, "permissionSetsImportRole"),
        assumedBy: new ServicePrincipal("states.amazonaws.com"),
      }
    );
    importPermissionSetSMRole.addToPrincipalPolicy(
      new PolicyStatement({
        resources: ["*"],
        actions: [
          "sso:ListPermissionSets",
          "sso:DescribePermissionSet",
          "sso:ListManagedPoliciesInPermissionSet",
          "sso:GetInlinePolicyForPermissionSet",
          "sso:ListTagsForResource",
          "sso:ListAccountsForProvisionedPermissionSet",
        ],
      })
    );
    importPermissionSetSMRole.addToPrincipalPolicy(
      new PolicyStatement({
        actions: [
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:GetItem",
          "dynamodb:DeleteItem",
        ],
        resources: [
          `arn:aws:dynamodb:${buildConfig.PipelineSettings.SSOServiceAccountRegion}:${buildConfig.PipelineSettings.SSOServiceAccountId}:table/${buildConfig.Environment}-temp-PermissionSets`,
          `arn:aws:dynamodb:${buildConfig.PipelineSettings.SSOServiceAccountRegion}:${buildConfig.PipelineSettings.SSOServiceAccountId}:table/${buildConfig.Environment}-temp-PermissionSets/index/*`,
        ],
      })
    );
    importPermissionSetSMRole.addToPrincipalPolicy(
      new PolicyStatement({
        actions: ["states:StartExecution"],
        resources: [importAccountAssignmentSM.ref],
      })
    );
    importPermissionSetSMRole.addToPrincipalPolicy(
      new PolicyStatement({
        actions: ["states:DescribeExecution", "states:StopExecution"],
        resources: ["*"],
      })
    );

    importPermissionSetSMRole.addToPrincipalPolicy(
      new PolicyStatement({
        actions: ["events:PutTargets", "events:PutRule", "events:DescribeRule"],
        resources: [
          `arn:aws:events:${buildConfig.PipelineSettings.SSOServiceAccountRegion}:${buildConfig.PipelineSettings.SSOServiceAccountId}:rule/StepFunctionsGetEventsForStepFunctionsExecutionRule`,
        ],
      })
    );
    importPermissionSetSMRole.addToPrincipalPolicy(
      new PolicyStatement({
        actions: [
          "logs:CreateLogDelivery",
          "logs:GetLogDelivery",
          "logs:UpdateLogDelivery",
          "logs:DeleteLogDelivery",
          "logs:ListLogDeliveries",
          "logs:PutResourcePolicy",
          "logs:DescribeResourcePolicies",
          "logs:DescribeLogGroups",
        ],
        resources: ["*"],
      })
    );

    this.permissionSetImportTopic.grantPublish(importPermissionSetSMRole);
    ssoArtefactsKeyforImport.grantEncryptDecrypt(importPermissionSetSMRole);

    /** Create import permission set state machine definition */
    const importPermissionSetSM = new CfnStateMachine(
      this,
      name(buildConfig, "importPermissionSetsSM"),
      {
        roleArn: importPermissionSetSMRole.roleArn,
        definitionString: JSON.stringify(importPermissionSetsSMJSON),
        stateMachineName: name(buildConfig, "importPermissionSetsSM"),
        loggingConfiguration: {
          destinations: [
            {
              cloudWatchLogsLogGroup: {
                logGroupArn: importArtefactsSMLogGroup.logGroupArn,
              },
            },
          ],
          includeExecutionData: true,
          level: "ALL",
        },
      }
    );
    importPermissionSetSM.node.addDependency(importPermissionSetSMRole);

    /** Create import current config IAM role and policy definitions */
    const importCurrentConfigSMRole = new Role(
      this,
      name(buildConfig, "importCurrentConfigSMRole"),
      {
        roleName: name(buildConfig, "currentSSOConfigImportRole"),
        assumedBy: new ServicePrincipal("states.amazonaws.com"),
      }
    );
    importCurrentConfigSMRole.addToPrincipalPolicy(
      new PolicyStatement({
        actions: [
          "dynamodb:CreateTable",
          "dynamodb:DeleteTable",
          "dynamodb:DescribeTable",
        ],
        resources: [
          `arn:aws:dynamodb:${buildConfig.PipelineSettings.SSOServiceAccountRegion}:${buildConfig.PipelineSettings.SSOServiceAccountId}:table/${buildConfig.Environment}-temp-PermissionSets`,
          `arn:aws:dynamodb:${buildConfig.PipelineSettings.SSOServiceAccountRegion}:${buildConfig.PipelineSettings.SSOServiceAccountId}:table/${buildConfig.Environment}-temp-PermissionSets/index/*`,
        ],
      })
    );
    importCurrentConfigSMRole.addToPrincipalPolicy(
      new PolicyStatement({
        resources: ["*"],
        actions: ["sso:ListInstances"],
      })
    );
    importCurrentConfigSMRole.addToPrincipalPolicy(
      new PolicyStatement({
        actions: ["states:StartExecution"],
        resources: [importPermissionSetSM.ref],
      })
    );
    importCurrentConfigSMRole.addToPrincipalPolicy(
      new PolicyStatement({
        actions: ["states:DescribeExecution", "states:StopExecution"],
        resources: ["*"],
      })
    );

    importCurrentConfigSMRole.addToPrincipalPolicy(
      new PolicyStatement({
        actions: ["events:PutTargets", "events:PutRule", "events:DescribeRule"],
        resources: [
          `arn:aws:events:${buildConfig.PipelineSettings.SSOServiceAccountRegion}:${buildConfig.PipelineSettings.SSOServiceAccountId}:rule/StepFunctionsGetEventsForStepFunctionsExecutionRule`,
        ],
      })
    );
    importCurrentConfigSMRole.addToPrincipalPolicy(
      new PolicyStatement({
        actions: [
          "logs:CreateLogDelivery",
          "logs:GetLogDelivery",
          "logs:UpdateLogDelivery",
          "logs:DeleteLogDelivery",
          "logs:ListLogDeliveries",
          "logs:PutResourcePolicy",
          "logs:DescribeResourcePolicies",
          "logs:DescribeLogGroups",
        ],
        resources: ["*"],
      })
    );

    /** Create import current config state machine definition */
    const importCurrentConfigSM = new CfnStateMachine(
      this,
      name(buildConfig, "importCurrentSSOConfigSM"),
      {
        roleArn: importCurrentConfigSMRole.roleArn,
        definitionString: JSON.stringify(importCurrentConfigSMJSON),
        stateMachineName: name(buildConfig, "importCurrentSSOConfigSM"),
        loggingConfiguration: {
          destinations: [
            {
              cloudWatchLogsLogGroup: {
                logGroupArn: importArtefactsSMLogGroup.logGroupArn,
              },
            },
          ],
          includeExecutionData: true,
          level: "ALL",
        },
      }
    );

    importCurrentConfigSM.node.addDependency(importCurrentConfigSMRole);

    /**
     * Create IAM role with permissions to invoke the import current config
     * state machine and trust policy set to trust target account
     */
    new CrossAccountRole(
      this,
      name(buildConfig, "smStartExecutionRole"),
      buildConfig,
      {
        assumeAccountID: buildConfig.PipelineSettings.TargetAccountId,
        roleNameKey: "smStartExecution-smapi",
        policyStatement: new PolicyStatement({
          resources: [importCurrentConfigSM.ref],
          actions: ["states:StartExecution"],
        }),
      }
    );
    /**
     * Create IAM role with permissions to describe the state machine execution
     * status so that CloudFormation can update resource creation status
     */
    new CrossAccountRole(
      this,
      name(buildConfig, "smDescribeRole"),
      buildConfig,
      {
        assumeAccountID: buildConfig.PipelineSettings.TargetAccountId,
        roleNameKey: "smDescribeSsoApi",
        policyStatement: new PolicyStatement({
          resources: ["*"],
          actions: ["states:DescribeExecution"],
        }),
      }
    );

    /** Cloudwatch insights query definition to debug any current config import error */
    new CfnQueryDefinition(
      this,
      name(buildConfig, "importCurrentSSOConfiguration-errors"),
      {
        name: name(buildConfig, "importCurrentSsoConfiguration-errors"),
        queryString:
          "filter @message like 'solutionError' and details.name not like 'Catchall'| sort id asc",
        logGroupNames: [importArtefactsSMLogGroup.logGroupName],
      }
    );
  }
}
