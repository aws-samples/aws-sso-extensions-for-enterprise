#!/usr/bin/env node

import { App, DefaultStackSynthesizer, Tags } from "aws-cdk-lib";
import { readFileSync } from "fs";
import { resolve } from "path";
import { BuildConfig } from "../lib/build/buildConfig";
import { AwsSsoExtensionsForEnterprise } from "../lib/stacks/pipeline/aws-sso-extensions-for-enterprise";

import yaml = require("js-yaml");
import { RegionSwitchBuildConfig } from "../lib/build/regionSwitchBuildConfig";
import { AwsSsoExtensionsRegionSwitchDiscover } from "../lib/stacks/region-switch/aws-sso-extensions-region-switch-discover";
import { AwsSsoExtensionsRegionSwitchDeploy } from "../lib/stacks/region-switch/aws-sso-extensions-region-switch-deploy";
const app = new App();

function ensureString(
  /* eslint-disable  @typescript-eslint/no-explicit-any */
  object: { [name: string]: any },
  propName: string
): string {
  if (!object[`${propName}`] || object[`${propName}`].trim().length === 0)
    throw new Error(propName + " does not exist or is empty");

  return object[`${propName}`];
}

function ensureValidString(
  /* eslint-disable  @typescript-eslint/no-explicit-any */
  object: { [name: string]: any },
  propName: string,
  validList: Array<string>
): string {
  if (
    !object[`${propName}`] ||
    object[`${propName}`].trim().length === 0 ||
    typeof object[`${propName}`] !== "string"
  )
    throw new Error(
      propName +
        " does not exist or is empty or is of not the correct data type"
    );

  const value = ("" + object[`${propName}`]).toUpperCase();
  if (!validList.includes(value)) {
    throw new Error(
      `${propName} is not one of the valid values - ${validList.toString()}`
    );
  }

  return object[`${propName}`];
}

function ensureNumber(
  /* eslint-disable  @typescript-eslint/no-explicit-any */
  object: { [name: string]: any },
  propName: string
): number {
  if (!object[`${propName}`] || typeof object[`${propName}`] !== "number")
    throw new Error(
      propName + " does not exist or is empty or is not a number data type"
    );

  return object[`${propName}`];
}

function ensureBoolean(
  /* eslint-disable  @typescript-eslint/no-explicit-any */
  object: { [name: string]: any },
  propName: string
): boolean {
  if (typeof object[`${propName}`] !== "boolean")
    throw new Error(
      propName + " does not exist or is of not the correct data type"
    );

  return object[`${propName}`];
}

function getConfig() {
  const env = app.node.tryGetContext("config");
  if (!env)
    throw new Error(
      "Context variable missing on CDK command. Pass in as `-c config=XXX`"
    );

  /* eslint-disable  @typescript-eslint/no-explicit-any */
  const unparsedEnv: any = yaml.load(
    readFileSync(resolve("./config/" + env + ".yaml"), "utf8")
  );

  const buildConfig: BuildConfig = {
    App: ensureString(unparsedEnv, "App"),
    Environment: ensureString(unparsedEnv, "Environment"),
    Version: ensureString(unparsedEnv, "Version"),

    PipelineSettings: {
      BootstrapQualifier: ensureString(
        unparsedEnv["PipelineSettings"],
        "BootstrapQualifier"
      ),
      DeploymentAccountId: ensureString(
        unparsedEnv["PipelineSettings"],
        "DeploymentAccountId"
      ),
      DeploymentAccountRegion: ensureString(
        unparsedEnv["PipelineSettings"],
        "DeploymentAccountRegion"
      ),
      TargetAccountId: ensureString(
        unparsedEnv["PipelineSettings"],
        "TargetAccountId"
      ),
      TargetAccountRegion: ensureString(
        unparsedEnv["PipelineSettings"],
        "TargetAccountRegion"
      ),
      SSOServiceAccountId: ensureString(
        unparsedEnv["PipelineSettings"],
        "SSOServiceAccountId"
      ),
      SSOServiceAccountRegion: ensureString(
        unparsedEnv["PipelineSettings"],
        "SSOServiceAccountRegion"
      ),
      OrgMainAccountId: ensureString(
        unparsedEnv["PipelineSettings"],
        "OrgMainAccountId"
      ),
      RepoArn: ensureString(unparsedEnv["PipelineSettings"], "RepoArn"),
      RepoBranchName: ensureString(
        unparsedEnv["PipelineSettings"],
        "RepoBranchName"
      ),
      SynthCommand: ensureString(
        unparsedEnv["PipelineSettings"],
        "SynthCommand"
      ),
    },

    Parameters: {
      LinksProvisioningMode: ensureValidString(
        unparsedEnv["Parameters"],
        "LinksProvisioningMode",
        ["API", "S3"]
      ),
      PermissionSetProvisioningMode: ensureValidString(
        unparsedEnv["Parameters"],
        "PermissionSetProvisioningMode",
        ["API", "S3"]
      ),
      LinkCallerRoleArn: ensureString(
        unparsedEnv["Parameters"],
        "LinkCallerRoleArn"
      ),
      PermissionSetCallerRoleArn: ensureString(
        unparsedEnv["Parameters"],
        "PermissionSetCallerRoleArn"
      ),
      NotificationEmail: ensureString(
        unparsedEnv["Parameters"],
        "NotificationEmail"
      ),
      AccountAssignmentVisibilityTimeoutHours: ensureNumber(
        unparsedEnv["Parameters"],
        "AccountAssignmentVisibilityTimeoutHours"
      ),
      IsAdUsed: ensureBoolean(unparsedEnv["Parameters"], "IsAdUsed"),
      DomainName: ensureString(unparsedEnv["Parameters"], "DomainName"),
      ImportCurrentSSOConfiguration: ensureBoolean(
        unparsedEnv["Parameters"],
        "ImportCurrentSSOConfiguration"
      ),
      UpgradeFromVersionLessThanV303: ensureBoolean(
        unparsedEnv["Parameters"],
        "UpgradeFromVersionLessThanV303"
      ),
      EnableNightlyRun: ensureBoolean(
        unparsedEnv["Parameters"],
        "EnableNightlyRun"
      ),
      NightlyRunRemediationMode: ensureValidString(
        unparsedEnv["Parameters"],
        "NightlyRunRemediationMode",
        ["NOTIFY", "AUTOREMEDIATE"]
      ),
      SupportNestedOU: ensureBoolean(
        unparsedEnv["Parameters"],
        "SupportNestedOU"
      ),
    },
  };

  return buildConfig;
}

function getRegionSwitchConfig() {
  /* eslint-disable  @typescript-eslint/no-explicit-any */
  const unparsedEnv: any = yaml.load(
    readFileSync(resolve("./config/" + "region-switch" + ".yaml"), "utf8")
  );

  const buildConfig: RegionSwitchBuildConfig = {
    SSOServiceAccountId: ensureString(unparsedEnv, "SSOServiceAccountId"),
    BootstrapQualifier: ensureString(unparsedEnv, "BootstrapQualifier"),
    SSOServiceAccountRegion: ensureString(
      unparsedEnv,
      "SSOServiceAccountRegion"
    ),
    SSOServiceTargetAccountRegion: ensureString(
      unparsedEnv,
      "SSOServiceTargetAccountRegion"
    ),
  };

  return buildConfig;
}

async function DeploySSOForEnterprise() {
  const env: string = app.node.tryGetContext("config");
  if (!env)
    throw new Error(
      "Context variable missing on CDK command. Pass in as `-c config=XXX`"
    );

  if (env.toUpperCase() === "REGION-SWITCH-DISCOVER") {
    const buildConfig: RegionSwitchBuildConfig = getRegionSwitchConfig();
    const AwsSsoExtensionsRegionSwitchDiscoverAppName = `aws-sso-extensions-region-switch-discover`;
    new AwsSsoExtensionsRegionSwitchDiscover(
      app,
      AwsSsoExtensionsRegionSwitchDiscoverAppName,
      {
        env: {
          region: buildConfig.SSOServiceAccountRegion,
          account: buildConfig.SSOServiceAccountId,
        },
        synthesizer: new DefaultStackSynthesizer({
          qualifier: buildConfig.BootstrapQualifier,
        }),
      },
      buildConfig
    );
  } else if (env.toUpperCase() === "REGION-SWITCH-DEPLOY") {
    const buildConfig: RegionSwitchBuildConfig = getRegionSwitchConfig();
    const AwsSsoExtensionsRegionSwitchDeployAppName = `aws-sso-extensions-region-switch-deploy`;
    new AwsSsoExtensionsRegionSwitchDeploy(
      app,
      AwsSsoExtensionsRegionSwitchDeployAppName,
      {
        env: {
          region: buildConfig.SSOServiceTargetAccountRegion,
          account: buildConfig.SSOServiceAccountId,
        },
        synthesizer: new DefaultStackSynthesizer({
          qualifier: buildConfig.BootstrapQualifier,
        }),
      },
      buildConfig
    );
  } else {
    const buildConfig: BuildConfig = getConfig();

    const AwsSsoExtensionsForEnterpriseAppName =
      buildConfig.Environment + "-" + buildConfig.App;
    const AwsSsoExtensionsForEnterpriseStack =
      new AwsSsoExtensionsForEnterprise(
        app,
        AwsSsoExtensionsForEnterpriseAppName,
        {
          env: {
            region: buildConfig.PipelineSettings.DeploymentAccountRegion,
            account: buildConfig.PipelineSettings.DeploymentAccountId,
          },
          synthesizer: new DefaultStackSynthesizer({
            qualifier: buildConfig.PipelineSettings.BootstrapQualifier,
          }),
        },
        buildConfig
      );

    Tags.of(AwsSsoExtensionsForEnterpriseStack).add("App", buildConfig.App);
    Tags.of(AwsSsoExtensionsForEnterpriseStack).add(
      "Environment",
      buildConfig.Environment
    );
  }
}

DeploySSOForEnterprise();
