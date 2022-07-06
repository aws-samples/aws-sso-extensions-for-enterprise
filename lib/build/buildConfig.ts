/*
Build parameters interface definition
To enable easier sharing between constructs and stacks as well as
synth and deploy validations
*/

export interface BuildConfig {
  readonly App: string;
  readonly Environment: string;
  readonly Version: string;
  readonly PipelineSettings: PipelineSettings;
  readonly Parameters: Parameters;
}

export interface PipelineSettings {
  readonly BootstrapQualifier: string;
  readonly DeploymentAccountId: string;
  readonly DeploymentAccountRegion: string;
  readonly TargetAccountId: string;
  readonly TargetAccountRegion: string;
  readonly SSOServiceAccountId: string;
  readonly SSOServiceAccountRegion: string;
  readonly OrgMainAccountId: string;
  readonly RepoArn: string;
  readonly RepoBranchName: string;
  readonly SynthCommand: string;
}

export interface Parameters {
  readonly LinksProvisioningMode: string;
  readonly PermissionSetProvisioningMode: string;
  readonly LinkCallerRoleArn: string;
  readonly PermissionSetCallerRoleArn: string;
  readonly NotificationEmail: string;
  readonly AccountAssignmentVisibilityTimeoutHours: number;
  readonly IsAdUsed: boolean;
  readonly DomainName: string;
  readonly ImportCurrentSSOConfiguration: boolean;
  readonly UpgradeFromVersionLessThanV303: boolean;
  readonly EnableNightlyRun: boolean;
  readonly NightlyRunRemediationMode: string;
  readonly SupportNestedOU: boolean;
}
