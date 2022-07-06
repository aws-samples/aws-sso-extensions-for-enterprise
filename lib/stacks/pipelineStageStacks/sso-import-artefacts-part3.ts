/*
This is used for any post clean up / completions operations required for SSO import current config/ nightlyRun use cases
*/
import { Stack, StackProps } from "aws-cdk-lib";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import {
  AwsCustomResource,
  AwsCustomResourcePolicy,
  PhysicalResourceId,
} from "aws-cdk-lib/custom-resources";
import { Construct } from "constructs";
import { BuildConfig } from "../../build/buildConfig";

function name(buildConfig: BuildConfig, resourcename: string): string {
  return buildConfig.Environment + "-" + resourcename;
}

export class SSOImportArtefactsPart3 extends Stack {
  constructor(
    scope: Construct,
    id: string,
    props: StackProps | undefined,
    buildConfig: BuildConfig
  ) {
    super(scope, id, props);

    /**
     * For nightlyRun use case, if the feature is enabled we enable the rule,
     * else we disable the rule
     */
    /** Construct the required permissions policy for this */
    const nightlyRunMgmtPolicy = new PolicyStatement({
      resources: [
        `arn:aws:events:${buildConfig.PipelineSettings.SSOServiceAccountRegion}:${buildConfig.PipelineSettings.SSOServiceAccountId}:rule/${buildConfig.Environment}-nightlyRunRule`,
      ],
      actions: ["events:EnableRule", "events:DisableRule"],
    });

    if (buildConfig.Parameters.EnableNightlyRun) {
      /** Nightly run is enabled, so we enable the rule */
      new AwsCustomResource(this, name(buildConfig, "enableNightlyRunRule"), {
        onCreate: {
          service: "EventBridge",
          action: "enableRule",
          parameters: {
            Name: name(buildConfig, "nightlyRunRule"),
          },
          physicalResourceId: PhysicalResourceId.of(
            `${buildConfig.Environment}-nightlyRunRule-enablement`
          ),
          region: buildConfig.PipelineSettings.SSOServiceAccountRegion,
        },
        policy: AwsCustomResourcePolicy.fromStatements([nightlyRunMgmtPolicy]),
      });
    } else {
      /** Nightly run is disabled/unknowmn state, so we disable the rule */
      new AwsCustomResource(this, name(buildConfig, "disableNightlyRunRule"), {
        onCreate: {
          service: "EventBridge",
          action: "disableRule",
          parameters: {
            Name: name(buildConfig, "nightlyRunRule"),
          },
          physicalResourceId: PhysicalResourceId.of(
            `${buildConfig.Environment}-nightlyRunRule-disablement`
          ),
          region: buildConfig.PipelineSettings.SSOServiceAccountRegion,
        },
        policy: AwsCustomResourcePolicy.fromStatements([nightlyRunMgmtPolicy]),
      });
    }
  }
}
