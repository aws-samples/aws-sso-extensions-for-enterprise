# Troubleshooting

- The solution uses a logging convention aligned to the following data structure for all the lambda based use case flow logs written to cloud watch log groups. Trace starts from a use case trigger where it generates the request ID and all the subsequent logs until the lifecycle of this request carry over this request ID

| Log Element        |                                                         Description                                                          | Mandatory |
| ------------------ | :--------------------------------------------------------------------------------------------------------------------------: | :-------: |
| logMode            |                           Classifies mode the log message is written in, i.e.<br>info, error, warn                           |    Yes    |
| handler            |                                      Name of the lambda handler that generated the log                                       |    Yes    |
| requestId          |                  UUID based request ID to collate different log entries<br>triggered from the same process                   |    No     |
| status             | Status of the current request i.e. one of InProgress,<br>Completed, FailedWithError, FailedWithException, OnHold,<br>Aborted |    Yes    |
| statusMessage      |                                          Details of status to provide more context                                           |    No     |
| relatedData        |  Solution entity that the log is being written to. For ex,<br>this could be a permission set name, account assignment link   |    No     |
| hasRelatedRequests |                       Either true/false depending on whether this request triggered<br>other requests                        |    No     |
| sourceReqeustId    |                                   Holds the source request ID that triggered this request                                    |    No     |

- The solution writes logs to the following cloud watch log groups in `target` account and region. Note that these log groups only get created after the relevant use case flow is executed. Replace `env` with your environment name

| Cloudwatch log group                                  |                                                                       Related use case                                                                       |
| ----------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------: |
| /aws/lambda/env-linkApiHandler                        |                                                        Account assignment - API interface processing                                                         |
| /aws/lambda/env-linkCuHandler                         |                                                  Account assignment - S3 interface create/update processing                                                  |
| /aws/lambda/env-linkDelHandler                        |                                                     Account assignment - S3 interface delete processing                                                      |
| /aws/lambda/env-linkManagerHandler                    |                                                 Account assignment - provisioning/de-provisioning operations                                                 |
| /aws/lambda/env-linkTopicProcessor                    | Account assignment - provisioning/de-provisioning topic processor<br>that handles resolution of ou_id, root, account_tag scopes into<br>target accounts list |
| /aws/lambda/env-processTargetAccountSMListenerHandler |               Account assignment - handles state machine outputs when the target accounts<br>for ou_id, root, account_tag scopes are resolved                |
| /aws/lambda/env-psApiHandler                          |                                                          Permission set - API interface processing                                                           |
| /aws/lambda/env-psCuHandler                           |                                                    Permission set - S3 interface create/update processing                                                    |
| /aws/lambda/env-psDelHandler                          |                                                       Permissoin set - S3 interface delete processing                                                        |
| /aws/lambda/env-permissionSetTopicProcessor           |                                                    Permission set - create/update/delete topic processor                                                     |
| /aws/lambda/env-permissionSetSyncHandler              |                                Permission set - synchronisation of updated permission set to already provisioned<br>accounts                                 |
| /aws/lambda/env-ssoUserHandler                        |                                                 Self sustain - SSO user creation/deletion events processing                                                  |
| /aws/lambda/env-ssoGroupHandler                       |                                                 Self sustain - SSO group creation/deletion events processing                                                 |
| /aws/lambda/env-orgEventsHandler                      |                                                         Self sustain - org changes events processing                                                         |

- The solution deploys pre-defined `Cloud watch insights queries` in `target` account and region that allow you to access information around a use case flow easily. These queries are defined to handle most common queries. If these queries do not fit your needs, then you could tweak them to fit your requirements. Replace `env` with your environment name.

| Cloudwatch Insights query name                             |                                      Purpose                                       |
| ---------------------------------------------------------- | :--------------------------------------------------------------------------------: |
| env-accountAssignmentAPIFlows-getRequestDetails            |  Get details of a specific request for account assignment flows via API interface  |
| env-accountAssignmentAPIFlows-getRelatedRequestDetails     | Get details of all related requests for account assignment flows via API interface |
| env-permissionSetAPIFlows-getRequestDetails                |    Get details of a specific request for permission set flows via API interface    |
| env-permissionSetAPIFlows-getRelatedRequestDetails         |   Get details of all related requests for permission set flows via API interface   |
| env-ssoGroupTriggerFlows-getRequestDetails                 |      Get details of a specific request for SSO group creation/deletion events      |
| env-ssoGroupTriggerFlows-getRelatedRequestDetails          |     Get details of all related requests for SSO group creation/deletion events     |
| env-ssoUserTriggerFlows-getRequestDetails                  |      Get details of a specific request for SSO user creation/deletion events       |
| env-ssoUserTriggerFlows-getRelatedRequestDetails           |     Get details of all related requests for SSO user creation/deletion events      |
| env-permissionSetSyncTriggerFlows-getRequestDetails        |          Get details of a specific request for permission set sync flows           |
| env-permissionSetSyncTriggerFlows-getRelatedRequestDetails |         Get details of all related requests for permission set sync flows          |
| env-orgEventsTriggerFlows-getRequestDetails                |                  Get details of a specific request for org events                  |
| env-orgEventsTriggerFlows-getRelatedRequestDetails         |                 Get details of all related requests for org events                 |

- For `import current SSO configuration` use cases, the solution creates the cloudwatch insights query `env-importCurrentSsoConfiguration-errors` in your `SSO service` account `SSO service` region to provide details of all the errors that the state machine ran into and suppressed when trying to import current SSO configuration into the solution
- For `region switch` use cases, the solution creates the cloudwatch insights query `aws-sso-extensions-region-switch-discover-errors` in your `SSO service` account `SSOServiceAccountRegion` to provide details of all the errors that the state machine ran into and suppressed when trying to discover your current SSO region configuration
- For `region switch` use cases, the solution creates the cloudwatch insights query `aws-sso-extensions-region-switch-deploy-errors` in your `SSO service` account `SSOServiceTargetAccountRegion` to provide details of all the errors that the state machine ran into and suppressed when trying to deploy the discovered SSO configuration into your new region
- For `upgradetoV303` use cases, the solution creates the cloudwatch insights query `upgradeV303-errors` in your `target` account and region to provide details of all the errors that the state machine ran into and suppressed when trying to upgrade account assignments from old solution format to a format compatible with solution version 3.0.3 and above
