/**
 * Where spn-mock runs. It is hosted next to wave-media: one more ECS service in the wave cluster of each stage,
 * behind the shared ALB, on `spn-mock.<domain>`. Everything wave-specific this app needs (VPC, listener, cluster
 * capacity provider, Cognito ALB-auth client) is read from SSM parameters published by the wave-media infra.
 */
export type Stage = "dev" | "qa" | "prod";

export interface StageConfig {
  account: string;
  region: string;
  /** wave-media domain of the stage; the mock lives on `spn-mock.<domain>` and calls back `api.<domain>`. */
  waveDomain: string;
  /** Keep logs and secrets on stack deletion. */
  retainData: boolean;
}

export const STAGES: Record<Stage, StageConfig> = {
  dev: { account: "728093470638", region: "us-east-1", waveDomain: "media.wavedev.co", retainData: false },
  qa: { account: "396907899926", region: "us-east-1", waveDomain: "media-qa.wavedev.co", retainData: false },
  prod: { account: "517121893780", region: "us-east-1", waveDomain: "media-prod.wavedev.co", retainData: true },
};

/** Availability zones the wave VPCs use (needed to import a VPC without a context lookup). */
export const AVAILABILITY_ZONES = ["us-east-1a", "us-east-1b"];

export const PIPELINE = {
  account: "100025280990",
  region: "us-east-1",
  github: { owner: "genesant", repo: "spn-mock", branch: "main" },
  /** Shared CodeConnections connection to the Genesant GitHub org (tools account). */
  connectionArn: "arn:aws:codeconnections:us-east-1:100025280990:connection/c9f5d4e0-0576-48f3-b179-41bc9a07eed2",
  /**
   * Stages the mock is deployed to. Dev only: it exists to exercise the wave payment flow while the real
   * Sport Pass billing API does not exist yet; it never goes to production. Add "qa" here (and to
   * `manualApprovalBefore`) if QA needs the payment step on their environment.
   */
  stages: ["dev"] as Stage[],
  manualApprovalBefore: [] as Stage[],
  alertEmails: ["masha.kastenka@celadonsoft.com"],
};

export const APP = {
  port: 4100,
  repositoryName: "spn-mock",
  /** Bind-mounted host directory for the SQLite file: survives redeploys, not instance replacement. */
  hostDataPath: "/data/spn-mock",
  memoryReservationMiB: 256,
  memoryLimitMiB: 512,
};

export const host = (cfg: StageConfig) => `spn-mock.${cfg.waveDomain}`;
export const waveApiWebhookUrl = (cfg: StageConfig) => `https://api.${cfg.waveDomain}/webhooks/spn`;
export const serviceName = (stage: Stage) => `spn-mock-${stage}`;
export const clusterName = (stage: Stage) => `wave-${stage}`;
export const deploymentRoleName = (stage: Stage) => `spn-mock-deploy-${stage}`;
export const deploymentRoleArn = (stage: Stage) =>
  `arn:aws:iam::${STAGES[stage].account}:role/${deploymentRoleName(stage)}`;

/** SSM parameters published by wave-media's infra (packages/infra) in the stage account. */
export const waveParams = (stage: Stage) => ({
  vpcId: `/wave/${stage}/vpc-id`,
  httpsListenerArn: `/wave/${stage}/alb/https-listener-arn`,
  albSecurityGroupId: `/wave/${stage}/alb/security-group-id`,
  capacityProvider: `/wave/${stage}/ecs/capacity-provider`,
  workforcePoolArn: `/wave/${stage}/cognito/workforce-pool-arn`,
  albAuthClientId: `/wave/${stage}/cognito/alb-auth-client-id`,
  albAuthDomain: `/wave/${stage}/cognito/alb-auth-domain`,
});
