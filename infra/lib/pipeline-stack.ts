import * as cdk from "aws-cdk-lib";
import * as codebuild from "aws-cdk-lib/aws-codebuild";
import * as codepipeline from "aws-cdk-lib/aws-codepipeline";
import * as codepipeline_actions from "aws-cdk-lib/aws-codepipeline-actions";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subs from "aws-cdk-lib/aws-sns-subscriptions";
import { Construct } from "constructs";
import { APP, PIPELINE, STAGES, clusterName, deploymentRoleArn, serviceName } from "./config";

/**
 * Tools-account pipeline: GitHub → build the image → ECR → per stage [approval] → register a task definition
 * revision with the new image → update the ECS service. Infrastructure changes are deployed with `cdk deploy`,
 * the pipeline only moves application images (same split as wave-media).
 */
export class PipelineStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: cdk.StackProps) {
    super(scope, id, props);

    const repository = new ecr.Repository(this, "Repository", {
      repositoryName: APP.repositoryName,
      imageScanOnPush: true,
      lifecycleRules: [{ description: "keep last 20 images", maxImageCount: 20 }],
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    repository.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: "AllowWorkloadAccountsToPull",
        principals: [...new Set(PIPELINE.stages.map((s) => STAGES[s].account))].map((a) => new iam.AccountPrincipal(a)),
        actions: ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer", "ecr:BatchCheckLayerAvailability"],
      }),
    );

    const artifactBucket = new s3.Bucket(this, "Artifacts", {
      bucketName: `spn-mock-pipeline-artifacts-${this.account}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      lifecycleRules: [{ expiration: cdk.Duration.days(30) }],
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const pipeline = new codepipeline.Pipeline(this, "Pipeline", {
      pipelineName: "spn-mock",
      pipelineType: codepipeline.PipelineType.V2,
      artifactBucket,
      restartExecutionOnUpdate: false,
    });

    const sourceOutput = new codepipeline.Artifact("Source");
    pipeline.addStage({
      stageName: "Source",
      actions: [
        new codepipeline_actions.CodeStarConnectionsSourceAction({
          actionName: "GitHub",
          owner: PIPELINE.github.owner,
          repo: PIPELINE.github.repo,
          branch: PIPELINE.github.branch,
          connectionArn: PIPELINE.connectionArn,
          output: sourceOutput,
          triggerOnPush: true,
        }),
      ],
    });

    // -- Build: one image, tagged with the commit and `latest` ------------------------------------------------
    const buildProject = new codebuild.PipelineProject(this, "Build", {
      projectName: "spn-mock-build",
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
        computeType: codebuild.ComputeType.SMALL,
        privileged: true,
      },
      environmentVariables: { REPO: { value: repository.repositoryUri } },
      cache: codebuild.Cache.local(codebuild.LocalCacheMode.DOCKER_LAYER),
      buildSpec: codebuild.BuildSpec.fromObject({
        version: "0.2",
        phases: {
          build: {
            commands: [
              'SHA=$(echo "$CODEBUILD_RESOLVED_SOURCE_VERSION" | cut -c1-12)',
              'aws ecr get-login-password | docker login --username AWS --password-stdin "${REPO%%/*}"',
              'docker build -t "$REPO:$SHA" -t "$REPO:latest" .',
              'docker push "$REPO:$SHA" && docker push "$REPO:latest"',
              'printf \'{"image":"%s"}\' "$REPO:$SHA" > image.json && cat image.json',
            ],
          },
        },
        artifacts: { files: ["image.json"] },
      }),
      timeout: cdk.Duration.minutes(20),
    });
    repository.grantPullPush(buildProject);
    buildProject.addToRolePolicy(new iam.PolicyStatement({ actions: ["ecr:GetAuthorizationToken"], resources: ["*"] }));

    const buildOutput = new codepipeline.Artifact("Image");
    pipeline.addStage({
      stageName: "Build",
      actions: [
        new codepipeline_actions.CodeBuildAction({ actionName: "BuildImage", project: buildProject, input: sourceOutput, outputs: [buildOutput] }),
      ],
    });

    // -- Deploy per stage: assume the stage role, pin the image, update the service -----------------------------
    for (const stage of PIPELINE.stages) {
      const stageCfg = STAGES[stage];
      if (PIPELINE.manualApprovalBefore.includes(stage)) {
        pipeline.addStage({
          stageName: `Approve-${stage}`,
          actions: [
            new codepipeline_actions.ManualApprovalAction({ actionName: `Approve-${stage}`, additionalInformation: `Deploy spn-mock to ${stage}` }),
          ],
        });
      }

      const deployProject = new codebuild.PipelineProject(this, `Deploy-${stage}`, {
        projectName: `spn-mock-deploy-${stage}`,
        environment: { buildImage: codebuild.LinuxBuildImage.STANDARD_7_0, computeType: codebuild.ComputeType.SMALL },
        environmentVariables: {
          TARGET_REGION: { value: stageCfg.region },
          CLUSTER: { value: clusterName(stage) },
          SERVICE: { value: serviceName(stage) },
          DEPLOYMENT_ROLE_ARN: { value: deploymentRoleArn(stage) },
        },
        buildSpec: codebuild.BuildSpec.fromObject({
          version: "0.2",
          phases: {
            build: {
              commands: [
                "set -euo pipefail",
                'creds=$(aws sts assume-role --role-arn "$DEPLOYMENT_ROLE_ARN" --role-session-name "spn-mock-pipeline-$(date +%s)")',
                'export AWS_ACCESS_KEY_ID=$(echo "$creds" | jq -r .Credentials.AccessKeyId) AWS_SECRET_ACCESS_KEY=$(echo "$creds" | jq -r .Credentials.SecretAccessKey) AWS_SESSION_TOKEN=$(echo "$creds" | jq -r .Credentials.SessionToken) AWS_DEFAULT_REGION=$TARGET_REGION',
                "image=$(jq -r .image image.json)",
                'current=$(aws ecs describe-services --cluster "$CLUSTER" --services "$SERVICE" --query "services[0].taskDefinition" --output text)',
                'running=$(aws ecs describe-task-definition --task-definition "$current" --query "taskDefinition.containerDefinitions[0].image" --output text)',
                'if [ "$running" = "$image" ]; then echo "already running $image"; exit 0; fi',
                'echo "$SERVICE: $running -> $image"',
                "td=$(aws ecs describe-task-definition --task-definition \"$current\" --query taskDefinition | jq --arg img \"$image\" '.containerDefinitions[0].image = $img | del(.taskDefinitionArn, .revision, .status, .requiresAttributes, .compatibilities, .registeredAt, .registeredBy, .deregisteredAt)')",
                'arn=$(aws ecs register-task-definition --cli-input-json "$td" --query "taskDefinition.taskDefinitionArn" --output text)',
                'aws ecs update-service --cluster "$CLUSTER" --service "$SERVICE" --task-definition "$arn" >/dev/null',
                'aws ecs wait services-stable --cluster "$CLUSTER" --services "$SERVICE"',
                'echo "deployed $image to $SERVICE"',
              ],
            },
          },
        }),
        timeout: cdk.Duration.minutes(30),
      });
      deployProject.addToRolePolicy(new iam.PolicyStatement({ actions: ["sts:AssumeRole"], resources: [deploymentRoleArn(stage)] }));

      pipeline.addStage({
        stageName: `Deploy-${stage}`,
        actions: [new codepipeline_actions.CodeBuildAction({ actionName: "Deploy", project: deployProject, input: buildOutput })],
      });
    }

    if (PIPELINE.alertEmails.length > 0) {
      const alerts = new sns.Topic(this, "Alerts", { topicName: "spn-mock-pipeline-alerts" });
      for (const email of PIPELINE.alertEmails) alerts.addSubscription(new subs.EmailSubscription(email));
      pipeline.onStateChange("Failed", {
        description: "spn-mock pipeline execution failed",
        eventPattern: { detail: { state: ["FAILED"] } },
        target: new targets.SnsTopic(alerts),
      });
    }

    new cdk.CfnOutput(this, "PipelineName", { value: pipeline.pipelineName });
    new cdk.CfnOutput(this, "RepositoryUri", { value: repository.repositoryUri });
  }
}
