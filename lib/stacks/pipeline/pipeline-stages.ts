/*
Pipeline stages abstraction
*/

import { DefaultStackSynthesizer, Stage, StageProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import { BuildConfig } from "../../build/buildConfig";
import { OrgEventsProcessor } from "../pipelineStageStacks/org-events-processor";
import { PreSolutionArtefacts } from "../pipelineStageStacks/pre-solution-artefacts";
import { SolutionArtefacts } from "../pipelineStageStacks/solution-artefacts";
import { SSOApiRoles } from "../pipelineStageStacks/sso-api-roles";
import { SSOEventsProcessor } from "../pipelineStageStacks/sso-events-processor";
import { SSOImportArtefactsPart1 } from "../pipelineStageStacks/sso-import-artefacts-part1";
import { SSOImportArtefactsPart2 } from "../pipelineStageStacks/sso-import-artefacts-part2";
import { SSOImportArtefactsPart3 } from "../pipelineStageStacks/sso-import-artefacts-part3";
import { UpgradeToV303 } from "../pipelineStageStacks/upgrade-to-v303";

function fullname(buildConfig: BuildConfig, name: string): string {
  return buildConfig.Environment + "-" + buildConfig.App + "-" + name;
}

export class OrgArtefactsDeploymentStage extends Stage {
  constructor(
    scope: Construct,
    id: string,
    props: StageProps | undefined,
    buildConfig: BuildConfig
  ) {
    super(scope, id, props);

    new OrgEventsProcessor(
      this,
      fullname(buildConfig, "orgEventsProcessorStack"),
      {
        stackName: fullname(buildConfig, "orgEventsProcessorStack"),
        synthesizer: new DefaultStackSynthesizer({
          qualifier: buildConfig.PipelineSettings.BootstrapQualifier,
        }),
      },
      buildConfig
    );
  }
}

export class SSOArtefactsDeploymentStage extends Stage {
  constructor(
    scope: Construct,
    id: string,
    props: StageProps | undefined,
    buildConfig: BuildConfig
  ) {
    super(scope, id, props);

    new SSOEventsProcessor(
      this,
      fullname(buildConfig, "ssoEventsProcessorStack"),
      {
        stackName: fullname(buildConfig, "ssoEventsProcessorStack"),
        synthesizer: new DefaultStackSynthesizer({
          qualifier: buildConfig.PipelineSettings.BootstrapQualifier,
        }),
      },
      buildConfig
    );

    new SSOApiRoles(
      this,
      fullname(buildConfig, "ssoAPIRolesstack"),
      {
        stackName: fullname(buildConfig, "ssoAPIRolesstack"),
        synthesizer: new DefaultStackSynthesizer({
          qualifier: buildConfig.PipelineSettings.BootstrapQualifier,
        }),
      },
      buildConfig
    );

    new SSOImportArtefactsPart1(
      this,
      fullname(buildConfig, "ssoImportArtefactsPart1stack"),
      {
        stackName: fullname(buildConfig, "ssoImportArtefactsPart1stack"),
        synthesizer: new DefaultStackSynthesizer({
          qualifier: buildConfig.PipelineSettings.BootstrapQualifier,
        }),
      },
      buildConfig
    );
  }
}

export class SolutionArtefactsDeploymentStage extends Stage {
  constructor(
    scope: Construct,
    id: string,
    props: StageProps | undefined,
    buildConfig: BuildConfig
  ) {
    super(scope, id, props);

    const preSolutionArtefactsStack = new PreSolutionArtefacts(
      this,
      fullname(buildConfig, "preSolutionArtefactsStack"),
      {
        stackName: fullname(buildConfig, "preSolutionArtefactsStack"),
        synthesizer: new DefaultStackSynthesizer({
          qualifier: buildConfig.PipelineSettings.BootstrapQualifier,
        }),
      },
      buildConfig
    );

    const solutionartefactsStack = new SolutionArtefacts(
      this,
      fullname(buildConfig, "solutionartefactsStack"),
      {
        stackName: fullname(buildConfig, "solutionartefactsStack"),
        synthesizer: new DefaultStackSynthesizer({
          qualifier: buildConfig.PipelineSettings.BootstrapQualifier,
        }),
      },
      buildConfig
    );

    solutionartefactsStack.node.addDependency(preSolutionArtefactsStack);

    const ssoImportArtefactsPart2Stack = new SSOImportArtefactsPart2(
      this,
      fullname(buildConfig, "ssoImportArtefactsPart2Stack"),
      {
        stackName: fullname(buildConfig, "ssoImportArtefactsPart2Stack"),
        synthesizer: new DefaultStackSynthesizer({
          qualifier: buildConfig.PipelineSettings.BootstrapQualifier,
        }),
      },
      buildConfig
    );

    ssoImportArtefactsPart2Stack.node.addDependency(solutionartefactsStack);

    if (buildConfig.Parameters.UpgradeFromVersionLessThanV303) {
      const upgradeToV303Stack = new UpgradeToV303(
        this,
        fullname(buildConfig, "upgradeToV303Stack"),
        {
          stackName: fullname(buildConfig, "upgradeToV303Stack"),
          synthesizer: new DefaultStackSynthesizer({
            qualifier: buildConfig.PipelineSettings.BootstrapQualifier,
          }),
        },
        buildConfig
      );
      upgradeToV303Stack.node.addDependency(solutionartefactsStack);
    }
  }
}

export class SSOArtefactsPostDeployment extends Stage {
  constructor(
    scope: Construct,
    id: string,
    props: StageProps | undefined,
    buildConfig: BuildConfig
  ) {
    super(scope, id, props);

    new SSOImportArtefactsPart3(
      this,
      fullname(buildConfig, "ssoImportArtefactsPart3stack"),
      {
        stackName: fullname(buildConfig, "ssoImportArtefactsPart3stack"),
        synthesizer: new DefaultStackSynthesizer({
          qualifier: buildConfig.PipelineSettings.BootstrapQualifier,
        }),
      },
      buildConfig
    );
  }
}
