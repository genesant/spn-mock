import * as cdk from "aws-cdk-lib";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as elbv2_actions from "aws-cdk-lib/aws-elasticloadbalancingv2-actions";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as ssm from "aws-cdk-lib/aws-ssm";
import { Construct } from "constructs";
import {
  APP,
  AVAILABILITY_ZONES,
  PIPELINE,
  clusterName,
  deploymentRoleName,
  host,
  serviceName,
  waveApiWebhookUrl,
  waveParams,
} from "./config";
import type { Stage, StageConfig } from "./config";

interface ServiceStackProps extends cdk.StackProps {
  stage: Stage;
  cfg: StageConfig;
  /** Start with desiredCount 0 (no image in ECR yet). */
  bootstrap: boolean;
}

/**
 * spn-mock in one stage: an ECS service in the wave cluster behind the shared ALB.
 *   /v1/*          API for the wave api (Bearer API key issued by the mock's seed)
 *   /checkout/:id  payment page loaded in an iframe by end users           — public
 *   /admin*        backoffice (payments table, settle ACH)                  — staff only: ALB authenticates
 *                                                                              against wave's workforce Cognito pool
 * State is SQLite on the EC2 host (bind mount). Credentials are generated once in Secrets Manager and re-applied
 * by the mock's idempotent seed on every start, so a lost file never changes the API key wave uses.
 */
export class ServiceStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, props);
    const { stage, cfg } = props;
    const params = waveParams(stage);
    const param = (name: string) => ssm.StringParameter.valueForStringParameter(this, name);
    const publicHost = host(cfg);
    const removalPolicy = cfg.retainData ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY;

    // -- wave-media resources, imported by id ----------------------------------------------------------------
    const vpc = ec2.Vpc.fromVpcAttributes(this, "WaveVpc", {
      vpcId: param(params.vpcId),
      availabilityZones: AVAILABILITY_ZONES,
    });
    const cluster = ecs.Cluster.fromClusterAttributes(this, "WaveCluster", { clusterName: clusterName(stage), vpc });
    const listener = elbv2.ApplicationListener.fromApplicationListenerAttributes(this, "WaveHttpsListener", {
      listenerArn: param(params.httpsListenerArn),
      securityGroup: ec2.SecurityGroup.fromSecurityGroupId(this, "WaveAlbSg", param(params.albSecurityGroupId)),
    });
    // The ALB security group only informs CDK's connection model (wave's ECS SG already admits the ALB), so it
    // ends up as an unreferenced template parameter: `cdk synth` prints a harmless W2001 warning for it.
    const workforcePool = cognito.UserPool.fromUserPoolArn(this, "WorkforcePool", param(params.workforcePoolArn));
    const albAuthClient = cognito.UserPoolClient.fromUserPoolClientId(this, "AlbAuthClient", param(params.albAuthClientId));
    const albAuthDomain = cognito.UserPoolDomain.fromDomainName(this, "AlbAuthDomain", param(params.albAuthDomain));
    const repository = ecr.Repository.fromRepositoryAttributes(this, "Repository", {
      repositoryName: APP.repositoryName,
      repositoryArn: `arn:aws:ecr:${PIPELINE.region}:${PIPELINE.account}:repository/${APP.repositoryName}`,
    });

    // -- Credentials (copy into wave/<stage>/app as SPN_API_KEY / SPN_WEBHOOK_SECRET) ------------------------
    const apiKey = new secretsmanager.Secret(this, "ApiKey", {
      secretName: `spn-mock/${stage}/api-key`,
      description: "API key the wave api uses against spn-mock (SPN_API_KEY); seeded into the mock on start",
      generateSecretString: { passwordLength: 40, excludePunctuation: true },
      removalPolicy,
    });
    const webhookSecret = new secretsmanager.Secret(this, "WebhookSecret", {
      secretName: `spn-mock/${stage}/webhook-secret`,
      description: "HMAC secret for spn-mock -> wave webhooks (SPN_WEBHOOK_SECRET)",
      generateSecretString: { passwordLength: 48, excludePunctuation: true },
      removalPolicy,
    });

    // -- Task definition --------------------------------------------------------------------------------------
    const logGroup = new logs.LogGroup(this, "Logs", {
      logGroupName: `/spn-mock/${stage}`,
      retention: cfg.retainData ? logs.RetentionDays.THREE_MONTHS : logs.RetentionDays.ONE_MONTH,
      removalPolicy,
    });
    const taskDefinition = new ecs.Ec2TaskDefinition(this, "TaskDefinition", {
      family: serviceName(stage),
      networkMode: ecs.NetworkMode.BRIDGE,
      volumes: [{ name: "data", host: { sourcePath: `${APP.hostDataPath}-${stage}` } }],
    });
    const container = taskDefinition.addContainer("spn-mock", {
      // The pipeline pins the commit tag on every deploy; `latest` is only the initial value.
      image: ecs.ContainerImage.fromEcrRepository(repository, "latest"),
      memoryReservationMiB: APP.memoryReservationMiB,
      memoryLimitMiB: APP.memoryLimitMiB,
      environment: {
        NODE_ENV: "production",
        SPN_PORT: String(APP.port),
        SPN_BASE_URL: `https://${publicHost}`,
        SPN_DB_PATH: "/data/spn.db",
        SPN_WEBHOOK_URL: waveApiWebhookUrl(cfg),
      },
      secrets: {
        SPN_SEED_API_KEY: ecs.Secret.fromSecretsManager(apiKey),
        SPN_SEED_WEBHOOK_SECRET: ecs.Secret.fromSecretsManager(webhookSecret),
      },
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: "spn-mock", logGroup }),
    });
    container.addPortMappings({ containerPort: APP.port, hostPort: 0, protocol: ecs.Protocol.TCP });
    container.addMountPoints({ sourceVolume: "data", containerPath: "/data", readOnly: false });

    // -- Service ----------------------------------------------------------------------------------------------
    const service = new ecs.Ec2Service(this, "Service", {
      cluster,
      serviceName: serviceName(stage),
      taskDefinition,
      desiredCount: props.bootstrap ? 0 : 1,
      capacityProviderStrategies: [{ capacityProvider: param(params.capacityProvider), weight: 1 }],
      // SQLite has a single writer: never run two copies against the same file. Stop the old task first.
      minHealthyPercent: 0,
      maxHealthyPercent: 100,
      circuitBreaker: { rollback: true },
      enableExecuteCommand: !cfg.retainData,
      healthCheckGracePeriod: cdk.Duration.seconds(60),
    });

    // -- ALB: host rules on wave's HTTPS listener --------------------------------------------------------------
    const targetGroup = new elbv2.ApplicationTargetGroup(this, "TargetGroup", {
      targetGroupName: `spn-mock-${stage}`,
      vpc,
      port: APP.port,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.INSTANCE,
      targets: [service],
      deregistrationDelay: cdk.Duration.seconds(10),
      healthCheck: { path: "/health", interval: cdk.Duration.seconds(30), healthyThresholdCount: 2 },
    });
    // Backoffice: the ALB authenticates staff against the workforce pool before forwarding.
    new elbv2.ApplicationListenerRule(this, "AdminRule", {
      listener,
      priority: 7,
      conditions: [
        elbv2.ListenerCondition.hostHeaders([publicHost]),
        elbv2.ListenerCondition.pathPatterns(["/admin", "/admin/*"]),
      ],
      action: new elbv2_actions.AuthenticateCognitoAction({
        userPool: workforcePool,
        userPoolClient: albAuthClient,
        userPoolDomain: albAuthDomain,
        sessionTimeout: cdk.Duration.hours(8),
        next: elbv2.ListenerAction.forward([targetGroup]),
      }),
    });
    // Everything else on the host: /v1/* (API key) and /checkout/* (end users), like a real provider.
    new elbv2.ApplicationListenerRule(this, "PublicRule", {
      listener,
      priority: 8,
      conditions: [elbv2.ListenerCondition.hostHeaders([publicHost])],
      action: elbv2.ListenerAction.forward([targetGroup]),
    });

    // -- Deployment role for the pipeline (tools account) --------------------------------------------------------
    const deploymentRole = new iam.Role(this, "DeploymentRole", {
      roleName: deploymentRoleName(stage),
      assumedBy: new iam.AccountPrincipal(PIPELINE.account),
      description: `Assumed by the spn-mock pipeline to deploy ${stage}`,
      maxSessionDuration: cdk.Duration.hours(2),
    });
    deploymentRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["ecs:DescribeServices", "ecs:DescribeTaskDefinition", "ecs:RegisterTaskDefinition"],
        resources: ["*"],
      }),
    );
    deploymentRole.addToPolicy(new iam.PolicyStatement({ actions: ["ecs:UpdateService"], resources: [service.serviceArn] }));
    deploymentRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["iam:PassRole"],
        resources: [taskDefinition.taskRole.roleArn, taskDefinition.obtainExecutionRole().roleArn],
      }),
    );

    new cdk.CfnOutput(this, "Url", { value: `https://${publicHost}` });
    new cdk.CfnOutput(this, "AdminUrl", { value: `https://${publicHost}/admin` });
    new cdk.CfnOutput(this, "DeploymentRoleArn", { value: deploymentRole.roleArn });
    new cdk.CfnOutput(this, "WaveSecretHint", {
      description: "Copy into wave/<stage>/app: SPN_API_KEY, SPN_WEBHOOK_SECRET (values of these secrets) and SPN_BASE_URL",
      value: `${apiKey.secretName}, ${webhookSecret.secretName}, SPN_BASE_URL=https://${publicHost}`,
    });
  }
}
