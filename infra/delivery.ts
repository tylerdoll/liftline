import { Stack, type StackProps, CfnOutput } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as iam from "aws-cdk-lib/aws-iam";
export class DeliveryStack extends Stack {
  constructor(
    scope: Construct,
    id: string,
    props: StackProps & {
      stage: string;
      repository: string;
      githubEnabled?: boolean;
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
    const provider = new iam.OpenIdConnectProvider(this, "GitHub", {
      url: "https://token.actions.githubusercontent.com",
      clientIds: ["sts.amazonaws.com"],
    });
    const role = new iam.Role(this, "Deployment", {
      roleName: `liftline-${props.stage}-github`,
      assumedBy: new iam.WebIdentityPrincipal(
        provider.openIdConnectProviderArn,
        {
          StringEquals: {
            "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
            "token.actions.githubusercontent.com:sub": `repo:${props.repository}:environment:${props.stage}`,
          },
        },
      ),
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
        actions: ["ssm:GetParameter"],
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
        actions: ["cloudfront:CreateInvalidation"],
        resources: [`arn:aws:cloudfront::${this.account}:distribution/*`],
      }),
    );
    new CfnOutput(this, "DeploymentRole", { value: role.roleArn });
  }
}
