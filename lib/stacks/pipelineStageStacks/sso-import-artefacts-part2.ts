import { CustomResource, Duration, Stack, StackProps } from "aws-cdk-lib";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Provider } from "aws-cdk-lib/custom-resources";
import { Construct } from "constructs";
import { join } from "path";
import { BuildConfig } from "../../build/buildConfig";
import { SSOObjectsDiscoveryPart2 } from "../../constructs/sso-objects-discovery-part2";

function name(buildConfig: BuildConfig, resourcename: string): string {
  return buildConfig.Environment + "-" + resourcename;
}

export class SSOImportArtefactsPart2 extends Stack {
  constructor(
    scope: Construct,
    id: string,
    props: StackProps | undefined,
    buildConfig: BuildConfig
  ) {
    super(scope, id, props);

    /**
     * We deploy SSO objects discovery part 2 for both nightly run and import
     * current config use cases
     */

    const deploySSOObjectsDiscoveryPart2 = new SSOObjectsDiscoveryPart2(
      this,
      name(buildConfig, "deploySSOObjectsDiscoveryPart2"),
      buildConfig
    );
    /** Use case specific additions */

    /**
     * If import current config is enabled, we want to trigger the state machine
     * as part of the pipeline deployment using CloudFormation Custom Resource
     * CDK framework
     */

    if (buildConfig.Parameters.ImportCurrentSSOConfiguration === true) {
      const updateCustomResourceHandler = new NodejsFunction(
        this,
        name(buildConfig, `updateCustomResourceHandler`),
        {
          runtime: lambda.Runtime.NODEJS_16_X,
          functionName: name(buildConfig, `updateCustomResourceHandler`),
          layers: [deploySSOObjectsDiscoveryPart2.nodeJsLayer],
          entry: join(
            __dirname,
            "../../../",
            "lib",
            "lambda-functions",
            "current-config-handlers",
            "src",
            "update-custom-resource.ts"
          ),
          bundling: {
            externalModules: [
              "@aws-sdk/client-sfn",
              "@aws-sdk/credential-providers",
            ],
            minify: true,
          },
          environment: {
            smDescribeRoleArn:
              deploySSOObjectsDiscoveryPart2.currentConfigSMDescribeRoleArn,
            ssoAccountId: buildConfig.PipelineSettings.SSOServiceAccountId,
            ssoRegion: buildConfig.PipelineSettings.SSOServiceAccountRegion,
          },
        }
      );

      if (updateCustomResourceHandler.role) {
        updateCustomResourceHandler.addToRolePolicy(
          new PolicyStatement({
            resources: [
              deploySSOObjectsDiscoveryPart2.currentConfigSMDescribeRoleArn,
            ],
            actions: ["sts:AssumeRole"],
          })
        );
      }

      const parentSMInvokePolicy = new PolicyStatement({
        resources: [
          deploySSOObjectsDiscoveryPart2.currentConfigSMInvokeRoleArn,
        ],
        actions: ["sts:AssumeRole"],
      });

      const parentSMInvokeFunction = new NodejsFunction(
        this,
        name(buildConfig, `parentSMInvokeFunction`),
        {
          runtime: lambda.Runtime.NODEJS_16_X,
          functionName: name(buildConfig, `parentSMInvokeFunction`),
          layers: [deploySSOObjectsDiscoveryPart2.nodeJsLayer],
          entry: join(
            __dirname,
            "../../../",
            "lib",
            "lambda-functions",
            "current-config-handlers",
            "src",
            "trigger-parentSM.ts"
          ),
          bundling: {
            externalModules: [
              "@aws-sdk/client-sfn",
              "@aws-sdk/credential-providers",
              "uuid",
            ],
            minify: true,
          },
        }
      );

      if (parentSMInvokeFunction.role) {
        parentSMInvokeFunction.role.addToPrincipalPolicy(parentSMInvokePolicy);
      }

      const parentSMInvokeProvider = new Provider(
        this,
        name(buildConfig, "parentSMInvokeProvider"),
        {
          onEventHandler: parentSMInvokeFunction,
          isCompleteHandler: updateCustomResourceHandler,
          queryInterval: Duration.seconds(5),
          totalTimeout: Duration.minutes(120), // to handle scenarios where organisations have a lot of existing account assignments already
        }
      );

      const parentSMResource = new CustomResource(
        this,
        name(buildConfig, "parentSMResource"),
        {
          serviceToken: parentSMInvokeProvider.serviceToken,
          properties: {
            smInvokeRoleArn:
              deploySSOObjectsDiscoveryPart2.currentConfigSMInvokeRoleArn,
            importCurrentConfigSMArn: `arn:aws:states:${buildConfig.PipelineSettings.SSOServiceAccountRegion}:${buildConfig.PipelineSettings.SSOServiceAccountId}:stateMachine:${buildConfig.Environment}-importCurrentSSOConfigSM`,
            importAccountAssignmentSMArn: `arn:aws:states:${buildConfig.PipelineSettings.SSOServiceAccountRegion}:${buildConfig.PipelineSettings.SSOServiceAccountId}:stateMachine:${buildConfig.Environment}-importAccountAssignmentsSM`,
            importPermissionSetSMArn: `arn:aws:states:${buildConfig.PipelineSettings.SSOServiceAccountRegion}:${buildConfig.PipelineSettings.SSOServiceAccountId}:stateMachine:${buildConfig.Environment}-importPermissionSetsSM`,
            accountAssignmentImportTopicArn:
              deploySSOObjectsDiscoveryPart2.accountAssignmentImportTopic
                .topicArn,
            permissionSetImportTopicArn:
              deploySSOObjectsDiscoveryPart2.permissionSetImportTopic.topicArn,
            temporaryPermissionSetTableName: `${buildConfig.Environment}-temp-PermissionSets`,
            ssoRegion: buildConfig.PipelineSettings.SSOServiceAccountRegion,
          },
        }
      );

      parentSMResource.node.addDependency(
        deploySSOObjectsDiscoveryPart2.importAccountAssignmentHandler
      );
      parentSMResource.node.addDependency(
        deploySSOObjectsDiscoveryPart2.importPermissionSetHandler
      );
      parentSMResource.node.addDependency(updateCustomResourceHandler);
    }
  }
}
