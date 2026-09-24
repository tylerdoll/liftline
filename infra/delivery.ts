import { Stack, type StackProps, CfnOutput } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as codebuild from "aws-cdk-lib/aws-codebuild";
import * as logs from "aws-cdk-lib/aws-logs";
export class DeliveryStack extends Stack {
  constructor(
    scope: Construct,
    id: string,
    props: StackProps & {
      stage: string;
      repository: string;
      githubEnabled?: boolean;
      githubSubject?: string;
      existingGithubProviderArn?: string;
      runner?: { connectionArn: string; trustedActorIds: string[] };
    },
  ) {
    super(scope, id, props);
    const boundary = new iam.ManagedPolicy(this, "AppBoundary", {
      managedPolicyName: `liftline-${props.stage}-app-boundary`,
      statements: [
        new iam.PolicyStatement({ actions: ["*"], resources: ["*"] }),
        new iam.PolicyStatement({
          effect: iam.Effect.DENY,
          actions: [
            "dynamodb:DeleteTable",
            "dynamodb:DeleteBackup",
            "dynamodb:UpdateContinuousBackups",
            "backup:*",
            "cognito-idp:DeleteUserPool",
            "organizations:*",
            "iam:CreateUser",
            "iam:CreateAccessKey",
          ],
          resources: ["*"],
        }),
      ],
    });
    const execution = new iam.Role(this, "Execution", {
      roleName: `liftline-${props.stage}-app-execution`,
      assumedBy: new iam.ServicePrincipal("cloudformation.amazonaws.com"),
      permissionsBoundary: boundary,
    });
    const appRole = `arn:aws:iam::${this.account}:role/LiftlineApp-${props.stage}-*`;
    execution.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          "cloudwatch:PutMetricAlarm",
          "cloudwatch:DeleteAlarms",
          "cloudwatch:DescribeAlarms",
          "cloudwatch:TagResource",
          "cloudwatch:UntagResource",
          "cloudwatch:ListTagsForResource",
        ],
        resources: [
          `arn:aws:cloudwatch:${this.region}:${this.account}:alarm:LiftlineApp-${props.stage}-*`,
        ],
      }),
    );
    execution.addToPolicy(
      new iam.PolicyStatement({
        actions: ["ssm:GetParameter", "ssm:GetParameters"],
        resources: [
          `arn:aws:ssm:${this.region}:${this.account}:parameter/cdk-bootstrap/hnb659fds/version`,
        ],
      }),
    );
    execution.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          "lambda:*",
          "apigateway:*",
          "cloudfront:*",
          "cognito-idp:*",
          "logs:*",
          "events:*",
          "sns:*",
        ],
        resources: ["*"],
      }),
    );
    execution.addToPolicy(
      new iam.PolicyStatement({
        actions: ["s3:*"],
        resources: [
          `arn:aws:s3:::liftlineapp-${props.stage}-*`,
          `arn:aws:s3:::liftlineapp-${props.stage}-*/*`,
          `arn:aws:s3:::cdk-hnb659fds-assets-${this.account}-${this.region}/*`,
        ],
      }),
    );
    execution.addToPolicy(
      new iam.PolicyStatement({
        actions: ["iam:CreateRole", "iam:PutRolePermissionsBoundary"],
        resources: [appRole],
        conditions: {
          StringEquals: {
            "iam:PermissionsBoundary": boundary.managedPolicyArn,
          },
        },
      }),
    );
    execution.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          "iam:GetRole",
          "iam:DeleteRole",
          "iam:PutRolePolicy",
          "iam:DeleteRolePolicy",
          "iam:GetRolePolicy",
          "iam:AttachRolePolicy",
          "iam:DetachRolePolicy",
          "iam:UpdateAssumeRolePolicy",
          "iam:TagRole",
          "iam:UntagRole",
          "iam:PassRole",
        ],
        resources: [appRole],
      }),
    );
    execution.addToPolicy(
      new iam.PolicyStatement({
        actions: ["iam:GetPolicy", "iam:GetPolicyVersion"],
        resources: ["*"],
      }),
    );
    new CfnOutput(this, "ExecutionRole", { value: execution.roleArn });
    if (props.githubEnabled === false) return;
    const provider = props.runner
      ? undefined
      : props.existingGithubProviderArn
        ? iam.OpenIdConnectProvider.fromOpenIdConnectProviderArn(
            this,
            "GitHub",
            props.existingGithubProviderArn,
          )
        : new iam.OpenIdConnectProvider(this, "GitHub", {
            url: "https://token.actions.githubusercontent.com",
            clientIds: ["sts.amazonaws.com"],
          });
    const role = new iam.Role(this, "Deployment", {
      roleName: `liftline-${props.stage}-github`,
      assumedBy: props.runner
        ? new iam.ServicePrincipal("codebuild.amazonaws.com", {
            conditions: {
              StringEquals: { "aws:SourceAccount": this.account },
              ArnEquals: {
                "aws:SourceArn": `arn:aws:codebuild:${this.region}:${this.account}:project/liftline-${props.stage}-release`,
              },
            },
          })
        : new iam.WebIdentityPrincipal(provider!.openIdConnectProviderArn, {
            StringEquals: {
              "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
              "token.actions.githubusercontent.com:sub":
                props.githubSubject ??
                `repo:${props.repository}:environment:${props.stage}`,
            },
          }),
      permissionsBoundary: boundary,
    });
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          "cloudformation:CreateChangeSet",
          "cloudformation:DescribeChangeSet",
          "cloudformation:ExecuteChangeSet",
          "cloudformation:DeleteChangeSet",
          "cloudformation:DescribeStacks",
          "cloudformation:DescribeStackEvents",
          "cloudformation:GetTemplate",
        ],
        resources: [
          `arn:aws:cloudformation:${this.region}:${this.account}:stack/LiftlineApp-${props.stage}/*`,
        ],
      }),
    );
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          "cloudformation:ListStacks",
          "cloudformation:ValidateTemplate",
          "cloudformation:GetTemplateSummary",
        ],
        resources: ["*"],
      }),
    );
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["iam:PassRole"],
        resources: [execution.roleArn],
        conditions: {
          StringEquals: {
            "iam:PassedToService": "cloudformation.amazonaws.com",
          },
        },
      }),
    );
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["sts:AssumeRole"],
        resources: [
          `arn:aws:iam::${this.account}:role/cdk-hnb659fds-file-publishing-role-${this.account}-${this.region}`,
          `arn:aws:iam::${this.account}:role/cdk-hnb659fds-lookup-role-${this.account}-${this.region}`,
        ],
      }),
    );
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["s3:GetObject", "s3:PutObject", "s3:ListBucket"],
        resources: [
          `arn:aws:s3:::liftlineapp-${props.stage}-*`,
          `arn:aws:s3:::liftlineapp-${props.stage}-*/*`,
          `arn:aws:s3:::cdk-hnb659fds-assets-${this.account}-${this.region}/*`,
        ],
      }),
    );
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["ssm:GetParameter", "ssm:GetParameters"],
        resources: [
          `arn:aws:ssm:${this.region}:${this.account}:parameter/cdk-bootstrap/hnb659fds/version`,
        ],
      }),
    );
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["lambda:GetAlias", "lambda:UpdateAlias"],
        resources: [
          `arn:aws:lambda:${this.region}:${this.account}:function:LiftlineApp-${props.stage}-*`,
        ],
      }),
    );
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          "cloudfront:CreateInvalidation",
          "cloudfront:GetInvalidation",
        ],
        resources: [`arn:aws:cloudfront::${this.account}:distribution/*`],
      }),
    );
    new CfnOutput(this, "DeploymentRole", { value: role.roleArn });
    if (props.runner) {
      const { connectionArn, trustedActorIds } = props.runner;
      if (
        !trustedActorIds.length ||
        trustedActorIds.some((id) => !/^\d+$/.test(id))
      )
        throw new Error("Explicit numeric trusted GitHub actor IDs required");
      if (
        !connectionArn.startsWith(
          `arn:aws:codeconnections:${this.region}:${this.account}:connection/`,
        )
      )
        throw new Error(
          "Runner connection must belong to this project and selected Region",
        );
      role.addToPolicy(
        new iam.PolicyStatement({
          actions: [
            "codeconnections:GetConnection",
            "codeconnections:GetConnectionToken",
          ],
          resources: [connectionArn],
        }),
      );
      const logGroup = new logs.LogGroup(this, "RunnerLogs", {
        retention: logs.RetentionDays.TWO_WEEKS,
      });
      logGroup.grantWrite(role);
      const runner = new codebuild.CfnProject(this, "Runner", {
        name: `liftline-${props.stage}-release`,
        serviceRole: role.roleArn,
        artifacts: { type: "NO_ARTIFACTS" },
        source: {
          type: "GITHUB",
          location: `https://github.com/${props.repository}`,
          auth: { type: "CODECONNECTIONS", resource: connectionArn },
        },
        environment: {
          type: "LINUX_CONTAINER",
          computeType: "BUILD_GENERAL1_SMALL",
          image: "aws/codebuild/standard:7.0",
          privilegedMode: false,
        },
        concurrentBuildLimit: 1,
        timeoutInMinutes: 45,
        queuedTimeoutInMinutes: 30,
        visibility: "PRIVATE",
        logsConfig: {
          cloudWatchLogs: {
            status: "ENABLED",
            groupName: logGroup.logGroupName,
          },
        },
        // HEAD_REF is not supported for workflow_job events. Trust is enforced by actor,
        // not by the workflow's own branch condition, which PR authors can change.
        triggers: {
          webhook: true,
          filterGroups: [
            [
              { type: "EVENT", pattern: "WORKFLOW_JOB_QUEUED" },
              { type: "WORKFLOW_NAME", pattern: "^Exact artifact release$" },
              {
                type: "ACTOR_ACCOUNT_ID",
                pattern: `^(${trustedActorIds.join("|")})$`,
              },
            ],
          ],
        },
      });
      // Webhook registration needs the service-role policy to exist first.
      runner.node.addDependency(role);
      new CfnOutput(this, "RunnerProject", { value: runner.ref });
    }
  }
}
