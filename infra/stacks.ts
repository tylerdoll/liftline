import {
  Stack,
  Duration,
  RemovalPolicy,
  CfnOutput,
  type StackProps,
} from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ddb from "aws-cdk-lib/aws-dynamodb";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as iam from "aws-cdk-lib/aws-iam";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as apigw from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { HttpJwtAuthorizer } from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import * as deploy from "aws-cdk-lib/aws-s3-deployment";
import * as backup from "aws-cdk-lib/aws-backup";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subscriptions from "aws-cdk-lib/aws-sns-subscriptions";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as actions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as budgets from "aws-cdk-lib/aws-budgets";
type EnvironmentProps = StackProps & {
  stage: "alpha" | "preprod" | "prod";
  email: string;
};
function bucket(scope: Construct, id: string, name?: string) {
  return new s3.Bucket(scope, id, {
    bucketName: name,
    blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    encryption: s3.BucketEncryption.S3_MANAGED,
    versioned: true,
    enforceSSL: true,
    removalPolicy: RemovalPolicy.RETAIN,
  });
}
function alertTopic(scope: Construct, email: string) {
  const topic = new sns.Topic(scope, "Alerts");
  topic.addSubscription(new subscriptions.EmailSubscription(email));
  return topic;
}
export class RecoveryStack extends Stack {
  constructor(
    scope: Construct,
    id: string,
    props: StackProps & { sourceAccount: string },
  ) {
    super(scope, id, props);
    const vault = bucket(this, "Recovery", `liftline-recovery-${this.account}`);
    vault.addLifecycleRule({
      prefix: "weekly/",
      expiration: Duration.days(56),
      noncurrentVersionExpiration: Duration.days(56),
    });
    vault.addToResourcePolicy(
      new iam.PolicyStatement({
        principals: [
          new iam.ArnPrincipal(
            `arn:aws:iam::${props.sourceAccount}:role/liftline-prod-backup`,
          ),
        ],
        actions: ["s3:PutObject", "s3:AbortMultipartUpload", "s3:PutObjectAcl"],
        resources: [vault.arnForObjects("weekly/*")],
      }),
    );
    vault.addToResourcePolicy(
      new iam.PolicyStatement({
        principals: [
          new iam.ArnPrincipal(
            `arn:aws:iam::${props.sourceAccount}:role/liftline-prod-archive-replication`,
          ),
        ],
        actions: [
          "s3:ReplicateObject",
          "s3:ReplicateTags",
          "s3:ObjectOwnerOverrideToBucketOwner",
        ],
        resources: [vault.arnForObjects("private/*")],
      }),
    );
    vault.addLifecycleRule({
      prefix: "private/",
      noncurrentVersionExpiration: Duration.days(56),
    });
    new CfnOutput(this, "RecoveryBucket", { value: vault.bucketName });
  }
}
export class DataStack extends Stack {
  readonly table: ddb.Table;
  readonly archive: s3.Bucket;
  constructor(
    scope: Construct,
    id: string,
    props: EnvironmentProps & { recoveryAccount: string },
  ) {
    super(scope, id, props);
    this.table = new ddb.Table(this, "Records", {
      tableName: `liftline-${props.stage}`,
      partitionKey: { name: "PK", type: ddb.AttributeType.STRING },
      sortKey: { name: "SK", type: ddb.AttributeType.STRING },
      billingMode: ddb.BillingMode.PAY_PER_REQUEST,
      tableClass: ddb.TableClass.STANDARD,
      encryption: ddb.TableEncryption.AWS_MANAGED,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
        recoveryPeriodInDays: 35,
      },
      deletionProtection: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    this.table.addGlobalSecondaryIndex({
      indexName: "Expiry",
      partitionKey: { name: "expiryPK", type: ddb.AttributeType.STRING },
      sortKey: { name: "expirySK", type: ddb.AttributeType.NUMBER },
      projectionType: ddb.ProjectionType.KEYS_ONLY,
    });
    this.archive = bucket(this, "PrivateArchive");
    if (props.stage !== "prod") {
      this.archive.addLifecycleRule({
        prefix: "weekly/",
        expiration: Duration.days(56),
        noncurrentVersionExpiration: Duration.days(56),
      });
    }
    if (props.stage === "prod") {
      const replication = new iam.Role(this, "ArchiveReplication", {
        roleName: "liftline-prod-archive-replication",
        assumedBy: new iam.ServicePrincipal("s3.amazonaws.com"),
      });
      replication.addToPolicy(
        new iam.PolicyStatement({
          actions: ["s3:GetReplicationConfiguration", "s3:ListBucket"],
          resources: [this.archive.bucketArn],
        }),
      );
      replication.addToPolicy(
        new iam.PolicyStatement({
          actions: [
            "s3:GetObjectVersionForReplication",
            "s3:GetObjectVersionAcl",
            "s3:GetObjectVersionTagging",
          ],
          resources: [this.archive.arnForObjects("private/*")],
        }),
      );
      replication.addToPolicy(
        new iam.PolicyStatement({
          actions: [
            "s3:ReplicateObject",
            "s3:ReplicateTags",
            "s3:ObjectOwnerOverrideToBucketOwner",
          ],
          resources: [
            `arn:aws:s3:::liftline-recovery-${props.recoveryAccount}/private/*`,
          ],
        }),
      );
      (
        this.archive.node.defaultChild as s3.CfnBucket
      ).replicationConfiguration = {
        role: replication.roleArn,
        rules: [
          {
            id: "private-archive",
            priority: 1,
            status: "Enabled",
            filter: { prefix: "private/" },
            deleteMarkerReplication: { status: "Disabled" },
            destination: {
              bucket: `arn:aws:s3:::liftline-recovery-${props.recoveryAccount}`,
              account: props.recoveryAccount,
              accessControlTranslation: { owner: "Destination" },
            },
          },
        ],
      };
    }
    const topic = alertTopic(this, props.email);
    const vault = new backup.BackupVault(this, "DailyVault", {
      removalPolicy: RemovalPolicy.RETAIN,
    });
    const plan = new backup.BackupPlan(this, "Daily", { backupVault: vault });
    plan.addRule(
      new backup.BackupPlanRule({
        ruleName: "daily-keep-seven",
        scheduleExpression: events.Schedule.cron({ hour: "9", minute: "0" }),
        deleteAfter: Duration.days(7),
      }),
    );
    plan.addSelection("Table", {
      resources: [backup.BackupResource.fromDynamoDbTable(this.table)],
    });
    const role = new iam.Role(this, "BackupRole", {
      roleName: `liftline-${props.stage}-backup`,
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
    });
    role.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName(
        "service-role/AWSLambdaBasicExecutionRole",
      ),
    );
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          "dynamodb:ExportTableToPointInTime",
          "dynamodb:DescribeContinuousBackups",
        ],
        resources: [this.table.tableArn],
      }),
    );
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["dynamodb:DescribeExport"],
        resources: [`${this.table.tableArn}/export/*`],
      }),
    );
    this.table.grant(role, "dynamodb:GetItem", "dynamodb:PutItem");
    const destination =
      props.stage === "prod"
        ? `liftline-recovery-${props.recoveryAccount}`
        : this.archive.bucketName;
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["s3:PutObject", "s3:PutObjectAcl", "s3:AbortMultipartUpload"],
        resources: [`arn:aws:s3:::${destination}/weekly/*`],
      }),
    );
    const fn = new lambda.Function(this, "WeeklyExport", {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: "backup.handler",
      code: lambda.Code.fromAsset("dist/api"),
      role,
      timeout: Duration.minutes(2),
      memorySize: 256,
      environment: {
        TABLE_ARN: this.table.tableArn,
        TABLE_NAME: this.table.tableName,
        RECOVERY_BUCKET: destination,
        RECOVERY_ACCOUNT:
          props.stage === "prod" ? props.recoveryAccount : this.account,
      },
      logGroup: new logs.LogGroup(this, "BackupLogs", {
        retention:
          props.stage === "prod"
            ? logs.RetentionDays.ONE_MONTH
            : logs.RetentionDays.ONE_WEEK,
      }),
    });
    new events.Rule(this, "Weekly", {
      schedule: events.Schedule.cron({
        weekDay: "SUN",
        hour: "10",
        minute: "0",
      }),
      targets: [new targets.LambdaFunction(fn, { retryAttempts: 2 })],
    });
    new events.Rule(this, "ExportMonitor", {
      schedule: events.Schedule.rate(Duration.hours(1)),
      targets: [
        new targets.LambdaFunction(fn, {
          event: events.RuleTargetInput.fromObject({ monitor: true }),
        }),
      ],
    });
    new events.Rule(this, "BackupFailure", {
      eventPattern: {
        source: ["aws.backup", "aws.dynamodb"],
        detailType: ["Backup Job State Change", "DynamoDB Export Status"],
        detail: { state: ["FAILED", "ABORTED", "EXPIRED"] },
      },
      targets: [new targets.SnsTopic(topic)],
    });
    const alarm = fn.metricErrors().createAlarm(this, "ExportFailure", {
      threshold: 1,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    alarm.addAlarmAction(new actions.SnsAction(topic));
    for (const dollars of [5, 10])
      new budgets.CfnBudget(this, `Budget${dollars}`, {
        budget: {
          budgetType: "COST",
          timeUnit: "MONTHLY",
          budgetLimit: { amount: dollars, unit: "USD" },
        },
        notificationsWithSubscribers: [
          {
            notification: {
              comparisonOperator: "GREATER_THAN",
              notificationType: "ACTUAL",
              threshold: 100,
              thresholdType: "PERCENTAGE",
            },
            subscribers: [{ subscriptionType: "EMAIL", address: props.email }],
          },
        ],
      });
  }
}
export class AppStack extends Stack {
  constructor(
    scope: Construct,
    id: string,
    props: EnvironmentProps & { table: ddb.ITable; archive: s3.IBucket },
  ) {
    super(scope, id, props);
    const topic = alertTopic(this, props.email),
      assets = bucket(this, "Assets");
    iam.PermissionsBoundary.of(this).apply(
      iam.ManagedPolicy.fromManagedPolicyArn(
        this,
        "Boundary",
        `arn:aws:iam::${this.account}:policy/liftline-${props.stage}-app-boundary`,
      ),
    );
    const apiFn = new lambda.Function(this, "Api", {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: "request.handler",
      code: lambda.Code.fromAsset("dist/api"),
      timeout: Duration.seconds(30),
      memorySize: 256,
      environment: {
        TABLE_NAME: props.table.tableName,
        ARCHIVE_BUCKET: props.archive.bucketName,
      },
      logGroup: new logs.LogGroup(this, "ApiLogs", {
        retention:
          props.stage === "prod"
            ? logs.RetentionDays.ONE_MONTH
            : logs.RetentionDays.ONE_WEEK,
      }),
    });
    props.table.grant(
      apiFn,
      "dynamodb:GetItem",
      "dynamodb:Query",
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
      "dynamodb:ConditionCheckItem",
    );
    props.archive.grantRead(apiFn, "private/*");
    apiFn.currentVersion.applyRemovalPolicy(RemovalPolicy.RETAIN);
    const apiAlias = new lambda.Alias(this, "ApiLive", {
      aliasName: "live",
      version: apiFn.currentVersion,
    });
    const api = new apigw.HttpApi(this, "Http", { createDefaultStage: true });
    api
      .metricServerError()
      .createAlarm(this, "Http5xx", {
        threshold: 1,
        evaluationPeriods: 1,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      })
      .addAlarmAction(new actions.SnsAction(topic));
    const policy = new cloudfront.ResponseHeadersPolicy(
      this,
      "SecurityHeaders",
      {
        securityHeadersBehavior: {
          contentTypeOptions: { override: true },
          frameOptions: {
            frameOption: cloudfront.HeadersFrameOption.DENY,
            override: true,
          },
          referrerPolicy: {
            referrerPolicy: cloudfront.HeadersReferrerPolicy.NO_REFERRER,
            override: true,
          },
          strictTransportSecurity: {
            accessControlMaxAge: Duration.days(365),
            includeSubdomains: true,
            override: true,
          },
        },
        customHeadersBehavior: {
          customHeaders: [
            { header: "Cache-Control", value: "no-store", override: true },
          ],
        },
      },
    );
    const distribution = new cloudfront.Distribution(this, "Web", {
      defaultRootObject: "index.html",
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(assets),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        responseHeadersPolicy: policy,
      },
      additionalBehaviors: {
        "api/*": {
          origin: new origins.HttpOrigin(
            `${api.apiId}.execute-api.${this.region}.amazonaws.com`,
          ),
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy:
            cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          responseHeadersPolicy: policy,
        },
        "runtime-config.json": {
          origin: origins.S3BucketOrigin.withOriginAccessControl(assets),
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
        },
      },
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
    });
    const url = `https://${distribution.distributionDomainName}/`;
    const pool = new cognito.UserPool(this, "Users", {
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      autoVerify: { email: true },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      featurePlan: cognito.FeaturePlan.ESSENTIALS,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    const domain = pool.addDomain("ManagedLogin", {
      cognitoDomain: {
        domainPrefix: `liftline-${props.stage}-${this.account}`,
      },
      managedLoginVersion: cognito.ManagedLoginVersion.NEWER_MANAGED_LOGIN,
    });
    const client = pool.addClient("WebClient", {
      generateSecret: false,
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.PROFILE,
        ],
        callbackUrls: [url],
        logoutUrls: [url],
      },
      preventUserExistenceErrors: true,
      accessTokenValidity: Duration.hours(1),
    });
    new cognito.CfnManagedLoginBranding(this, "Branding", {
      userPoolId: pool.userPoolId,
      clientId: client.userPoolClientId,
      useCognitoProvidedValues: true,
    });
    const authorizer = new HttpJwtAuthorizer(
      "Cognito",
      pool.userPoolProviderUrl,
      { jwtAudience: [client.userPoolClientId] },
    );
    api.addRoutes({
      path: "/api/v1/{proxy+}",
      methods: [apigw.HttpMethod.ANY],
      integration: new HttpLambdaIntegration("ApiIntegration", apiAlias),
      authorizer,
      authorizationScopes: ["openid"],
    });
    new deploy.BucketDeployment(this, "RuntimeConfig", {
      destinationBucket: assets,
      prune: false,
      sources: [
        deploy.Source.jsonData("runtime-config.json", {
          clientId: client.userPoolClientId,
          cognitoDomain: domain.baseUrl(),
          issuer: pool.userPoolProviderUrl,
          redirectUri: url,
          scope: "openid email profile",
        }),
      ],
      cacheControl: [deploy.CacheControl.noStore()],
    });
    const expiry = new lambda.Function(this, "Expiry", {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: "expiry.handler",
      code: lambda.Code.fromAsset("dist/api"),
      timeout: Duration.minutes(5),
      memorySize: 256,
      environment: { TABLE_NAME: props.table.tableName },
      logGroup: new logs.LogGroup(this, "ExpiryLogs", {
        retention:
          props.stage === "prod"
            ? logs.RetentionDays.ONE_MONTH
            : logs.RetentionDays.ONE_WEEK,
      }),
    });
    props.table.grant(
      expiry,
      "dynamodb:GetItem",
      "dynamodb:Query",
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
      "dynamodb:ConditionCheckItem",
    );
    expiry.currentVersion.applyRemovalPolicy(RemovalPolicy.RETAIN);
    const expiryAlias = new lambda.Alias(this, "ExpiryLive", {
      aliasName: "live",
      version: expiry.currentVersion,
    });
    new events.Rule(this, "ExpirySchedule", {
      schedule: events.Schedule.rate(Duration.minutes(5)),
      targets: [new targets.LambdaFunction(expiryAlias, { retryAttempts: 2 })],
    });
    for (const [name, fn] of [
      ["Api", apiFn],
      ["Expiry", expiry],
    ] as const) {
      const alarm = fn.metricErrors().createAlarm(this, `${name}Errors`, {
        threshold: 1,
        evaluationPeriods: 1,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
      alarm.addAlarmAction(new actions.SnsAction(topic));
    }
    new CfnOutput(this, "Url", { value: url });
    new CfnOutput(this, "AssetsBucket", { value: assets.bucketName });
    new CfnOutput(this, "Distribution", { value: distribution.distributionId });
    new CfnOutput(this, "UserPool", { value: pool.userPoolId });
    new CfnOutput(this, "ClientId", { value: client.userPoolClientId });
    new CfnOutput(this, "ApiFunction", { value: apiFn.functionName });
    new CfnOutput(this, "ExpiryFunction", { value: expiry.functionName });
  }
}
