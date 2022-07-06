import { Stack, StackProps } from "aws-cdk-lib";
import { Rule, RuleTargetInput, Schedule } from "aws-cdk-lib/aws-events";
import { SfnStateMachine } from "aws-cdk-lib/aws-events-targets";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import { StateMachine } from "aws-cdk-lib/aws-stepfunctions";
import { Construct } from "constructs";
import { v4 as uuidv4 } from "uuid";
import { BuildConfig } from "../../build/buildConfig";
import { CrossAccountRole } from "../../constructs/cross-account-role";
import { SSOObjectsDiscoveryPart1 } from "../../constructs/sso-objects-discovery-part1";

function name(buildConfig: BuildConfig, resourcename: string): string {
  return buildConfig.Environment + "-" + resourcename;
}

const generateRandomString = uuidv4().toString().split("-")[0];
const requestId = uuidv4().toString();

export class SSOImportArtefactsPart1 extends Stack {
  constructor(
    scope: Construct,
    id: string,
    props: StackProps | undefined,
    buildConfig: BuildConfig
  ) {
    super(scope, id, props);

    /** Static name for temporary DynamoDB table */
    const temporaryPermissionSetTableName = `${buildConfig.Environment}-temp-PermissionSets`;

    /**
     * We deploy SSO import artefacts part 1 for both nightly run and import
     * current config use cases
     */

    const deploySSOImportArtefactsPart1 = new SSOObjectsDiscoveryPart1(
      this,
      name(buildConfig, "deploySSOImportArtefactsforNightlyRun"),
      buildConfig
    );
    /**
     * Create all deterministic resource names for importing and using it as a
     * target for the nightly run event bridge rule
     */

    const importCurrentConfigSMArn = `arn:aws:states:${buildConfig.PipelineSettings.SSOServiceAccountRegion}:${buildConfig.PipelineSettings.SSOServiceAccountId}:stateMachine:${buildConfig.Environment}-importCurrentSSOConfigSM`;
    const importAccountAssignmentSMArn = `arn:aws:states:${buildConfig.PipelineSettings.SSOServiceAccountRegion}:${buildConfig.PipelineSettings.SSOServiceAccountId}:stateMachine:${buildConfig.Environment}-importAccountAssignmentsSM`;
    const importPermissionSetSMArn = `arn:aws:states:${buildConfig.PipelineSettings.SSOServiceAccountRegion}:${buildConfig.PipelineSettings.SSOServiceAccountId}:stateMachine:${buildConfig.Environment}-importPermissionSetSM`;

    /** Use case specific additions below */

    /**
     * Create event bridge rule for nightlyRun in a disabled state. This will be
     * enabled if the customer chooses to have nightlyRun feature
     */

    new Rule(this, name(buildConfig, "nightlyRunRule"), {
      ruleName: name(buildConfig, "nightlyRunRule"),
      description:
        "Enable nightly run for aws-sso-extensions-for-enterprise governance",
      enabled: false, // This rule is disabled on creation to accommodate race condition with the import config lambda's that are not yet created. This will be enabled as part of an additional pipeline stage after creation of the lambda functions in part2
      schedule: Schedule.cron({ minute: "0", hour: "23" }),
      targets: [
        new SfnStateMachine(
          StateMachine.fromStateMachineArn(
            this,
            name(buildConfig, `currentConfigSMTarget`),
            importCurrentConfigSMArn
          ),
          {
            input: RuleTargetInput.fromObject({
              temporaryPermissionSetTableName: temporaryPermissionSetTableName,
              importAccountAssignmentSMArn: importAccountAssignmentSMArn,
              accountAssignmentImportTopicArn:
                deploySSOImportArtefactsPart1.accountAssignmentImportTopic
                  .topicArn,
              importPermissionSetSMArn: importPermissionSetSMArn,
              permissionSetImportTopicArn:
                deploySSOImportArtefactsPart1.permissionSetImportTopic.topicArn,
              PhysicalResourceId: generateRandomString,
              eventType: "Create",
              triggerSource: "EventBridge",
              requestId: requestId,
              waitSeconds: 2,
              pageSize: 5,
            }),
          }
        ),
      ],
    });

    /** Create Cross account role to be used by nightlyRun processing lambda */
    new CrossAccountRole(
      this,
      name(buildConfig, "nightlyRun-ssoapi-Role"),
      buildConfig,
      {
        assumeAccountID: buildConfig.PipelineSettings.TargetAccountId,
        roleNameKey: "nightlyRun-ssoapi",
        policyStatement: new PolicyStatement({
          resources: ["*"],
          actions: [
            "sso:DeleteInlinePolicyFromPermissionSet",
            "sso:DetachManagedPolicyFromPermissionSet",
            "sso:DeletePermissionSet",
            "sso:CreatePermissionSet",
            "sso:GetPermissionSet",
            "sso:TagResource",
            "sso:ListTagsForResource",
            "sso:ListPermissionSetProvisioningStatus",
            "sso:UntagResource",
            "sso:ListInstances",
            "sso:DescribePermissionSet",
            "sso:ProvisionPermissionSet",
            "sso:ListPermissionSets",
            "sso:ListAccountsForProvisionedPermissionSet",
            "sso:PutInlinePolicyToPermissionSet",
            "sso:AttachManagedPolicyToPermissionSet",
            "sso:UpdatePermissionSet",
            "sso:GetInlinePolicyForPermissionSet",
            "sso:ListManagedPoliciesInPermissionSet",
            "sso:DescribePermissionSetProvisioningStatus",
            "sso:CreateAccountAssignment",
            "sso:DescribeAccountAssignmentDeletionStatus",
            "sso:ListAccountAssignmentDeletionStatus",
            "sso:DescribeAccountAssignmentCreationStatus",
            "sso:DeleteAccountAssignment",
            "sso:ListAccountAssignmentCreationStatus",
            "sso:ListAccountAssignments",
            "sso:ListInstances",
            "sso:DescribeAccountAssignmentDeletionStatus",
            "sso:DescribePermissionSetProvisioningStatus",
            "sso:DescribeAccountAssignmentCreationStatus",
          ],
        }),
      }
    );
  }
}
